/**
 * `realRaisedMinorSql` against a real Postgres.
 *
 * The unit tests for the cap exercise its ARITHMETIC. They cannot see whether
 * the SQL that feeds it is correct, and the ratchet only reads that SQL as
 * text - so a subquery that referenced the wrong column, failed to correlate,
 * or returned NULL would pass every other test in this change and then fail
 * in production on the first donation. This file is the part that could only
 * be proven by running it.
 *
 * The invariant that matters most is the last block: fabricated seed money
 * must not consume a real campaign's headroom.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { realRaisedMinorSql } from '@/db/real-raised';
import { checkRaiseCap } from '@/lib/campaign-raise-cap';
import { getCurrency } from '@/lib/money/currencies';
import { clearDatabase, seedCampaign } from '../../test/helpers';

const USD = getCurrency('USD');

let seq = 0;
async function addDonation(
  campaignId: string,
  amount: number,
  opts: { source?: 'real' | 'seed'; refunded?: boolean; currency?: string } = {},
) {
  seq += 1;
  await db.insert(schema.donations).values({
    campaignId,
    stripePaymentId: `pi_cap_${Date.now()}_${seq}`,
    amount,
    donorName: 'Test Donor',
    donorEmail: 'donor@test.invalid',
    phaseAtTime: 'first_believers',
    source: opts.source ?? 'real',
    refunded: opts.refunded ?? false,
    currency: opts.currency ?? 'USD',
  });
}

/** Reads the expression exactly as the money-in routes read it. */
async function readRealRaised(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ realRaisedMinor: realRaisedMinorSql })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  return Number(row.realRaisedMinor);
}

describe('realRaisedMinorSql', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await clearDatabase();
  });

  it('is 0, not NULL, for a campaign with no donations at all', async () => {
    const c = await seedCampaign({ raisedAmount: 0 });
    const v = await readRealRaised(c.id);
    expect(v).toBe(0);
    expect(Number.isNaN(v)).toBe(false);
  });

  it('sums real, un-refunded donations', async () => {
    const c = await seedCampaign({ raisedAmount: 0 });
    await addDonation(c.id, 1_000);
    await addDonation(c.id, 2_500);
    expect(await readRealRaised(c.id)).toBe(3_500);
  });

  it('excludes seed donations', async () => {
    const c = await seedCampaign({ raisedAmount: 0 });
    await addDonation(c.id, 1_000, { source: 'real' });
    await addDonation(c.id, 90_000, { source: 'seed' });
    expect(await readRealRaised(c.id)).toBe(1_000);
  });

  it('excludes refunded donations', async () => {
    const c = await seedCampaign({ raisedAmount: 0 });
    await addDonation(c.id, 1_000);
    await addDonation(c.id, 7_000, { refunded: true });
    expect(await readRealRaised(c.id)).toBe(1_000);
  });

  it('correlates on the campaign - another campaign\'s donations do not count', async () => {
    const mine = await seedCampaign({ raisedAmount: 0 });
    const theirs = await seedCampaign({ raisedAmount: 0 });
    await addDonation(mine.id, 1_000);
    await addDonation(theirs.id, 500_000);
    expect(await readRealRaised(mine.id)).toBe(1_000);
    expect(await readRealRaised(theirs.id)).toBe(500_000);
  });
});

describe('the money-safety invariant, proven end to end', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await clearDatabase();
  });

  it('seed money does NOT consume a real campaign\'s pre-verification headroom', async () => {
    /*
      The hazard this guards. `campaigns.raised_amount` is blended, so a
      campaign the simulation engine has inflated past the cap would, if the
      cap were measured off that column, refuse real donors - on the strength
      of money that does not exist.
    */
    const seeded = USD.unverifiedCapMinor * 4;
    const c = await seedCampaign({
      raisedAmount: seeded,
      verificationStatus: 'unverified',
    });
    await addDonation(c.id, seeded, { source: 'seed' });

    const blended = (
      await db
        .select({ raisedAmount: schema.campaigns.raisedAmount })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, c.id))
    )[0].raisedAmount;

    // The blended column is well past the cap...
    expect(blended).toBeGreaterThan(USD.unverifiedCapMinor);
    // ...while the real figure the cap uses is zero.
    expect(await readRealRaised(c.id)).toBe(0);

    // So a real donor is still allowed, with the full cap as headroom.
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: await readRealRaised(c.id), currency: 'USD' },
      USD.unverifiedCapMinor,
    );
    expect(d.allowed).toBe(true);
  });

  it('real money DOES consume headroom, and the cap then refuses', async () => {
    const c = await seedCampaign({ raisedAmount: 0, verificationStatus: 'unverified' });
    await addDonation(c.id, USD.unverifiedCapMinor);

    expect(await readRealRaised(c.id)).toBe(USD.unverifiedCapMinor);

    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: await readRealRaised(c.id), currency: 'USD' },
      USD.minDonationMinor,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe('CAP_REACHED');
  });

  it('a refund returns headroom, because the refunded row stops counting', async () => {
    const c = await seedCampaign({ raisedAmount: 0, verificationStatus: 'unverified' });
    await addDonation(c.id, USD.unverifiedCapMinor, { refunded: true });
    expect(await readRealRaised(c.id)).toBe(0);
    const d = checkRaiseCap(
      { verificationStatus: 'unverified', realRaisedMinor: await readRealRaised(c.id), currency: 'USD' },
      USD.minDonationMinor,
    );
    expect(d.allowed).toBe(true);
  });
});
