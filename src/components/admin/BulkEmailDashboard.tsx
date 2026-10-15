'use client';

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatRelativeTime } from '@/lib/utils/dates';
import { toast } from 'sonner';
import {
  BULK_EMAIL_TEMPLATES,
  RECIPIENT_FILTERS,
} from '@/lib/validators/verification';
import {
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';

interface BulkEmailItem {
  id: string;
  templateName: string;
  subject: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  status: string;
  campaignId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];
type TemplateName = (typeof BULK_EMAIL_TEMPLATES)[number];

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  sending: 'secondary',
  completed: 'default',
  failed: 'destructive',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sending: 'Sending…',
  completed: 'Completed',
  failed: 'Failed',
};

const TEMPLATE_LABELS: Record<string, string> = {
  campaign_cancelled_refund: 'Campaign Cancelled - Full Refund',
  campaign_paused_update: 'Campaign Paused - Status Update',
  campaign_resumed_update: 'Campaign Resumed - Good News',
  campaign_completed_thanks: 'Campaign Completed - Thank You',
  custom: 'Custom Template',
};

/**
 * Keyed on `RECIPIENT_FILTERS` so the selector covers exactly the values
 * `createBulkEmailSchema` / `isRecipientFilter` accept — no more, no fewer.
 * Descriptions are read off `resolveCandidates()` in
 * `src/lib/bulk-email-recipients.ts`, not invented.
 */
const FILTER_LABELS: Record<RecipientFilter, string> = {
  all_donors: 'All donors',
  registered_donors: 'Registered donors (have an account)',
  guest_donors: 'Guest donors (no account)',
  subscribed_donors: 'Campaign subscribers',
  refunded_donors: 'Refunded donors',
};

const FILTER_HINTS: Record<RecipientFilter, string> = {
  all_donors: 'Everyone with a real, un-refunded donation.',
  registered_donors: 'Un-refunded donations that are linked to a user account.',
  guest_donors: 'Un-refunded donations made without an account.',
  subscribed_donors:
    'Reads the campaign subscription list. Requires a campaign ID; without one it resolves to nobody.',
  refunded_donors: 'Donors whose donation was refunded.',
};

/**
 * The send route fails closed when the filter chosen at draft time cannot be
 * read back out of `audit_logs.details.recipientFilter`, and says so with a
 * `VALIDATION_ERROR`. There is no distinct error code for it, so match the
 * message the route emits (`.../[id]/send/route.ts`).
 */
function isUnrecoverableFilterError(message: string): boolean {
  return /recipient filter/i.test(message) && /could not be recovered/i.test(message);
}

