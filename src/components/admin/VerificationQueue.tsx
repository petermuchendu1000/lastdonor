'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Money } from '@/components/ui/Money';
import { formatDate, formatRelativeTime } from '@/lib/utils/dates';
import { ListCount } from '@/components/admin/ListCount';
import { toast } from 'sonner';
import { publicCampaignPath } from '@/lib/campaign-links';
import {
  MagnifyingGlassIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ShieldCheckIcon,
  EllipsisVerticalIcon,
  DocumentIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

/* ─── Types ─── */

interface VerificationItem {
  id: string;
  title: string;
  slug: string;
  status: string;
  category: string;
  verificationStatus: string;
  verificationNotes: string | null;
  verificationReviewedAt: string | null;
  stripeVerificationId: string | null;
  /** The campaign's own currency; its amounts are in THAT currency's minor units (`docs/92`). */
  currency: string;
  goalAmount: number;
  raisedAmount: number;
  creatorId: string | null;
  createdAt: string;
  updatedAt: string;
  creatorName: string | null;
  creatorEmail: string | null;
  documentCount: number;
}

interface AdminDocument {
  id: string;
  documentType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  status: string;
  reviewerNotes: string | null;
  createdAt: string;
}

interface VerificationQueueProps {
  initialItems: VerificationItem[];
  stats: {
    /** True `count(*)` of the queue, before the page's 500-row cap (docs/88 F16). */
    totalInQueue: number;
    totalPending: number;
    totalIdentityVerified: number;
    totalFullyVerified: number;
    totalRejected: number;
  };
}

/* ─── Constants ─── */

const PAGE_SIZE = 25;

type SortField = 'title' | 'verificationStatus' | 'goalAmount' | 'documentCount' | 'updatedAt';
type SortDir = 'asc' | 'desc';

const STATUS_LABELS: Record<string, string> = {
  documents_uploaded: 'Documents Uploaded',
  submitted_for_review: 'Submitted for Review',
  identity_verified: 'Identity Verified (T1)',
  fully_verified: 'Fully Verified (T2)',
  info_requested: 'Info Requested',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  documents_uploaded: 'outline',
  submitted_for_review: 'secondary',
  identity_verified: 'default',
  fully_verified: 'default',
  info_requested: 'outline',
  rejected: 'destructive',
  suspended: 'destructive',
};

type ReviewAction = 'approve_t1' | 'approve_t2' | 'reject' | 'request_info';

const ACTION_LABELS: Record<ReviewAction, string> = {
  approve_t1: 'Approve Tier 1 (Identity)',
  approve_t2: 'Approve Tier 2 (Full)',
  reject: 'Reject',
  request_info: 'Request More Info',
};

/* ─── Sort icon helper ─── */

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronDownIcon className="ml-1 inline h-3 w-3 opacity-30" />;
  return sortDir === 'asc'
    ? <ChevronUpIcon className="ml-1 inline h-3 w-3" />
    : <ChevronDownIcon className="ml-1 inline h-3 w-3" />;
}

/* ─── Component ─── */

