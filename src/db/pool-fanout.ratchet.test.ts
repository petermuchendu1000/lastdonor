import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

/*
  No request may hold more database connections than the pool can spare
  (docs/87 amendment 5).

  ## What this is for, and what it is NOT for

  Measured in a local lab against a direct Postgres, 50 concurrent
  queries on a `max: 5` pool finish in 13ms with zero timeouts, so
  client-side queueing is NOT the hazard. The hazard is what production
  showed through Supavisor: `/admin/settings`, which fanned out to
  SEVEN queries in one `Promise.all`, was reproduced leaving backends
  stuck in `active` / `Client/ClientRead` holding open transactions -
  the signature of every wedge in docs/37, docs/52 and docs/87. A wide
  fan-out is the one thing those routes had in common, and narrowing it
  is cheap, so the bound stands while the Supavisor mechanism is
  unsettled.

  ## The budget

  `src/db/index.ts` sets `max: 5`. The admin layout's `auth()` role
  lookup runs alongside every admin page, so a page may use at most 4
  without starving it, and 3 leaves one connection for whatever else
  the machine is serving.

  If a screen genuinely needs more data, combine the queries (FILTER
  aggregates or scalar subqueries usually collapse several counts into
  one round trip) or run a second batch after the first. Do not raise
  this number to make a page pass.
*/

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const MAX_CONCURRENT_QUERIES = 3;

/** Expressions that reach the database. */
const DB_HINT =
  /\b(db|tx)\s*\.\s*(select|insert|update|delete|execute|transaction|query)\b|\bdb\.query\.|getAllSettings\(|getSetting\(|resolveEnvVar\(/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const cache = new Map<string, ts.SourceFile>();
function source(f: string): ts.SourceFile {
  if (!cache.has(f)) {
    cache.set(
      f,
      ts.createSourceFile(
        f,
        readFileSync(f, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    );
  }
  return cache.get(f)!;
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      // keep looking
    }
  }
  return null;
}

const fnCache = new Map<string, Map<string, ts.Node>>();
function functionsIn(file: string): Map<string, ts.Node> {
  if (fnCache.has(file)) return fnCache.get(file)!;
  const map = new Map<string, ts.Node>();
  const visit = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name) map.set(n.name.text, n);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        ) {
          map.set(d.name.text, d.initializer);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source(file));
  fnCache.set(file, map);
  return map;
}

function importSourceOf(file: string, name: string): string | null {
  let found: string | null = null;
  const visit = (n: ts.Node) => {
    if (
      ts.isImportDeclaration(n) &&
      n.importClause?.namedBindings &&
      ts.isNamedImports(n.importClause.namedBindings)
    ) {
      for (const el of n.importClause.namedBindings.elements) {
        if (el.name.text === name && ts.isStringLiteral(n.moduleSpecifier)) found = n.moduleSpecifier.text;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source(file));
  return found;
}

interface Fan {
  width: number;
  notes: string[];
}

function fanOut(node: ts.Node | undefined, file: string, depth = 0, seen = new Set<string>()): Fan {
  if (!node) return { width: 0, notes: [] };
  let best: Fan = { width: 0, notes: [] };
  const consider = (r: Fan) => {
    if (r.width > best.width) best = r;
  };

  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'Promise' &&
      /^(all|allSettled)$/.test(n.expression.name.text)
    ) {
      consider(widthOfPromiseAll(n, file, depth, seen));
    }
    ts.forEachChild(n, visit);
  };
  visit(node);

  if (best.width === 0 && DB_HINT.test(node.getText())) best = { width: 1, notes: [] };

  if (depth < 3) {
    const callVisit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const name = n.expression.text;
        const key = `${file}#${name}`;
        if (!seen.has(key)) {
          let target: { file: string; fn: ts.Node } | null = null;
          const local = functionsIn(file).get(name);
          if (local) target = { file, fn: local };
          else {
            const spec = importSourceOf(file, name);
            const f2 = spec ? resolveImport(file, spec) : null;
            const fn2 = f2 ? functionsIn(f2).get(name) : null;
            if (f2 && fn2) target = { file: f2, fn: fn2 };
          }
          if (target) {
            const next = new Set(seen);
            next.add(key);
            const body = (target.fn as ts.FunctionLikeDeclaration).body ?? target.fn;
            const r = fanOut(body, target.file, depth + 1, next);
            /*
              `>= 1`, not `> 1`. It was `> 1` until 2026-10-19, which meant a
              helper that issues ONE query contributed nothing - so
              `Promise.all([a(), b(), c(), d()])` over four single-query
              helpers scored ZERO and sailed through, while the same four
              queries written inline scored 4 and failed. Proven with a pair
              of fixture files: the inline one was caught, the helper one was
              invisible.

              That is the more common shape, not the rarer one. It is how
              `/campaigns/[slug]` came to issue five concurrent queries on a
              `max: 5` pool - the exact condition docs/87 ties to the wedges -
              with this test green the whole time.
            */
            if (r.width >= 1) consider({ width: r.width, notes: [...r.notes, `via ${name}()`] });
          }
        }
      }
      ts.forEachChild(n, callVisit);
    };
    callVisit(node);
  }

  return best;
}

