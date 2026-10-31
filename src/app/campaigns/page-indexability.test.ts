/**
 * An out-of-range listing page is not indexable, and a real one is.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * `generateMetadata` ran no query, so it could not tell a real page from one
 * past the end, and emitted `index, follow` with a self-referencing canonical
 * for both. [VERIFIED live on production v170] `/campaigns?page=99` answered
 * 200 / `index, follow` / canonical `?page=99` over ZERO cards - and with 8
 * live campaigns against a page size of 12 there was one page, so `?page=2`
 * answered exactly the same. Every page above 1 was an indexable empty URL,
 * not just an exotic probe. `docs/146` §9.2 reported it; `docs/166` fixes it.
 *
 * ── WHY THE RULES ARE SHAPED THIS WAY ─────────────────────────────────────
 *
 * The JUDGEMENT is executed, not read. `paginationRobots` is pure for that
 * reason: a condition inline in `generateMetadata` can be executed by
 * nothing, because that file imports the database and the whole page, and
 * text cannot see which way a branch points (`docs/162` §5.1).
 *
 * The WIRING is read from source, because no test can call `generateMetadata`
 * here. Both halves are needed: a correct judgement nothing calls is
 * `docs/83`'s shape, and a call site passing the wrong total is `docs/119`'s.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { paginationRobots } from '@/lib/pagination';

const PAGE = join(process.cwd(), 'src/app/campaigns/(index)/page.tsx');
const PAGE_SIZE = 12;

function source(): string {
  return readFileSync(PAGE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

describe('EXECUTED: the indexability judgement', () => {
  it('⛔ a page PAST the end is noindex', () => {
    // 8 campaigns = one page. This is production's exact shape today.
    expect(paginationRobots({ total: 8, pageSize: PAGE_SIZE, requestedPage: 2 })).toEqual({
      index: false,
      follow: true,
    });
    expect(paginationRobots({ total: 8, pageSize: PAGE_SIZE, requestedPage: 99 })).toEqual({
      index: false,
      follow: true,
    });
  });

  it('⛔ CONTROL: a REAL page is indexable', () => {
    /*
      This is the control that matters. A blanket "noindex anything above
      page 1" needs no query and would pass the rule above - while
      de-indexing the pages `docs/145` built crawlable pagination to expose.
      17 campaigns at 12 per page is two real pages.
    */
    expect(paginationRobots({ total: 17, pageSize: PAGE_SIZE, requestedPage: 1 })).toEqual({
      index: true,
      follow: true,
    });
    expect(paginationRobots({ total: 17, pageSize: PAGE_SIZE, requestedPage: 2 })).toEqual({
      index: true,
      follow: true,
    });
    // ...and the first page PAST those two is not.
    expect(
      paginationRobots({ total: 17, pageSize: PAGE_SIZE, requestedPage: 3 }).index,
    ).toBe(false);
  });

  it('⛔ both boundaries, exactly', () => {
    // 24 = exactly two full pages: page 2 real, page 3 not.
    expect(paginationRobots({ total: 24, pageSize: PAGE_SIZE, requestedPage: 2 }).index).toBe(true);
    expect(paginationRobots({ total: 24, pageSize: PAGE_SIZE, requestedPage: 3 }).index).toBe(false);
    // 25 = two full pages plus one: page 3 becomes real.
    expect(paginationRobots({ total: 25, pageSize: PAGE_SIZE, requestedPage: 3 }).index).toBe(true);
  });

  it('⚠️ an EMPTY listing still has one page, and page 1 is indexable', () => {
    /*
      `paginationModel` makes an empty result ONE page - "the page that says
      so" - so `/campaigns` with nothing to show must not noindex itself. The
      review gate emptied this listing for a day (`docs/79`), and that day
      must not also de-index the URL.
    */
    expect(paginationRobots({ total: 0, pageSize: PAGE_SIZE, requestedPage: 1 }).index).toBe(true);
    expect(paginationRobots({ total: 0, pageSize: PAGE_SIZE, requestedPage: 2 }).index).toBe(false);
  });

  it('⛔ `follow` is NEVER withdrawn', () => {
    /*
      Only indexing is withdrawn. The page still carries the site navigation
      and, on a real page, `rel="prev"` - and `docs/145` built this pagination
      so crawlers could WALK it. A rule that also dropped `follow` would undo
      that while passing every assertion above.
    */
    for (const requestedPage of [1, 2, 3, 99]) {
      for (const total of [0, 8, 17, 24, 25]) {
        expect(
          paginationRobots({ total, pageSize: PAGE_SIZE, requestedPage }).follow,
          `total=${total} page=${requestedPage}`,
        ).toBe(true);
      }
    }
  });
});

describe('the wiring: generateMetadata actually asks', () => {
  it('⛔ it reads a real total and passes it to the judgement', () => {
    const src = source();
    const meta = src.slice(
      src.indexOf('export async function generateMetadata'),
      src.indexOf('const metadata: Metadata'),
    );
    expect(meta.length, 'generateMetadata not found - this rule needs rewriting').toBeGreaterThan(
      120,
    );
    // It must obtain the matched total...
    expect(meta, 'generateMetadata does not read the matched total').toMatch(
      /browseCounts\s*\(/,
    );
    // ...and decide robots from it, rather than hardcoding one.
    expect(meta, 'generateMetadata does not call the judgement').toMatch(
      /paginationRobots\s*\(/,
    );
    expect(meta, 'robots is not returned').toMatch(/\brobots\b/);
  });

  it('⛔ the page body and generateMetadata read the SAME count function', () => {
    /*
      Two counts would be two ideas of what matches - the defect class
      `docs/146`, `docs/147`, `docs/164` and `docs/165` are instances of. One
      function, called by both.
    */
    const src = source();
    /*
      ⚠️ EXCLUDES THE DEFINITION. The first version counted
      `/browseCounts\s*\(/g` and found THREE, because
      `async function browseCounts(` matches the same pattern - so the rule
      was asserting a number that included the thing being called. Counting
      CALLS means not preceded by `function `.
    */
    const calls = (src.match(/(?<!function\s)browseCounts\s*\(/g) ?? []).length;
    expect(calls, 'expected exactly two callers: metadata and the page').toBe(2);
  });

  it('⛔ no separate filtered-count query came back', () => {
    /*
      THE CONCURRENCY PROPERTY, and it is why the fix is free.

      Measured with `log_statement=all`: before this change one request issued
      FOUR queries against `campaigns` on the filtered path (rows, tab counts,
      a filtered count, and `generateMetadata`'s own) - over `docs/87`'s cap of
      three. Folding `matched` into the same FILTER-aggregate scan makes the
      page body TWO and `generateMetadata` ONE, measured at THREE in total.

      ⚠️ So a reinstated standalone count query is not a tidiness regression,
      it is a return to four. `docs/87` is a pool-wedge incident, not a style
      preference.
    */
    const src = source();
    expect(src, 'a standalone COUNT(*) query is back in the page body').not.toMatch(
      /select\(\s*\{\s*count:\s*sql/,
    );
    // And the three aggregates must still share one scan.
    const counts = src.match(/count\(\*\) FILTER/g) ?? [];
    expect(counts.length, 'expected three FILTER aggregates in one query').toBe(3);
  });

  it('ANTI-VACUITY: the source reader is reading the real file', () => {
    const src = source();
    expect(src).toContain('export default async function CampaignsPage');
    expect(src.length).toBeGreaterThan(4000);
  });
});
