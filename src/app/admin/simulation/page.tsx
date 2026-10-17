import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { SimulationControlPanel } from '@/components/admin/SimulationControlPanel';
import { getAllSettings } from '@/lib/settings.server';
import { db } from '@/db';
import { campaigns, donations, fundPoolAllocations } from '@/db/schema';
import { sql, eq, and, inArray } from 'drizzle-orm';
import { calculateAutoVolume } from '@/lib/seed/phase-out';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Simulation Controls - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function SimulationPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    redirect('/admin');
  }

  const [
    settings,
    autoVolume,
    campaignRows,
    donationStats,
    fundPoolStats,
    [realCount],
  ] = await Promise.all([
    getAllSettings(),
    calculateAutoVolume(),
    db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        category: campaigns.category,
        goalAmount: campaigns.goalAmount,
        simulationFlag: campaigns.simulationFlag,
        simulationConfig: campaigns.simulationConfig,
        createdAt: campaigns.createdAt,
      })
      .from(campaigns)
      .where(eq(campaigns.simulationFlag, true)),
    db
      .select({
        source: donations.source,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
      })
      .from(donations)
      .groupBy(donations.source),
    db
      .select({
        status: fundPoolAllocations.status,
        total: sql<number>`coalesce(sum(${fundPoolAllocations.amount}), 0)::int`,
      })
      .from(fundPoolAllocations)
      .groupBy(fundPoolAllocations.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(eq(campaigns.simulationFlag, false)),
  ]);

  // Get donation counts per campaign
  const campaignIds = campaignRows.map((c) => c.id);
  const donationsByCampaign =
    campaignIds.length > 0
      ? await db
          .select({
            campaignId: donations.campaignId,
            source: donations.source,
            count: sql<number>`count(*)::int`,
            total: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
          })
          .from(donations)
          .where(inArray(donations.campaignId, campaignIds))
          .groupBy(donations.campaignId, donations.source)
      : [];

  const fundPendingByCampaign =
    campaignIds.length > 0
      ? await db
          .select({
            sourceCampaignId: fundPoolAllocations.sourceCampaignId,
            total: sql<number>`coalesce(sum(${fundPoolAllocations.amount}), 0)::int`,
          })
          .from(fundPoolAllocations)
          .where(
            and(
              inArray(fundPoolAllocations.sourceCampaignId, campaignIds),
              eq(fundPoolAllocations.status, 'pending'),
            ),
          )
          .groupBy(fundPoolAllocations.sourceCampaignId)
      : [];

  // Build campaign data with computed stats
  const donMap = new Map<string, { real: { count: number; total: number }; seed: { count: number; total: number } }>();
  for (const d of donationsByCampaign) {
    if (!d.campaignId) continue;
    if (!donMap.has(d.campaignId)) donMap.set(d.campaignId, { real: { count: 0, total: 0 }, seed: { count: 0, total: 0 } });
    const entry = donMap.get(d.campaignId)!;
    if (d.source === 'real') {
      entry.real = { count: d.count, total: d.total };
    } else {
      entry.seed = { count: d.count, total: d.total };
    }
  }
  const fpMap = new Map(fundPendingByCampaign.map((f) => [f.sourceCampaignId, f.total]));

  const campaignsData = campaignRows.map((c) => {
    const dons = donMap.get(c.id) ?? { real: { count: 0, total: 0 }, seed: { count: 0, total: 0 } };
    const raised = dons.real.total + dons.seed.total;
    const goal = c.goalAmount ?? 0;
    return {
      id: c.id,
      title: c.title,
      slug: c.slug,
      status: c.status,
      category: c.category,
      progress: goal > 0 ? Math.round((raised / goal) * 100) : 0,
      raisedAmount: raised,
      goalAmount: goal,
      realDonationCount: dons.real.count,
      realDonationTotal: dons.real.total,
      seedDonationCount: dons.seed.count,
      seedDonationTotal: dons.seed.total,
      fundPoolPending: fpMap.get(c.id) ?? 0,
      paused: !!(c.simulationConfig as { paused?: boolean } | null)?.paused,
      createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  });

  // Build summary stats
  const seedDon = donationStats.find((d) => d.source === 'seed');
  const realDon = donationStats.find((d) => d.source === 'real');
  const fpPending = fundPoolStats.find((f) => f.status === 'pending');
  const fpAllocated = fundPoolStats.find((f) => f.status === 'allocated');
  const fpDisbursed = fundPoolStats.find((f) => f.status === 'disbursed');

  const simulationSettings = {
    enabled: settings['simulation.enabled'] as boolean,
    volume: settings['simulation.volume_multiplier'] as number,
    maxConcurrent: settings['simulation.max_concurrent'] as number,
    minCycleMinutes: settings['simulation.min_cycle_minutes'] as number,
    cohortChance: settings['simulation.cohort_chance'] as number,
    autoComplete: settings['simulation.auto_complete'] as boolean,
    fundAllocationDefault: settings['simulation.fund_allocation_default'] as string,
    realisticTiming: settings['simulation.realistic_timing'] as boolean,
    pauseAll: settings['simulation.pause_all'] as boolean,
    phaseOut: {
      enabled: settings['simulation.phase_out.enabled'] as boolean,
      thresholdLow: settings['simulation.phase_out.threshold_low'] as number,
      thresholdMid: settings['simulation.phase_out.threshold_mid'] as number,
      thresholdHigh: settings['simulation.phase_out.threshold_high'] as number,
    },
    effectiveVolume: autoVolume,
  };

  const analytics = {
    simulatedCount: campaignRows.filter((c) => c.status === 'active').length,
    realCampaigns: realCount.count,
    seedDonations: { count: seedDon?.count ?? 0, total: seedDon?.total ?? 0 },
    realDonations: { count: realDon?.count ?? 0, total: realDon?.total ?? 0 },
    fundPool: {
      pending: fpPending?.total ?? 0,
      allocated: fpAllocated?.total ?? 0,
      disbursed: fpDisbursed?.total ?? 0,
    },
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Simulation Controls</h1>
        <p className="text-sm text-muted-foreground">
          Manage simulated campaigns, configure automation, and monitor the dual-campaign system.
        </p>
      </div>
      <SimulationControlPanel
        initialSettings={simulationSettings}
        campaigns={campaignsData}
        analytics={analytics}
      />
    </>
  );
}
