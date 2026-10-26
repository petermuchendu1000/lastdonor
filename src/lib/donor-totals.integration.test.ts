/**
 * What one person has given, per currency, against real Postgres.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * The organiser dashboard summed `donations.amount` filtered by DONOR with no
 * currency grouping and rendered it as dollars. The decisive test is the
 * MIXED-CURRENCY donor: one person who has given in both KES and USD must get
 * two totals, because adding 100 KES to 100 USD yields 200 of nothing.
 *
 * ⚠️ That case cannot be produced by accident. A campaign is single-currency
 * by composite FK, so the fixture needs TWO campaigns in different currencies
 * and one donor across both - which is exactly the shape the old query got
 * wrong and no existing fixture had.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { donorTotalsByCurrency } from './donor-totals.server';
import { clearDatabase, seedCampaign, seedUser } from '../../test/helpers';

const DONOR_EMAIL = 'mixed-currency-donor@test.invalid';

async function seedDonation(over: {
  campaignId: string;
  currency: string;
  amount: number;
  userId?: string;
  donorEmail?: string;
  source?: 'real' | 'seed';
  refunded?: boolean;
}) {
  await db.insert(schema.donations).values({
    campaignId: over.campaignId,
    amount: over.amount,
    currency: over.currency,
    donorEmail: over.donorEmail ?? DONOR_EMAIL,
    donorName: 'A Donor',
    userId: over.userId ?? null,
    source: over.source ?? 'real',
    refunded: over.refunded ?? false,
    stripePaymentId: `seed_${Math.random().toString(36).slice(2)}`,
    // NOT NULL with no default, read off the live schema rather than assumed;
    // its enum is first_believers | the_push | closing_in | last_donor_zone.
    phaseAtTime: 'first_believers',
  });
}

let donor: Awaited<ReturnType<typeof seedUser>>;
let kesCampaign: Awaited<ReturnType<typeof seedCampaign>>;
let usdCampaign: Awaited<ReturnType<typeof seedCampaign>>;

beforeEach(async () => {
  await clearDatabase();
  donor = await seedUser({ email: DONOR_EMAIL });
  const creator = await seedUser({ email: `creator-${Math.random()}@test.invalid` });
  kesCampaign = await seedCampaign({ creatorId: creator.id, currency: 'KES', slug: `kes-${Date.now()}` });
  usdCampaign = await seedCampaign({ creatorId: creator.id, currency: 'USD', slug: `usd-${Date.now()}` });
});

describe('donorTotalsByCurrency', () => {
  it('returns nothing for somebody who has never donated', async () => {
    // Every user on this platform today. The caller must render no tile
    // rather than a zero in an arbitrary currency.
    expect(await donorTotalsByCurrency(db, donor.id, DONOR_EMAIL)).toEqual([]);
  });

  it('⛔ THE DEFECT: a donor in TWO currencies gets TWO totals, never one sum', async () => {
    await seedDonation({ campaignId: kesCampaign.id, currency: 'KES', amount: 50_000, userId: donor.id });
    await seedDonation({ campaignId: usdCampaign.id, currency: 'USD', amount: 10_000, userId: donor.id });

    const totals = await donorTotalsByCurrency(db, donor.id, DONOR_EMAIL);

    expect(totals).toHaveLength(2);
    const byCode = Object.fromEntries(totals.map((t) => [t.currency, t.totalMinor]));
    expect(byCode).toEqual({ KES: 50_000, USD: 10_000 });
    // The number the old code produced. If this ever appears, the sum is back.
    expect(totals.some((t) => t.totalMinor === 60_000)).toBe(false);
  });

  it('adds up multiple donations WITHIN one currency', async () => {
    await seedDonation({ campaignId: kesCampaign.id, currency: 'KES', amount: 50_000, userId: donor.id });
    await seedDonation({ campaignId: kesCampaign.id, currency: 'KES', amount: 25_000, userId: donor.id });

    const totals = await donorTotalsByCurrency(db, donor.id, DONOR_EMAIL);
    expect(totals).toEqual([{ currency: 'KES', totalMinor: 75_000, donationCount: 2 }]);
  });

  it('matches a guest donation by EMAIL as well as by user id', async () => {
    // The page's filter is `userId = ? OR donorEmail = ?`, because a person
    // can give as a guest before they ever have an account.
    await seedDonation({ campaignId: kesCampaign.id, currency: 'KES', amount: 10_000, userId: undefined });

    const totals = await donorTotalsByCurrency(db, donor.id, DONOR_EMAIL);
    expect(totals).toEqual([{ currency: 'KES', totalMinor: 10_000, donationCount: 1 }]);
  });

  it('⛔ excludes seed money and refunded donations', async () => {
    /*
      Seed donations are fabricated (`docs/101`) and a refunded donation is
      not something the donor still gave. Both exclusions were in the query
      this replaced and must survive it.
    */
    await seedDonation({ campaignId: kesCampaign.id, currency: 'KES', amount: 10_000, userId: donor.id });
    await seedDonation({ campaignId: kesCampaign.id, currency: 'KES', amount: 99_000, userId: donor.id, source: 'seed' });
    await seedDonation({ campaignId: kesCampaign.id, currency: 'KES', amount: 88_000, userId: donor.id, refunded: true });

    expect(await donorTotalsByCurrency(db, donor.id, DONOR_EMAIL)).toEqual([
      { currency: 'KES', totalMinor: 10_000, donationCount: 1 },
    ]);
  });

  it('ignores other people’s donations', async () => {
    await seedDonation({
      campaignId: kesCampaign.id, currency: 'KES', amount: 70_000,
      donorEmail: 'someone-else@test.invalid',
    });
    expect(await donorTotalsByCurrency(db, donor.id, DONOR_EMAIL)).toEqual([]);
  });
});
