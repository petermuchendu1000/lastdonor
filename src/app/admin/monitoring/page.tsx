import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getAICostSummary, getDailyCostTrend, getCostByPromptType } from '@/lib/monitoring/ai-cost-tracker';
import { getSimulationQuality, getPipelineHealth } from '@/lib/monitoring/pipeline-health';
import dynamic from 'next/dynamic';
import type { Metadata } from 'next';

const PipelineMonitor = dynamic(
  () => import('@/components/admin/PipelineMonitor').then((m) => ({ default: m.PipelineMonitor }))
);

export const metadata: Metadata = {
  title: 'Monitoring - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function MonitoringPage() {
  /*
    ⛔ The sidebar marks this page's group `adminOnly`, and until `docs/132`
    that was the ONLY thing keeping an editor out - which is to say nothing
    kept them out, because hiding a link does not gate a URL.
    `src/app/admin/layout.tsx:30` admits `editor` as well as `admin`.
    [VERIFIED in a browser: an editor was served this page, byte-identical to
    the admin control.] `admin-nav-role.ratchet.test.ts` now derives this
    requirement from the sidebar's own `adminOnly` flag.
  */
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  const [costSummary, costTrend, costByPromptType, simulationQuality, pipelineHealth] =
    await Promise.all([
      getAICostSummary(),
      getDailyCostTrend(30),
      getCostByPromptType(30),
      getSimulationQuality(),
      getPipelineHealth(),
    ]);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          AI costs, content quality, and pipeline health.
        </p>
      </div>
      <PipelineMonitor
        aiCosts={{ summary: costSummary, trend: costTrend, byPromptType: costByPromptType }}
        simulationQuality={simulationQuality}
        pipelineHealth={pipelineHealth}
      />
    </>
  );
}
