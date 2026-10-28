'use client';

import { Money } from '@/components/ui/Money';
import { useState, useMemo } from 'react';
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CANCELLATION_REASONS } from '@/lib/validators/verification';
import { ListCount } from '@/components/admin/ListCount';
import { toast } from 'sonner';
import { publicCampaignPath } from '@/lib/campaign-links';
import {
  MagnifyingGlassIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlayIcon,
  PauseIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  EllipsisVerticalIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';

interface GovernanceCampaign {
  id: string;
  title: string;
  slug: string;
  status: string;
  /** `docs/131`: a campaign has a public page only once a person approved its publication. */
  publishedAt: string | null;
  /** The campaign's own currency; its amounts are in THAT currency's minor units (`docs/92`). */
  currency: string;
  raisedAmount: number;
  goalAmount: number;
  donorCount: number;
  creatorName: string | null;
  creatorEmail: string | null;
  pausedAt: string | null;
  pausedReason: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  verificationStatus: string;
  createdAt: string;
}

interface GovernancePanelProps {
  campaigns: GovernanceCampaign[];
  /** True `count(*)`, before the page's 200-row fetch cap (docs/88 F16). */
  totalCampaigns: number;
}

/* ─── Constants ─── */

const PAGE_SIZE = 25;

type SortField = 'title' | 'status' | 'raisedAmount' | 'donorCount' | 'createdAt';
type SortDir = 'asc' | 'desc';
type ActionType = 'pause' | 'resume' | 'suspend' | 'cancel' | null;

function statusCount(campaigns: GovernanceCampaign[], status: string) {
  return campaigns.filter((c) => c.status === status).length;
}

/* ─── Sort icon helper ─── */

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronDownIcon className="ml-1 inline h-3 w-3 opacity-30" />;
  return sortDir === 'asc'
    ? <ChevronUpIcon className="ml-1 inline h-3 w-3" />
    : <ChevronDownIcon className="ml-1 inline h-3 w-3" />;
}

/* ─── Component ─── */

