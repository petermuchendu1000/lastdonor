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
