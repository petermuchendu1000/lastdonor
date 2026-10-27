/**
 * A scheduled job that decides to do nothing says so where someone can see it.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The cron Worker logs the HTTP status of each call and **deliberately never
 * reads the response body** (`docs/66`). So a route that answers
 * `200 { ok: true, skipped: true }` is indistinguishable, from the Worker's
 * log, from one that did the work. The only place a skip can be seen is
 * `audit_logs`.
 *
 * `blog-generate` returned exactly that and wrote nothing. [VERIFIED
 * 2026-10-27 against production] it is scheduled 08:00 daily; there are
 * **eleven** `blog_topics_discovered` rows and **28 queued topics**, and
 * `blog_pipeline_completed` has **never been written once**. Nine days of
 * `blog-generate ok 200`, zero blog posts ever, and no row anywhere saying
 * why — because `BLOG_PIPELINE_ENABLED` is not `'true'` on the Fly app.
 *
 * Its sibling `send-newsletter` gets this right, which is the only reason
 * that refusal is discoverable: it writes an audit row carrying
 * `MAILING_POSTAL_ADDRESS is not set … (CAN-SPAM …)`, and that row is how we
 * know the newsletter has reached nobody.
 *
 * `docs/123`. The `docs/106` "exit 0 is not success" family, at the cron
 * layer.
 *
 * ── WHY THE JOB LIST IS DERIVED ─────────────────────────────────────────────
 *
 * From `CRON_SCHEDULE`, not typed here. That is what makes the rule apply to
 * a job added tomorrow, and it is also what correctly exempts
 * `simulate-donations` — which has three `skipped: true` paths and is
 * **deliberately not scheduled** (`docs/66`), so nothing is watching its log
 * to be misled by.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ⚠️ The export is `CRON_JOBS`. CLAUDE.md calls it `CRON_SCHEDULE`, which
// is a stale name - noted in `docs/123` rather than silently followed.
import { CRON_JOBS } from '@/lib/cron-schedule';

const ROOT = resolve(__dirname, '../../../../..');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^(\s*)\/\/.*$/gm, (m, indent: string) => indent + ' '.repeat(m.length - indent.length));
}

/**
 * The enclosing `{ … }` block that contains `index`, brace-matched outwards.
 *
 * ⚠️ It walks out THROUGH object literals. A `skipped: true` always sits
 * inside one - it is a property - so the nearest enclosing brace pair is
 * never the branch, and a naive version of this flagged both routes while
 * both were correct. An opener is an object literal when the character
 * before it is `(`, `,`, `=`, `:` or `[`, or the word before it is `return`;
 * otherwise (`)`, `;`, `{`, `}`, `=>`, `else`, `try`, `finally`, `do`) it
 * opens a statement block and the walk stops there.
 *
 * ⛔ It stops at the FIRST statement block, which is the branch. Walking
 * further would reach the handler body, and both routes write an audit row
 * on their success path - so the rule would pass against anything, which is
 * the "a check that cannot fail is not a check" failure mode.
 */
function enclosingStatementBlock(src: string, index: number): string {
  let from = index;
  for (let level = 0; level < 12; level++) {
    let depth = 0;
    let open = -1;
    for (let i = from; i >= 0; i--) {
      if (src[i] === '}') depth++;
      else if (src[i] === '{') {
        if (depth === 0) {
          open = i;
          break;
        }
        depth--;
      }
    }
    if (open === -1) return '';

    const before = src.slice(0, open).replace(/\s+$/, '');
    const ch = before.at(-1) ?? '';
    const isObjectLiteral =
      '(,=:['.includes(ch) || /\breturn$/.test(before);

    if (!isObjectLiteral) {
      // Brace-match forward to close it.
      let d = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') d++;
        else if (src[i] === '}') {
          d--;
          if (d === 0) return src.slice(open, i + 1);
        }
      }
      return src.slice(open);
    }
    from = open - 1;
  }
  return '';
}

const read = (p: string) => stripComments(readFileSync(resolve(ROOT, p), 'utf-8'));

type Route = { job: string; src: string };

const ROUTES: Route[] = CRON_JOBS.map((entry) => {
  const path = resolve(ROOT, `src/app/api/v1/cron/${entry.job}/route.ts`);
  return { job: entry.job, src: existsSync(path) ? stripComments(readFileSync(path, 'utf-8')) : '' };
});

describe('the sweep is looking at real scheduled jobs', () => {
  it('every scheduled job has a route on disk', () => {
    /*
      A job scheduled with no route is its own defect: the Worker would call
      it and log a 404, which `docs/66` says nothing surfaces.
    */
    const missing = ROUTES.filter((r) => r.src === '').map((r) => r.job);
    expect(missing).toEqual([]);
    expect(ROUTES.length).toBeGreaterThan(8);
  });
});

