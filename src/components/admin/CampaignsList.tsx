'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import { VerificationBadge } from '@/components/campaigns/TrustBadge';
import { Money } from '@/components/ui/Money';
import { formatDate } from '@/lib/utils/dates';
import { ListCount } from '@/components/admin/ListCount';
import { Textarea } from '@/components/ui/textarea';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  EllipsisVerticalIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { ADMIN_STATUS_LABELS } from './campaign-status-labels';

interface Campaign {
  id: string;
  title: string;
  slug: string;
  status: string;
  category: string;
  verificationStatus: string;
  source: string;
  creatorName: string | null;
  /** The campaign's own currency; its amounts are in THAT currency's minor units (`docs/92`). */
  currency: string;
  raisedAmount: number;
  goalAmount: number;
  donorCount: number;
  createdAt: string;
}

interface CampaignsListProps {
  campaigns: Campaign[];
  /** Per-status `count(*)` over the whole table, not over `campaigns`. */
  statusCounts: Record<string, number>;
  /** True `count(*)`, before the page's fetch cap (docs/88 F8, F16). */
  totalCampaigns: number;
  /*
    Whether the viewer may perform the row actions. Required, not optional, so
    `tsc` names every render site (`docs/118`).

    An editor reaches this list on purpose - it is the only door to the
    campaign whose updates `POST /api/v1/admin/campaigns/[campaignId]/updates`
    lets them post - but `Change Status` (PATCH, and the pause / suspend
    siblings) and `Delete` are `requireRole(['admin'])`, as is the editor form
    `Edit` opens. `docs/133`.
  */
  isAdmin: boolean;
}

/* Matches every other admin list. */
const PAGE_SIZE = 25;

/* One admin vocabulary, shared with `CampaignEditor` - see the module. */
const STATUS_LABELS = ADMIN_STATUS_LABELS as Record<string, string>;

const CATEGORIES = [
  'medical', 'disaster', 'military', 'veterans',
  'memorial', 'first-responders', 'community', 'essential-needs',
];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['active', 'archived'],
  active: ['draft', 'paused', 'completed', 'archived'],
  last_donor_zone: ['active', 'paused', 'completed', 'archived'],
  completed: ['archived'],
  archived: ['draft'],
  paused: ['active'],
  under_review: ['active', 'suspended'],
  suspended: ['active', 'cancelled'],
  cancelled: [],
};

