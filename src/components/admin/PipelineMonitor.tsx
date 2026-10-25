'use client';

import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  FlagIcon,
} from '@heroicons/react/24/outline';
import { formatRelativeTime } from '@/lib/utils/dates';
import { toast } from 'sonner';
import type {
  AICostSummary,
  DailyCostPoint,
  CostByPromptType,
} from '@/lib/monitoring/ai-cost-tracker';
import type {
  SimulationQuality,
  PipelineHealth,
} from '@/lib/monitoring/pipeline-health';

// ── Props ───────────────────────────────────────────────────────────────────

interface PipelineMonitorProps {
  aiCosts: {
    summary: AICostSummary;
    trend: DailyCostPoint[];
    byPromptType: CostByPromptType[];
  };
  simulationQuality: SimulationQuality;
  pipelineHealth: PipelineHealth;
}

// ── Main Component ──────────────────────────────────────────────────────────

export function PipelineMonitor({
  aiCosts,
  simulationQuality,
  pipelineHealth,
}: PipelineMonitorProps) {
  return (
    <Tabs defaultValue="costs">
      <TabsList>
        <TabsTrigger value="costs">AI Costs</TabsTrigger>
        <TabsTrigger value="simulation">Content Quality</TabsTrigger>
        <TabsTrigger value="pipeline">Pipeline Health</TabsTrigger>
      </TabsList>

      <TabsContent value="costs">
        <AICostsTab data={aiCosts} />
      </TabsContent>
      <TabsContent value="simulation">
        <SimulationTab data={simulationQuality} />
      </TabsContent>
      <TabsContent value="pipeline">
        <PipelineTab data={pipelineHealth} />
      </TabsContent>
    </Tabs>
  );
}

// ── AI Costs Tab ────────────────────────────────────────────────────────────