export function GovernancePanel({ campaigns: initial, totalCampaigns }: GovernancePanelProps) {
  const [campaigns, setCampaigns] = useState(initial);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [action, setAction] = useState<ActionType>(null);
  const [target, setTarget] = useState<GovernanceCampaign | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [notifyDonors, setNotifyDonors] = useState(true);
  const [refundAll, setRefundAll] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  function updateFilter(fn: () => void) { fn(); setPage(1); }

  const filtered = useMemo(() => {
    let result = campaigns;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.creatorName?.toLowerCase().includes(q) ||
          c.creatorEmail?.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q),
      );
    }
    if (filter !== 'all') {
      result = result.filter((c) => c.status === filter);
    }
    return result;
  }, [campaigns, search, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortField) {
        case 'title': return dir * a.title.localeCompare(b.title);
        case 'status': return dir * a.status.localeCompare(b.status);
        case 'raisedAmount': return dir * (a.raisedAmount - b.raisedAmount);
        case 'donorCount': return dir * (a.donorCount - b.donorCount);
        case 'createdAt': return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        default: return 0;
      }
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function openAction(campaign: GovernanceCampaign, act: ActionType) {
    setTarget(campaign);
    setAction(act);
    setReason('');
    setNotes('');
    setNotifyDonors(true);
    setRefundAll(false);
    setCancelReason('');
    setError(null);
  }

  function closeDialog() {
    setAction(null);
    setTarget(null);
    setError(null);
  }

  async function executeAction() {
    if (!target || !action) return;
    setLoading(true);
    setError(null);

    try {
      const url = `/api/v1/admin/campaigns/${target.id}/${action}`;
      let body: Record<string, unknown> = {};

      if (action === 'pause') {
        body = { reason: reason || 'Administrative review', notifyDonors };
      } else if (action === 'resume') {
        body = { notes };
      } else if (action === 'suspend') {
        body = { reason: reason || 'Under investigation', internalNotes: notes };
      } else if (action === 'cancel') {
        body = { reason: cancelReason, notes, notifyDonors, refundAll };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!data.ok) {
        setError(data.error?.message ?? 'Action failed');
        return;
      }

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === target.id ? { ...c, status: data.data.status } : c,
        ),
      );

      toast.success(`Campaign "${target.title}" - ${action} completed`);
      closeDialog();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  const canPause = (s: string) => ['active', 'last_donor_zone'].includes(s);
  const canResume = (s: string) => s === 'paused' || s === 'suspended';
  const canSuspend = (s: string) => ['active', 'last_donor_zone', 'paused', 'under_review'].includes(s);
  const canCancel = (s: string) => !['cancelled', 'completed', 'archived'].includes(s);
  const hasActions = (s: string) => canPause(s) || canResume(s) || canSuspend(s) || canCancel(s);

  const summaryCards = [
    { label: 'Active', status: 'active' },
    { label: 'Paused', status: 'paused' },
    { label: 'Suspended', status: 'suspended' },
    { label: 'Cancelled', status: 'cancelled' },
  ];

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summaryCards.map((card) => {
          const count = statusCount(campaigns, card.status);
          const active = filter === card.status;
          return (
            <button
              key={card.status}
              type="button"
              onClick={() => updateFilter(() => setFilter(active ? 'all' : card.status))}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${active ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/40'}`}
            >
              <p className="text-2xl font-semibold tabular-nums">{count}</p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by campaign title, slug, or creator…"
            value={search}
            onChange={(e) => updateFilter(() => setSearch(e.target.value))}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search campaigns"
          />
        </div>
        <Select value={filter} onValueChange={(v) => updateFilter(() => setFilter(v))}>
          <SelectTrigger className="w-44 bg-background">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="last_donor_zone">Last Donor Zone</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="under_review">Under Review</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border">
        {/* docs/88 F18: a table narrower than its content needs a scrollable
    wrapper, or `overflow-hidden` on the card clips the last columns
    with no way to reach them on a phone. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  <button type="button" onClick={() => toggleSort('title')} className="inline-flex items-center">
                    Campaign <SortIcon field="title" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  <button type="button" onClick={() => toggleSort('status')} className="inline-flex items-center">
                    Status <SortIcon field="status" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground md:table-cell">Verification</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">
                  <button type="button" onClick={() => toggleSort('raisedAmount')} className="inline-flex items-center">
                    Raised <SortIcon field="raisedAmount" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="hidden px-4 py-2.5 text-right text-xs font-medium text-muted-foreground sm:table-cell">
                  <button type="button" onClick={() => toggleSort('donorCount')} className="inline-flex items-center">
                    Donors <SortIcon field="donorCount" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground lg:table-cell">Creator</th>
                <th className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {paged.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="max-w-[280px] px-4 py-3">
                    {/* docs/118 via docs/120: a campaign with no public page is not a link. */}
                    {publicCampaignPath({ slug: c.slug, status: c.status, publishedAt: c.publishedAt }) ? (
                      <Link href={publicCampaignPath({ slug: c.slug, status: c.status, publishedAt: c.publishedAt })!} className="font-medium text-foreground hover:underline" target="_blank" rel="noopener">
                        {c.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{c.title}</span>
                    )}
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">/{c.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <CampaignStatusBadge status={c.status} />
                  </td>
                  <td className="hidden px-4 py-3 capitalize text-muted-foreground md:table-cell">{c.verificationStatus.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    <Money currency={c.currency} minor={c.raisedAmount} precision="exact" />
                  </td>
                  <td className="hidden px-4 py-3 text-right text-muted-foreground sm:table-cell">{c.donorCount}</td>
                  <td className="hidden max-w-[140px] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                    {c.creatorName ?? c.creatorEmail ?? '-'}
                  </td>
                  <td className="px-2 py-3 text-right">
                    {hasActions(c.status) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Actions for ${c.title}`}
                          >
                            <EllipsisVerticalIcon className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          {canResume(c.status) && (
                            <DropdownMenuItem onClick={() => openAction(c, 'resume')}>
                              <PlayIcon className="mr-2 h-4 w-4" />
                              Resume
                            </DropdownMenuItem>
                          )}
                          {canPause(c.status) && (
                            <DropdownMenuItem onClick={() => openAction(c, 'pause')}>
                              <PauseIcon className="mr-2 h-4 w-4" />
                              Pause
                            </DropdownMenuItem>
                          )}
                          {(canPause(c.status) || canResume(c.status)) && canSuspend(c.status) && <DropdownMenuSeparator />}
                          {canSuspend(c.status) && (
                            <DropdownMenuItem onClick={() => openAction(c, 'suspend')}>
                              <ExclamationTriangleIcon className="mr-2 h-4 w-4" />
                              Suspend
                            </DropdownMenuItem>
                          )}
                          {canCancel(c.status) && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => openAction(c, 'cancel')}>
                                <XCircleIcon className="mr-2 h-4 w-4" />
                                Cancel campaign
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="inline-block h-8 w-8" />
                    )}
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <ShieldExclamationIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="mt-2 text-sm text-muted-foreground">No campaigns match this filter.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Count and pagination (docs/88 F16) */}
      <div className="flex items-start justify-between gap-4 text-sm">
        <ListCount
          from={sorted.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
          to={Math.min(page * PAGE_SIZE, sorted.length)}
          shown={sorted.length}
          loaded={campaigns.length}
          total={totalCampaigns}
          noun="campaigns"
        />
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeftIcon className="mr-1 h-4 w-4" /> Prev
            </Button>
            <span className="text-muted-foreground tabular-nums">
              {page}&nbsp;/&nbsp;{totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRightIcon className="ml-1 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Pause Dialog */}
      <Dialog open={action === 'pause'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause Campaign</DialogTitle>
            <DialogDescription>
              Pause &ldquo;{target?.title}&rdquo; <span className="font-mono text-xs">/{target?.slug}</span>. Donations will be temporarily blocked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="pause-reason">Reason</Label>
              <Textarea
                id="pause-reason"
                placeholder="Why is this campaign being paused?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notifyDonors} onChange={(e) => setNotifyDonors(e.target.checked)} className="rounded border-border" />
              <span className="text-sm">Notify subscribed donors</span>
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={executeAction} disabled={loading}>
              {loading ? 'Pausing…' : 'Pause Campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resume Dialog */}
      <Dialog open={action === 'resume'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resume Campaign</DialogTitle>
            <DialogDescription>
              Resume &ldquo;{target?.title}&rdquo; <span className="font-mono text-xs">/{target?.slug}</span> and reopen it for donations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="resume-notes">Notes (optional)</Label>
              <Textarea
                id="resume-notes"
                placeholder="Any notes about why this is being resumed?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={executeAction} disabled={loading}>
              {loading ? 'Resuming…' : 'Resume Campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend Dialog */}
      <Dialog open={action === 'suspend'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend Campaign</DialogTitle>
            <DialogDescription>
              Suspend &ldquo;{target?.title}&rdquo; <span className="font-mono text-xs">/{target?.slug}</span> pending investigation. Donors will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="suspend-reason">Reason (visible to donors)</Label>
              <Textarea
                id="suspend-reason"
                placeholder="Why is this campaign being suspended?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="suspend-notes">Internal Notes</Label>
              <Textarea
                id="suspend-notes"
                placeholder="Internal notes (not shown to donors or campaigner)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button variant="destructive" onClick={executeAction} disabled={loading}>
              {loading ? 'Suspending…' : 'Suspend Campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={action === 'cancel'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Campaign</DialogTitle>
            <DialogDescription>
              Permanently cancel &ldquo;{target?.title}&rdquo; <span className="font-mono text-xs">/{target?.slug}</span>. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cancel-reason">Cancellation Reason</Label>
              <Select value={cancelReason} onValueChange={setCancelReason}>
                <SelectTrigger id="cancel-reason">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {CANCELLATION_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cancel-notes">Notes</Label>
              <Textarea
                id="cancel-notes"
                placeholder="Additional details about the cancellation"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notifyDonors} onChange={(e) => setNotifyDonors(e.target.checked)} className="rounded border-border" />
              <span className="text-sm">Notify donors</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={refundAll} onChange={(e) => setRefundAll(e.target.checked)} className="rounded border-border" />
              <span className="text-sm font-medium text-destructive">Refund all donations via Stripe</span>
            </label>
            {refundAll && (
              <p className="text-xs text-muted-foreground">
                This will process {target?.donorCount ?? 0} refund(s) totalling{' '}
                <Money minor={target?.raisedAmount ?? 0} currency={target?.currency ?? 'USD'} precision="exact" />.
                Refunds are irreversible.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Back</Button>
            <Button variant="destructive" onClick={executeAction} disabled={loading || !cancelReason}>
              {loading ? 'Cancelling…' : 'Cancel Campaign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
