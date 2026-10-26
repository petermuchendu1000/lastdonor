import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { SimulationAnalytics } from '@/components/admin/SimulationAnalytics';
import { db } from '@/db';
import { campaigns, donations, fundPoolAllocations } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
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
        // ⛔ Grouped by currency too: this total added shillings to dollars
        // and the panel printed it with a dollar sign (`docs/92`).
        currency: donations.currency,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
      })
      .from(donations)
      .groupBy(donations.source, donations.currency),
    // Fund pool by status
    db
      .select({
        status: fundPoolAllocations.status,
        // `fund_pool_allocations` has no currency column: the amount belongs
        // to its SOURCE campaign (`docs/92`).
        currency: campaigns.currency,
        total: sql<number>`coalesce(sum(${fundPoolAllocations.amount}), 0)::int`,
      })
      .from(fundPoolAllocations)
      .innerJoin(campaigns, eq(fundPoolAllocations.sourceCampaignId, campaigns.id))
      .groupBy(fundPoolAllocations.status, campaigns.currency),
  ]);

  // Per-category breakdown: campaign count by sim flag, donation totals by source
  const categoryBreakdown = await db.execute(sql`
      SELECT
        c.category,
        count(*) FILTER (WHERE c.simulation_flag = true)::int AS simulated,
        count(*) FILTER (WHERE c.simulation_flag = false)::int AS real,
        -- Grouped by currency as well: these two sums added shillings to
        -- dollars and the table printed both with a dollar sign (docs/92).
        -- NOTE: no backticks in here - this is inside a JS template literal.
        c.currency AS currency,
        coalesce(sum(CASE WHEN d.source = 'seed' THEN d.amount ELSE 0 END), 0)::int AS seed_donations,
        coalesce(sum(CASE WHEN d.source = 'real' THEN d.amount ELSE 0 END), 0)::int AS real_donations
      FROM campaigns c
      LEFT JOIN donations d ON d.campaign_id = c.id
      GROUP BY c.category, c.currency
      ORDER BY c.category, c.currency
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
  /*
    ⛔ One row per (source, currency) now, so these are LISTS. `find` would
    silently pick whichever currency came back first (`docs/92`).
  */
  const seedTotals = donationStats
    .filter((d) => d.source === 'seed')
    .map((d) => ({ currency: d.currency, totalMinor: d.total }));
  const realTotals = donationStats
    .filter((d) => d.source === 'real')
    .map((d) => ({ currency: d.currency, totalMinor: d.total }));
  const seedCount = donationStats.filter((d) => d.source === 'seed').reduce((n, d) => n + d.count, 0);
  const realCount = donationStats.filter((d) => d.source === 'real').reduce((n, d) => n + d.count, 0);
  const donationData = {
    seed: { count: seedCount, totals: seedTotals },
    real: { count: realCount, totals: realTotals },
  };
  const totalDonations = donationData.seed.count + donationData.real.count;
  const ratio = totalDonations > 0 ? (donationData.real.count / totalDonations) * 100 : 0;

  // Fund pool
  /*
    ⛔ One row per (status, currency) now, so `find` would silently pick
    whichever currency came back first (`docs/92`).
  */
  const byStatus = (status: string) =>
    fundPoolStats
      .filter((f) => f.status === status)
      .map((f) => ({ currency: f.currency, totalMinor: f.total }));
  const fundPoolData = {
    pending: byStatus('pending'),
    allocated: byStatus('allocated'),
    disbursed: byStatus('disbursed'),
  };

  // Categories
  const categoryRows = categoryBreakdown as unknown as Array<{
    category: string;
    currency: string;
    simulated: number;
    real: number;
    seed_donations: number;
    real_donations: number;
  }>;
  // One row per (category, currency): a category can hold campaigns in more
  // than one currency, and adding those together is the defect (`docs/92`).
  const categories = categoryRows.map((r) => ({
    category: r.category,
    currency: r.currency,
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
