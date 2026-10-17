'use client';

import { centsToDollars } from '@/lib/utils/currency';
import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatRelativeTime } from '@/lib/utils/dates';
import { toast } from 'sonner';
import {
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ReceiptRefundIcon,
} from '@heroicons/react/24/outline';

interface RefundBatchItem {
  id: string;
  campaignId: string;
  campaignTitle: string | null;
  campaignSlug: string | null;
  reason: string;
  totalDonations: number;
  totalAmount: number;
  refundedCount: number;
  failedCount: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

interface RefundRecordItem {
  id: string;
  donationId: string;
  donorEmail: string | null;
  donorName: string | null;
  amount: number;
  stripeRefundId: string | null;
  status: string;
  errorMessage: string | null;
  emailSent: boolean;
  processedAt: string | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  processing: 'secondary',
  completed: 'default',
  partial_failure: 'destructive',
};

const STATUS_LABEL: Record<string, string> = {
  processing: 'Processing',
  completed: 'Completed',
  partial_failure: 'Partial Failure',
};

const RECORD_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  completed: 'default',
  failed: 'destructive',
};

/*
  docs/88 F4/F5: one currency renderer. This local helper produced
  `$1234.50` with no thousands separator; `centsToDollars` uses
  Intl currency formatting, which is what every other screen uses.
*/
function formatCents(cents: number): string {
  return centsToDollars(cents);
}