function formatCategoryLabel(cat: string) {
  return cat.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function CampaignsList({ campaigns, statusCounts, totalCampaigns, isAdmin }: CampaignsListProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ campaign: Campaign; newStatus: string } | null>(null);
  /*
    Refusing a campaign at review is the one status change that carries a
    REASON, because the organiser is emailed it (docs/93, owner decision
    2026-10-25). Every other transition goes through PATCH with `{ status }`.
  */
  const [refusalReason, setRefusalReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleStatusChange = useCallback(async () => {
    if (!statusTarget) return;

    /*
      A refusal goes to the `suspend` endpoint, not to PATCH. PATCH takes
      `{ status }` and nothing else, so a refusal through it could carry no
      reason and the organiser could not be told anything - which is how a
      refused campaign came to notify nobody at all. PATCH now REFUSES this
      transition outright; see the note on its ALLOWED_TRANSITIONS.
    */
    /*
      ⛔ Two targets do not go to PATCH, and `paused` is the one that was
      missing.

      This client map offered `paused` for `active` and `last_donor_zone`,
      but the SERVER's `ALLOWED_TRANSITIONS` has no `paused` target at all
      (`src/app/api/v1/admin/campaigns/[campaignId]/route.ts:20-21`), so
      both menu items posted a transition PATCH answers 400 to - the same
      class of defect as the `docs/93` Suspend button, in the adjacent
      statement. Pausing has a dedicated route with the same reason shape as
      suspend (`pauseCampaignSchema`, free text, min 3), and it notifies
      donors, so the fix is to route there rather than to delete a control
      that should work. `docs/120`.
    */
    const dedicatedRoute =
      statusTarget.newStatus === 'suspended' ? 'suspend'
      : statusTarget.newStatus === 'paused' ? 'pause'
      : null;
    const reason = refusalReason.trim();

    if (dedicatedRoute && reason.length < 3) {
      setActionError(
        statusTarget.newStatus === 'suspended'
          ? 'Write a reason. The organiser is emailed it.'
          : 'Write a reason. Donors are told the campaign is paused.',
      );
      return;
    }

    setActionLoading(true);
    setActionError(null);
    try {
      const res = dedicatedRoute
        ? await fetch(`/api/v1/admin/campaigns/${statusTarget.campaign.id}/${dedicatedRoute}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
          })
        : await fetch(`/api/v1/admin/campaigns/${statusTarget.campaign.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: statusTarget.newStatus }),
          });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body?.error?.code === 'VALIDATION_ERROR' ? (body?.error?.message ?? 'Failed to change status') : 'Failed to change status');
        return;
      }
      setStatusTarget(null);
      setRefusalReason('');
      router.refresh();
    } finally {
      setActionLoading(false);
    }
  }, [statusTarget, refusalReason, router]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/admin/campaigns/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body?.error?.code === 'VALIDATION_ERROR' ? (body?.error?.message ?? 'Failed to delete campaign') : 'Failed to delete campaign');
        return;
      }
      setDeleteTarget(null);
      router.refresh();
    } finally {
      setActionLoading(false);
    }
  }, [deleteTarget, router]);

  const filtered = useMemo(() => {
    let result = campaigns;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q),
      );
    }

    if (statusFilter) {
      result = result.filter((c) => c.status === statusFilter);
    }

    if (categoryFilter) {
      result = result.filter((c) => c.category === categoryFilter);
    }

    return result;
  }, [campaigns, search, statusFilter, categoryFilter]);

  /*
    The true table size, not `campaigns.length` (docs/88 F8). The
    fetch is capped, so the array length is the size of the page's
    fetch and saying "222 total" from it would be false the moment
    there are more than 200.
  */
  const totalCount = totalCampaigns;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const statuses = ['draft', 'active', 'last_donor_zone', 'completed', 'archived', 'paused', 'under_review', 'suspended', 'cancelled'];

  return (
    <div>
      {/* CDS page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Campaigns</h1>
          {/*
            One count here, the true one. This used to read
            "{total} total - {filtered.length} shown", which with
            pagination became a third number disagreeing with both the
            tiles and the footer: "200 shown" over 25 rendered rows.
            What is on screen is ListCount's job (docs/88 F16).
          */}
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount.toLocaleString()} {totalCount === 1 ? 'campaign' : 'campaigns'}
          </p>
        </div>
        <Link
          href="/admin/campaigns/new"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90"
        >
          <PlusIcon className="mr-1.5 h-4 w-4" />
          New Campaign
        </Link>
      </div>

      {/* CDS status filter tiles */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        {statuses.map((s) => {
          const count = statusCounts[s] ?? 0;
          const isActive = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => { setStatusFilter(isActive ? null : s); setPage(1); }}
              className={`rounded-lg border border-border px-3 py-3 text-left transition-colors duration-100 ${
                isActive
                  ? 'border-primary/40 bg-primary/5'
                  : 'bg-background hover:bg-muted/60'
              }`}
            >
              <p className="text-2xl font-semibold tabular-nums leading-none">{count}</p>
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">{STATUS_LABELS[s]}</p>
            </button>
          );
        })}
      </div>

      {/* CDS search + category filter */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none transition-colors duration-100 focus:border-primary focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={categoryFilter ?? ''}
          onChange={(e) => { setCategoryFilter(e.target.value || null); setPage(1); }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors duration-100 focus:border-primary focus:ring-2 focus:ring-ring"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {formatCategoryLabel(cat)}
            </option>
          ))}
        </select>
      </div>

      {/* CDS Data Table */}
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Title</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Status</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground sm:table-cell">Category</th>
                <th className="hidden px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground md:table-cell">Progress</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Raised</th>
                <th className="hidden px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground md:table-cell">Donors</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground lg:table-cell">Created</th>
                <th className="px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
                {paged.map((c) => {
                  const pct = c.goalAmount > 0 ? Math.min((c.raisedAmount / c.goalAmount) * 100, 100) : 0;
                  return (
                    <tr key={c.id} className="transition-colors duration-100 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/campaigns/${c.id}`}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {c.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {c.creatorName ? `by ${c.creatorName}` : c.source === 'automated' ? 'Automated' : 'Editorial'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <CampaignStatusBadge status={c.status} />
                          <VerificationBadge status={c.verificationStatus} compact />
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                        {formatCategoryLabel(c.category)}
                      </td>
                      <td className="hidden px-4 py-3 text-right md:table-cell">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1 w-16 overflow-hidden rounded-full bg-border">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        <Money minor={c.raisedAmount} currency={c.currency} precision="exact" />
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground md:table-cell">{c.donorCount}</td>
                      <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                        {formatDate(c.createdAt)}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <EllipsisVerticalIcon className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem asChild>
                              <Link href={`/admin/campaigns/${c.id}`}>View Details</Link>
                            </DropdownMenuItem>
                            {isAdmin && (
                              <DropdownMenuItem asChild>
                                <Link href={`/admin/campaigns/${c.id}/edit`}>Edit</Link>
                              </DropdownMenuItem>
                            )}
                            {isAdmin && (ALLOWED_TRANSITIONS[c.status]?.length ?? 0) > 0 && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger>Change Status</DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    {ALLOWED_TRANSITIONS[c.status]?.map((s) => (
                                      <DropdownMenuItem
                                        key={s}
                                        onClick={() => setStatusTarget({ campaign: c, newStatus: s })}
                                      >
                                        {STATUS_LABELS[s] ?? s}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                              </>
                            )}
                            {/*
                              Draft only, matching the API guard added for
                              docs/88 F13. Offering Delete on every row is
                              how an active campaign  - or one of the review
                              queue's appeals about a real person  - ended up
                              two clicks from permanent destruction. Hidden
                              rather than disabled: there is no state in
                              which a non-draft becomes deletable, so a
                              greyed-out item would only invite a retry.
                            */}
                            {isAdmin && c.status === 'draft' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setDeleteTarget(c)}
                                >
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      {totalCount === 0 ? (
                        <>
                          No campaigns yet.{' '}
                          <Link href="/admin/campaigns/new" className="text-primary underline underline-offset-4">
                            Create one
                          </Link>
                        </>
                      ) : (
                        'No campaigns match your filters.'
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      {/* ── Count and pagination (docs/88 F8, F16) ── */}
      {(filtered.length > 0 || totalCount > campaigns.length) && (
        <div className="mt-3 flex items-start justify-between gap-4 border-t border-border pt-3">
          <ListCount
            from={filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
            to={Math.min(safePage * PAGE_SIZE, filtered.length)}
            shown={filtered.length}
            loaded={campaigns.length}
            total={totalCount}
            noun="campaigns"
          />
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <span className="px-2 text-xs tabular-nums text-muted-foreground">
                {safePage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Status change confirmation */}
      <Dialog open={!!statusTarget} onOpenChange={() => { setStatusTarget(null); setActionError(null); setRefusalReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {statusTarget?.newStatus === 'suspended' && statusTarget?.campaign.status === 'under_review'
                ? 'Do not publish this campaign'
                : 'Change Campaign Status'}
            </DialogTitle>
            <DialogDescription>
              Change &ldquo;{statusTarget?.campaign.title}&rdquo; from{' '}
              <strong>{STATUS_LABELS[statusTarget?.campaign.status ?? ''] ?? statusTarget?.campaign.status}</strong>{' '}
              to <strong>{STATUS_LABELS[statusTarget?.newStatus ?? ''] ?? statusTarget?.newStatus}</strong>?
            </DialogDescription>
          </DialogHeader>
          {(statusTarget?.newStatus === 'suspended' || statusTarget?.newStatus === 'paused') && (
            <div className="space-y-2">
              <label htmlFor="refusal-reason" className="text-sm font-medium text-foreground">
                Reason
              </label>
              <Textarea
                id="refusal-reason"
                value={refusalReason}
                onChange={(e) => setRefusalReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="What the organiser needs to know"
              />
              {/*
                The admin must know this is read by the organiser, not an
                internal note. docs/93 left this path silent; it is not silent
                now, so the words matter.
              */}
              <p className="text-xs text-muted-foreground">
                {statusTarget?.newStatus === 'paused'
                  ? 'Donors who subscribed are told the campaign is paused. Up to 500 characters.'
                  : 'This is emailed to the organiser, in your words. Up to 500 characters.'}
              </p>
            </div>
          )}
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setStatusTarget(null); setActionError(null); setRefusalReason(''); }} disabled={actionLoading}>
              Cancel
            </Button>
            <Button onClick={handleStatusChange} disabled={actionLoading}>
              {actionLoading ? 'Updating…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => { setDeleteTarget(null); setActionError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Campaign</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.title}&rdquo;?{' '}
              {(deleteTarget?.donorCount ?? 0) > 0
                ? 'This campaign has donations and will be archived instead of permanently deleted.'
                : 'This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setActionError(null); }} disabled={actionLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={actionLoading}>
              {actionLoading ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
