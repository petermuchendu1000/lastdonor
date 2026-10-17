import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { SimulationAnalytics } from '@/components/admin/SimulationAnalytics';
import { db } from '@/db';
import { campaigns, donations, fundPoolAllocations } from '@/db/schema';
import { sql } from 'drizzle-orm';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Simulation Analytics - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    redirect('/admin');
  }

  /*
    docs/87 amendment 5: three concurrent queries plus the layout's
    `auth()` is the pool's whole capacity. The category breakdown runs
    after the batch rather than inside it; it is the slowest of the
    four and nothing else depends on it.
  */
  const [
    campaignCounts,
    donationStats,
    fundPoolStats,
  ] = await Promise.all([
    // Campaign counts by simulation flag + status
    db
      .select({
        simulationFlag: campaigns.simulationFlag,
        status: campaigns.status,
        count: sql<number>`count(*)::int`,
      })
      .from(campaigns)
      .groupBy(campaigns.simulationFlag, campaigns.status),
    // Donation totals by source
    db
      .select({
        source: donations.source,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
      })
      .from(donations)
      .groupBy(donations.source),
    // Fund pool by status
    db
      .select({
        status: fundPoolAllocations.status,
        total: sql<number>`coalesce(sum(${fundPoolAllocations.amount}), 0)::int`,
      })
      .from(fundPoolAllocations)
      .groupBy(fundPoolAllocations.status),
  ]);

  // Per-category breakdown: campaign count by sim flag, donation totals by source
  const categoryBreakdown = await db.execute(sql`
      SELECT
        c.category,
        count(*) FILTER (WHERE c.simulation_flag = true)::int AS simulated,
        count(*) FILTER (WHERE c.simulation_flag = false)::int AS real,
        coalesce(sum(CASE WHEN d.source = 'seed' THEN d.amount ELSE 0 END), 0)::int AS seed_donations,
        coalesce(sum(CASE WHEN d.source = 'real' THEN d.amount ELSE 0 END), 0)::int AS real_donations
      FROM campaigns c
      LEFT JOIN donations d ON d.campaign_id = c.id
      GROUP BY c.category
      ORDER BY c.category
  `);

  // Build campaign counts
  const campaignData = { simulated: { active: 0, completed: 0, archived: 0, total: 0 }, real: { active: 0, completed: 0, archived: 0, total: 0 } };
  for (const row of campaignCounts) {
    const bucket = row.simulationFlag ? campaignData.simulated : campaignData.real;
    const status = row.status as string;
    if (status === 'active') bucket.active = row.count;
    else if (status === 'completed') bucket.completed = row.count;
    else if (status === 'archived') bucket.archived = row.count;
    bucket.total += row.count;
  }

  // Donation stats
  const seedDon = donationStats.find((d) => d.source === 'seed');
  const realDon = donationStats.find((d) => d.source === 'real');
  const donationData = {
    seed: { count: seedDon?.count ?? 0, total: seedDon?.total ?? 0 },
    real: { count: realDon?.count ?? 0, total: realDon?.total ?? 0 },
  };
  const totalDonations = donationData.seed.count + donationData.real.count;
  const ratio = totalDonations > 0 ? (donationData.real.count / totalDonations) * 100 : 0;

  // Fund pool
  const fpPending = fundPoolStats.find((f) => f.status === 'pending');
  const fpAllocated = fundPoolStats.find((f) => f.status === 'allocated');
  const fpDisbursed = fundPoolStats.find((f) => f.status === 'disbursed');
  const fundPoolData = {
    pending: fpPending?.total ?? 0,
    allocated: fpAllocated?.total ?? 0,
    disbursed: fpDisbursed?.total ?? 0,
  };

  // Categories
  const categoryRows = categoryBreakdown as unknown as Array<{
    category: string;
    simulated: number;
    real: number;
    seed_donations: number;
    real_donations: number;
  }>;
  const categories = categoryRows.map((r) => ({
    category: r.category,
    simulated: Number(r.simulated),
    real: Number(r.real),
    seedDonations: Number(r.seed_donations),
    realDonations: Number(r.real_donations),
  }));

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Simulation Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Monitor the balance between simulated and real campaigns, donation patterns, and fund flow.
        </p>
      </div>
      <SimulationAnalytics
        campaigns={campaignData}
        donations={donationData}
        ratio={ratio}
        fundPool={fundPoolData}
        categories={categories}
      />
    </>
  );
}
