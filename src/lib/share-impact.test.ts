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
/**
 * Rows per statement, in order, for the functions that issue MORE THAN ONE.
 *
 * `getImpactSummary` now runs two: the pre-folded join that `docs/58` is
 * about, and a separate per-currency sum of the money (`docs/92` - a sharer's
 * links can span campaigns in different currencies, so one blended total was
 * two kinds of money added together). When this queue is empty the driver
 * falls back to `nextRows`, so every single-statement test is unaffected.
 */
const rowQueue: { value: unknown[][][] } = vi.hoisted(() => ({ value: [] }));

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
    const rows = rowQueue.value.length ? rowQueue.value.shift()! : nextRows.value;
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
  getOwnGivingByCampaign,
  impactAmountsByCurrency,
} = await import('./share-impact');

/** The statement the call under test emitted. */
const lastSql = () => executed[executed.length - 1].sql;

beforeEach(() => {
  executed.length = 0;
  nextRows.value = [];
  rowQueue.value = [];
});

describe('getImpactSummary counts each link once', () => {
  /*
    ⚠️ These address `executed[0]` and not `lastSql()`, because this function
    now issues TWO statements: the pre-folded join below, then the
    per-currency money sum. Asserting the last one would have silently stopped
    checking the thing this file exists for - the visit-count fix of
    `docs/58`.
  */
  it('never aggregates visits with DISTINCT, which halves equal counts', async () => {
    await getImpactSummary('user-1');
    expect(executed[0].sql.toLowerCase()).not.toContain('sum(distinct');
  });

  it('folds donations to one row per link before joining', async () => {
    await getImpactSummary('user-1');
    const sql = executed[0].sql.toLowerCase();
    // The subquery is what stops a link's visits being multiplied by its
    // donation count. Its presence IS the fix.
    expect(sql).toMatch(/left join \(select [\s\S]*group by/);
    expect(sql).toContain('"per_link"');
  });

  it('⛔ keeps the currency OUT of the folded subquery', async () => {
    /*
      The money is NOT summed in this statement - `impactAmountsByCurrency`
      folds the per-campaign rows the page already has, because
      `/dashboard/impact` is on the `docs/87` fan-out allowlist and that list
      may only shrink.

      ⚠️ This assertion exists because of a mutation that SURVIVED: adding
      `currency: donations.currency` to `perLink` broke no test, since this
      harness asserts the SQL TEXT and not whether Postgres accepts it - that
      statement groups by `share_link_id`, so a bare currency column is a
      `must appear in the GROUP BY clause` error the stub driver happily
      returns rows for. Widening that subquery is how `docs/58`'s
      visit-count defects arose, so it is pinned.
    */
    await getImpactSummary('user-1');
    expect(executed).toHaveLength(1);
    const fold = executed[0].sql.toLowerCase();
    const subquery = fold.slice(fold.indexOf('left join ('), fold.indexOf(') "per_link"'));
    expect(subquery).not.toContain('currency');
  });

  it('reads the counts back in order, and carries no money field', async () => {
    nextRows.value = [[3, 2, 8]];
    const summary = await getImpactSummary('user-1');
    expect(summary).toEqual({ donorsBrought: 3, campaignsShared: 2, clicks: 8 });
    // A blended cross-currency total must not come back here again.
    expect('amountBroughtCents' in summary).toBe(false);
  });

  it('reports zeroes, not undefined, for a sharer with no links', async () => {
    nextRows.value = [];
    const summary = await getImpactSummary('user-1');
    expect(summary).toEqual({ donorsBrought: 0, campaignsShared: 0, clicks: 0 });
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

  it('excludes it from what the sharer gave themselves', async () => {
    await getOwnGivingByCampaign('user-1');
    expect(lastSql()).toMatch(/"refunded"\s*=\s*false/);
  });
});

describe('getOwnGivingByCampaign', () => {
  it('reads the sharer\'s own donations, not their links', async () => {
    await getOwnGivingByCampaign('user-1');
    const sql = lastSql().toLowerCase();
    expect(sql).toContain('from "donations"');
    // Keyed on who gave, not on who minted a link: a sharer's own gift
    // counts whether or not it arrived through their own link.
    expect(sql).toMatch(/"donations"\."user_id"\s*=/);
    expect(sql).not.toContain('campaign_share_links');
  });

  it('returns cents keyed by campaign', async () => {
    nextRows.value = [['camp-a', 5000], ['camp-b', 2500]];
    const giving = await getOwnGivingByCampaign('user-1');
    expect(giving.get('camp-a')).toBe(5000);
    expect(giving.get('camp-b')).toBe(2500);
  });

  it('is empty for a sharer who has never donated', async () => {
    nextRows.value = [];
    const giving = await getOwnGivingByCampaign('user-1');
    expect(giving.size).toBe(0);
  });
});

describe('getAttributedDonors honours anonymity in SQL', () => {
  it('resolves the displayed name in the query, not in the caller', async () => {
    await getAttributedDonors('user-1');
    expect(lastSql()).toMatch(/case when "donations"\."is_anonymous" then 'Anonymous'/);
  });

  it('returns the literal Anonymous for a hidden donor', async () => {
    /*
      Column order: donorName, amountMinor, currency, createdAt,
      campaignTitle, slug.

      ⚠️ This mock is POSITIONAL, so adding `donations.currency` to the
      select shifted every field after it. That is the cost of a call-shape
      mock and it is worth stating: the fields moved and the types caught it,
      which is the only reason this fixture is right.
    */
    nextRows.value = [
      ['Anonymous', 2000, 'KES', '2026-10-16T00:00:00.000Z', 'Aisha needs surgery', 'aisha'],
      ['Ada', 1000, 'KES', '2026-10-15T00:00:00.000Z', 'Aisha needs surgery', 'aisha'],
    ];
    const donors = await getAttributedDonors('user-1');
    expect(donors.map((d) => d.donorName)).toEqual(['Anonymous', 'Ada']);
    expect(donors[0].amountMinor).toBe(2000);
    // Without this the page renders a shilling gift with a dollar sign.
    expect(donors[0].currency).toBe('KES');
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

describe('impactAmountsByCurrency', () => {
  /*
    ⛔ THE DEFECT. `getImpactSummary` returned one `amountBroughtCents`
    summed across every link the sharer holds - across campaigns, therefore
    across currencies - and `/dashboard/impact` rendered it through a bare
    `<Money minor={...} />`, which falls back to USD. A sharer who brought in
    KES 2,500 and US$25 was shown a single figure that was neither, with a
    dollar sign on it (`docs/92`).
  */
  const row = (currency: string, amountBroughtMinor: number) => ({ currency, amountBroughtMinor });

  it('returns nothing for a sharer who has brought in nothing', () => {
    // The tile must then render nothing, not a zero in some default currency.
    expect(impactAmountsByCurrency([])).toEqual([]);
    expect(impactAmountsByCurrency([row('KES', 0)])).toEqual([]);
  });

  it('⛔ two currencies give TWO figures, never one blended total', () => {
    const out = impactAmountsByCurrency([row('KES', 250_000), row('USD', 2_500)]);
    expect(out).toEqual([
      { currency: 'KES', totalMinor: 250_000 },
      { currency: 'USD', totalMinor: 2_500 },
    ]);
    // 252_500 is what the old single-column sum produced.
    expect(out.some((a) => a.totalMinor === 252_500)).toBe(false);
  });

  it('folds SEVERAL links on the same campaign currency into one figure', () => {
    // A sharer can mint more than one link per campaign, so the rows are not
    // unique per currency and a map would drop all but the last.
    expect(impactAmountsByCurrency([row('KES', 1_000), row('KES', 2_500), row('KES', 500)])).toEqual([
      { currency: 'KES', totalMinor: 4_000 },
    ]);
  });

  it('leads with the biggest, and breaks ties by code', () => {
    expect(impactAmountsByCurrency([row('USD', 100), row('KES', 900)]).map((a) => a.currency))
      .toEqual(['KES', 'USD']);
    expect(impactAmountsByCurrency([row('USD', 500), row('KES', 500)]).map((a) => a.currency))
      .toEqual(['KES', 'USD']);
  });

  it('does not mutate its input', () => {
    const input = [row('KES', 5)];
    const copy = structuredClone(input);
    impactAmountsByCurrency(input);
    expect(input).toEqual(copy);
  });
});
