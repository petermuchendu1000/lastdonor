'use client';

import { formatMoney } from '@/lib/money/format';
import { Money } from '@/components/ui/Money';
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { CubeTransparentIcon } from '@heroicons/react/24/outline';
import type { SimulationReadiness } from '@/lib/seed/simulation-readiness';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

/* ---------- types ---------- */

interface SimulationSettings {
  enabled: boolean;
  volume: number;
  maxConcurrent: number;
  minCycleMinutes: number;
  cohortChance: number;
  autoComplete: boolean;
  fundAllocationDefault: string;
  realisticTiming: boolean;
  pauseAll: boolean;
  phaseOut: {
    enabled: boolean;
    thresholdLow: number;
    thresholdMid: number;
    thresholdHigh: number;
  };
  effectiveVolume: number;
}

interface CampaignRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  category: string;
  progress: number;
  /** The campaign's own currency. */
  currency: string;
  raisedAmount: number;
  goalAmount: number;
  realDonationCount: number;
  realDonationTotal: number;
  seedDonationCount: number;
  seedDonationTotal: number;
  fundPoolPending: number;
  paused: boolean;
  createdAt: string;
}

interface CurrencyAmount {
  currency: string;
  totalMinor: number;
}

interface Analytics {
  simulatedCount: number;
  realCampaigns: number;
  seedDonations: { count: number; totals: CurrencyAmount[] };
  realDonations: { count: number; totals: CurrencyAmount[] };
  fundPool: { pending: CurrencyAmount[]; allocated: CurrencyAmount[]; disbursed: CurrencyAmount[] };
}

interface Props {
  initialSettings: SimulationSettings;
  campaigns: CampaignRow[];
  analytics: Analytics;
  readiness: SimulationReadiness;
}

/* ---------- helpers ---------- */

/**
 * One figure per currency, or a dash.
 *
 * ⛔ These totals used to be a single number through `centsToDollars`, which
 * hardcodes USD, over `SUM(donations.amount)` with no currency in the GROUP
 * BY - shillings added to dollars under a dollar sign (`docs/92`).
 */
