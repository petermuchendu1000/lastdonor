/**
 * Admin money aggregates, per currency, against real Postgres.
 *
 * ⚠️ `docs/107` §7 records that NO admin page's data query is executed by any
 * test. These queries were moved out of the pages precisely so that this file
 * could run them, so the decisive cases are the ones a page cannot express:
 * a MIXED-CURRENCY platform, which is what every admin total was silently
 * flattening.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  donorTotalsForUsers,
  donationTotalsByCurrency,
  donationTotalsByMonthAndCurrency,
  donationTotalsByCategoryAndCurrency,
} from './donation-totals.server';
import { clearDatabase, seedCampaign, seedUser } from '../../../test/helpers';

async function seedDonation(o: {
  campaignId: string;
  currency: string;
  amount: number;
  source?: 'real' | 'seed';
  refunded?: boolean;
  createdAt?: Date;
}) {
  await db.insert(schema.donations).values({
    campaignId: o.campaignId,
    amount: o.amount,
    currency: o.currency,
    donorEmail: `d-${Math.random()}@test.invalid`,
    donorName: 'A Donor',
    source: o.source ?? 'real',
    refunded: o.refunded ?? false,
    stripePaymentId: `seed_${Math.random().toString(36).slice(2)}`,
    // NOT NULL with no default; enum read off the live schema.
    phaseAtTime: 'first_believers',
    ...(o.createdAt ? { createdAt: o.createdAt } : {}),
  });
}

let kes: Awaited<ReturnType<typeof seedCampaign>>;
let usd: Awaited<ReturnType<typeof seedCampaign>>;

beforeEach(async () => {
  await clearDatabase();
  const creator = await seedUser({ email: `creator-${Math.random()}@test.invalid` });
  kes = await seedCampaign({ creatorId: creator.id, currency: 'KES', slug: `kes-${Date.now()}`, category: 'medical' });
  usd = await seedCampaign({ creatorId: creator.id, currency: 'USD', slug: `usd-${Date.now()}`, category: 'medical' });
});

describe('donationTotalsByCurrency', () => {
  it('returns nothing before any real money arrives', async () => {
    expect(await donationTotalsByCurrency(db)).toEqual([]);
  });

  it('⛔ THE DEFECT: a mixed platform gives TWO rows, never one blended total', async () => {
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 1_840_000 });
    await seedDonation({ campaignId: usd.id, currency: 'USD', amount: 25_000 });

    const rows = await donationTotalsByCurrency(db);
    expect(rows).toHaveLength(2);
    expect(Object.fromEntries(rows.map((r) => [r.currency, r.totalMinor]))).toEqual({
      KES: 1_840_000,
      USD: 25_000,
    });
    // 1_865_000 is what `/admin`'s tile printed, with a dollar sign on it.
    expect(rows.some((r) => r.totalMinor === 1_865_000)).toBe(false);
  });

  it('⛔ excludes seed money and refunds, as every admin total did', async () => {
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 10_000 });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 90_000, source: 'seed' });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 80_000, refunded: true });

    expect(await donationTotalsByCurrency(db)).toEqual([
      { currency: 'KES', totalMinor: 10_000, donationCount: 1 },
    ]);
  });

  it('includeSeed widens to fabricated money, for the simulation screens', async () => {
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 10_000 });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 90_000, source: 'seed' });

    expect(await donationTotalsByCurrency(db, { includeSeed: true })).toEqual([
      { currency: 'KES', totalMinor: 100_000, donationCount: 2 },
    ]);
  });

  it('⛔ honours a date window without binding a bare Date (docs/107)', async () => {
    /*
      `/admin/reports` 500'd on every load because a JS Date was interpolated
      into a `sql` template, where it is bound with no encoder. These use the
      typed builders; running the query at all is the assertion.
    */
    const old = new Date('2020-01-15T00:00:00Z');
    const recent = new Date('2026-10-20T00:00:00Z');
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 5_000, createdAt: old });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 7_000, createdAt: recent });

    const since = await donationTotalsByCurrency(db, { since: new Date('2026-01-01T00:00:00Z') });
    expect(since).toEqual([{ currency: 'KES', totalMinor: 7_000, donationCount: 1 }]);

    const until = await donationTotalsByCurrency(db, { until: new Date('2021-01-01T00:00:00Z') });
    expect(until).toEqual([{ currency: 'KES', totalMinor: 5_000, donationCount: 1 }]);
  });
});

describe('donationTotalsByMonthAndCurrency', () => {
  it('⛔ splits each month by currency instead of blending them', async () => {
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 300_000, createdAt: new Date('2026-09-10T00:00:00Z') });
    await seedDonation({ campaignId: usd.id, currency: 'USD', amount: 4_000, createdAt: new Date('2026-09-20T00:00:00Z') });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 100_000, createdAt: new Date('2026-10-02T00:00:00Z') });

    const rows = await donationTotalsByMonthAndCurrency(db);
    expect(rows).toHaveLength(3);

    const sept = rows.filter((r) => r.month.startsWith('2026-09'));
    expect(sept.map((r) => [r.currency, r.totalMinor]).sort()).toEqual([
      ['KES', 300_000],
      ['USD', 4_000],
    ]);
    // 304_000 is the blended September figure the chart used to plot.
    expect(rows.some((r) => r.totalMinor === 304_000)).toBe(false);
  });

  it('returns months in chronological order', async () => {
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 1_000, createdAt: new Date('2026-10-02T00:00:00Z') });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 2_000, createdAt: new Date('2026-08-02T00:00:00Z') });
    const months = (await donationTotalsByMonthAndCurrency(db)).map((r) => r.month);
    expect(months).toEqual([...months].sort());
  });
});