describe('the block finder itself', () => {
  it('⚠️ walks out of object literals and stops at the branch, not the function', () => {
    /*
      Gate 4: the sweep below is only as good as this. If the walk stopped at
      the first brace pair it would always miss (a `skipped: true` is a
      property, so its own literal never holds an audit call); if it ran to
      the handler body it would always hit, because both routes audit on
      their success path. Proven on a fixture, not on the routes.
    */
    const fixture = [
      'export async function GET() {',
      '  await db.insert(auditLogs).values({ eventType: \'outer\' });',
      '  if (disabled) {',
      '    return NextResponse.json({ ok: true, data: { skipped: true } });',
      '  }',
      '  return NextResponse.json({ ok: true });',
      '}',
    ].join('\n');

    const block = enclosingStatementBlock(fixture, fixture.indexOf('skipped: true'));
    expect(block.startsWith('{\n    return NextResponse')).toBe(true);
    expect(block).not.toMatch(/auditLogs/);
    expect(block).not.toMatch(/export async function/);
  });
});

describe('⛔ a scheduled job that skips records the skip', () => {
  it('every `skipped: true` response has an audit write in its own block', () => {
    /*
      ⚠️ The block is BRACE-MATCHED backwards from the return, not a fixed
      window. A character count does not know where a branch begins, which is
      the mistake `docs/116` §4 and `docs/120` §11.1 both record.

      Lock skips are not matched here and should not be: they go through
      `lockSkipPayload`, carry no `skipped: true` literal, and are transient
      contention rather than a configuration decision somebody needs to see.
    */
    const offenders: string[] = [];
    let examined = 0;

    for (const { job, src } of ROUTES) {
      for (const m of src.matchAll(/skipped:\s*true/g)) {
        const at = m.index ?? 0;
        // A `skipped: true` inside an audit row's own `details` IS the record.
        const block = enclosingStatementBlock(src, at);
        examined++;
        if (!/auditLogs/.test(block)) offenders.push(`${job}: a skip returns with no audit row`);
      }
    }

    // An empty sweep passes against anything.
    expect(examined).toBeGreaterThan(0);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('⛔ and blog-generate specifically, since that is the one that was silent', () => {
    const route = ROUTES.find((r) => r.job === 'blog-generate');
    expect(route, 'blog-generate is no longer scheduled').toBeTruthy();
    expect(route!.src).toMatch(/eventType: 'blog_pipeline_skipped'/);
    // Before the audit insert, not after the return.
    const insertAt = route!.src.indexOf("blog_pipeline_skipped");
    const returnAt = route!.src.indexOf('return NextResponse.json({ ok: true, skipped: true');
    expect(insertAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(-1);
    expect(insertAt).toBeLessThan(returnAt);
  });

  it('⛔ and its failure path records too, since that was equally silent', () => {
    /*
      Three ways this route could do nothing - flag off, lock held, pipeline
      threw - and all three wrote nothing, so they were indistinguishable in
      the database and the diagnosis had to be made by elimination. The lock
      skip is left alone (it is transient contention through the shared
      `lockSkipPayload`); the other two now leave a row.
    */
    const route = ROUTES.find((r) => r.job === 'blog-generate')!;
    const catchAt = route.src.indexOf('} catch (error) {');
    expect(catchAt).toBeGreaterThan(-1);
    const tail = route.src.slice(catchAt);
    expect(tail).toMatch(/eventType: 'blog_pipeline_failed'/);
    expect(tail).toMatch(/severity: 'error'/);
    // Before the 500, or it never runs.
    expect(tail.indexOf('blog_pipeline_failed')).toBeLessThan(tail.indexOf('status: 500'));
  });

  it('⚠️ and it no longer tells an operator to go to Vercel', () => {
    /*
      The old message said to set the variable "in Vercel env vars". This
      platform runs on Fly (`docs/26`, `docs/35`) and there is no Vercel
      console to open.
    */
    const route = ROUTES.find((r) => r.job === 'blog-generate')!;
    expect(route.src).not.toMatch(/Vercel/i);
    expect(route.src).toMatch(/Fly/);
  });

  it('send-newsletter still records its own refusal (the control)', () => {
    /*
      It is the reason we know the newsletter has reached nobody: two runs,
      zero sent, each with a row naming the missing postal address. If this
      ever stops, the rule above has lost its worked example.
    */
    const route = ROUTES.find((r) => r.job === 'send-newsletter');
    expect(route, 'send-newsletter is no longer scheduled').toBeTruthy();
    /*
      ⚠️ SCOPED to the refusal branch, not the file. Injection 3 removed this
      exact audit row and this control still passed, because the success path
      further down also writes one - `toMatch(/auditLogs/)` over the whole
      source is a check that cannot fail.
    */
    const branch = enclosingStatementBlock(route!.src, route!.src.indexOf('skipped: true'));
    expect(branch).toMatch(/db\.insert\(auditLogs\)/);
    expect(branch).not.toMatch(/export async function/);
    /*
      ⚠️ The reason is NOT a literal here: it is
      `MISSING_POSTAL_ADDRESS_REASON`, imported from
      `src/lib/unsubscribe-tokens.ts`. Asserting the variable name is the
      honest check - my first version matched `MAILING_POSTAL_ADDRESS`, the
      env var it is ABOUT, which the route never names.
    */
    expect(route!.src).toMatch(/MISSING_POSTAL_ADDRESS_REASON/);
    expect(read('src/lib/unsubscribe-tokens.ts')).toMatch(/MAILING_POSTAL_ADDRESS/);
  });
});
