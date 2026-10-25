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
  opts: { source?: 'real' | 'seed'; refunded?: boolean } = {},
) {
  seq += 1;
  await db.insert(schema.donations).values({
    campaignId,
    stripePaymentId: `pi_report_${Date.now()}_${seq}`,
    amount,
    donorName: 'Test Donor',
    donorEmail: 'donor@test.invalid',
    phaseAtTime: 'first_believers',
    source: opts.source ?? 'real',
    refunded: opts.refunded ?? false,
    createdAt,
    currency: 'USD',
  });
}

/** A fixed instant, so the month and year boundaries are not today's weather. */
const NOW = new Date('2026-06-15T12:00:00.000Z');
const MONTH_START = startOfReportingMonth(NOW);
const YEAR_START = startOfReportingYear(NOW);

describe('getReportPeriods', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await clearDatabase();
  });

  it('executes against Postgres and returns zeros on an empty table', async () => {
    // The whole defect in one line: this used to throw inside the driver.
    const periods = await getReportPeriods(NOW);

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

    const periods = await getReportPeriods(NOW);

    expect(periods.mtd).toEqual({ total: 4000, count: 2, avgDonation: 2000 });
    expect(periods.ytd).toEqual({ total: 5200, count: 4, avgDonation: 1300 });
    expect(periods.allTime).toEqual({ total: 6100, count: 5, avgDonation: 1220 });
  });

  it('includes a donation exactly on the boundary and excludes the one before it', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });

    await addDonation(campaign.id, 100, MONTH_START);
    await addDonation(campaign.id, 7000, new Date(MONTH_START.getTime() - 1));

    const periods = await getReportPeriods(NOW);

    // `>=` the boundary, so the instant itself is in the month.
    expect(periods.mtd.total).toBe(100);
    expect(periods.mtd.count).toBe(1);
  });

  it('never reports seed money as revenue', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });

    await addDonation(campaign.id, 2000, MONTH_START, { source: 'real' });
    await addDonation(campaign.id, 999_999, MONTH_START, { source: 'seed' });

    const periods = await getReportPeriods(NOW);

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

    const periods = await getReportPeriods(NOW);

    expect(periods.allTime).toEqual({ total: 2500, count: 1, avgDonation: 2500 });
    expect(periods.refunds).toEqual({ total: 4000, count: 1 });
  });

  it('reads the boundary from the instant it is given, not from the clock', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });

    await addDonation(campaign.id, 1500, new Date('2026-03-10T00:00:00.000Z'));

    // March, asked about in March: inside the month.
    const march = await getReportPeriods(new Date('2026-03-20T00:00:00.000Z'));
    expect(march.mtd.total).toBe(1500);

    // The same row, asked about in June: same year, different month.
    const june = await getReportPeriods(NOW);
    expect(june.mtd.total).toBe(0);
    expect(june.ytd.total).toBe(1500);
  });
});
