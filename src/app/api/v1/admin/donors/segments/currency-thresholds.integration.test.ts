/**
 * A donor-segment money threshold is compared WITHIN ONE CURRENCY.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `GET /api/v1/admin/donors/segments` classified a "major donor" with
 * `"donorScore" >= 81`-style raw SQL: `"totalDonated" >= 50000`. That figure
 * is US$500 written as an integer, and the column it compares carries NO
 * CURRENCY:
 *
 *   - for a registered donor it is `users.total_donated`, one `integer`
 *     that `payment-service.ts:307` increments by every donation's raw
 *     `amount` whatever rail it came over;
 *   - for a guest it is `SUM(d.amount)` grouped by `donor_email` alone.
 *
 * So KES and USD were added together and the sum tested against a United
 * States dollar rule. `minDonated`/`maxDonated` were worse: they multiplied
 * the caller's figure by a hardcoded `100`, which is right for a two-decimal
 * currency and 100x wrong for a zero-decimal one (`docs/103`).
 *
 * ⚠️ KES and USD share exponent 2, so every DIGIT came out right and only the
 * MEANING was wrong - which is the whole reason six thousand unit tests and
 * nine ratchets never saw it (`docs/115`).
 *
 * ── WHY A REAL DATABASE, AND WHY THE REAL HANDLER ───────────────────────────
 *
 * The fix is a correlated `EXISTS` with an aggregate in it. `docs/101` is the
 * precedent: an interpolated Column renders UNQUALIFIED, so a predicate can be
 * valid SQL that is never true, return 0 rows for every input, and raise no
 * error anywhere - and unit tests, a text ratchet and `tsc` all passed over
 * exactly that. A test that does not execute the query proves nothing about
 * this class of defect.
 *
 * `docs/107` is the other half: no admin page's data query is run by any test.
 * This is an API route, so it can be.
 *
 * ── THE PROPERTY UNDER TEST ─────────────────────────────────────────────────
 *
 * Three donors, each seeded so the OLD rule and the NEW rule disagree:
 *
 *   KES-only   gave KES 50,000.00 (5,000,000 minor) - major in KES, not USD
 *   USD-only   gave US$500.00        (50,000 minor) - major in USD, not KES
 *   Mixed      gave KES 25,000 AND US$250           - major in NEITHER,
 *                                                     yet blends to 2,525,000
 *
 * The blended figure clears 50,000 for all three, so the old rule called every
 * one of them a major donor. Exactly one may qualify per currency now.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMock = vi.hoisted(() => ({
  value: { user: { id: '', role: 'admin', email: 'admin@test.invalid' } },
}));

/*
  ⚠️ The whole module is replaced, with NO `vi.importActual` - importing the
  real one pulls in next-auth, which resolves `next/server`, absent in this
  suite's `node` environment, and the failure names hoisting rather than the
  cause. The route imports exactly `requireRole`, so exactly that is provided.
*/
vi.mock('@/lib/auth', () => ({
  requireRole: async () => sessionMock.value,
  UnauthorizedError: class UnauthorizedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { CURRENCIES } from '@/lib/money/currencies';
import { clearDatabase, seedCampaign, seedUser } from '../../../../../../../test/helpers';
import { GET } from './route';

/**
 * The route reads `request.nextUrl.searchParams` and nothing else
 * (`route.ts`, one `request.` usage), so a URL is the whole request.
 */
function get(query: string) {
  return GET({ nextUrl: new URL(`http://localhost/api/v1/admin/donors/segments${query}`) } as never);
}

async function emailsFrom(query: string): Promise<string[]> {
  const res = await get(query);
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.data.donors as { email: string }[]).map((d) => d.email).sort();
}

const KES_ONLY = 'kes-only@test.invalid';
const USD_ONLY = 'usd-only@test.invalid';
const MIXED = 'mixed@test.invalid';

/** A real, un-refunded donation on a campaign of the same currency. */
async function give(campaignId: string, currency: string, email: string, amountMinor: number) {
  await db.insert(schema.donations).values({
    campaignId,
    amount: amountMinor,
    currency,
    donorEmail: email,
    donorName: email.split('@')[0],
    source: 'real',
    refunded: false,
    stripePaymentId: `pi_${Math.random().toString(36).slice(2)}`,
    // NOT NULL with no default.
    phaseAtTime: 'first_believers',
  });
}

beforeEach(async () => {
  await clearDatabase();

  const admin = await seedUser({ email: `admin-${Math.random()}@test.invalid`, role: 'admin' });
  sessionMock.value = { user: { id: admin.id, role: 'admin', email: admin.email ?? '' } };

  const kesCampaign = await seedCampaign({
    creatorId: admin.id, currency: 'KES', slug: `kes-${Math.random().toString(36).slice(2)}`,
  });
  const usdCampaign = await seedCampaign({
    creatorId: admin.id, currency: 'USD', slug: `usd-${Math.random().toString(36).slice(2)}`,
  });

  /*
    All three are GUEST donors (`user_id IS NULL`), which is the harder half
    of the union: their total is computed in the CTE rather than read from a
    column, so nothing but the filter can be making the decision.
  */
  await give(kesCampaign.id, 'KES', KES_ONLY, 5_000_000); // KES 50,000.00
  await give(usdCampaign.id, 'USD', USD_ONLY, 50_000); //   US$500.00
  await give(kesCampaign.id, 'KES', MIXED, 2_500_000); //   KES 25,000.00
  await give(usdCampaign.id, 'USD', MIXED, 25_000); //      US$250.00
});

describe('GET /api/v1/admin/donors/segments — money filters are per currency', () => {
  it('seeds a set where the OLD blended rule called all three major', async () => {
    /*
      Gate: without this, every assertion below could pass against a table
      that simply has no qualifying rows. The blended total is what the old
      predicate read, so this measures the defect's own input.
      KES-only 5,000,000 · USD-only 50,000 · Mixed 2,525,000 - all >= 50,000.
    */
    const rows = await db.execute<{ email: string; blended: number }>(
      sql`SELECT donor_email AS email, SUM(amount)::int AS blended
          FROM donations GROUP BY donor_email ORDER BY 1`,
    );
    expect(rows.map((r) => r.email).sort()).toEqual([KES_ONLY, MIXED, USD_ONLY]);
    for (const r of rows) expect(Number(r.blended)).toBeGreaterThanOrEqual(50_000);
  });

  it('⛔ major_donors in KES is the KES donor ALONE', async () => {
    expect(await emailsFrom('?segment=major_donors&currency=KES')).toEqual([KES_ONLY]);
  });

  it('major_donors in USD is the USD donor alone, which is the behaviour that existed', async () => {
    /*
      The threshold for USD is byte-for-byte the 50000 the route always used
      (`CURRENCIES.USD.majorDonorMinor`), so a dollar-only platform sees no
      change at all. Asserted against the constant, not a literal, so the two
      cannot drift.
    */
    expect(CURRENCIES.USD.majorDonorMinor).toBe(50_000);
    expect(await emailsFrom('?segment=major_donors&currency=USD')).toEqual([USD_ONLY]);
  });

  it('⛔ a blended total does NOT promote the mixed-currency donor in either currency', async () => {
    // 2,525,000 blended clears the old rule; KES 2,500,000 and US$25,000 each
    // fall short of their own currency's threshold.
    const kes = await emailsFrom('?segment=major_donors&currency=KES');
    const usd = await emailsFrom('?segment=major_donors&currency=USD');
    expect(kes).not.toContain(MIXED);
    expect(usd).not.toContain(MIXED);
  });

  it('⛔ refuses a money filter with no currency, rather than defaulting to one', async () => {
    for (const query of [
      '?segment=major_donors',
      '?minDonated=1000',
      '?maxDonated=1000',
      '?segment=major_donors&currency=GBP', // real currency, not COLLECTABLE (`docs/103`)
      '?segment=major_donors&currency=notacurrency',
    ]) {
      const res = await get(query);
      expect(res.status, query).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.field).toBe('currency');
      // An admin must be able to act on it: the message names the options.
      expect(body.error.message).toContain('KES');
    }
  });

  it('leaves the non-money segments alone, with no currency needed', async () => {
    // The other half: the guard must not have made the endpoint unusable.
    const res = await get('?segment=all');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.data.donors as unknown[]).length).toBe(3);
  });

  it('⛔ minDonated/maxDonated are MINOR units, not major units times 100', async () => {
    /*
      Previously `minDonated=500` meant `>= 50000`. It now means `>= 500`.
      The three seeded donors are 5,000,000 / 50,000 / 2,500,000 KES+USD, so a
      KES floor of 2,500,000 admits exactly two and a floor of 2,500,001
      exactly one - which the old `* 100` could not express at all.
    */
    expect(await emailsFrom('?currency=KES&minDonated=2500000')).toEqual([KES_ONLY, MIXED].sort());
    expect(await emailsFrom('?currency=KES&minDonated=2500001')).toEqual([KES_ONLY]);
  });

  it('⛔ maxDonated requires giving IN that currency, not merely not giving', async () => {
    /*
      ⚠️ THE TRAP THIS TEST EXISTS FOR, found by probing the first version of
      the fix against real Postgres. A `HAVING` with no `GROUP BY` is ONE
      group even over zero rows, so `COALESCE(SUM(amount), 0)` is 0 and
      `0 <= anything` is TRUE: `?currency=KES&maxDonated=1` returned the
      USD-only donor, who has never given a shilling. `GROUP BY d.currency`
      is what makes an empty match produce no group and the EXISTS false.

      This is the assertion that fails if somebody removes it as redundant.
    */
    expect(await emailsFrom('?currency=KES&maxDonated=1')).toEqual([]);
    expect(await emailsFrom('?currency=USD&maxDonated=1')).toEqual([]);

    // And the positive case, so this is not passing because everything is empty.
    expect(await emailsFrom('?currency=KES&maxDonated=2500000')).toEqual([MIXED]);
  });

  it('a refunded or seeded donation counts towards no threshold', async () => {
    const admin = sessionMock.value.user.id;
    const c = await seedCampaign({
      creatorId: admin, currency: 'KES', slug: `k2-${Math.random().toString(36).slice(2)}`,
    });
    const ghost = 'ghost@test.invalid';
    await db.insert(schema.donations).values([
      {
        campaignId: c.id, amount: 9_000_000, currency: 'KES', donorEmail: ghost,
        donorName: 'Ghost', source: 'real', refunded: true,
        stripePaymentId: `pi_${Math.random().toString(36).slice(2)}`, phaseAtTime: 'first_believers',
      },
      {
        campaignId: c.id, amount: 9_000_000, currency: 'KES', donorEmail: ghost,
        donorName: 'Ghost', source: 'seed', refunded: false,
        stripePaymentId: `seed_${Math.random().toString(36).slice(2)}`, phaseAtTime: 'first_believers',
      },
    ]);

    // 18,000,000 KES of refunded + fabricated money, well past the threshold.
    expect(await emailsFrom('?segment=major_donors&currency=KES')).toEqual([KES_ONLY]);
  });
});
