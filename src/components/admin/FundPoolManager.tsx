'use client';

import { centsToDollars } from '@/lib/utils/currency';
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MagnifyingGlassIcon, CurrencyDollarIcon } from '@heroicons/react/24/outline';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

/* ---------- types ---------- */

interface Allocation {
  id: string;
  donationId: string;
  sourceCampaignId: string;
  sourceCampaignTitle: string;
  sourceCampaignSlug: string;
  targetCampaignId: string | null;
  amount: number;
  status: string;
  notes: string | null;
  allocatedAt: string | null;
  disbursedAt: string | null;
  createdAt: string;
}

interface Summary {
  pending: { count: number; total: number };
  allocated: { count: number; total: number };
  disbursed: { count: number; total: number };
}

interface TargetCampaign {
  id: string;
  title: string;
}

interface Props {
  allocations: Allocation[];
  summary: Summary;
  targetCampaigns: TargetCampaign[];
}

function formatCents(cents: number): string {
  // docs/88 F4: delegate, so there is one currency renderer.
  return centsToDollars(cents);
}

/* ---------- component ---------- */

export function FundPoolManager({ allocations: initialAllocations, summary, targetCampaigns }: Props) {
  const router = useRouter();
  const [allocations, _setAllocations] = useState(initialAllocations);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'allocated' | 'disbursed'>('all');
  const [search, setSearch] = useState('');

  // Allocate dialog
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [allocateNotes, setAllocateNotes] = useState('');

  // Disburse dialog
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [disburseNotes, setDisburseNotes] = useState('');

  const filtered = allocations
    .filter((a) => filter === 'all' || a.status === filter)
    .filter((a) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return a.sourceCampaignTitle.toLowerCase().includes(q) || a.notes?.toLowerCase().includes(q);
    });
  const pendingSelected = [...selected].filter((id) => allocations.find((a) => a.id === id)?.status === 'pending');
  const allocatedSelected = [...selected].filter((id) => allocations.find((a) => a.id === id)?.status === 'allocated');

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
    }
  }, [selected.size, filtered]);

  const allocateSelected = useCallback(async () => {
    if (!targetId || pendingSelected.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/fund-pool/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationIds: pendingSelected,
          targetCampaignId: targetId,
          ...(allocateNotes.trim() ? { notes: allocateNotes.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.code === 'VALIDATION_ERROR' ? (body.error?.message ?? 'Failed to allocate') : 'Failed to allocate');
      toast.success(`${body.data.allocated} allocations assigned`);
      setAllocateOpen(false);
      setSelected(new Set());
      setTargetId('');
      setAllocateNotes('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to allocate');
    } finally {
      setBusy(false);
    }
  }, [targetId, pendingSelected, allocateNotes, router]);

  const disburseSelected = useCallback(async () => {
    if (allocatedSelected.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/fund-pool/disburse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationIds: allocatedSelected,
          ...(disburseNotes.trim() ? { notes: disburseNotes.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.code === 'VALIDATION_ERROR' ? (body.error?.message ?? 'Failed to disburse') : 'Failed to disburse');
      toast.success(`${body.data.disbursed} allocations disbursed (${formatCents(body.data.totalDisbursed)})`);
      setDisburseOpen(false);
      setSelected(new Set());
      setDisburseNotes('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disburse');
    } finally {
      setBusy(false);
    }
  }, [allocatedSelected, disburseNotes, router]);

  const exportCsv = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/fund-pool/export');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fund-pool-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    }
  }, []);

  const statusColor = (s: string) => {
    if (s === 'pending') return 'secondary';
    if (s === 'allocated') return 'default';
    return 'outline';
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Pending</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCents(summary.pending.total)}</p>
          <p className="text-xs text-muted-foreground">{summary.pending.count} allocations</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Allocated</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCents(summary.allocated.total)}</p>
          <p className="text-xs text-muted-foreground">{summary.allocated.count} allocations</p>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">Disbursed</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatCents(summary.disbursed.total)}</p>
          <p className="text-xs text-muted-foreground">{summary.disbursed.count} allocations</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="flex gap-1">
            {(['all', 'pending', 'allocated', 'disbursed'] as const).map((f) => (
              <Button
                key={f}
                variant="outline"
                size="sm"
                className={filter === f ? 'border-primary/40 bg-primary/5' : ''}
                onClick={() => { setFilter(f); setSelected(new Set()); }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>
          <div className="relative ml-auto">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search campaigns…"
              aria-label="Search campaigns"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48 rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pendingSelected.length === 0}
              onClick={() => setAllocateOpen(true)}
            >
              Allocate ({pendingSelected.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={allocatedSelected.length === 0}
              onClick={() => setDisburseOpen(true)}
            >
              Disburse ({allocatedSelected.length})
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
      </div>

      {/* Allocations Table */}
      <div className="rounded-lg border">
        <div className="border-b bg-muted/40 px-4 py-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Allocations ({filtered.length})</h3>
        </div>
        <div className="p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <CurrencyDollarIcon className="size-8" />
              <p>No allocations found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={toggleAll}
                        className="rounded"
                      />
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Source Campaign</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">Created</th>
                    <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground md:table-cell">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((a) => (
                    <tr key={a.id} className="hover:bg-muted/30">
                      <td className="py-3 pr-2">
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggleSelect(a.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium">{a.sourceCampaignTitle}</span>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">{formatCents(a.amount)}</td>
                      <td className="py-3 px-4">
                        <Badge variant={statusColor(a.status)}>{a.status}</Badge>
                      </td>
                      <td className="hidden py-3 px-4 text-muted-foreground sm:table-cell">
                        {new Date(a.createdAt).toLocaleDateString()}
                      </td>
                      <td className="hidden max-w-[200px] truncate py-3 px-4 text-muted-foreground md:table-cell">
                        {a.notes ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Allocate Dialog */}
      <Dialog open={allocateOpen} onOpenChange={setAllocateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate to Campaign</DialogTitle>
            <DialogDescription>
              Assign {pendingSelected.length} pending allocation(s) to a real campaign.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="target-campaign">Target Campaign</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger id="target-campaign" className="bg-background">
                  <SelectValue placeholder="Select a campaign…" />
                </SelectTrigger>
                <SelectContent>
                  {targetCampaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="allocate-notes">Notes (optional)</Label>
              <Input
                id="allocate-notes"
                placeholder="Reason for allocation..."
                value={allocateNotes}
                onChange={(e) => setAllocateNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocateOpen(false)}>Cancel</Button>
            <Button disabled={!targetId || busy} onClick={allocateSelected}>
              Allocate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disburse Dialog */}
      <Dialog open={disburseOpen} onOpenChange={setDisburseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Disbursement</DialogTitle>
            <DialogDescription>
              Mark {allocatedSelected.length} allocated allocation(s) as disbursed. This indicates funds have been sent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="disburse-notes">Notes (optional)</Label>
            <Input
              id="disburse-notes"
              placeholder="Disbursement details..."
              value={disburseNotes}
              onChange={(e) => setDisburseNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisburseOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={disburseSelected}>
              Confirm Disburse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
