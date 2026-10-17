import { db } from '@/db';
import { startOfReportingMonth } from '@/lib/reporting-timezone';
import { aiUsageLogs, auditLogs, siteSettings } from '@/db/schema';
import { sql, gte, eq, and } from 'drizzle-orm';

/**
 * Per-token cost in microdollars (1 microdollar = $0.000001).
 * Used to compute estimated costs from raw token counts.
 * Source: OpenRouter pricing as of 2024-12.
 */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'anthropic/claude-3.5-haiku': { input: 0.25, output: 1.25 },
};

/** Compute estimated cost in USD from token counts and model. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = MODEL_COSTS[model] ?? MODEL_COSTS['openai/gpt-4o-mini'];
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

export type AIUsageEntry = {
  model: string;
  promptType: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
  campaignId?: string;
};

/**
 * Log an AI usage entry to the database.
 * Fire-and-forget: never throws, never blocks the caller.
 */
export async function logAIUsage(entry: AIUsageEntry): Promise<void> {
  try {
    await db.insert(aiUsageLogs).values({
      model: entry.model,
      promptType: entry.promptType,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      latencyMs: entry.latencyMs,
      success: entry.success,
      errorMessage: entry.errorMessage,
      campaignId: entry.campaignId,
    });

    // Check daily cost threshold (only on successful calls to avoid noise)
    if (entry.success) {
      await checkDailyCostThreshold();
    }
  } catch (err) {
    // Logging must never crash the caller - but record the failure
    console.error('[ai-cost-tracker] logAIUsage failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Check if today's AI spend exceeds the configured threshold.
 * If exceeded and no alert has been raised today, insert an audit log warning.
 */
async function checkDailyCostThreshold(): Promise<void> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  // Get today's total tokens
  const [todayUsage] = await db
    .select({
      totalInputTokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens}), 0)::int`,
      totalOutputTokens: sql<number>`coalesce(sum(${aiUsageLogs.outputTokens}), 0)::int`,
      callCount: sql<number>`count(*)::int`,
    })
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, startOfDay));

  // Estimate cost in cents (using gpt-4o-mini rates as conservative default)
  const estimatedCostCents = Math.round(
    estimateCostUsd('openai/gpt-4o-mini', todayUsage.totalInputTokens, todayUsage.totalOutputTokens) * 100,
  );

  // Get threshold from site_settings
  const [setting] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'ai_daily_cost_alert_cents'));

  const thresholdCents = setting ? Number(setting.value) : 500;
  if (estimatedCostCents < thresholdCents) return;

  // Check if we already alerted today
  const [existingAlert] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.eventType, 'monitoring.ai_cost_alert'),
        gte(auditLogs.timestamp, startOfDay),
      ),
    )
    .limit(1);

  if (existingAlert) return;

  await db.insert(auditLogs).values({
    eventType: 'monitoring.ai_cost_alert',
    severity: 'warning',
    details: {
      estimatedCostCents,
      thresholdCents,
      callCount: todayUsage.callCount,
      totalInputTokens: todayUsage.totalInputTokens,
      totalOutputTokens: todayUsage.totalOutputTokens,
    },
  });
}

export type AICostSummary = {
  today: { costUsd: number; calls: number; inputTokens: number; outputTokens: number };
  week: { costUsd: number; calls: number; inputTokens: number; outputTokens: number };
  month: { costUsd: number; calls: number; inputTokens: number; outputTokens: number };
  thresholdCents: number;
  thresholdExceeded: boolean;
};

/** Aggregate AI cost data for the monitoring dashboard. */
export async function getAICostSummary(): Promise<AICostSummary> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // docs/88 F15.
  const startOfMonth = startOfReportingMonth(now);

  const [today, week, month] = await Promise.all([
    db
      .select({
        inputTokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsageLogs.outputTokens}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(aiUsageLogs)
      .where(gte(aiUsageLogs.createdAt, startOfDay))
      .then((r) => r[0]),
    db
      .select({
        inputTokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsageLogs.outputTokens}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(aiUsageLogs)
      .where(gte(aiUsageLogs.createdAt, startOfWeek))
      .then((r) => r[0]),
    db
      .select({
        inputTokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsageLogs.outputTokens}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(aiUsageLogs)
      .where(gte(aiUsageLogs.createdAt, startOfMonth))
      .then((r) => r[0]),
  ]);

  const [setting] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'ai_daily_cost_alert_cents'));

  const thresholdCents = setting ? Number(setting.value) : 500;

  const todayCost = estimateCostUsd('openai/gpt-4o-mini', today.inputTokens, today.outputTokens);
  const todayCostCents = Math.round(todayCost * 100);

  return {
    today: { costUsd: todayCost, calls: today.calls, inputTokens: today.inputTokens, outputTokens: today.outputTokens },
    week: { costUsd: estimateCostUsd('openai/gpt-4o-mini', week.inputTokens, week.outputTokens), calls: week.calls, inputTokens: week.inputTokens, outputTokens: week.outputTokens },
    month: { costUsd: estimateCostUsd('openai/gpt-4o-mini', month.inputTokens, month.outputTokens), calls: month.calls, inputTokens: month.inputTokens, outputTokens: month.outputTokens },
    thresholdCents,
    thresholdExceeded: todayCostCents >= thresholdCents,
  };
}

export type DailyCostPoint = {
  date: string;
  costUsd: number;
  calls: number;
};

/** Get daily AI cost trend for the last N days. */
export async function getDailyCostTrend(days: number = 30): Promise<DailyCostPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      date: sql<Date | string>`date_trunc('day', ${aiUsageLogs.createdAt})::date`,
      inputTokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageLogs.outputTokens}), 0)::int`,
      calls: sql<number>`count(*)::int`,
    })
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, since))
    .groupBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`)
    .orderBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`);

  return rows.map((r) => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
    costUsd: estimateCostUsd('openai/gpt-4o-mini', r.inputTokens, r.outputTokens),
    calls: r.calls,
  }));
}

export type CostByPromptType = {
  promptType: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

/** Get cost breakdown by prompt type for the last N days. */
export async function getCostByPromptType(days: number = 30): Promise<CostByPromptType[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      promptType: aiUsageLogs.promptType,
      inputTokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageLogs.outputTokens}), 0)::int`,
      calls: sql<number>`count(*)::int`,
    })
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, since))
    .groupBy(aiUsageLogs.promptType)
    .orderBy(sql`count(*) desc`);

  return rows.map((r) => ({
    promptType: r.promptType,
    calls: r.calls,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: estimateCostUsd('openai/gpt-4o-mini', r.inputTokens, r.outputTokens),
  }));
}
