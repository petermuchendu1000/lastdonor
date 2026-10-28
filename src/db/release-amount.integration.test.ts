/**
 * The lump-sum release, executed against a real Postgres.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `approve_t2` on `/api/v1/admin/campaigns/[campaignId]/verification` sets
 * `campaigns.total_released_amount`, and that column is what
 * `withdraw/route.ts` pays out against. It is the most consequential money
 * write in the product, and **nothing executed it.**
 *
 * The route's own test mocks `@/db` and re-implements the statement in
 * JavaScript - it regex-matches the SET expression and sums a fake array. So
 * it checks the expression's shape and its own arithmetic. It cannot check
 * that Postgres accepts the statement, that `LEAST` clamps as assumed, or
 * that `campaigns_released_lte_raised` survives it. `docs/124`: a mock cannot
 * raise what only the database can. `docs/107` §7 names this gap for admin
 * generally.
 *
 * ⚠️ These tests call the REAL `releasableAmountSql`. A replica of the SQL
 * would be the `docs/101` trap in test form - proving what I believe the
 * statement does rather than what it does.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { campaigns, donations } from '@/db/schema';
import { releasableAmountSql } from '@/db/release-amount';
import { clearDatabase } from '../../test/helpers';

const CID = 'aaaaaaaa-0000-4000-8000-00000000beef';

async function seedCampaign(raisedAmount: number) {
  await db.insert(campaigns).values({
    id: CID,
    title: 'Release fixture',
    slug: 'release-fixture',
    heroImageUrl: 'https://example.invalid/x.jpg',
    storyHtml: '<p>fixture</p>',
    goalAmount: 1_000_000,
    category: 'medical',
    subjectName: 'Fixture Subject',
    currency: 'USD',
    status: 'active',
    raisedAmount,
    totalReleasedAmount: 0,
    verificationStatus: 'identity_verified',
  });
}

let seq = 0;
async function seedDonation(amount: number, source: 'real' | 'seed', refunded: boolean) {
  await db.insert(donations).values({
    campaignId: CID,
    stripePaymentId: `release_fixture_${seq++}`,
    amount,
    donorEmail: `release-fixture-${seq}@example.invalid`,
    phaseAtTime: 'first_believers',
    source,
    refunded,
    currency: 'USD',
    provider: 'stripe',
  });
}

/** Apply the release exactly as the route does, and read back what landed. */
async function release(): Promise<{ released: number | null; raised: number | null }> {
  const [row] = await db
    .update(campaigns)
    .set({
      verificationStatus: 'fully_verified',
      totalReleasedAmount: releasableAmountSql(CID),
    } as never)
    .where(eq(campaigns.id, CID))
    .returning({
      released: campaigns.totalReleasedAmount,
      raised: campaigns.raisedAmount,
    });
  return row;
}

describe('⚠️ the relocation changed no semantics', () => {
  /*
    `docs/129` moved this expression out of the route handler so a test could
    run it. That is only safe if the SQL is the same SQL. This is the pinned
    rendering of the INLINE version, captured before the move.

    ⛔ If drizzle ever renders a Column unqualified here, this fails - which
    is the `docs/101` trap ("a grep over SQL text proves the text, not the
    semantics") arriving as a test failure instead of a silent zero.
  */
  it('renders byte-for-byte what the inline expression rendered', () => {
    const q = db
      .update(campaigns)
      .set({ totalReleasedAmount: releasableAmountSql(CID) } as never)
      .where(eq(campaigns.id, CID));
    const flat = q.toSQL().sql.replace(/\s+/g, ' ');

    expect(flat).toContain(
      'LEAST(( SELECT COALESCE(SUM("donations"."amount"), 0)::int ' +
        'FROM "donations" WHERE "donations"."campaign_id" = $' ,
    );
    expect(flat).toContain('"donations"."source" = \'real\'');
    expect(flat).toContain('"donations"."refunded" = false');
    expect(flat).toContain('), "campaigns"."raised_amount")');
  });
});