function perCurrency(totals: CurrencyAmount[]): string {
  if (totals.length === 0) return '-';
  return totals.map((t) => formatMoney(t.totalMinor, t.currency, 'exact')).join(' · ');
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/* ---------- component ---------- */

export function SimulationControlPanel({ initialSettings, campaigns: initialCampaigns, analytics, readiness }: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState<SimulationSettings>(initialSettings);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>(initialCampaigns);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  // Convert dialog state
  const [convertTarget, setConvertTarget] = useState<CampaignRow | null>(null);
  const [beneficiaryInfo, setBeneficiaryInfo] = useState('');

  /* ---- settings save ---- */
  const saveSettings = useCallback(
    async (patch: Record<string, unknown>) => {
      setSaving(true);
      try {
        const res = await fetch('/api/v1/admin/simulation/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.code === 'VALIDATION_ERROR' ? (body.error?.message ?? 'Failed to save') : 'Failed to save');
        setSettings((prev) => ({ ...prev, ...patch, ...(body.data ?? {}) }));
        toast.success('Settings saved');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save settings');
      } finally {
        setSaving(false);
      }
    },
    [router],
  );

  /* ---- campaign actions ---- */
  const pauseResume = useCallback(
    async (id: string, action: 'pause' | 'resume') => {
      setActionBusy(id);
      try {
        const res = await fetch(`/api/v1/admin/simulation/campaigns/${id}/${action}`, { method: 'POST' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.code === 'VALIDATION_ERROR' ? (body.error?.message ?? `Failed to ${action}`) : `Failed to ${action}`);
        setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, paused: action === 'pause' } : c)));
        toast.success(`Campaign ${action === 'pause' ? 'paused' : 'resumed'}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Failed to ${action}`);
      } finally {
        setActionBusy(null);
      }
    },
    [],
  );

  const convertCampaign = useCallback(async () => {
    if (!convertTarget) return;
    if (beneficiaryInfo.trim().length < 5) {
      toast.error('Beneficiary info must be at least 5 characters');
      return;
    }
    setActionBusy(convertTarget.id);
    try {
      const res = await fetch(`/api/v1/admin/simulation/campaigns/${convertTarget.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiaryInfo: beneficiaryInfo.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.code === 'VALIDATION_ERROR' ? (body.error?.message ?? 'Failed to convert') : 'Failed to convert');
      setCampaigns((prev) => prev.filter((c) => c.id !== convertTarget.id));
      setConvertTarget(null);
      setBeneficiaryInfo('');
      toast.success('Campaign converted to real');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to convert');
    } finally {
      setActionBusy(null);
    }
  }, [convertTarget, beneficiaryInfo, router]);

  /* ---- derived values ---- */
  const totalDonations = analytics.seedDonations.count + analytics.realDonations.count;
  const seedRatio = totalDonations > 0 ? (analytics.realDonations.count / totalDonations) * 100 : 0;
  const effectiveVolumeLabel =
    settings.effectiveVolume < 0 ? 'Disabled' : pct(settings.effectiveVolume);

  /*
    docs/88 F9. "Active" used to mean "the setting is on", which is not
    what anyone reads it as. The simulation is active only when the
    setting is on AND nothing is blocking it; with a blocker present
    the switch changes a stored value and nothing else.
  */
  const reallyActive = settings.enabled && readiness.canRun;
  const statusLabel = reallyActive
    ? 'Active'
    : settings.enabled
      ? 'Switched on, cannot run'
      : 'Off';

  return (
    <div className="space-y-6">
      {readiness.blockers.length > 0 && (
        <section
          className="rounded-lg border border-brand-amber/40 bg-brand-amber/5 p-4"
          aria-labelledby="sim-blockers-heading"
        >
          <h2 id="sim-blockers-heading" className="text-sm font-semibold">
            Nothing on this screen will produce a donation
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {readiness.blockers.length === 1
              ? 'One thing stands in the way. The controls below still save, they just have no effect.'
              : `${readiness.blockers.length} separate things stand in the way, and clearing one is not enough. The controls below still save, they just have no effect.`}
          </p>
          <ol className="mt-3 space-y-3">
            {readiness.blockers.map((b, i) => (
              <li key={b.id} className="border-l-2 border-brand-amber/40 pl-3">
                <p className="text-sm font-medium">
                  {i + 1}. {b.title}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{b.detail}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">To clear it: </span>
                  {b.fix}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Global Controls */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Global Controls</h3>
          <Badge variant={reallyActive ? 'default' : settings.enabled ? 'outline' : 'secondary'}>
            {statusLabel}
          </Badge>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="sim-enabled">Simulation Enabled</Label>
            <Switch
              id="sim-enabled"
              checked={settings.enabled}
              disabled={saving}
              onCheckedChange={async (v) => {
                await saveSettings({ enabled: v });
                /*
                  The save toast says "Settings saved", which is true.
                  Switching this on while blocked and being told only
                  that is how an admin concludes the simulation is
                  running (docs/88 F9).
                */
                if (v && !readiness.canRun) {
                  toast.info('Saved, but the simulation still cannot run. See the notice above.');
                }
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pause-all">Pause All</Label>
            <Switch
              id="pause-all"
              checked={settings.pauseAll}
              disabled={saving}
              onCheckedChange={(v) => saveSettings({ pauseAll: v })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="volume">Volume Multiplier ({pct(settings.volume)})</Label>
            <input
              id="volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              disabled={saving}
              onChange={(e) => setSettings((s) => ({ ...s, volume: parseFloat(e.target.value) }))}
              onMouseUp={() => saveSettings({ volume: settings.volume })}
              onTouchEnd={() => saveSettings({ volume: settings.volume })}
              className="w-full accent-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="max-concurrent">Max Concurrent</Label>
              <Input
                id="max-concurrent"
                type="number"
                min={1}
                max={100}
                value={settings.maxConcurrent}
                disabled={saving}
                onChange={(e) => setSettings((s) => ({ ...s, maxConcurrent: parseInt(e.target.value) || 1 }))}
                onBlur={() => saveSettings({ maxConcurrent: settings.maxConcurrent })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="min-cycle">Min Cycle (minutes)</Label>
              <Input
                id="min-cycle"
                type="number"
                min={1}
                value={settings.minCycleMinutes}
                disabled={saving}
                onChange={(e) => setSettings((s) => ({ ...s, minCycleMinutes: parseInt(e.target.value) || 1 }))}
                onBlur={() => saveSettings({ minCycleMinutes: settings.minCycleMinutes })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-complete">Auto Complete</Label>
              <Switch
                id="auto-complete"
                checked={settings.autoComplete}
                disabled={saving}
                onCheckedChange={(v) => saveSettings({ autoComplete: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="realistic-timing">Realistic Timing</Label>
              <Switch
                id="realistic-timing"
                checked={settings.realisticTiming}
                disabled={saving}
                onCheckedChange={(v) => saveSettings({ realisticTiming: v })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cohort">Cohort Chance ({pct(settings.cohortChance)})</Label>
            <input
              id="cohort"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.cohortChance}
              disabled={saving}
              onChange={(e) => setSettings((s) => ({ ...s, cohortChance: parseFloat(e.target.value) }))}
              onMouseUp={() => saveSettings({ cohortChance: settings.cohortChance })}
              onTouchEnd={() => saveSettings({ cohortChance: settings.cohortChance })}
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>

      {/* Phase-Out Configuration */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Phase-Out Configuration</h3>
          <Badge variant={settings.phaseOut.enabled ? 'default' : 'outline'}>
            Effective Volume: {effectiveVolumeLabel}
          </Badge>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="phase-out-enabled">Phase-Out Enabled</Label>
            <Switch
              id="phase-out-enabled"
              checked={settings.phaseOut.enabled}
              disabled={saving}
              onCheckedChange={(v) =>
                saveSettings({ phaseOut: { ...settings.phaseOut, enabled: v } })
              }
            />
          </div>
          {settings.phaseOut.enabled && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label htmlFor="threshold-low">Low Threshold (→ 70%)</Label>
                <Input
                  id="threshold-low"
                  type="number"
                  min={1}
                  value={settings.phaseOut.thresholdLow}
                  disabled={saving}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      phaseOut: { ...s.phaseOut, thresholdLow: parseInt(e.target.value) || 1 },
                    }))
                  }
                  onBlur={() =>
                    saveSettings({
                      phaseOut: settings.phaseOut,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="threshold-mid">Mid Threshold (→ 30%)</Label>
                <Input
                  id="threshold-mid"
                  type="number"
                  min={1}
                  value={settings.phaseOut.thresholdMid}
                  disabled={saving}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      phaseOut: { ...s.phaseOut, thresholdMid: parseInt(e.target.value) || 1 },
                    }))
                  }
                  onBlur={() =>
                    saveSettings({
                      phaseOut: settings.phaseOut,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="threshold-high">High Threshold (→ 0%)</Label>
                <Input
                  id="threshold-high"
                  type="number"
                  min={1}
                  value={settings.phaseOut.thresholdHigh}
                  disabled={saving}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      phaseOut: { ...s.phaseOut, thresholdHigh: parseInt(e.target.value) || 1 },
                    }))
                  }
                  onBlur={() =>
                    saveSettings({
                      phaseOut: settings.phaseOut,
                    })
                  }
                />
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            As real campaigns grow, simulation volume automatically decreases. Low → 70% volume,
            Mid → 30%, High → 0%.
          </p>
        </div>
      </div>

      {/* Analytics Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Simulated Campaigns</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{analytics.simulatedCount}</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Real Campaigns</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{analytics.realCampaigns}</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Seed Donations</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{perCurrency(analytics.seedDonations.totals)}</p>
          <p className="text-xs text-muted-foreground">{analytics.seedDonations.count} donations</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Real Donations</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{perCurrency(analytics.realDonations.totals)}</p>
          <p className="text-xs text-muted-foreground">{analytics.realDonations.count} donations</p>
        </div>
      </div>

      {/* Fund Pool Summary */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Fund Pool</h3>
          <Link href="/admin/simulation/fund-pool" className="text-sm underline-offset-4 hover:underline">
            Manage →
          </Link>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{perCurrency(analytics.fundPool.pending)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Allocated</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{perCurrency(analytics.fundPool.allocated)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Disbursed</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{perCurrency(analytics.fundPool.disbursed)}</p>
            </div>
          </div>
          <div className="mt-3 text-center">
            <p className="text-sm text-muted-foreground">
              Real-to-Total Ratio: <span className="font-medium text-foreground">{seedRatio.toFixed(1)}%</span>
            </p>
          </div>
        </div>
      </div>

      {/* Active Simulated Campaigns Table */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Active Simulated Campaigns ({campaigns.length})</h3>
        </div>
        <div className="p-4">
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <CubeTransparentIcon className="size-8" />
              <p>No simulated campaigns.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Campaign</th>
                    <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">Category</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Progress</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Raised</th>
                    <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground md:table-cell">Real / Seed</th>
                    <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground lg:table-cell">Pool</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {campaigns.map((c) => (
                    <tr key={c.id} className={`hover:bg-muted/30${c.paused ? ' opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{c.title}</div>
                        <div className="text-xs text-muted-foreground">{c.status}</div>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <Badge variant="outline" className="text-xs">
                          {c.category}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-muted">
                            <div
                              className="h-1.5 rounded-full bg-primary"
                              style={{ width: `${Math.min(c.progress, 100)}%` }}
                            />
                          </div>
                          <span className="tabular-nums">{c.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums"><Money minor={c.raisedAmount} currency={c.currency} precision="exact" /></td>
                      <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                        {c.realDonationCount} / {c.seedDonationCount}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell"><Money minor={c.fundPoolPending} currency={c.currency} precision="exact" /></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={actionBusy === c.id}
                            onClick={() => pauseResume(c.id, c.paused ? 'resume' : 'pause')}
                          >
                            {c.paused ? 'Resume' : 'Pause'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={actionBusy === c.id}
                            onClick={() => {
                              setConvertTarget(c);
                              setBeneficiaryInfo('');
                            }}
                          >
                            Convert
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Convert Dialog */}
      <Dialog open={!!convertTarget} onOpenChange={(open) => !open && setConvertTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Real Campaign</DialogTitle>
            <DialogDescription>
              Converting &ldquo;{convertTarget?.title}&rdquo; will remove its simulation flag and transfer
              pending fund pool allocations. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="beneficiary">Beneficiary / Organization Info</Label>
            <Input
              id="beneficiary"
              placeholder="Name, contact, and details of the beneficiary..."
              value={beneficiaryInfo}
              onChange={(e) => setBeneficiaryInfo(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Minimum 5 characters required.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={actionBusy === convertTarget?.id || beneficiaryInfo.trim().length < 5}
              onClick={convertCampaign}
            >
              Convert Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
