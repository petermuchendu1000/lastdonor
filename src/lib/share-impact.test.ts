/**
 * "Your impact" aggregation.
 *
 * These tests run the REAL query builder against a stub driver, so what is
 * asserted is the SQL that would reach Postgres and the mapping of the rows
 * that come back - not the shape of a mock's call log.
 *
 * That distinction is the whole reason the file exists. The first draft of
 * `getImpactSummary` aggregated visits across a join, and a call-shape mock
 * would have passed it happily. Checked against the live database on
 * 2026-10-16 with two links of 4 visits each and 3 counting donations on one
 * of them (truth: 8 visits):
 *
 *   sum(distinct click_count)  ->  4   (DISTINCT dedupes the VALUES)
 *   sum(click_count) over join -> 16   (each link multiplied by its donations)
 *   pre-folded subquery        ->  8   correct, and what ships
 *
 * See `docs/58`.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Every statement the builder emitted, in order. */
const executed: { sql: string; params: unknown[] }[] = vi.hoisted(() => []);
/** Positional rows the stub driver hands back for the next statement. */
const nextRows: { value: unknown[][] } = vi.hoisted(() => ({ value: [] }));

vi.mock('@/db', async () => {
  const { drizzle: makeDb } = await import('drizzle-orm/postgres-js');
  const s = await import('@/db/schema');

  // A function, not an object: `drizzle()` only treats an object literal as a
  // config bag, so a callable is routed straight to the driver constructor.
  // The constructor installs transparent type parsers, hence `options`.
  const client = (() => undefined) as unknown as Record<string, unknown>;
  client.options = { parsers: {}, serializers: {} };
  client.unsafe = (sql: string, params: unknown[]) => {
    executed.push({ sql, params });
    const rows = nextRows.value;
    return {
      values: async () => rows,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
  };

  return { db: makeDb(client as never, { schema: s }) };
});

const {
  getImpactSummary,
  getImpactByCampaign,
  getAttributedDonors,
} = await import('./share-impact');

/** The statement the call under test emitted. */
const lastSql = () => executed[executed.length - 1].sql;

beforeEach(() => {
  executed.length = 0;
  nextRows.value = [];
});

describe('getImpactSummary counts each link once', () => {
  it('never aggregates visits with DISTINCT, which halves equal counts', async () => {
    await getImpactSummary('user-1');
    expect(lastSql().toLowerCase()).not.toContain('sum(distinct');
  });

  it('folds donations to one row per link before joining', async () => {
    await getImpactSummary('user-1');
    const sql = lastSql().toLowerCase();
    // The subquery is what stops a link's visits being multiplied by its
    // donation count. Its presence IS the fix.
    expect(sql).toMatch(/left join \(select [\s\S]*group by/);
    expect(sql).toContain('"per_link"');
  });

  it('scopes to the signed-in sharer', async () => {
    await getImpactSummary('user-1');
    expect(executed[0].params).toContain('user-1');
  });

  it('reads the four totals back in order', async () => {
    nextRows.value = [[3, 6000, 2, 8]];
    const summary = await getImpactSummary('user-1');
    expect(summary).toEqual({
      donorsBrought: 3,
      amountBroughtCents: 6000,
      campaignsShared: 2,
      clicks: 8,
    });
  });

  it('reports zeroes, not undefined, for a sharer with no links', async () => {
    nextRows.value = [];
    const summary = await getImpactSummary('user-1');
    expect(summary).toEqual({
      donorsBrought: 0,
      amountBroughtCents: 0,
      campaignsShared: 0,
      clicks: 0,
    });
  });
});

describe('refunded money is never credited to a sharer', () => {
  it('excludes it from the totals', async () => {
    await getImpactSummary('user-1');
    expect(lastSql()).toMatch(/"refunded"\s*=\s*false/);
  });

  it('excludes it from the per-campaign breakdown', async () => {
    await getImpactByCampaign('user-1');
    expect(lastSql()).toMatch(/"refunded"\s*=\s*false/);
  });

  it('excludes it from the list of people brought in', async () => {
    await getAttributedDonors('user-1');
    expect(lastSql()).toMatch(/"refunded"\s*=\s*false/);
  });
});

describe('getAttributedDonors honours anonymity in SQL', () => {
  it('resolves the displayed name in the query, not in the caller', async () => {
    await getAttributedDonors('user-1');
    expect(lastSql()).toMatch(/case when "donations"\."is_anonymous" then 'Anonymous'/);
  });

  it('returns the literal Anonymous for a hidden donor', async () => {
    // Column order: donorName, amountCents, createdAt, campaignTitle, slug.
    nextRows.value = [
      ['Anonymous', 2000, '2026-10-16T00:00:00.000Z', 'Aisha needs surgery', 'aisha'],
      ['Ada', 1000, '2026-10-15T00:00:00.000Z', 'Aisha needs surgery', 'aisha'],
    ];
    const donors = await getAttributedDonors('user-1');
    expect(donors.map((d) => d.donorName)).toEqual(['Anonymous', 'Ada']);
    expect(donors[0].amountCents).toBe(2000);
    expect(donors[0].createdAt).toBeInstanceOf(Date);
  });

  it('is bounded, so one prolific sharer cannot pull an unbounded read', async () => {
    await getAttributedDonors('user-1');
    expect(lastSql().toLowerCase()).toContain('limit');
  });
});

describe('getImpactByCampaign', () => {
  it('groups per link and leads with the links that worked', async () => {
    await getImpactByCampaign('user-1');
    const sql = lastSql().toLowerCase();
    expect(sql).toContain('group by');
    expect(sql).toMatch(/order by count\(.*\) desc/);
  });

  it('keeps a shared campaign with no donations yet, so it can be chased', async () => {
    // A left join is what keeps a zero-donation link in the list; an inner
    // join would silently hide exactly the links a sharer needs to see.
    await getImpactByCampaign('user-1');
    expect(lastSql().toLowerCase()).toContain('left join "donations"');
  });
});
