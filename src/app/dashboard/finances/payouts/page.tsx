import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users, campaigns, campaignWithdrawals } from '@/db/schema';
import { eq, desc, inArray, and, sql } from 'drizzle-orm';
import FinancesClient from '@/components/dashboard/FinancesClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Payouts - Finances - LastDonor.org',
  robots: { index: false },
};

export default async function FundReleasesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/finances/payouts');
  const userId = session.user.id;

  // User's Stripe Connect status
  const [user] = await db
    .select({
      stripeConnectStatus: users.stripeConnectStatus,
      stripeConnectAccountId: users.stripeConnectAccountId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // All campaigns created by user
  const userCampaigns = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      // Every amount below is in the MINOR UNITS OF THIS ROW'S currency
      // (`docs/92`). Without it the client printed a fifth hand-rolled
      // '$' + cents/100 over whatever currency the campaign is in.
      currency: campaigns.currency,
      goalAmount: campaigns.goalAmount,
      raisedAmount: campaigns.raisedAmount,
      totalReleasedAmount: campaigns.totalReleasedAmount,
      totalWithdrawnAmount: campaigns.totalWithdrawnAmount,
    })
    .from(campaigns)
    .where(eq(campaigns.creatorId, userId))
    .orderBy(desc(campaigns.createdAt));

  const campaignIds = userCampaigns.map((c) => c.id);

  let inFlightByCampaign: Record<string, number> = {};
  let withdrawalRows: Array<{
    id: string;
    campaignId: string;
    campaignTitle: string | null;
    campaignSlug: string | null;
    // NOT NULL in the schema and reached through an inner join, so there is
    // deliberately NO fallback: a silently-defaulted currency on a money
    // figure is the defect, not the safety net.
    campaignCurrency: string;
    amount: number;
    status: string;
    notes: string | null;
    failureReason: string | null;
    requestedAt: Date;
    processedAt: Date | null;
  }> = [];

  if (campaignIds.length > 0) {
    const [inFlightRows, wdRows] = await Promise.all([
      db
        .select({
          campaignId: campaignWithdrawals.campaignId,
          total: sql<number>`COALESCE(SUM(${campaignWithdrawals.amount}), 0)::int`,
        })
        .from(campaignWithdrawals)
        .where(
          and(
            inArray(campaignWithdrawals.campaignId, campaignIds),
            inArray(campaignWithdrawals.status, ['requested', 'approved', 'processing']),
          ),
        )
        .groupBy(campaignWithdrawals.campaignId),

      db
        .select({
          id: campaignWithdrawals.id,
          campaignId: campaignWithdrawals.campaignId,
          campaignTitle: campaigns.title,
          campaignSlug: campaigns.slug,
          campaignCurrency: campaigns.currency,
          amount: campaignWithdrawals.amount,
          status: campaignWithdrawals.status,
          notes: campaignWithdrawals.notes,
          failureReason: campaignWithdrawals.failureReason,
          requestedAt: campaignWithdrawals.requestedAt,
          processedAt: campaignWithdrawals.processedAt,
        })
        .from(campaignWithdrawals)
        .innerJoin(campaigns, eq(campaignWithdrawals.campaignId, campaigns.id))
        .where(eq(campaignWithdrawals.requestedBy, userId))
        .orderBy(desc(campaignWithdrawals.requestedAt)),
    ]);

    inFlightByCampaign = Object.fromEntries(inFlightRows.map((r) => [r.campaignId, r.total]));
    withdrawalRows = wdRows;
  }

  // Build enriched campaign data with computed fields
  const enrichedCampaigns = userCampaigns.map((c) => {
    const released = c.totalReleasedAmount ?? 0;
    const withdrawn = c.totalWithdrawnAmount ?? 0;
    const inFlight = inFlightByCampaign[c.id] ?? 0;
    return {
      id: c.id,
      title: c.title ?? 'Untitled Campaign',
      slug: c.slug ?? '',
      status: c.status ?? 'active',
      currency: c.currency,
      goalAmount: c.goalAmount,
      raisedAmount: c.raisedAmount ?? 0,
      totalReleasedAmount: released,
      totalWithdrawnAmount: withdrawn,
      inFlightAmount: inFlight,
      availableBalance: Math.max(0, released - withdrawn - inFlight),
    };
  });

  const serializedWithdrawals = withdrawalRows.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    campaignTitle: r.campaignTitle ?? 'Unknown',
    campaignSlug: r.campaignSlug ?? '',
    currency: r.campaignCurrency,
    amount: r.amount,
    status: r.status,
    notes: r.notes,
    failureReason: r.failureReason,
    requestedAt: r.requestedAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
  }));

  return (
    <FinancesClient
      stripeConnectStatus={user?.stripeConnectStatus ?? 'not_started'}
      hasStripeAccount={!!user?.stripeConnectAccountId}
      campaigns={enrichedCampaigns}
      withdrawals={serializedWithdrawals}
    />
  );
}