export function BulkEmailDashboard() {
  const [items, setItems] = useState<BulkEmailItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<BulkEmailItem | null>(null);

  // ── Send-dialog gates ────────────────────────────────────────────────────
  // `confirmAllDonors` is the UI side of the blast-radius gate: the send route
  // rejects an un-scoped draft unless the body carries `confirmAllDonors: true`.
  const [confirmAllDonors, setConfirmAllDonors] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [filterUnrecoverable, setFilterUnrecoverable] = useState(false);
  const [recoveryFilter, setRecoveryFilter] = useState<RecipientFilter | ''>('');

  // ── Draft creation ───────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState<TemplateName>('custom');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftCampaignId, setDraftCampaignId] = useState('');
  const [draftFilter, setDraftFilter] = useState<RecipientFilter>('all_donors');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{
    subject: string;
    recipientCount: number;
    recipientFilter: RecipientFilter;
    campaignId: string | null;
  } | null>(null);

  const fetchData = useCallback(async (page: number, status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status !== 'all') params.set('status', status);

      const res = await fetch(`/api/v1/admin/bulk-emails?${params}`);
      const data = await res.json();
      if (data.ok) {
        setItems(data.data.items);
        setPagination(data.data.pagination);
      } else {
        toast.error('Failed to load communications');
      }
    } catch {
      toast.error('Network error loading communications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(pagination.page, statusFilter);
  }, [fetchData, pagination.page, statusFilter]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/v1/admin/bulk-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: draftTemplate,
          subject: draftSubject,
          bodyHtml: draftBody,
          recipientFilter: draftFilter,
          // Omitted rather than sent empty: the schema requires a UUID.
          ...(draftCampaignId.trim() ? { campaignId: draftCampaignId.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        // The create response carries the recipient count resolved by the same
        // helper the send uses, so this is the number that will be mailed.
        setLastCreated({
          subject: data.data.subject,
          recipientCount: data.data.recipientCount,
          recipientFilter: data.data.recipientFilter,
          campaignId: data.data.campaignId ?? null,
        });
        toast.success(`Draft created for ${data.data.recipientCount} recipient(s)`);
        setDraftSubject('');
        setDraftBody('');
        setDraftCampaignId('');
        setShowCreate(false);
        fetchData(pagination.page, statusFilter);
      } else {
        const message = data.error?.message ?? 'Failed to create draft';
        setCreateError(message);
        toast.error(message);
      }
    } catch {
      setCreateError('Network error creating draft');
      toast.error('Network error creating draft');
    } finally {
      setCreating(false);
    }
  }

  function openConfirm(item: BulkEmailItem) {
    // Every gate resets on open, so a confirmation can never be inherited from
    // a previous dialog or satisfied before the admin has read this one.
    setConfirmAllDonors(false);
    setSendError(null);
    setFilterUnrecoverable(false);
    setRecoveryFilter('');
    setConfirmTarget(item);
  }

  function closeConfirm() {
    setConfirmTarget(null);
    setConfirmAllDonors(false);
    setSendError(null);
    setFilterUnrecoverable(false);
    setRecoveryFilter('');
  }

  async function handleSend(item: BulkEmailItem, explicitFilter?: RecipientFilter) {
    const needsAllDonorsConfirmation = !item.campaignId;
    if (needsAllDonorsConfirmation && !confirmAllDonors) return;

    setSendingId(item.id);
    setSendError(null);
    try {
      const body: { confirmAllDonors?: true; recipientFilter?: RecipientFilter } = {};
      if (needsAllDonorsConfirmation) body.confirmAllDonors = true;
      // Only ever sent when the admin has explicitly chosen one after the
      // server said the stored filter was unrecoverable. Sending a default
      // here would defeat the route's fail-closed behaviour.
      if (explicitFilter) body.recipientFilter = explicitFilter;

      const res = await fetch(`/api/v1/admin/bulk-emails/${item.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`"${item.subject}" is now sending`);
        closeConfirm();
        fetchData(pagination.page, statusFilter);
      } else {
        const message = data.error?.message ?? 'Failed to send';
        if (isUnrecoverableFilterError(message)) {
          // Keep the dialog open and offer the two routes the server names.
          setFilterUnrecoverable(true);
        } else {
          setSendError(message);
          toast.error(message);
        }
      }
    } catch {
      setSendError('Network error sending bulk email');
      toast.error('Network error sending bulk email');
    } finally {
      setSendingId(null);
    }
  }

  const displayed = search.trim()
    ? items.filter((item) => {
        const q = search.toLowerCase();
        return (
          item.subject.toLowerCase().includes(q) ||
          item.templateName.toLowerCase().includes(q)
        );
      })
    : items;

  const needsAllDonorsConfirmation = Boolean(confirmTarget && !confirmTarget.campaignId);
  const sendBlocked =
    sendingId === confirmTarget?.id ||
    (needsAllDonorsConfirmation && !confirmAllDonors) ||
    (filterUnrecoverable && !recoveryFilter);

  return (
    <div className="space-y-6">
      {/* Draft creation */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">New bulk email</h2>
            <p className="text-xs text-muted-foreground">
              Pick the audience here. The recipient count is resolved against live
              opt-out data when the draft is created, and that is the number that
              gets mailed.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={showCreate}
            onClick={() => { setShowCreate((v) => !v); setCreateError(null); }}
          >
            {showCreate ? 'Cancel' : 'New Draft'}
          </Button>
        </div>

        {showCreate && (
          <form className="mt-4 grid gap-4" onSubmit={handleCreate}>
            <div className="grid gap-1.5">
              <label htmlFor="bulk-email-template" className="text-xs font-medium">
                Template
              </label>
              <select
                id="bulk-email-template"
                value={draftTemplate}
                onChange={(e) => setDraftTemplate(e.target.value as TemplateName)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {BULK_EMAIL_TEMPLATES.map((name) => (
                  <option key={name} value={name}>
                    {TEMPLATE_LABELS[name] ?? name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="bulk-email-subject" className="text-xs font-medium">
                Subject
              </label>
              <input
                id="bulk-email-subject"
                type="text"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="bulk-email-body" className="text-xs font-medium">
                Body (HTML)
              </label>
              <textarea
                id="bulk-email-body"
                rows={5}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                {'{{donor_name}}'}, {'{{donation_amount}}'}, {'{{campaign_title}}'} and{' '}
                {'{{support_channels}}'} are interpolated per recipient. An unsubscribe
                footer is appended automatically.
              </p>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="bulk-email-filter" className="text-xs font-medium">
                Recipients
              </label>
              <select
                id="bulk-email-filter"
                value={draftFilter}
                onChange={(e) => setDraftFilter(e.target.value as RecipientFilter)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                aria-describedby="bulk-email-filter-hint"
              >
                {RECIPIENT_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {FILTER_LABELS[value]}
                  </option>
                ))}
              </select>
              <p id="bulk-email-filter-hint" className="text-xs text-muted-foreground">
                {FILTER_HINTS[draftFilter]}
              </p>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="bulk-email-campaign" className="text-xs font-medium">
                Campaign ID (optional)
              </label>
              <input
                id="bulk-email-campaign"
                type="text"
                value={draftCampaignId}
                onChange={(e) => setDraftCampaignId(e.target.value)}
                placeholder="UUID; leave blank to scope to the whole donor base"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                aria-describedby="bulk-email-campaign-hint"
              />
              <p id="bulk-email-campaign-hint" className="text-xs text-muted-foreground">
                Without a campaign, this draft reaches the entire donor base and
                sending it requires an extra confirmation.
              </p>
            </div>

            {createError && (
              <p role="alert" className="text-sm text-destructive">
                {createError}
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={creating}>
                {creating ? 'Creating…' : 'Create Draft'}
              </Button>
            </div>
          </form>
        )}

        {lastCreated && (
          <div
            role="status"
            className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <p className="font-medium">Draft created: {lastCreated.subject}</p>
            <p className="text-muted-foreground">
              {FILTER_LABELS[lastCreated.recipientFilter] ?? lastCreated.recipientFilter}
              {lastCreated.campaignId ? ', scoped to a campaign' : ', entire donor base'}:
              resolves to {lastCreated.recipientCount} recipient(s) after opt-outs.
            </p>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by subject or template…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search communications"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPagination((p) => ({ ...p, page: 1 })); }}>
          <SelectTrigger className="w-40 bg-background">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sending">Sending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : displayed.length === 0 ? (
        <div className="py-16 text-center">
          <EnvelopeIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No bulk emails found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Template</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Subject</th>
                <th className="hidden px-4 py-3 text-xs font-medium text-muted-foreground md:table-cell">Audience</th>
                <th className="hidden px-4 py-3 text-right text-xs font-medium text-muted-foreground sm:table-cell">Recipients</th>
                <th className="hidden px-4 py-3 text-right text-xs font-medium text-muted-foreground md:table-cell">Sent</th>
                <th className="hidden px-4 py-3 text-right text-xs font-medium text-muted-foreground md:table-cell">Failed</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="hidden px-4 py-3 text-xs font-medium text-muted-foreground lg:table-cell">Created</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {displayed.map((item) => (
                <tr key={item.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">
                      {TEMPLATE_LABELS[item.templateName] ?? item.templateName}
                    </span>
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 font-medium">
                    {item.subject}
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {item.campaignId ? 'Campaign-scoped' : 'Entire donor base'}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {item.recipientCount}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                    {item.sentCount}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                    {item.failedCount > 0 ? (
                      <span className="text-destructive">{item.failedCount}</span>
                    ) : (
                      item.failedCount
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[item.status] ?? 'outline'}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </Badge>
                    {item.status === 'sending' && item.recipientCount > 0 && (
                      <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-primary transition-all"
                          style={{ width: `${Math.round(((item.sentCount + item.failedCount) / item.recipientCount) * 100)}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                    {formatRelativeTime(item.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    {item.status === 'draft' && (
                      <Button
                        size="sm"
                        variant="default"
                        disabled={sendingId === item.id}
                        onClick={() => openConfirm(item)}
                      >
                        {sendingId === item.id ? 'Sending…' : 'Send'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {/* Send confirmation dialog */}
      <Dialog open={!!confirmTarget} onOpenChange={(open) => { if (!open) closeConfirm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Bulk Email</DialogTitle>
            <DialogDescription>
              Send &ldquo;{confirmTarget?.subject}&rdquo; to {confirmTarget?.recipientCount} recipient(s). This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {confirmTarget && needsAllDonorsConfirmation && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">
                This draft is not scoped to a campaign.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                It will email the entire donor base: {confirmTarget.recipientCount} people,
                as resolved when the draft was created.
              </p>
              <div className="mt-3 flex items-start gap-2">
                <input
                  id="confirm-all-donors"
                  type="checkbox"
                  checked={confirmAllDonors}
                  onChange={(e) => setConfirmAllDonors(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <label htmlFor="confirm-all-donors" className="text-sm">
                  I confirm this email should go to all {confirmTarget.recipientCount} donors.
                </label>
              </div>
            </div>
          )}

          {filterUnrecoverable && confirmTarget && (
            <div role="alert" className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium">
                This draft&rsquo;s recipient filter could not be recovered.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                The audit record that stores the audience is missing, and the server
                will not guess one. Re-create the draft with the form above, or pick
                the filter now and re-send.
              </p>
              <div className="mt-3 grid gap-1.5 sm:max-w-xs">
                <label htmlFor="send-recipient-filter" className="text-xs font-medium">
                  Recipient filter
                </label>
                <select
                  id="send-recipient-filter"
                  value={recoveryFilter}
                  onChange={(e) => setRecoveryFilter(e.target.value as RecipientFilter | '')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Choose a filter…</option>
                  {RECIPIENT_FILTERS.map((value) => (
                    <option key={value} value={value}>
                      {FILTER_LABELS[value]}
                    </option>
                  ))}
                </select>
                {recoveryFilter && (
                  <p className="text-xs text-muted-foreground">{FILTER_HINTS[recoveryFilter]}</p>
                )}
              </div>
            </div>
          )}

          {sendError && (
            <p role="alert" className="text-sm text-destructive">
              {sendError}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeConfirm}>Cancel</Button>
            <Button
              onClick={() =>
                confirmTarget &&
                handleSend(confirmTarget, recoveryFilter === '' ? undefined : recoveryFilter)
              }
              disabled={sendBlocked}
            >
              {sendingId === confirmTarget?.id
                ? 'Sending…'
                : filterUnrecoverable
                  ? 'Re-send With This Filter'
                  : 'Send Now'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