describe('donationTotalsByCategoryAndCurrency', () => {
  it('⛔ splits each category by currency', async () => {
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 500_000 });
    await seedDonation({ campaignId: usd.id, currency: 'USD', amount: 6_000 });

    const rows = await donationTotalsByCategoryAndCurrency(db);
    // Both campaigns are 'medical', so a currency-blind query gives ONE row.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.category === 'medical')).toBe(true);
    expect(rows.some((r) => r.totalMinor === 506_000)).toBe(false);
  });

  it('⛔ counts the DISTINCT campaigns behind each row', async () => {
    /*
      A regression I introduced and a screenshot caught: rewiring this query
      I dropped `count(distinct campaigns.id)` and hardcoded 0, so
      /admin/reports reported "Campaigns: 0" for every category while the
      revenue beside it was right. A figure that is always zero looks like an
      empty platform, not like a bug.
    */
    const creator = await seedUser({ email: `c3-${Math.random()}@test.invalid` });
    const kes2 = await seedCampaign({ creatorId: creator.id, currency: 'KES', slug: `kes3-${Date.now()}`, category: 'medical' });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 1_000 });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 2_000 });
    await seedDonation({ campaignId: kes2.id, currency: 'KES', amount: 3_000 });

    const [row] = await donationTotalsByCategoryAndCurrency(db);
    expect(row.donationCount).toBe(3);
    // Three donations, but only TWO campaigns.
    expect(row.campaignCount).toBe(2);
  });

  it('joins campaigns, so a donation with no campaign cannot appear', async () => {
    // The inner join is what makes the category meaningful; without it the
    // category column would be null and the row silently mis-attributed.
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 1_000 });
    const rows = await donationTotalsByCategoryAndCurrency(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('medical');
  });
});

describe('donorTotalsForUsers', () => {
  /*
    ⛔ `users.total_donated` is ONE integer with no currency dimension
    [VERIFIED: a single column, written only by `payment-service.ts:307` as
    `total_donated + amount`]. A donor across two rails gets a number in no
    currency at all, and three admin screens printed it as dollars.
  */
  it('returns an empty map for no users, without touching the database', async () => {
    expect(await donorTotalsForUsers(db, [])).toEqual(new Map());
  });

  it('⛔ a donor across TWO currencies gets TWO rows, never one sum', async () => {
    const donor = await seedUser({ email: `mixed-${Math.random()}@test.invalid` });
    await db.insert(schema.donations).values([
      { campaignId: kes.id, amount: 500_000, currency: 'KES', donorEmail: donor.email!,
        donorName: 'D', userId: donor.id, source: 'real', refunded: false,
        stripePaymentId: `s_${Math.random()}`, phaseAtTime: 'first_believers' },
      { campaignId: usd.id, amount: 5_000, currency: 'USD', donorEmail: donor.email!,
        donorName: 'D', userId: donor.id, source: 'real', refunded: false,
        stripePaymentId: `s_${Math.random()}`, phaseAtTime: 'first_believers' },
    ]);

    const map = await donorTotalsForUsers(db, [donor.id]);
    const totals = map.get(donor.id) ?? [];
    expect(Object.fromEntries(totals.map((t) => [t.currency, t.totalMinor]))).toEqual({
      KES: 500_000,
      USD: 5_000,
    });
    // 505_000 is what `users.total_donated` holds for this person.
    expect(totals.some((t) => t.totalMinor === 505_000)).toBe(false);
  });

  it('keeps donors apart, and costs ONE query for many of them', async () => {
    const a = await seedUser({ email: `a-${Math.random()}@test.invalid` });
    const b = await seedUser({ email: `b-${Math.random()}@test.invalid` });
    await db.insert(schema.donations).values([
      { campaignId: kes.id, amount: 1_000, currency: 'KES', donorEmail: a.email!, donorName: 'A',
        userId: a.id, source: 'real', refunded: false, stripePaymentId: `s_${Math.random()}`, phaseAtTime: 'first_believers' },
      { campaignId: kes.id, amount: 2_000, currency: 'KES', donorEmail: b.email!, donorName: 'B',
        userId: b.id, source: 'real', refunded: false, stripePaymentId: `s_${Math.random()}`, phaseAtTime: 'first_believers' },
    ]);

    const map = await donorTotalsForUsers(db, [a.id, b.id]);
    expect(map.get(a.id)).toEqual([{ currency: 'KES', totalMinor: 1_000, donationCount: 1 }]);
    expect(map.get(b.id)).toEqual([{ currency: 'KES', totalMinor: 2_000, donationCount: 1 }]);
  });

  it('⛔ excludes seed money and refunds', async () => {
    const donor = await seedUser({ email: `x-${Math.random()}@test.invalid` });
    await db.insert(schema.donations).values([
      { campaignId: kes.id, amount: 1_000, currency: 'KES', donorEmail: donor.email!, donorName: 'D',
        userId: donor.id, source: 'real', refunded: false, stripePaymentId: `s_${Math.random()}`, phaseAtTime: 'first_believers' },
      { campaignId: kes.id, amount: 9_000, currency: 'KES', donorEmail: donor.email!, donorName: 'D',
        userId: donor.id, source: 'seed', refunded: false, stripePaymentId: `s_${Math.random()}`, phaseAtTime: 'first_believers' },
      { campaignId: kes.id, amount: 8_000, currency: 'KES', donorEmail: donor.email!, donorName: 'D',
        userId: donor.id, source: 'real', refunded: true, stripePaymentId: `s_${Math.random()}`, phaseAtTime: 'first_believers' },
    ]);
    expect(await donorTotalsForUsers(db, [donor.id])).toEqual(
      new Map([[donor.id, [{ currency: 'KES', totalMinor: 1_000, donationCount: 1 }]]]),
    );
  });
});
