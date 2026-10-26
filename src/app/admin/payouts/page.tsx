import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import {
  campaigns,
  campaignWithdrawals,
  auditLogs,
  users,
} from '@/db/schema';
import { desc, sql, count, eq, inArray, and } from 'drizzle-orm';
import { PayoutsDashboard } from '@/components/admin/PayoutsDashboard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Payouts - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AdminFundReleasesPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  // Load verified campaigns that have released funds or are eligible for withdrawal
  const [campaignList, [stats]] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        verificationStatus: campaigns.verificationStatus,
        goalAmount: campaigns.goalAmount,
        raisedAmount: campaigns.raisedAmount,
        currency: campaigns.currency,
        totalReleasedAmount: campaigns.totalReleasedAmount,
        totalWithdrawnAmount: campaigns.totalWithdrawnAmount,
        creatorId: campaigns.creatorId,
        creatorName: users.name,
        creatorEmail: users.email,
        updatedAt: campaigns.updatedAt,
      })
      .from(campaigns)
      .leftJoin(users, eq(campaigns.creatorId, users.id))
      .where(
        sql`${campaigns.verificationStatus} IN ('identity_verified', 'fully_verified') OR ${campaigns.totalReleasedAmount} > 0`,
      )
      .orderBy(desc(campaigns.updatedAt))
      .limit(500),
    db
      .select({
        /*
          docs/88 F16: the true number of campaigns matching the same
          predicate as the 500-row fetch above, so the footer can report
          how much of it was loaded.
        */
        totalMatching: sql<number>`count(*)::int`,
        totalFullyVerified: sql<number>`count(*) FILTER (WHERE ${campaigns.verificationStatus} = 'fully_verified')::int`,
        totalReleased: sql<number>`count(*) FILTER (WHERE ${campaigns.totalReleasedAmount} > 0)::int`,
        totalWithdrawn: sql<number>`count(*) FILTER (WHERE ${campaigns.totalWithdrawnAmount} > 0)::int`,
        totalPendingVerification: sql<number>`count(*) FILTER (WHERE ${campaigns.verificationStatus} = 'identity_verified')::int`,
      })
      .from(campaigns)
      .where(
        sql`${campaigns.verificationStatus} IN ('identity_verified', 'fully_verified') OR ${campaigns.totalReleasedAmount} > 0`,
      ),
  ]);

  const campaignIds = campaignList.map((c) => c.id);

  if (campaignIds.length === 0) {
    return (
      <>
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Payouts</h1>
          <p className="text-sm text-muted-foreground">No campaigns with released or releasable funds</p>
        </div>
        <PayoutsDashboard initialCampaigns={[]} stats={stats} />
      </>
    );
  }

  // Parallel: withdrawal counts + recent audit entries
  const [withdrawalsByC, auditEntries] = await Promise.all([
    db
      .select({
        campaignId: campaignWithdrawals.campaignId,
        withdrawalCount: count(),
        totalRequested: sql<number>`sum(${campaignWithdrawals.amount})::int`,
      })
      .from(campaignWithdrawals)
      .where(inArray(campaignWithdrawals.campaignId, campaignIds))
      .groupBy(campaignWithdrawals.campaignId),
    db
      .select({
        id: auditLogs.id,
        eventType: auditLogs.eventType,
        actorId: auditLogs.actorId,
        targetId: auditLogs.targetId,
        targetType: auditLogs.targetType,
        details: auditLogs.details,
        severity: auditLogs.severity,
        timestamp: auditLogs.timestamp,
      })
      .from(auditLogs)
      .where(
        and(
          inArray(auditLogs.targetId, campaignIds),
          eq(auditLogs.targetType, 'campaign'),
        ),
      )
      .orderBy(desc(auditLogs.timestamp))
      .limit(200),
  ]);

  const withdrawals = Object.fromEntries(
    withdrawalsByC.map((w) => [w.campaignId, { count: w.withdrawalCount, total: w.totalRequested ?? 0 }]),
  );

  // Group audit entries by campaign
  const auditByCampaign: Record<string, typeof auditEntries> = {};
  for (const a of auditEntries) {
    const tId = a.targetId!;
    if (!auditByCampaign[tId]) auditByCampaign[tId] = [];
    auditByCampaign[tId].push(a);
  }

  const serialized = campaignList.map((c) => ({
    ...c,
    totalReleasedAmount: c.totalReleasedAmount ?? 0,
    totalWithdrawnAmount: c.totalWithdrawnAmount ?? 0,
    withdrawalCount: withdrawals[c.id]?.count ?? 0,
    updatedAt: c.updatedAt.toISOString(),
    auditTrail: (auditByCampaign[c.id] || []).slice(0, 20).map((a) => ({
      id: a.id,
      eventType: a.eventType,
      actorId: a.actorId,
      details: a.details as Record<string, unknown> | null,
      severity: a.severity,
      timestamp: a.timestamp.toISOString(),
    })),
  }));

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Payouts</h1>
        <p className="text-sm text-muted-foreground">
          {stats.totalFullyVerified} verified campaigns, {stats.totalReleased} with released funds
        </p>
      </div>
      <PayoutsDashboard initialCampaigns={serialized} stats={stats} />
    </>
  );
}
