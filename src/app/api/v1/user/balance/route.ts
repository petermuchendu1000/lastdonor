import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { campaigns, campaignWithdrawals } from '@/db/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';

/**
 * GET /api/v1/user/balance
 *
 * The authenticated user's available balance across the campaigns they
 * created, **one figure per currency**.
 *
 * ── WHY PER CURRENCY ────────────────────────────────────────────────────────
 *
 * This route used to `reduce` `total_released_amount - total_withdrawn_amount`
 * across every campaign into a single bare integer, and sum
 * `campaign_withdrawals.amount` across every currency alongside it. Every
 * amount column is an INTEGER in the minor units of ITS OWN ROW'S currency
 * (`docs/92`), so that added shillings to dollars. `UserNav` then rendered the
 * result with a hand-rolled `toLocaleString('en-US', { currency: 'USD' })`, so
 * a KES 10,000-minor balance printed as **$100.00** in the navbar of every
 * signed-in page.
 *
 * The sweeps of `docs/114` and `docs/115` missed both halves because
 * `money-currency.ratchet.test.ts` looked for `<Money …>` JSX, and a
 * hand-rolled `Intl` call has none. That ratchet now checks the property
 * instead of the symptom. `docs/121`.
 *
 * ⚠️ The grouping is done in SQL rather than in JS, so the shape of the
 * response cannot be wrong: there is no point at which two currencies are in
 * the same accumulator.
 *
 * Available = SUM(released − withdrawn) − in-flight withdrawals, per currency.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  /*
    Two queries, within the three-concurrent cap (`docs/87`). `campaigns` is
    grouped in the database; the in-flight withdrawals are grouped by the
    campaign's currency, not the withdrawal's, so a row whose currency ever
    diverged from its campaign's could not silently offset the wrong bucket.
  */
  const perCurrency = await db
    .select({
      currency: campaigns.currency,
      grossMinor: sql<number>`COALESCE(SUM(${campaigns.totalReleasedAmount} - ${campaigns.totalWithdrawnAmount}), 0)::int`,
    })
    .from(campaigns)
    .where(eq(campaigns.creatorId, userId))
    .groupBy(campaigns.currency);

  if (perCurrency.length === 0) {
    return NextResponse.json({ balances: [], hasCampaigns: false });
  }

  /*
    No separate id lookup: the join to `campaigns` carries `creator_id`, so
    `eq(campaigns.creatorId, userId)` scopes this to the same set the query
    above counted. Fetching the ids first would have been a third round trip
    for a restriction the join already applies.
  */
  const pending = await db
    .select({
      currency: campaigns.currency,
      pendingMinor: sql<number>`COALESCE(SUM(${campaignWithdrawals.amount}), 0)::int`,
    })
    .from(campaignWithdrawals)
    .innerJoin(campaigns, eq(campaigns.id, campaignWithdrawals.campaignId))
    .where(
      and(
        eq(campaigns.creatorId, userId),
        inArray(campaignWithdrawals.status, ['requested', 'approved', 'processing']),
      ),
    )
    .groupBy(campaigns.currency);

  const pendingByCurrency = new Map(pending.map((p) => [p.currency, p.pendingMinor]));

  const balances = perCurrency
    .map((row) => ({
      currency: row.currency,
      availableMinor: Math.max(0, row.grossMinor - (pendingByCurrency.get(row.currency) ?? 0)),
    }))
    // A currency with nothing available is not worth a line in the navbar.
    .filter((b) => b.availableMinor > 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return NextResponse.json({ balances, hasCampaigns: true });
}