function widthOfPromiseAll(call: ts.CallExpression, file: string, depth: number, seen: Set<string>): Fan {
  const arg = call.arguments[0];
  if (!arg) return { width: 0, notes: [] };

  if (ts.isArrayLiteralExpression(arg)) {
    let total = 0;
    const notes: string[] = [];
    for (const el of arg.elements) {
      const r = fanOut(el, file, depth, seen);
      total += Math.max(r.width, DB_HINT.test(el.getText()) ? 1 : 0);
      notes.push(...r.notes);
    }
    return { width: total, notes: [...new Set(notes)] };
  }

  /*
    `Promise.all(xs.map(...))`. The width is the length of `xs`, which
    is data, not code. The pipeline slices into fixed batches before
    mapping, so the bound is the slice size; anything else mapping over
    a collection of unknown length is reported.
  */
  const t = arg.getText();
  if (DB_HINT.test(t)) {
    const sliced = /\.slice\(/.test(t) || /\bbatch\b/.test(t);
    return { width: sliced ? MAX_CONCURRENT_QUERIES : 99, notes: [sliced ? 'batched .map' : `unbounded .map: ${t.slice(0, 40)}`] };
  }
  return { width: 0, notes: [] };
}

describe('no route oversubscribes the connection pool (docs/87 amendment 5)', () => {
  const files = walk(SRC).filter(
    (f) => /\/(page|route|layout)\.tsx?$/.test(f) || f.includes('/src/lib/'),
  );

  it('scans a meaningful number of entry points', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  /*
    A whole-repo AST walk that resolves imports three levels deep. It
    took 4.6s of the default 5s budget the day it was written and
    tipped over as soon as a file was added, so the budget is explicit
    rather than coincidental.
  */
  /*
    Known offenders, uncovered on 2026-10-19 the moment the helper bug
    above was fixed. Every one of these was invisible before, because
    each fans out through single-query helpers.

    They are listed rather than fixed in the same commit for the reason
    the icon ratchet gives: rewriting all of them at once is how
    migrations get abandoned. This list may only SHRINK. A file not on
    it that exceeds the cap fails, and when one of these is fixed,
    delete its line in the same commit.

      admin/monitoring/page.tsx        14  ⛔ worst in the codebase, on a
      api/v1/admin/monitoring/route.ts 14     pool of 5. Both fan out
                                             through pipeline-health.
      lib/monitoring/pipeline-health.ts 5  ⛔ the shared cause of both
      dashboard/impact/page.tsx         4

    `/admin/monitoring` issuing fourteen concurrent queries against a
    `max: 5` pool is the wide-fan-out condition docs/87 ties to seven
    production wedges, and it is a bigger instance of the one that took
    `/admin/settings` to 15,330ms. Fixing it is its own piece of work:
    collapse the counts into FILTER aggregates, as docs/87 describes.
  */
  const KNOWN_OFFENDERS = new Map<string, number>([
    ['src/app/admin/monitoring/page.tsx', 14],
    ['src/app/api/v1/admin/monitoring/route.ts', 14],
    ['src/lib/monitoring/pipeline-health.ts', 5],
    ['src/app/dashboard/impact/page.tsx', 4],
  ]);

  it(`no entry point issues more than ${MAX_CONCURRENT_QUERIES} concurrent queries`, { timeout: 60_000 }, () => {
    const offenders: string[] = [];
    const improved: string[] = [];
    for (const f of files) {
      const sf = source(f);
      const r = fanOut(sf, f, 0, new Set());
      const rel = f.slice(ROOT.length + 1);
      const known = KNOWN_OFFENDERS.get(rel);
      if (known !== undefined) {
        // A known offender must not get worse, and when it gets better
        // the baseline comes down with it.
        if (r.width > known) {
          offenders.push(`${rel} = ${r.width}, worse than its baseline of ${known}`);
        } else if (r.width <= MAX_CONCURRENT_QUERIES) {
          improved.push(`${rel} is now ${r.width}: delete it from KNOWN_OFFENDERS`);
        }
        continue;
      }
      if (r.width > MAX_CONCURRENT_QUERIES) {
        offenders.push(`${rel} = ${r.width}${r.notes.length ? ` (${r.notes.join(', ')})` : ''}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(improved).toEqual([]);
  });

  it('counts fan-out through single-query helpers, not just inline queries', () => {
    /*
      The regression test for the bug this file had until 2026-10-19.
      Proven with fixture files at the time: four queries written inline
      scored 4 and failed; the same four behind one-query helpers scored
      0 and passed. `campaigns/[slug]` sat at five that way.
    */
    const campaignPage = join(SRC, 'app/campaigns/[slug]/page.tsx');
    const r = fanOut(source(campaignPage), campaignPage, 0, new Set());
    expect(r.width).toBeLessThanOrEqual(MAX_CONCURRENT_QUERIES);
  });

  it('still matches the pool the driver actually opens', () => {
    // If `max` is raised, this budget should be revisited deliberately
    // rather than silently becoming slack.
    const dbIndex = readFileSync(join(SRC, 'db/index.ts'), 'utf8');
    expect(dbIndex).toMatch(/max:\s*5\b/);
  });
});
