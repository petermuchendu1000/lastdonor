import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users, campaigns, campaignWithdrawals } from '@/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { PayoutSettingsClient } from '@/components/dashboard/PayoutSettingsClient';
import { isConnectAvailable, getAccountStatus } from '@/lib/stripe-connect';
import type { ConnectAccountStatus } from '@/lib/stripe-connect';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Payout Account | LastDonor.org',
  description: 'Connect your bank account to receive funds from your campaigns.',
};

async function getPayoutData(userId: string) {
  const [user] = await db
    .select({
      stripeConnectAccountId: users.stripeConnectAccountId,
      stripeConnectStatus: users.stripeConnectStatus,
      stripeConnectOnboardedAt: users.stripeConnectOnboardedAt,
      payoutCurrency: users.payoutCurrency,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Get user's campaigns with financial data
  const userCampaigns = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      // Minor units of THIS row's currency (`docs/92`); the client used to
      // format every figure below with a hardcoded `currency: 'USD'`.
      currency: campaigns.currency,
      goalAmount: campaigns.goalAmount,
      raisedAmount: campaigns.raisedAmount,
      totalReleasedAmount: campaigns.totalReleasedAmount,
      totalWithdrawnAmount: campaigns.totalWithdrawnAmount,
    })
    .from(campaigns)
    .where(eq(campaigns.creatorId, userId))
    .orderBy(desc(campaigns.createdAt));

  // Get recent withdrawals across all user campaigns
  const campaignIds = userCampaigns.map((c) => c.id);
  let recentWithdrawals: Array<{
    id: string;
    campaignId: string;
    currency: string;
    amount: number;
    status: string;
    stripeTransferId: string | null;
    failureReason: string | null;
    requestedAt: string;
    processedAt: string | null;
  }> = [];

  if (campaignIds.length > 0) {
    const rows = await db
      .select({
        id: campaignWithdrawals.id,
        campaignId: campaignWithdrawals.campaignId,
        // A withdrawal is in the money it came out of. Read from the campaign
        // through the join rather than inferred, so there is no code path
        // that can silently settle on dollars.
        currency: campaigns.currency,
        amount: campaignWithdrawals.amount,
        status: campaignWithdrawals.status,
        stripeTransferId: campaignWithdrawals.stripeTransferId,
        failureReason: campaignWithdrawals.failureReason,
        requestedAt: campaignWithdrawals.requestedAt,
        processedAt: campaignWithdrawals.processedAt,
      })
      .from(campaignWithdrawals)
      .innerJoin(campaigns, eq(campaignWithdrawals.campaignId, campaigns.id))
      .where(inArray(campaignWithdrawals.campaignId, campaignIds))
      .orderBy(desc(campaignWithdrawals.requestedAt))
      .limit(50);

    recentWithdrawals = rows.map((w) => ({
      ...w,
      requestedAt: w.requestedAt instanceof Date ? w.requestedAt.toISOString() : String(w.requestedAt),
      processedAt: w.processedAt instanceof Date ? w.processedAt.toISOString() : w.processedAt ? String(w.processedAt) : null,
    }));
  }

  // Sync live status from Stripe if user has a Connect account.
  // This ensures the page always reflects Stripe's actual state,
  // even if the webhook didn't fire (e.g. missing webhook secret in dev).
  let resolvedStatus = user?.stripeConnectStatus ?? 'not_started';
  let resolvedOnboardedAt = user?.stripeConnectOnboardedAt ?? null;
  let resolvedCurrency = user?.payoutCurrency ?? null;

  if (user?.stripeConnectAccountId) {
    try {
      const live = await getAccountStatus(user.stripeConnectAccountId);
      const liveStatus = live.status as ConnectAccountStatus;

      // Update DB if status diverged
      if (liveStatus !== resolvedStatus) {
        const updateFields: Record<string, unknown> = {
          stripeConnectStatus: liveStatus,
        };

        // Set onboardedAt on first transition to verified
        if (liveStatus === 'verified' && !resolvedOnboardedAt) {
          const now = new Date();
          updateFields.stripeConnectOnboardedAt = now;
          resolvedOnboardedAt = now;
        }

        // Store default currency from Stripe
        if (live.defaultCurrency && live.defaultCurrency !== resolvedCurrency) {
          updateFields.payoutCurrency = live.defaultCurrency;
          resolvedCurrency = live.defaultCurrency;
        }

        await db
          .update(users)
          .set(updateFields)
          .where(eq(users.id, userId));

        resolvedStatus = liveStatus;
      }
    } catch (err) {
      console.error('[PayoutSettings] Failed to sync live Stripe status:', err);
      // Fall through with DB status
    }
  }

  return {
    connectStatus: {
      hasAccount: !!user?.stripeConnectAccountId,
      status: resolvedStatus,
      onboardedAt: resolvedOnboardedAt ? resolvedOnboardedAt.toISOString() : null,
      payoutCurrency: resolvedCurrency,
    },
    campaigns: userCampaigns.map((c) => ({
      id: c.id,
      title: c.title,
      slug: c.slug,
      status: c.status,
      currency: c.currency,
      goalAmount: c.goalAmount,
      raisedAmount: c.raisedAmount ?? 0,
      totalReleasedAmount: c.totalReleasedAmount ?? 0,
      totalWithdrawnAmount: c.totalWithdrawnAmount ?? 0,
      availableBalance: (c.totalReleasedAmount ?? 0) - (c.totalWithdrawnAmount ?? 0),
    })),
    withdrawals: recentWithdrawals,
  };
}

export default async function PayoutSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/dashboard/payout-settings');
  }

  const data = await getPayoutData(session.user.id);
  const connectAvailable = await isConnectAvailable();

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-foreground">Payout Account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect your bank account and manage your payout settings
      </p>
      <div className="mt-6">
        <PayoutSettingsClient
          connectStatus={data.connectStatus}
          campaigns={data.campaigns}
          withdrawals={data.withdrawals}
          connectAvailable={connectAvailable}
        />
      </div>
    </>
  );
}