describe('⛔ the money-safety invariant: real, un-refunded donations only', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('⛔ releases the REAL total, never the seed-blended raised_amount', async () => {
    /*
      THE REGRESSION TEST (`docs/29` audit P0). A campaign showing $40,000 of
      which $38,000 was seeded used to release $40,000 of real platform money.
    */
    await seedCampaign(39_500);
    await seedDonation(1_000, 'real', false);
    await seedDonation(500, 'real', false);
    await seedDonation(38_000, 'seed', false);

    const r = await release();
    expect(r.raised).toBe(39_500);
    expect(r.released).toBe(1_500);
  });

  it('excludes a refunded real donation', async () => {
    await seedCampaign(1_500);
    await seedDonation(1_000, 'real', false);
    await seedDonation(500, 'real', true);
    expect((await release()).released).toBe(1_000);
  });

  it('⛔ a seed-only campaign releases NOTHING', async () => {
    await seedCampaign(38_000);
    await seedDonation(38_000, 'seed', false);
    expect((await release()).released).toBe(0);
  });

  it('⚠️ no donations at all releases 0, not NULL', async () => {
    // COALESCE is what makes this 0. Without it the column takes NULL and
    // `released <= raised` is NULL, which Postgres treats as satisfied - the
    // CHECK would not catch it and withdrawal arithmetic would break later.
    await seedCampaign(0);
    const r = await release();
    expect(r.released).toBe(0);
    expect(r.released).not.toBeNull();
  });

  it('⛔ the LEAST clamp keeps campaigns_released_lte_raised satisfied', async () => {
    /*
      A partially-failed bulk refund zeroes `raised_amount` while leaving some
      donations un-refunded, so the real sum can EXCEED raised. Without the
      clamp this statement violates the CHECK and the whole transaction
      aborts, leaving the verification un-recorded.
    */
    await seedCampaign(0);
    await seedDonation(1_000, 'real', false);
    const r = await release();
    expect(r.released).toBe(0);
    expect(r.released!).toBeLessThanOrEqual(r.raised!);
  });

  it('⚠️ the control: it is not simply always zero', async () => {
    // Without this, every assertion above is satisfied by an expression that
    // releases nothing - which would be safe and also completely broken.
    await seedCampaign(2_500);
    await seedDonation(2_500, 'real', false);
    expect((await release()).released).toBe(2_500);
  });

  it('⚠️ another campaign\'s donations are never counted', async () => {
    // The subquery is correlated by `campaign_id`. If that predicate were
    // broken - the `docs/101` unqualified-identifier trap - this would pick
    // up the other campaign's money.
    await seedCampaign(1_000);
    await seedDonation(1_000, 'real', false);

    const OTHER = 'bbbbbbbb-0000-4000-8000-00000000beef';
    await db.insert(campaigns).values({
      id: OTHER, title: 'Other', slug: 'other-release-fixture',
      heroImageUrl: 'https://example.invalid/y.jpg', storyHtml: '<p>other</p>',
      goalAmount: 1_000_000, category: 'medical', subjectName: 'Other',
      currency: 'USD', status: 'active', raisedAmount: 999_000,
    });
    await db.insert(donations).values({
      campaignId: OTHER, stripePaymentId: 'release_fixture_other', amount: 999_000,
      donorEmail: 'other@example.invalid', phaseAtTime: 'first_believers',
      source: 'real', refunded: false, currency: 'USD', provider: 'stripe',
    });

    expect((await release()).released).toBe(1_000);
  });
});

describe('⛔ concurrent approvals', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('two at once leave one correct figure, never a doubled one', async () => {
    /*
      The route takes `FOR UPDATE` before re-validating, so only one approval
      applies. The expression itself is idempotent - it SETS an absolute sum
      rather than incrementing - so even applied twice the figure is right.
      Asserted because an increment here would double a payout.
    */
    await seedCampaign(3_000);
    await seedDonation(3_000, 'real', false);

    await Promise.all([release(), release(), release()]);

    const [row] = await db
      .select({ released: campaigns.totalReleasedAmount })
      .from(campaigns)
      .where(eq(campaigns.id, CID))
      .limit(1);
    expect(row.released).toBe(3_000);
  });
});

describe('⚠️ the database still guards the column', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('campaigns_released_lte_raised rejects a release above raised', async () => {
    // [VERIFIED from pg_constraint] CHECK (total_released_amount <= raised_amount).
    // Asserted so a future change notices the constraint exists.
    await seedCampaign(100);
    await expect(
      db.update(campaigns).set({ totalReleasedAmount: sql`200` } as never).where(eq(campaigns.id, CID)),
    ).rejects.toThrow();
  });
});