function AICostsTab({
  data,
}: {
  data: PipelineMonitorProps['aiCosts'];
}) {
  const { summary, trend, byPromptType } = data;

  return (
    <div className="mt-4 space-y-6">
      {/* Threshold Alert */}
      {summary.thresholdExceeded && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">
            Daily AI cost threshold exceeded (${(summary.thresholdCents / 100).toFixed(2)} limit).
            Today&apos;s spend: ${summary.today.costUsd.toFixed(4)}
          </p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <CostCard label="Today" cost={summary.today.costUsd} calls={summary.today.calls} />
        <CostCard label="Last 7 Days" cost={summary.week.costUsd} calls={summary.week.calls} />
        <CostCard label="This Month" cost={summary.month.costUsd} calls={summary.month.calls} />
      </div>

      {/* 30-Day Trend */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Daily Cost Trend (30 days)</h3>
        </div>
        <div className="p-4">
          {trend.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d: string) => d.slice(5)}
                  className="fill-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  className="fill-muted-foreground"
                />
                <Tooltip
                  formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                  labelFormatter={(l) => String(l)}
                />
                <Area
                  type="monotone"
                  dataKey="costUsd"
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Cost by Prompt Type */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Cost by Prompt Type (30 days)</h3>
        </div>
        <div className="p-4">
          {byPromptType.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Prompt Type</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Calls</th>
                    <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground sm:table-cell">Input Tokens</th>
                    <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground sm:table-cell">Output Tokens</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {byPromptType.map((row) => (
                    <tr key={row.promptType} className="hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <Badge variant="outline">{row.promptType}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {row.calls.toLocaleString()}
                      </td>
                      <td className="hidden px-4 py-2 text-right font-mono tabular-nums sm:table-cell">
                        {row.inputTokens.toLocaleString()}
                      </td>
                      <td className="hidden px-4 py-2 text-right font-mono tabular-nums sm:table-cell">
                        {row.outputTokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        ${row.costUsd.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CostCard({ label, cost, calls }: { label: string; cost: number; calls: number }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">${cost.toFixed(4)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{calls.toLocaleString()} API calls</p>
    </div>
  );
}

// ── Simulation Quality Tab ──────────────────────────────────────────────────

function SimulationTab({ data }: { data: SimulationQuality }) {
  return (
    <div className="mt-4 space-y-6">
      {/* Age Buckets */}
      <div className="grid gap-4 sm:grid-cols-4">
        {data.ageBuckets.map((bucket) => (
          <div key={bucket.label} className="rounded-lg border px-4 py-3">
            <p className="text-xs text-muted-foreground">Campaigns {bucket.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{bucket.count}</p>
          </div>
        ))}
      </div>

      {/* Category Distribution */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Campaign Category Distribution</h3>
        </div>
        <div className="p-4">
          {data.categoryDistribution.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No active campaigns.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.categoryDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                  tickFormatter={(v: string) => v.replace(/-/g, ' ')}
                />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <Tooltip
                  formatter={(v, name) => [
                    Number(v),
                    name === 'count' ? 'Campaigns' : 'Avg %',
                  ]}
                />
                <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Donation Velocity */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Donation Velocity (7 days, hourly)</h3>
        </div>
        <div className="p-4">
          {data.donationVelocity.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No donation data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.donationVelocity}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(h: string) => h.slice(11)}
                  className="fill-muted-foreground"
                />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--chart-2)"
                  fill="var(--chart-2)"
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Message Pool Health */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Message Pool Health</h3>
        </div>
        <div className="p-4">
          {data.messagePoolHealth.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No active campaign messages.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Campaign</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Total</th>
                    <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground sm:table-cell">Unused</th>
                    <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground sm:table-cell">Used</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.messagePoolHealth.map((row) => {
                    const pct = row.total > 0 ? Math.round((row.unused / row.total) * 100) : 0;
                    return (
                      <tr key={row.campaignId} className="hover:bg-muted/30">
                        <td className="max-w-[200px] truncate px-4 py-2">
                          {row.campaignTitle}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{row.total}</td>
                        <td className="hidden px-4 py-2 text-right font-mono tabular-nums sm:table-cell">{row.unused}</td>
                        <td className="hidden px-4 py-2 text-right font-mono tabular-nums sm:table-cell">{row.used}</td>
                        <td className="px-4 py-2 text-right">
                          <Badge variant={pct < 20 ? 'destructive' : pct < 50 ? 'secondary' : 'default'}>
                            {pct}% remaining
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Donor Name Repetitions */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Donor Name Repetitions (top 50)</h3>
        </div>
        <div className="p-4">
          {data.donorNameRepetitions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No repeated donor names detected.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Donor Name</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Occurrences</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Campaigns</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.donorNameRepetitions.map((row) => (
                    <tr key={row.donorName} className="hover:bg-muted/30">
                      <td className="px-4 py-2">{row.donorName}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{row.occurrences}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{row.campaigns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pipeline Health Tab ─────────────────────────────────────────────────────

function PipelineTab({ data }: { data: PipelineHealth }) {
  return (
    <div className="mt-4 space-y-6">
      {/* Cron Health */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.cronHealth.map((cron) => (
          <div key={cron.eventType} className="rounded-lg border px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                {cronLabel(cron.eventType)}
              </p>
              <CronStatusIcon severity={cron.lastSeverity} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {cron.lastRun ? `Last: ${formatRelativeTime(cron.lastRun)}` : 'Never run'}
            </p>
            <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
              <span>{cron.runsLast24h} runs (24h)</span>
              {cron.errorsLast24h > 0 && (
                <span className="text-destructive">{cron.errorsLast24h} errors</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Funnel */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Pipeline Funnel (24h)</h3>
        </div>
        <div className="flex items-center justify-around p-4 py-6">
            <FunnelStep label="Fetched" count={data.funnel24h.fetched} />
            <FunnelArrow />
            <FunnelStep label="Classified" count={data.funnel24h.classified} />
            <FunnelArrow />
            <FunnelStep label="Extracted" count={data.funnel24h.extracted} />
            <FunnelArrow />
            <FunnelStep label="Published" count={data.funnel24h.published} />
          </div>
      </div>

      {/* Source Statuses */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">News Source Status</h3>
        </div>
        <div className="p-4">
          {data.sourceStatuses.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No sources configured.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Source</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Last Fetched</th>
                    <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground sm:table-cell">Articles (24h)</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Campaigns Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.sourceStatuses.map((s) => (
                    <tr key={s.source} className="hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <Badge variant="outline">{s.source}</Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {s.lastFetchedAt ? formatRelativeTime(s.lastFetchedAt) : 'Never'}
                      </td>
                      <td className="hidden px-4 py-2 text-right font-mono tabular-nums sm:table-cell">{s.articlesLast24h}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{s.campaignsCreated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Classification Review Queue */}
      <ReviewQueueSection items={data.reviewQueue} />
    </div>
  );
}

// ── Review Queue with Admin Actions ─────────────────────────────────────────

function ReviewQueueSection({
  items: initialItems,
}: {
  items: PipelineHealth['reviewQueue'];
}) {
  const [items, setItems] = useState(initialItems);
  const [saving, setSaving] = useState<string | null>(null);

  async function handleReview(
    id: string,
    updates: { adminFlagged?: boolean; adminOverrideCategory?: string | null },
  ) {
    setSaving(id);
    try {
      const res = await fetch(`/api/v1/admin/news-feed/${id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, ...updates } : item)),
        );
        toast.success('Review updated');
      } else {
        toast.error('Failed to update review');
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="border-b bg-muted/40 px-4 py-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Classification Review Queue ({items.length})
        </h3>
      </div>
      <div className="p-4">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No items pending review.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-foreground line-clamp-1">
                        {item.title}
                      </h4>
                      {item.adminFlagged && (
                        <Badge variant="destructive" className="shrink-0">
                          <FlagIcon className="mr-1 h-3 w-3" />
                          Flagged
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <Badge variant="outline">{item.source}</Badge>
                      {item.category && (
                        <Badge variant="secondary">
                          {(item.adminOverrideCategory ?? item.category).replace(/-/g, ' ')}
                        </Badge>
                      )}
                      <span>Score: {item.relevanceScore}</span>
                      <span>{formatRelativeTime(item.fetchedAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Override Category */}
                    <Select
                      value={item.adminOverrideCategory ?? ''}
                      onValueChange={(value) =>
                        handleReview(item.id, {
                          adminOverrideCategory: value || null,
                        })
                      }
                      disabled={saving === item.id}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Override..." />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat.replace(/-/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Flag Toggle */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleReview(item.id, { adminFlagged: !item.adminFlagged })
                      }
                      disabled={saving === item.id}
                      title={item.adminFlagged ? 'Unflag' : 'Flag bad extraction'}
                      aria-label={item.adminFlagged ? 'Unflag' : 'Flag bad extraction'}
                    >
                      <FlagIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared Helpers ──────────────────────────────────────────────────────────

const CATEGORIES = [
  'medical', 'disaster', 'military', 'veterans', 'memorial',
  'first-responders', 'community', 'essential-needs', 'emergency',
  'charity', 'education', 'animal', 'environment', 'business',
  'competition', 'creative', 'event', 'faith', 'family',
  'sports', 'travel', 'volunteer', 'wishes',
] as const;

function cronLabel(eventType: string): string {
  const labels: Record<string, string> = {
    'cron.simulate_donations': 'Process Donations',
    'cron.update_phases': 'Update Phases',
    'cron.ingest_news': 'Ingest News',
    'cron.fetch_news': 'Fetch News',
    'cron.reconcile': 'Reconcile',
    'cron.send_newsletter': 'Newsletter',
  };
  return labels[eventType] ?? eventType;
}

function CronStatusIcon({ severity }: { severity: string | null }) {
  if (!severity) return <span className="h-4 w-4 rounded-full bg-muted" />;
  if (severity === 'error' || severity === 'critical')
    return <XCircleIcon className="h-5 w-5 text-destructive" />;
  return <CheckCircleIcon className="h-5 w-5 text-primary" />;
}

function FunnelStep({ label, count }: { label: string; count: number }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-semibold tabular-nums">{count}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function FunnelArrow() {
  return (
    <span className="text-muted-foreground" aria-hidden="true">
      →
    </span>
  );
}
