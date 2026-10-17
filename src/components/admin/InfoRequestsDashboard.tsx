'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  InformationCircleIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';

interface InfoRequestItem {
  id: string;
  campaignId: string;
  campaignTitle: string;
  targetName: string | null;
  targetEmail: string;
  requestType: string;
  details: string;
  deadline: string;
  status: string;
  pauseCampaign: boolean;
  responseText: string | null;
  respondedAt: string | null;
  reminderSent: boolean;
  escalated: boolean;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  responded: 'default',
  expired: 'destructive',
  closed: 'outline',
};

export function InfoRequestsDashboard() {
  const [items, setItems] = useState<InfoRequestItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<InfoRequestItem | null>(null);
  const [extendDialog, setExtendDialog] = useState<InfoRequestItem | null>(null);
  const [extendDays, setExtendDays] = useState(7);

  const fetchData = useCallback(async (page: number, status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status !== 'all') params.set('status', status);

      const res = await fetch(`/api/v1/admin/info-requests?${params}`);
      const data = await res.json();
      if (data.ok) {
        setItems(data.data.items);
        setPagination(data.data.pagination);
      } else {
        toast.error('Failed to load info requests');
      }
    } catch {
      toast.error('Network error loading info requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(pagination.page, statusFilter);
  }, [fetchData, pagination.page, statusFilter]);

  function isOverdue(deadline: string) {
    return new Date(deadline) < new Date();
  }

  async function handleAction(id: string, action: string, extra?: Record<string, unknown>) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/v1/admin/info-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(
          action === 'close' ? 'Info request closed' :
          action === 'extend_deadline' ? 'Deadline extended' :
          'Reminder sent'
        );
        fetchData(pagination.page, statusFilter);
      } else {
        toast.error(data.error?.message || 'Action failed');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setActionLoading(null);
    }
  }

  const displayed = search.trim()
    ? items.filter((req) => {
        const q = search.toLowerCase();
        return (
          req.campaignTitle.toLowerCase().includes(q) ||
          req.targetName?.toLowerCase().includes(q) ||
          req.targetEmail.toLowerCase().includes(q) ||
          req.requestType.toLowerCase().includes(q)
        );
      })
    : items;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by campaign, name, email, or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search info requests"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPagination((p) => ({ ...p, page: 1 }));
          }}
        >
          <SelectTrigger className="w-40 bg-background">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="responded">Responded</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {pagination.total} total
        </span>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Campaign</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Type</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground sm:table-cell">Campaigner</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">Deadline</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">Flags</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading...</td>
                </tr>
              ) : displayed.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <InformationCircleIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p className="mt-2 text-sm text-muted-foreground">No info requests found.</p>
                  </td>
                </tr>
              ) : displayed.map((req) => (
                <tr key={req.id} className="border-b last:border-0 hover:bg-muted/25">
                  <td className="max-w-[200px] truncate px-4 py-3 font-medium">{req.campaignTitle}</td>
                  <td className="px-4 py-3 capitalize">{req.requestType.replace(/_/g, ' ')}</td>
                  <td className="hidden max-w-[150px] truncate px-4 py-3 text-muted-foreground sm:table-cell">
                    {req.targetName ?? req.targetEmail}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[req.status] ?? 'outline'}>
                      {req.status}
                    </Badge>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span className={isOverdue(req.deadline) && req.status === 'pending' ? 'font-semibold text-destructive' : ''}>
                      {formatRelativeTime(req.deadline)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <div className="flex gap-1">
                      {req.reminderSent && <Badge variant="outline" className="text-xs">Reminded</Badge>}
                      {req.escalated && <Badge variant="destructive" className="text-xs">Escalated</Badge>}
                      {req.pauseCampaign && <Badge variant="secondary" className="text-xs">Paused</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetailItem(req)}
                      >
                        View
                      </Button>
                      {req.status !== 'closed' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" disabled={actionLoading === req.id}>
                              <EllipsisVerticalIcon className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {req.status === 'pending' && (
                              <DropdownMenuItem
                                onClick={() => handleAction(req.id, 'send_reminder')}
                                disabled={req.reminderSent}
                              >
                                Send Reminder
                              </DropdownMenuItem>
                            )}
                            {(req.status === 'pending' || req.status === 'expired') && (
                              <DropdownMenuItem onClick={() => { setExtendDialog(req); setExtendDays(7); }}>
                                Extend Deadline
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => handleAction(req.id, 'close')}
                              className="text-destructive"
                            >
                              Close Request
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
          </span>
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

      {/* Detail Dialog */}
      <Dialog open={!!detailItem} onOpenChange={(open) => !open && setDetailItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Info Request Details</DialogTitle>
            <DialogDescription>{detailItem?.campaignTitle}</DialogDescription>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="capitalize">{detailItem.requestType.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant={STATUS_VARIANT[detailItem.status] ?? 'outline'}>{detailItem.status}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Campaigner</p>
                  <p>{detailItem.targetName ?? detailItem.targetEmail}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Deadline</p>
                  <p className={isOverdue(detailItem.deadline) && detailItem.status === 'pending' ? 'font-semibold text-destructive' : ''}>
                    {new Date(detailItem.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Request Details</p>
                <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{detailItem.details}</p>
              </div>
              {detailItem.responseText && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Response {detailItem.respondedAt && (
                      <span className="ml-1 text-muted-foreground/70">
                        ({formatRelativeTime(detailItem.respondedAt)})
                      </span>
                    )}
                  </p>
                  <p className="whitespace-pre-wrap rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/30">
                    {detailItem.responseText}
                  </p>
                </div>
              )}
              <div className="flex gap-1">
                {detailItem.reminderSent && <Badge variant="outline" className="text-xs">Reminder Sent</Badge>}
                {detailItem.escalated && <Badge variant="destructive" className="text-xs">Escalated</Badge>}
                {detailItem.pauseCampaign && <Badge variant="secondary" className="text-xs">Campaign Paused</Badge>}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailItem(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Deadline Dialog */}
      <Dialog open={!!extendDialog} onOpenChange={(open) => !open && setExtendDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Extend Deadline</DialogTitle>
            <DialogDescription>
              Extend the response deadline for this info request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label htmlFor="extend-days" className="text-sm font-medium">Additional days</label>
              <input
                id="extend-days"
                type="number"
                min={1}
                max={90}
                value={extendDays}
                onChange={(e) => setExtendDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 1)))}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {extendDialog && (
              <p className="text-xs text-muted-foreground">
                Current deadline: {new Date(extendDialog.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendDialog(null)}>Cancel</Button>
            <Button
              disabled={actionLoading === extendDialog?.id}
              onClick={() => {
                if (extendDialog) {
                  handleAction(extendDialog.id, 'extend_deadline', { additionalDays: extendDays });
                  setExtendDialog(null);
                }
              }}
            >
              Extend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
