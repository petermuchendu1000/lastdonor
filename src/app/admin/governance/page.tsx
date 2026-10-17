import { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { campaigns, users } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { GovernancePanel } from '@/components/admin/GovernancePanel';

export const metadata: Metadata = {
  title: 'Campaign Governance - Admin - LastDonor.org',
  robots: { index: false },
};

export const revalidate = 60;

export default async function AdminGovernancePage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') redirect('/admin');

  const rows = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      raisedAmount: campaigns.raisedAmount,
      goalAmount: campaigns.goalAmount,
      donorCount: campaigns.donorCount,
      creatorName: users.name,
      creatorEmail: users.email,
      pausedAt: campaigns.pausedAt,
      pausedReason: campaigns.pausedReason,
      suspendedAt: campaigns.suspendedAt,
      suspendedReason: campaigns.suspendedReason,
      cancelledAt: campaigns.cancelledAt,
      cancellationReason: campaigns.cancellationReason,
      verificationStatus: campaigns.verificationStatus,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .leftJoin(users, eq(campaigns.creatorId, users.id))
    .orderBy(desc(campaigns.updatedAt))
    .limit(200);

  /*
    docs/88 F16: the fetch above is capped at 200 and the panel's footer
    reported the length of that capped set as if it were the table. The
    true count is cheap and makes the cap visible.
  */
  const [{ totalCampaigns }] = await db
    .select({ totalCampaigns: sql<number>`count(*)::int` })
    .from(campaigns);

  const serialized = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    pausedAt: r.pausedAt?.toISOString() ?? null,
    suspendedAt: r.suspendedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
  }));

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Campaign Governance</h1>
        <p className="text-sm text-muted-foreground">
          {totalCampaigns} {totalCampaigns === 1 ? 'campaign' : 'campaigns'}
        </p>
      </div>
      <GovernancePanel campaigns={serialized} totalCampaigns={totalCampaigns} />
    </>
  );
}
