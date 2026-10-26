/**
 * `getReportPeriods` against a real Postgres.
 *
 * This file exists because `/admin/reports` answered **500 on every load**
 * and nothing in the repository could tell. The page's period query was an
 * inline `sql` template interpolating a JS `Date`, which binds a parameter
 * with no encoder and throws inside the driver. Typecheck passed, the unit
 * suite passed, the pool-fan-out ratchet passed (it counts queries, it does
 * not run them), and a grep over the SQL text read perfectly well.
 *
 * ⚠️ So the first assertion here is the cheapest one and the one that
 * matters: **the query executes.** Everything after it checks that the
 * numbers it returns are the right numbers, which is the other half - a
 * query that runs and silently reports zero is the `docs/101` defect, and
 * these totals are quoted to people as revenue.
 *
 * Every period boundary is tested with a row on BOTH sides of it. A boundary
 * assertion with data on one side only passes for a query that ignores the
 * boundary entirely.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { getReportPeriods } from '@/lib/report-periods';
import {
  startOfReportingMonth,
  startOfReportingYear,
} from '@/lib/reporting-timezone';
import { clearDatabase, seedCampaign } from '../../test/helpers';

let seq = 0;

async function addDonation(
  campaignId: string,
  amount: number,
  createdAt: Date,
  opts: { source?: 'real' | 'seed'; refunded?: boolean; currency?: string } = {},
) {
  seq += 1;
  await db.insert(schema.donations).values({
    campaignId,
    stripePaymentId: `pi_report_${Date.now()}_${seq}`,
    amount,
    donorName: 'Test Donor',
    donorEmail: 'donor@test.invalid',
    phaseAtTime: 'first_believers',
    // ⚠️ Must match the CAMPAIGN's currency: `donations_campaign_currency_fk`
    // is a composite FK on (campaign_id, currency) and the database refuses
    // anything else (`docs/92`). Leaving it defaulted is what made the
    // mixed-currency test below fail on its first run.
    currency: opts.currency ?? 'USD',
    source: opts.source ?? 'real',
    refunded: opts.refunded ?? false,
    createdAt,
  });
}

/** A fixed instant, so the month and year boundaries are not today's weather. */
const NOW = new Date('2026-06-15T12:00:00.000Z');
const MONTH_START = startOfReportingMonth(NOW);
const YEAR_START = startOfReportingYear(NOW);

/**
 * ⚠️ `getReportPeriods` now returns ONE ROW PER CURRENCY (`docs/92`): every
 * figure here was a `SUM(donations.amount)` with no currency in the GROUP BY,
 * rendered as dollars on `/admin/reports`. These single-currency tests pick
 * the row they were always about; the mixed-currency case at the bottom is
 * the one the old shape could not express.
 */
async function periodsFor(currency: string, now: Date) {
  const rows = await getReportPeriods(now);
  return (
    rows.find((r) => r.currency === currency) ?? {
      currency,
      ytd: { total: 0, count: 0, avgDonation: 0 },
      mtd: { total: 0, count: 0, avgDonation: 0 },
      allTime: { total: 0, count: 0, avgDonation: 0 },
      refunds: { total: 0, count: 0 },
    }
  );
}