export function RefundBatchDashboard() {
  const [items, setItems] = useState<RefundBatchItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [expandedRecords, setExpandedRecords] = useState<RefundRecordItem[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [retryingBatchId, setRetryingBatchId] = useState<string | null>(null);

  const fetchData = useCallback(async (page: number, status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status !== 'all') params.set('status', status);

      const res = await fetch(`/api/v1/admin/refund-batches?${params}`);
      const data = await res.json();
      if (data.ok) {
        setItems(data.data.items);
        setPagination(data.data.pagination);
      } else {
        toast.error('Failed to load refund batches');
      }
    } catch {
      toast.error('Network error loading refund batches');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(pagination.page, statusFilter);
  }, [fetchData, pagination.page, statusFilter]);

  async function toggleExpand(batchId: string) {
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
      setExpandedRecords([]);
      return;
    }

    setExpandedBatchId(batchId);
    setLoadingRecords(true);
    try {
      const res = await fetch(`/api/v1/admin/refund-batches/${batchId}`);
      const data = await res.json();
      if (data.ok) {
        setExpandedRecords(data.data.records ?? []);
      } else {
        toast.error('Failed to load batch records');
      }
    } catch {
      toast.error('Network error loading batch records');
    } finally {
      setLoadingRecords(false);
    }
  }

  const displayed = search.trim()
    ? items.filter((batch) => {
        const q = search.toLowerCase();
        return (
          (batch.campaignTitle?.toLowerCase().includes(q) ?? false) ||
          batch.reason.toLowerCase().includes(q) ||
          (batch.campaignSlug?.toLowerCase().includes(q) ?? false)
        );
      })
    : items;

  async function handleRetry(batchId: string) {
    setRetryingBatchId(batchId);
    try {
      const res = await fetch(`/api/v1/admin/refund-batches/${batchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Retry complete: ${data.data.retriedOk} succeeded, ${data.data.retriedFail} failed`);
        fetchData(pagination.page, statusFilter);
        if (expandedBatchId === batchId) {
          toggleExpand(batchId);
          setTimeout(() => toggleExpand(batchId), 300);
        }
      } else {
        toast.error(data.error?.message || 'Retry failed');
      }
    } catch {
      toast.error('Network error during retry');
    } finally {
      setRetryingBatchId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by campaign title, slug, or reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search refund batches"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPagination((p) => ({ ...p, page: 1 })); }}>
          <SelectTrigger className="w-40 bg-background">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="partial_failure">Partial Failure</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Batch cards */}
      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : displayed.length === 0 ? (
        <div className="py-16 text-center">
          <ReceiptRefundIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No refund batches found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayed.map((batch) => {
            const progress = batch.totalDonations > 0
              ? Math.round(((batch.refundedCount + batch.failedCount) / batch.totalDonations) * 100)
              : 0;
            const isExpanded = expandedBatchId === batch.id;

            return (
              <div key={batch.id} className="rounded-lg border">
                {/* Batch header */}
                <button
                  type="button"
                  className="w-full p-4 text-left hover:bg-muted/30"
                  onClick={() => toggleExpand(batch.id)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold">
                          {batch.campaignTitle ?? 'Unknown Campaign'}
                        </h3>
                        <Badge variant={STATUS_VARIANT[batch.status] ?? 'outline'}>
                          {STATUS_LABEL[batch.status] ?? batch.status}
                        </Badge>
                        {isExpanded
                          ? <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
                          : <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                        }
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {batch.reason} - {formatRelativeTime(batch.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-6 text-right">
                      <div>
                        <p className="text-sm text-muted-foreground">Amount</p>
                        <p className="font-mono font-semibold">{formatCents(batch.totalAmount)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Donors</p>
                        <p className="font-semibold tabular-nums">
                          {batch.refundedCount}/{batch.totalDonations}
                        </p>
                      </div>
                      {batch.failedCount > 0 && (
                        <div>
                          <p className="text-sm text-muted-foreground">Failed</p>
                          <p className="font-semibold tabular-nums text-destructive">
                            {batch.failedCount}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {batch.status === 'processing' && (
                    <div className="mt-3 h-2 w-full rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </button>

                {/* Retry button for failed batches */}
                {batch.status === 'partial_failure' && batch.failedCount > 0 && (
                  <div className="border-t px-4 py-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={retryingBatchId === batch.id}
                      onClick={(e) => { e.stopPropagation(); handleRetry(batch.id); }}
                    >
                      {retryingBatchId === batch.id ? 'Retrying...' : `Retry ${batch.failedCount} Failed Refund${batch.failedCount === 1 ? '' : 's'}`}
                    </Button>
                  </div>
                )}

                {/* Expanded records */}
                {isExpanded && (
                  <div className="border-t px-4 py-3">
                    {loadingRecords ? (
                      <p className="text-center text-sm text-muted-foreground">Loading records…</p>
                    ) : expandedRecords.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground">No individual records.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="text-xs text-muted-foreground">
                              <th className="pb-2 font-medium">Donor</th>
                              <th className="hidden pb-2 font-medium sm:table-cell">Email</th>
                              <th className="pb-2 text-right font-medium">Amount</th>
                              <th className="hidden pb-2 font-medium md:table-cell">Stripe Refund</th>
                              <th className="pb-2 font-medium">Status</th>
                              <th className="hidden pb-2 font-medium lg:table-cell">Error</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {expandedRecords.map((record) => (
                              <tr key={record.id}>
                                <td className="py-2">{record.donorName ?? 'Unknown'}</td>
                                <td className="hidden py-2 text-muted-foreground sm:table-cell">{record.donorEmail ?? '-'}</td>
                                <td className="py-2 text-right tabular-nums">{formatCents(record.amount)}</td>
                                <td className="hidden py-2 font-mono text-xs text-muted-foreground md:table-cell">
                                  {record.stripeRefundId ? record.stripeRefundId.slice(0, 16) + '…' : '-'}
                                </td>
                                <td className="py-2">
                                  <Badge variant={RECORD_STATUS_VARIANT[record.status] ?? 'outline'} className="text-xs">
                                    {record.status}
                                  </Badge>
                                </td>
                                <td className="hidden max-w-[200px] truncate py-2 text-xs text-destructive lg:table-cell">
                                  {record.errorMessage ?? ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
            >
              <ChevronLeftIcon className="mr-1 h-4 w-4" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
            >
              Next <ChevronRightIcon className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
