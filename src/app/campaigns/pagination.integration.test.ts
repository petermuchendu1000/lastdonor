import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import { clearDatabase, seedCampaign } from '../../../test/helpers';
import { paginationModel } from '@/lib/pagination';

/**
 * Offset pagination, EXECUTED against a real Postgres.
 *
 * ## Why this file exists at all (docs/124, docs/130, docs/145)
 *
 * `page.test.tsx` drives the real page component, but its database is a mock
 * chain whose `offset()` records its argument and returns the same canned
 * rows. That proves the page ASKS for an offset. It cannot prove the offset
 * SLICES anything - a mock will happily return page 1's rows for every page,
 * which is precisely the defect being fixed.
 *
 * The property that matters is not "offset was called". It is that the pages,
 * concatenated, reproduce the full ordered result exactly once each: no row
 * skipped, no row repeated. That is a statement about Postgres and can only
 * be settled by running it.
 *
 * ⚠️ `docs/98`: this suite is serial and every file truncates the database.
 */

const PAGE_SIZE = 12;

/** The listing's own predicate and order, as `(index)/page.tsx` builds them. */
const LISTABLE = or(eq(campaigns.status, 'active'), eq(campaigns.status, 'last_donor_zone'))!;

async function fetchPage(page: number, pageSize = PAGE_SIZE) {
  const model = paginationModel({ total: 0, pageSize, requestedPage: page });
  return db
    .select({ slug: campaigns.slug, raisedAmount: campaigns.raisedAmount, id: campaigns.id })
    .from(campaigns)
    .where(and(LISTABLE))
    .orderBy(desc(campaigns.raisedAmount), asc(campaigns.id))
    .offset(model.offset)
    .limit(pageSize + 1);
}

describe('offset pagination partitions the listing', () => {
  beforeAll(async () => {
    await clearDatabase();
    // 29 rows: not a multiple of 12, so the last page is partial (5 rows) and
    // an off-by-one in the final slice cannot hide.
    for (let i = 0; i < 29; i++) {
      await seedCampaign({
        slug: `pagination-${String(i).padStart(2, '0')}`,
        title: `Pagination ${i}`,
        status: 'active',
        // Deliberately COLLIDING sort keys: five rows share raisedAmount, so
        // the `asc(id)` tiebreaker is the only thing making the order total.
        raisedAmount: i < 5 ? 1000 : 1000 + i,
      });
    }
  });

  afterAll(async () => {
    await clearDatabase();
  });

  it('seeds the fixture it claims to', async () => {
    // Anti-vacuity: without this, an empty table satisfies every rule below.
    const rows = await db.select({ id: campaigns.id }).from(campaigns).where(LISTABLE);
    expect(rows).toHaveLength(29);
  });

  it('page 1 and page 2 share NO rows', async () => {
    // The reported symptom, executed: before the fix both pages were identical.
    const p1 = (await fetchPage(1)).slice(0, PAGE_SIZE).map((r) => r.slug);
    const p2 = (await fetchPage(2)).slice(0, PAGE_SIZE).map((r) => r.slug);

    expect(p1).toHaveLength(12);
    expect(p2).toHaveLength(12);
    expect(p1.filter((s) => p2.includes(s))).toEqual([]);
  });

  it('the pages concatenated reproduce the full ordered list, once each', async () => {
    const whole = await db
      .select({ slug: campaigns.slug })
      .from(campaigns)
      .where(LISTABLE)
      .orderBy(desc(campaigns.raisedAmount), asc(campaigns.id));

    const walked: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const rows = await fetchPage(page);
      walked.push(...rows.slice(0, PAGE_SIZE).map((r) => r.slug));
    }

    // No gaps, no duplicates, and the SAME ORDER as one unpaginated query.
    expect(walked).toEqual(whole.map((r) => r.slug));
    expect(new Set(walked).size).toBe(29);
  });

  it('the last page is partial and there is nothing after it', async () => {
    const p3 = await fetchPage(3);
    expect(p3).toHaveLength(5); // 29 - 24, and below the overfetch of 13
    const p4 = await fetchPage(4);
    expect(p4).toHaveLength(0);
  });

  it('the overfetch agrees with the model about whether a next page exists', async () => {
    // The page derives "is there more" twice - from `limit(PAGE_SIZE + 1)` and
    // from the count. If those disagree the strip contradicts the listing.
    for (let page = 1; page <= 4; page++) {
      const rows = await fetchPage(page);
      const overfetchSawMore = rows.length > PAGE_SIZE;
      const model = paginationModel({ total: 29, pageSize: PAGE_SIZE, requestedPage: page });
      expect(overfetchSawMore, `page ${page}`).toBe(model.nextPage !== null);
    }
  });

  it('a page past the end returns nothing rather than wrapping round', async () => {
    const far = await fetchPage(99);
    expect(far).toHaveLength(0);
  });

  it('tied rows come back in id order, which is the query contract offset relies on', async () => {
    /*
      Five rows share `raisedAmount = 1000`. Without a total order Postgres is
      free to return them differently per query, so a row could appear on two
      pages or on none.

      ⚠️ WHAT THIS DOES AND DOES NOT PROVE. It pins the CONTRACT - tied rows
      emerge ascending by id - which is a real, checkable property of the query
      as written. It does NOT prove Postgres would misbehave without
      `asc(campaigns.id)`: at 29 rows the plan is a sort over a seq scan and
      the output is stable in practice, so an "assert it twice, expect the
      same" test would pass with the tiebreaker deleted. That would be a check
      that cannot fail. The necessity of the tiebreaker is an argument about
      what Postgres is PERMITTED to do, not something this fixture can
      demonstrate.
    */
    const tied = (await db
      .select({ slug: campaigns.slug, id: campaigns.id, raisedAmount: campaigns.raisedAmount })
      .from(campaigns)
      .where(and(LISTABLE, eq(campaigns.raisedAmount, 1000)))
      .orderBy(desc(campaigns.raisedAmount), asc(campaigns.id)));

    expect(tied).toHaveLength(5);
    const ids = tied.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('a different page size still partitions cleanly', async () => {
    // Proves the arithmetic, not the constant 12.
    const size = 7;
    const walked: string[] = [];
    for (let page = 1; page <= 5; page++) {
      walked.push(...(await fetchPage(page, size)).slice(0, size).map((r) => r.slug));
    }
    expect(walked).toHaveLength(29);
    expect(new Set(walked).size).toBe(29);
  });
});