describe('getReportPeriods', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await clearDatabase();
  });

  it('executes against Postgres and returns zeros on an empty table', async () => {
    // The whole defect in one line: this used to throw inside the driver.
    expect(await getReportPeriods(NOW)).toEqual([]);
    const periods = await periodsFor('USD', NOW);

    expect(periods.ytd).toEqual({ total: 0, count: 0, avgDonation: 0 });
    expect(periods.mtd).toEqual({ total: 0, count: 0, avgDonation: 0 });
    expect(periods.allTime).toEqual({ total: 0, count: 0, avgDonation: 0 });
    expect(periods.refunds).toEqual({ total: 0, count: 0 });
  });

  it('puts each donation in the periods its date belongs to', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });

    //                                                     mtd  ytd  all
    await addDonation(campaign.id, 1000, new Date(MONTH_START.getTime() + 3_600_000)); // y    y    y
    await addDonation(campaign.id, 3000, new Date(MONTH_START.getTime() + 7_200_000)); // y    y    y
    await addDonation(campaign.id, 500, new Date(MONTH_START.getTime() - 1)); //         n    y    y
    await addDonation(campaign.id, 700, YEAR_START); //                                  n    y    y
    await addDonation(campaign.id, 900, new Date(YEAR_START.getTime() - 1)); //          n    n    y

    const periods = await periodsFor('USD', NOW);

    expect(periods.mtd).toEqual({ total: 4000, count: 2, avgDonation: 2000 });
    expect(periods.ytd).toEqual({ total: 5200, count: 4, avgDonation: 1300 });
    expect(periods.allTime).toEqual({ total: 6100, count: 5, avgDonation: 1220 });
  });

  it('includes a donation exactly on the boundary and excludes the one before it', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });

    await addDonation(campaign.id, 100, MONTH_START);
    await addDonation(campaign.id, 7000, new Date(MONTH_START.getTime() - 1));

    const periods = await periodsFor('USD', NOW);

    // `>=` the boundary, so the instant itself is in the month.
    expect(periods.mtd.total).toBe(100);
    expect(periods.mtd.count).toBe(1);
  });

  it('never reports seed money as revenue', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });

    await addDonation(campaign.id, 2000, MONTH_START, { source: 'real' });
    await addDonation(campaign.id, 999_999, MONTH_START, { source: 'seed' });

    const periods = await periodsFor('USD', NOW);

    expect(periods.mtd.total).toBe(2000);
    expect(periods.ytd.total).toBe(2000);
    expect(periods.allTime.total).toBe(2000);
    expect(periods.allTime.count).toBe(1);
  });

  it('moves a refunded donation out of revenue and into the refund figure', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });

    await addDonation(campaign.id, 2500, MONTH_START, { refunded: false });
    await addDonation(campaign.id, 4000, MONTH_START, { refunded: true });
    // A refunded SEED donation is not a refund of anyone's money.
    await addDonation(campaign.id, 8000, MONTH_START, { source: 'seed', refunded: true });

    const periods = await periodsFor('USD', NOW);

    expect(periods.allTime).toEqual({ total: 2500, count: 1, avgDonation: 2500 });
    expect(periods.refunds).toEqual({ total: 4000, count: 1 });
  });

  it('reads the boundary from the instant it is given, not from the clock', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });

    await addDonation(campaign.id, 1500, new Date('2026-03-10T00:00:00.000Z'));

    // March, asked about in March: inside the month.
    const march = await periodsFor('USD', new Date('2026-03-20T00:00:00.000Z'));
    expect(march.mtd.total).toBe(1500);

    // The same row, asked about in June: same year, different month.
    const june = await periodsFor('USD', NOW);
    expect(june.mtd.total).toBe(0);
    expect(june.ytd.total).toBe(1500);
  });

  it('⛔ a mixed-currency platform gets ONE ROW PER CURRENCY, never one sum', async () => {
    /*
      The case the old single-row shape could not express, and the reason
      `/admin/reports` printed shillings and dollars added together under a
      dollar sign. A campaign is single-currency by composite FK; the
      PLATFORM is not.
    */
    const kes = await seedCampaign({ currency: 'KES', slug: `kes-${Date.now()}` });
    const usd = await seedCampaign({ currency: 'USD', slug: `usd-${Date.now()}` });

    await addDonation(kes.id, 1_840_000, new Date(MONTH_START.getTime() + 3_600_000), { currency: 'KES' });
    await addDonation(usd.id, 25_000, new Date(MONTH_START.getTime() + 3_600_000));

    const rows = await getReportPeriods(NOW);
    expect(rows).toHaveLength(2);
    expect(Object.fromEntries(rows.map((r) => [r.currency, r.allTime.total]))).toEqual({
      KES: 1_840_000,
      USD: 25_000,
    });
    // 1_865_000 is the blended figure the page used to publish.
    expect(rows.some((r) => r.allTime.total === 1_865_000)).toBe(false);
  });
});