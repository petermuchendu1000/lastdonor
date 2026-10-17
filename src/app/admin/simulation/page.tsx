import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { SimulationControlPanel } from '@/components/admin/SimulationControlPanel';
import { getAllSettings } from '@/lib/settings.server';
import { db } from '@/db';
import { campaigns, donations, fundPoolAllocations, auditLogs } from '@/db/schema';
import { sql, eq, and, inArray } from 'drizzle-orm';
import { calculateAutoVolume } from '@/lib/seed/phase-out';
import { getSimulationReadiness } from '@/lib/seed/simulation-readiness';
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

  /*
    ── Why this page does not use one big Promise.all ────────────────

    It used to. Six branches ran concurrently, and one of them
    (`calculateAutoVolume`) issued five queries of its own, against a
    pool of FIVE connections (`src/db/index.ts`, `max: 5`). The admin
    layout's `auth()` role lookup runs alongside it. So opening this
    one screen could demand more connections than the whole process
    owns, and the surplus queries queue.

    `withQueryTimeout` starts its 15s clock when a query is issued,
    queue time included, and on expiry it calls `pending.cancel()` -
    the path docs/52 and docs/87 suspect of leaving a backend wedged in
    `active` / `Client/ClientRead` with an open transaction. On
    2026-10-17 the sixth pool wedge was found holding
    `select count(*)::int from "campaigns" where "simulation_flag" = $1`,
    which exists in exactly one place in the codebase: the `realCount`
    query below. See docs/87.

    The settings are therefore loaded first and passed to
    `calculateAutoVolume`, which removes four queries outright, and the
    rest run in batches that cannot exceed the pool. The page is an
    operator screen; a few serialised round trips cost milliseconds and
    cannot starve every other request on the machine.
  */
  const settings = await getAllSettings();

  const [autoVolume, campaignRows, donationStats] = await Promise.all([
    calculateAutoVolume(settings),
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
  ]);

  const [fundPoolStats, [realCount], [lastCron]] = await Promise.all([
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
    /*
      The most recent run of ANY cron job, which is how this screen
      knows whether a scheduler exists at all (docs/88 F9). Crons log
      `cron.<job>` rows; nothing else writes that prefix.
    */
    db
      .select({ at: sql<Date>`max(${auditLogs.timestamp})` })
      .from(auditLogs)
      .where(sql`${auditLogs.eventType} LIKE 'cron.%'`),
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

  /*
    docs/88 F9. Read from the three things that actually block a seed
    donation, so a cleared blocker disappears on its own rather than
    leaving a stale warning behind.
  */
  const readiness = getSimulationReadiness(
    lastCron?.at ? new Date(lastCron.at) : null,
  );

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
        readiness={readiness}
      />
    </>
  );
}
