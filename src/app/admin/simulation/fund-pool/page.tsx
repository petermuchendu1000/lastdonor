import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { FundPoolManager } from '@/components/admin/FundPoolManager';
import { db } from '@/db';
import { campaigns, fundPoolAllocations } from '@/db/schema';
import { sql, eq, and } from 'drizzle-orm';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Fund Pool - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function FundPoolPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    redirect('/admin');
  }

  const [allocations, summaryRows, targetCandidates] = await Promise.all([
    db
      .select({
        id: fundPoolAllocations.id,
        donationId: fundPoolAllocations.donationId,
        sourceCampaignId: fundPoolAllocations.sourceCampaignId,
        sourceCampaignTitle: campaigns.title,
        sourceCampaignSlug: campaigns.slug,
        targetCampaignId: fundPoolAllocations.targetCampaignId,
        amount: fundPoolAllocations.amount,
        status: fundPoolAllocations.status,
        notes: fundPoolAllocations.notes,
        allocatedAt: fundPoolAllocations.allocatedAt,
        disbursedAt: fundPoolAllocations.disbursedAt,
        createdAt: fundPoolAllocations.createdAt,
      })
      .from(fundPoolAllocations)
      .leftJoin(campaigns, eq(fundPoolAllocations.sourceCampaignId, campaigns.id))
      .orderBy(sql`${fundPoolAllocations.createdAt} DESC`)
      .limit(200),
    db
      .select({
        status: fundPoolAllocations.status,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${fundPoolAllocations.amount}), 0)::int`,
      })
      .from(fundPoolAllocations)
      .groupBy(fundPoolAllocations.status),
    // Campaigns that can receive allocations (real, active)
    db
      .select({ id: campaigns.id, title: campaigns.title })
      .from(campaigns)
      .where(and(eq(campaigns.simulationFlag, false), eq(campaigns.status, 'active'))),
  ]);

  const summary = {
    pending: { count: 0, total: 0 },
    allocated: { count: 0, total: 0 },
    disbursed: { count: 0, total: 0 },
  };
  for (const r of summaryRows) {
    if (r.status === 'pending' || r.status === 'allocated' || r.status === 'disbursed') {
      summary[r.status] = { count: r.count, total: r.total };
    }
  }

  const allocationData = allocations.map((a) => ({
    id: a.id,
    donationId: a.donationId,
    sourceCampaignId: a.sourceCampaignId,
    sourceCampaignTitle: a.sourceCampaignTitle ?? 'Unknown',
    sourceCampaignSlug: a.sourceCampaignSlug ?? '',
    targetCampaignId: a.targetCampaignId,
    amount: a.amount,
    status: a.status,
    notes: a.notes,
    allocatedAt: a.allocatedAt?.toISOString() ?? null,
    disbursedAt: a.disbursedAt?.toISOString() ?? null,
    createdAt: a.createdAt?.toISOString() ?? new Date().toISOString(),
  }));

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Fund Pool Management</h1>
        <p className="text-sm text-muted-foreground">
          Track, allocate, and disburse pooled funds from simulated campaigns.
        </p>
      </div>
      <FundPoolManager
        allocations={allocationData}
        summary={summary}
        targetCampaigns={targetCandidates}
      />
    </>
  );
}