export function VerificationQueue({ initialItems, stats }: VerificationQueueProps) {
  const [items, setItems] = useState(initialItems);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [reviewTarget, setReviewTarget] = useState<VerificationItem | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewDeadlineDays, setReviewDeadlineDays] = useState(7);
  const [processing, setProcessing] = useState(false);
  const [viewDocsTarget, setViewDocsTarget] = useState<VerificationItem | null>(null);
  const [viewDocs, setViewDocs] = useState<AdminDocument[] | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [processingDocId, setProcessingDocId] = useState<string | null>(null);
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [docRejectNotes, setDocRejectNotes] = useState('');

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  function updateFilter(fn: () => void) { fn(); setPage(1); }

  const filtered = useMemo(() => {
    let result = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.creatorName?.toLowerCase().includes(q) ||
          item.creatorEmail?.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== 'all') {
      result = result.filter((item) => item.verificationStatus === statusFilter);
    }
    return result;
  }, [items, search, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortField) {
        case 'title': return dir * a.title.localeCompare(b.title);
        case 'verificationStatus': return dir * a.verificationStatus.localeCompare(b.verificationStatus);
        case 'goalAmount': return dir * (a.goalAmount - b.goalAmount);
        case 'documentCount': return dir * (a.documentCount - b.documentCount);
        case 'updatedAt': return dir * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
        default: return 0;
      }
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openReview = useCallback((item: VerificationItem, action: ReviewAction) => {
    setReviewTarget(item);
    setReviewAction(action);
    setReviewNotes('');
    setReviewDeadlineDays(7);
  }, []);

  const closeReview = useCallback(() => {
    setReviewTarget(null);
    setReviewAction(null);
    setReviewNotes('');
  }, []);

  const openViewDocs = useCallback(async (item: VerificationItem) => {
    setViewDocsTarget(item);
    setViewDocs(null);
    setLoadingDocs(true);
    try {
      const res = await fetch(`/api/v1/admin/campaigns/${item.id}/verification`);
      const data = await res.json();
      setViewDocs(res.ok ? data.data : []);
    } catch {
      setViewDocs([]);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const closeViewDocs = useCallback(() => {
    setViewDocsTarget(null);
    setViewDocs(null);
    setRejectingDocId(null);
    setDocRejectNotes('');
  }, []);

  const handleDocAction = useCallback(async (docId: string, action: 'approve' | 'reject', notes?: string) => {
    setProcessingDocId(docId);
    try {
      const res = await fetch(`/api/v1/admin/verification-documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes: notes || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setViewDocs((prev) =>
          prev?.map((d) =>
            d.id === docId
              ? { ...d, status: data.data.status, reviewerNotes: data.data.reviewerNotes }
              : d,
          ) ?? null,
        );
        toast.success(`Document ${action === 'approve' ? 'approved' : 'rejected'}`);
        setRejectingDocId(null);
        setDocRejectNotes('');
      } else {
        const data = await res.json();
        toast.error(data.error?.message || `Failed to ${action} document`);
      }
    } catch {
      toast.error(`Failed to ${action} document`);
    } finally {
      setProcessingDocId(null);
    }
  }, []);

  const handleReview = useCallback(async () => {
    if (!reviewTarget || !reviewAction) return;
    setProcessing(true);
    try {
      const res = await fetch(`/api/v1/admin/campaigns/${reviewTarget.id}/verification`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: reviewAction,
          notes: reviewNotes.trim() || undefined,
          deadline: reviewAction === 'request_info'
            ? new Date(Date.now() + reviewDeadlineDays * 24 * 60 * 60 * 1000).toISOString()
            : undefined,
        }),
      });
      if (res.ok) {
        const statusMap: Record<string, string> = {
          approve_t1: 'identity_verified',
          approve_t2: 'fully_verified',
          reject: 'rejected',
          request_info: 'info_requested',
        };
        const newStatus = statusMap[reviewAction] ?? reviewAction;
        setItems((prev) => prev.map((item) =>
          item.id === reviewTarget.id
            ? {
                ...item,
                verificationStatus: newStatus,
                verificationReviewedAt: new Date().toISOString(),
                verificationNotes: reviewNotes.trim() || item.verificationNotes,
              }
            : item,
        ));
        toast.success(`Campaign "${reviewTarget.title}" - ${ACTION_LABELS[reviewAction]} complete`);
      } else {
        const data = await res.json();
        toast.error(data.error?.message || 'Review action failed');
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setProcessing(false);
      closeReview();
    }
  }, [reviewTarget, reviewAction, reviewNotes, reviewDeadlineDays, closeReview]);

  function getActions(item: VerificationItem): ReviewAction[] {
    switch (item.verificationStatus) {
      case 'documents_uploaded':
      case 'submitted_for_review':
        return ['approve_t1', 'approve_t2', 'reject', 'request_info'];
      case 'identity_verified':
        return ['approve_t2', 'reject', 'request_info'];
      case 'info_requested':
        return ['approve_t1', 'approve_t2', 'reject'];
      default:
        return [];
    }
  }

  const statTiles = [
    { key: 'pending', label: 'Pending review', value: stats.totalPending, filter: 'documents_uploaded' },
    { key: 'identity', label: 'Identity verified', value: stats.totalIdentityVerified, filter: 'identity_verified' },
    { key: 'full', label: 'Fully verified', value: stats.totalFullyVerified, filter: 'fully_verified' },
    { key: 'rejected', label: 'Rejected', value: stats.totalRejected, filter: 'rejected' },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statTiles.map((tile) => {
          const active = statusFilter === tile.filter;
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => updateFilter(() => setStatusFilter(active ? 'all' : tile.filter))}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${active ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/40'}`}
            >
              <p className="text-2xl font-semibold tabular-nums">{tile.value}</p>
              <p className="text-xs text-muted-foreground">{tile.label}</p>
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
            placeholder="Search by campaign, creator name, or email…"
            value={search}
            onChange={(e) => updateFilter(() => setSearch(e.target.value))}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search verification queue"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => updateFilter(() => setStatusFilter(v))}>
          <SelectTrigger className="w-48 bg-background">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="documents_uploaded">Documents Uploaded</SelectItem>
            <SelectItem value="submitted_for_review">Submitted for Review</SelectItem>
            <SelectItem value="identity_verified">Identity Verified (T1)</SelectItem>
            <SelectItem value="fully_verified">Fully Verified (T2)</SelectItem>
            <SelectItem value="info_requested">Info Requested</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                  <button type="button" onClick={() => toggleSort('title')} className="inline-flex items-center">
                    Campaign <SortIcon field="title" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">Creator</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                  <button type="button" onClick={() => toggleSort('verificationStatus')} className="inline-flex items-center">
                    Status <SortIcon field="verificationStatus" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground md:table-cell">
                  <button type="button" onClick={() => toggleSort('goalAmount')} className="inline-flex items-center">
                    Goal <SortIcon field="goalAmount" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="hidden px-4 py-2 text-right text-xs font-medium text-muted-foreground md:table-cell">
                  <button type="button" onClick={() => toggleSort('documentCount')} className="inline-flex items-center">
                    Docs <SortIcon field="documentCount" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="hidden px-4 py-2 text-left text-xs font-medium text-muted-foreground lg:table-cell">
                  <button type="button" onClick={() => toggleSort('updatedAt')} className="inline-flex items-center">
                    Submitted <SortIcon field="updatedAt" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="w-12 px-2 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {paged.map((item) => {
                const actions = getActions(item);
                return (
                  <tr key={item.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      {/* docs/118 via docs/120: every campaign in this queue is
                          `under_review`, so this link was a 404 on every row. */}
                      {publicCampaignPath({ slug: item.slug, status: item.status }) ? (
                        <Link
                          href={publicCampaignPath({ slug: item.slug, status: item.status })!}
                          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                          target="_blank"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <p className="text-sm font-medium text-foreground">{item.title}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{item.category}</p>
                    </td>
                    <td className="hidden px-4 py-2.5 sm:table-cell">
                      <p className="truncate text-sm">{item.creatorName ?? 'Unknown'}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.creatorEmail}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={STATUS_VARIANT[item.verificationStatus] ?? 'outline'} className="text-[11px]">
                            {STATUS_LABELS[item.verificationStatus] ?? item.verificationStatus}
                          </Badge>
                          {item.stripeVerificationId && (
                            <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400">
                              Stripe ID
                            </Badge>
                          )}
                        </div>
                        {item.verificationReviewedAt && (
                          <span className="text-[11px] text-muted-foreground" title={formatDate(item.verificationReviewedAt)}>
                            Reviewed {formatRelativeTime(item.verificationReviewedAt)}
                          </span>
                        )}
                        {item.verificationNotes && (
                          <span className="text-[11px] italic text-muted-foreground truncate max-w-[200px]" title={item.verificationNotes}>
                            {item.verificationNotes}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-right font-mono text-muted-foreground md:table-cell">
                      <Money minor={item.goalAmount} currency={item.currency} precision="exact" />
                    </td>
                    <td className="hidden px-4 py-2.5 text-right md:table-cell">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums">{item.documentCount}</span>
                    </td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">
                      <span title={formatDate(item.updatedAt)}>{formatRelativeTime(item.updatedAt)}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {actions.length === 0 && item.documentCount > 0 && (
                        <button
                          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => openViewDocs(item)}
                          aria-label={`View documents for ${item.title}`}
                        >
                          <DocumentIcon className="h-3.5 w-3.5" />
                          Docs
                        </button>
                      )}
                      {actions.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={`Actions for ${item.title}`}
                            >
                              <EllipsisVerticalIcon className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => openViewDocs(item)}>
                              <DocumentIcon className="mr-2 h-4 w-4" />
                              View Documents ({item.documentCount})
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {actions.includes('approve_t1') && (
                              <DropdownMenuItem onClick={() => openReview(item, 'approve_t1')}>
                                Approve Identity (T1)
                              </DropdownMenuItem>
                            )}
                            {actions.includes('approve_t2') && (
                              <DropdownMenuItem onClick={() => openReview(item, 'approve_t2')}>
                                Approve Full (T2)
                              </DropdownMenuItem>
                            )}
                            {actions.includes('request_info') && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => openReview(item, 'request_info')}>
                                  Request more info
                                </DropdownMenuItem>
                              </>
                            )}
                            {actions.includes('reject') && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => openReview(item, 'reject')}>
                                  Reject
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <ShieldCheckIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="mt-2 text-sm text-muted-foreground">No campaigns match your filters.</p>
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
          loaded={items.length}
          total={stats.totalInQueue}
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

      {/* Review confirmation dialog */}
      <Dialog open={!!reviewTarget && !!reviewAction} onOpenChange={() => closeReview()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction && ACTION_LABELS[reviewAction]}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === 'reject'
                ? `This will reject the verification for "${reviewTarget?.title}". The campaigner will be notified.`
                : reviewAction === 'request_info'
                  ? `This will request additional information from the campaigner for "${reviewTarget?.title}".`
                  : `This will ${reviewAction === 'approve_t1' ? 'verify the identity (Tier 1)' : 'fully verify (Tier 2)'} for "${reviewTarget?.title}".`
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Label htmlFor="reviewNotes">
              Notes {reviewAction === 'reject' || reviewAction === 'request_info' ? '(required)' : '(optional)'}
            </Label>
            <Textarea
              id="reviewNotes"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder={
                reviewAction === 'request_info'
                  ? 'Describe what additional information or documents are needed…'
                  : reviewAction === 'reject'
                    ? 'Explain why the verification was rejected…'
                    : 'Optional internal notes about this decision…'
              }
              rows={4}
            />
            {reviewAction === 'request_info' && (
              <div className="space-y-2">
                <Label htmlFor="reviewDeadline">Response deadline</Label>
                <Select
                  value={String(reviewDeadlineDays)}
                  onValueChange={(v) => setReviewDeadlineDays(Number(v))}
                >
                  <SelectTrigger id="reviewDeadline">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days (recommended)</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Deadline: {new Date(Date.now() + reviewDeadlineDays * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeReview} disabled={processing}>
              Cancel
            </Button>
            <Button
              variant={reviewAction === 'reject' ? 'destructive' : 'default'}
              onClick={handleReview}
              disabled={processing || ((reviewAction === 'reject' || reviewAction === 'request_info') && !reviewNotes.trim())}
            >
              {processing ? 'Processing…' : reviewAction && ACTION_LABELS[reviewAction]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Viewer Dialog */}
      <Dialog open={!!viewDocsTarget} onOpenChange={closeViewDocs}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DocumentIcon className="h-5 w-5 shrink-0" />
              Documents: {viewDocsTarget?.title}
            </DialogTitle>
            <DialogDescription>
              Creator: {viewDocsTarget?.creatorName ?? 'Unknown'} &bull; {viewDocsTarget?.creatorEmail ?? ''}
            </DialogDescription>
          </DialogHeader>
          {loadingDocs ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading documents&hellip;</p>
          ) : !viewDocs || viewDocs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No documents have been uploaded for this campaign.</p>
          ) : (
            <div className="space-y-4">
              {/* Review summary */}
              <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span>{viewDocs.filter((d) => d.status === 'approved').length}/{viewDocs.length} approved</span>
                {viewDocs.some((d) => d.status === 'rejected') && (
                  <span className="text-destructive">{viewDocs.filter((d) => d.status === 'rejected').length} rejected</span>
                )}
                {viewDocs.some((d) => d.status === 'pending') && (
                  <span>{viewDocs.filter((d) => d.status === 'pending').length} pending review</span>
                )}
              </div>

              {/* Document list */}
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {viewDocs.map((doc) => (
                  <div key={doc.id} className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{doc.fileName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {doc.documentType.replace(/_/g, ' ')} &bull; {(doc.fileSize / 1024).toFixed(0)} KB &bull; {formatRelativeTime(doc.createdAt)}
                        </p>
                      </div>
                      {/*
                        docs/88 F2: this used to be `href={doc.fileUrl}`,
                        which is a `supabase-private://` reference, not a
                        URL - the browser silently did nothing. The route
                        below signs the object and redirects, so the link
                        is minted at click time and nothing stale sits in
                        the list.
                      */}
                      <a
                        href={`/api/v1/admin/verification-documents/${doc.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex shrink-0 items-center gap-1 text-sm text-brand-teal underline underline-offset-2 hover:text-brand-teal/80"
                      >
                        View
                        <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                      </a>
                    </div>

                    {/* Status + actions */}
                    {doc.status === 'approved' && (
                      <div className="mt-2 flex items-center gap-2">
                        <CheckCircleIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                        <span className="text-xs font-medium text-green-700 dark:text-green-300">Approved</span>
                        {doc.reviewerNotes && (
                          <span className="text-xs italic text-muted-foreground">&bull; {doc.reviewerNotes}</span>
                        )}
                      </div>
                    )}

                    {doc.status === 'rejected' && (
                      <div className="mt-2">
                        <div className="flex items-center gap-2">
                          <XCircleIcon className="h-4 w-4 text-red-600 dark:text-red-400" />
                          <span className="text-xs font-medium text-red-700 dark:text-red-300">Rejected</span>
                        </div>
                        {doc.reviewerNotes && (
                          <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                            {doc.reviewerNotes}
                          </p>
                        )}
                      </div>
                    )}

                    {doc.status === 'pending' && rejectingDocId !== doc.id && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">pending</span>
                        <div className="ml-auto flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 px-2 text-xs"
                            disabled={processingDocId === doc.id}
                            onClick={() => handleDocAction(doc.id, 'approve')}
                          >
                            {processingDocId === doc.id ? 'Approving\u2026' : (<><CheckCircleIcon className="h-3.5 w-3.5" /> Approve</>)}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                            disabled={processingDocId === doc.id}
                            onClick={() => { setRejectingDocId(doc.id); setDocRejectNotes(''); }}
                          >
                            <XCircleIcon className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      </div>
                    )}

                    {doc.status === 'pending' && rejectingDocId === doc.id && (
                      <div className="mt-2 space-y-2 rounded-md border border-red-200 bg-red-50/50 p-2 dark:border-red-800 dark:bg-red-950/20">
                        <Label htmlFor={`reject-notes-${doc.id}`} className="text-xs">
                          Reason for rejection (required)
                        </Label>
                        <Textarea
                          id={`reject-notes-${doc.id}`}
                          value={docRejectNotes}
                          onChange={(e) => setDocRejectNotes(e.target.value)}
                          placeholder="Explain why this document is being rejected\u2026"
                          rows={2}
                          className="text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-3 text-xs"
                            disabled={!docRejectNotes.trim() || processingDocId === doc.id}
                            onClick={() => handleDocAction(doc.id, 'reject', docRejectNotes)}
                          >
                            {processingDocId === doc.id ? 'Rejecting\u2026' : 'Confirm Rejection'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => { setRejectingDocId(null); setDocRejectNotes(''); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeViewDocs}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
