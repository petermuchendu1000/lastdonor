/**
 * What the platform has raised, per currency, against real Postgres.
 *
 * ── THE DEFECT, verified against live production on 2026-10-26 ──────────────
 *
 * `https://lastdonor.org/transparency` published
 *
 *     $100.00   Raised So Far
 *
 * while the production database held
 * `[{"currency":"KES","n":2,"total_minor":10000}]` - KES 100.00, about
 * US$0.77. The query summed `donations.amount` across the whole table with no
 * currency grouping and printed the result as dollars.
 *
 * The decisive test is therefore the MIXED-CURRENCY platform: donations in
 * KES and USD must produce two totals, never one.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { platformRaisedByCurrency } from './platform-totals.server';
import { clearDatabase, seedCampaign, seedUser } from '../../test/helpers';

async function seedDonation(o: {
  campaignId: string;
  currency: string;
  amount: number;
  source?: 'real' | 'seed';
  refunded?: boolean;
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
  });
}

let kes: Awaited<ReturnType<typeof seedCampaign>>;
let usd: Awaited<ReturnType<typeof seedCampaign>>;

beforeEach(async () => {
  await clearDatabase();
  const creator = await seedUser({ email: `creator-${Math.random()}@test.invalid` });
  kes = await seedCampaign({ creatorId: creator.id, currency: 'KES', slug: `kes-${Date.now()}` });
  usd = await seedCampaign({ creatorId: creator.id, currency: 'USD', slug: `usd-${Date.now()}` });
});

describe('platformRaisedByCurrency', () => {
  it('returns nothing before anything real is raised', async () => {
    // The caller must then render no tile rather than a zero in a currency
    // nobody has given in.
    expect(await platformRaisedByCurrency(db)).toEqual([]);
  });

  it('⛔ THE DEFECT: two currencies give TWO totals, never one blended figure', async () => {
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 10_000 });
    await seedDonation({ campaignId: usd.id, currency: 'USD', amount: 25_000 });

    const totals = await platformRaisedByCurrency(db);

    expect(totals).toHaveLength(2);
    expect(Object.fromEntries(totals.map((t) => [t.currency, t.totalMinor]))).toEqual({
      KES: 10_000,
      USD: 25_000,
    });
    // 35_000 is what the old query produced. If it reappears, the sum is back.
    expect(totals.some((t) => t.totalMinor === 35_000)).toBe(false);
  });

  it('reproduces production exactly: two KES donations totalling KES 100.00', async () => {
    /*
      The live figures on 2026-10-26. The old code turned these into
      "$100.00"; the correct rendering names the shilling.
    */
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 5_000 });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 5_000 });

    expect(await platformRaisedByCurrency(db)).toEqual([
      { currency: 'KES', totalMinor: 10_000, donationCount: 2 },
    ]);
  });

  it('⛔ excludes seed money and refunded donations', async () => {
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 10_000 });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 90_000, source: 'seed' });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 80_000, refunded: true });

    expect(await platformRaisedByCurrency(db)).toEqual([
      { currency: 'KES', totalMinor: 10_000, donationCount: 1 },
    ]);
  });

  it('counts every campaign, not just one', async () => {
    // Platform-wide is the whole point; a per-campaign correlation here would
    // be a different (and already correct) query - see real-raised.ts.
    const creator2 = await seedUser({ email: `c2-${Math.random()}@test.invalid` });
    const kes2 = await seedCampaign({ creatorId: creator2.id, currency: 'KES', slug: `kes2-${Date.now()}` });
    await seedDonation({ campaignId: kes.id, currency: 'KES', amount: 4_000 });
    await seedDonation({ campaignId: kes2.id, currency: 'KES', amount: 6_000 });

    expect(await platformRaisedByCurrency(db)).toEqual([
      { currency: 'KES', totalMinor: 10_000, donationCount: 2 },
    ]);
  });
});
