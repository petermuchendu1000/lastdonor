import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import robots from './robots';

/**
 * robots.txt must not forbid the fetch the rest of the stack depends on.
 *
 * ## The defect this encodes (docs/142)
 *
 * `robots.ts` disallowed `/api/` for all twelve user-agent groups. Every
 * `og:image` on this site is `/api/v1/og/page?…` or
 * `/api/v1/og/campaign/<slug>` - 26 source files emit one, and there is no
 * `opengraph-image` convention route anywhere - while `src/middleware.ts`
 * declares both routes public with the reason "fetched by social crawlers that
 * hold no session", and `src/lib/facebook-rescrape.ts` exists solely to ask
 * Facebook to fetch them again. So one file was built for the fetch and
 * another forbade it.
 *
 * ## Why this shape
 *
 * The og paths are DISCOVERED from the files that actually emit them, not
 * listed here. A hand-written list is the thing that failed in docs/116 §4 and
 * docs/123 §4; if a new template emits a new og URL under a disallowed prefix,
 * this fails without anyone editing this file.
 *
 * The evaluator implements RFC 9309 group selection and longest-match
 * precedence (ties go to allow), because that is what decides the question and
 * a substring check does not.
 */

type Rule = { userAgent: string | string[]; allow?: string | string[]; disallow?: string | string[] };

const SRC = join(__dirname, '..');
const APP = __dirname;
const SKIP_DIRS = new Set(['node_modules', '.next']);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * Every distinct `/api/...` path referenced as an image URL in src/.
 *
 * `robots.ts` is EXCLUDED on purpose: it contains the same string as its own
 * allowance, so including it would let the config satisfy its own rule - and
 * it made my first anti-vacuity injection measure the wrong thing (docs/142).
 * The input to this rule is what the app EMITS, never what robots.ts permits.
 */
function discoveredOgPaths(): string[] {
  const found = new Set<string>();
  const selfConfig = join(APP, 'robots.ts');
  for (const f of sourceFiles(SRC)) {
    if (f === selfConfig) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/['"`](\/api\/v1\/og\/[^'"`?\s]*)/g)) {
      // Normalise a template-literal slug into a concrete probe path.
      found.add(m[1]!.replace(/\$\{[^}]*\}/g, 'probe-slug'));
    }
  }
  return [...found].sort();
}

const RULES = (robots().rules ?? []) as Rule[];

function asList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** RFC 9309: most specific user-agent group wins; `*` only as fallback. */
function groupFor(agent: string): Rule | undefined {
  const a = agent.toLowerCase();
  let best: { len: number; rule: Rule } | undefined;
  for (const r of RULES) {
    for (const ua of asList(r.userAgent)) {
      const token = ua.toLowerCase();
      if (token === '*') continue;
      if (a === token || a.startsWith(token)) {
        if (!best || token.length > best.len) best = { len: token.length, rule: r };
      }
    }
  }
  if (best) return best.rule;
  return RULES.find((r) => asList(r.userAgent).includes('*'));
}

/** RFC 9309: longest matching path wins; equal length favours allow. */
function isAllowed(agent: string, path: string): boolean {
  const g = groupFor(agent);
  if (!g) return true;
  let win: { kind: 'allow' | 'disallow'; pat: string } | undefined;
  const consider = (kind: 'allow' | 'disallow', pats: string[]) => {
    for (const pat of pats) {
      if (!pat || !path.startsWith(pat)) continue;
      if (
        !win ||
        pat.length > win.pat.length ||
        (pat.length === win.pat.length && kind === 'allow')
      ) {
        win = { kind, pat };
      }
    }
  };
  consider('allow', asList(g.allow));
  consider('disallow', asList(g.disallow));
  return win ? win.kind === 'allow' : true;
}

const OG_PATHS = discoveredOgPaths();
/** Agents whose fetch of an og:image matters: search, answer engines, unfurlers. */
const FETCHERS = ['*', 'Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'facebookexternalhit', 'Twitterbot'];

describe('robots.txt keeps the Open Graph card crawlable', () => {
  it('discovers og image paths from the source that emits them', () => {
    // Anti-vacuity. Without this, deleting every og:image would satisfy rule 2.
    expect(OG_PATHS.length).toBeGreaterThan(0);
    expect(OG_PATHS.some((p) => p.startsWith('/api/v1/og/'))).toBe(true);
  });

  it.each(FETCHERS)('%s may fetch every og:image path', (agent) => {
    const blocked = OG_PATHS.filter((p) => !isAllowed(agent, p));
    expect(blocked).toEqual([]);
  });

  /**
   * Controls. The allowance must be NARROW: if these come back allowed, the
   * fix opened `/api/` wholesale and this rule has stopped meaning anything.
   */
  it.each([
    ['/api/v1/admin/users'],
    ['/api/v1/donations/create-checkout'],
    ['/api/auth/session'],
    ['/admin/users'],
    ['/dashboard/campaigns'],
  ])('%s stays disallowed for the default group', (path) => {
    expect(isAllowed('*', path)).toBe(false);
  });

  it('still allows ordinary public pages (the evaluator can say yes)', () => {
    expect(isAllowed('*', '/campaigns/example-slug')).toBe(true);
    expect(isAllowed('Googlebot', '/')).toBe(true);
  });

  it('leaves CCBot blocked from everything, og card included', () => {
    // A deliberate whole-site block (robots.ts). Widening the og allowance
    // must not have reached into it.
    expect(isAllowed('CCBot', '/campaigns/example-slug')).toBe(false);
    for (const p of OG_PATHS) expect(isAllowed('CCBot', p)).toBe(false);
  });

  it('agrees with the middleware, which declares those routes public', () => {
    const mw = readFileSync(join(SRC, 'middleware.ts'), 'utf8');
    // The middleware writes these as ESCAPED regexes (`/^\/api\/v1\/og\/page$/`),
    // so the plain substring `/og/page` is not in the file.
    expect(mw).toContain('og\\/page');
    expect(mw).toContain('og\\/campaign\\/');
    // Both ends must say the same thing: public to crawlers in the middleware,
    // allowed to crawlers in robots.txt.
    expect(isAllowed('*', '/api/v1/og/page')).toBe(true);
    expect(isAllowed('*', '/api/v1/og/campaign/probe-slug')).toBe(true);
  });

  it('scans the app directory it claims to scan', () => {
    expect(sourceFiles(APP).length).toBeGreaterThan(50);
  });
});
