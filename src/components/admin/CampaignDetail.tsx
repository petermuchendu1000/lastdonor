'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { CampaignStatusBadge } from '@/components/campaigns/CampaignStatusBadge';
import { VerificationBadge, FundReleaseIndicator } from '@/components/campaigns/TrustBadge';
import { Money } from '@/components/ui/Money';
import { formatDate } from '@/lib/utils/dates';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import {
  PencilSquareIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  PlusIcon,
  PauseIcon,
  PlayIcon,
  NoSymbolIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@/components/ui/icon';
import { CANCELLATION_REASONS } from '@/lib/validators/verification';
import { publicCampaignPath } from '@/lib/campaign-links';

interface CampaignData {
  id: string;
  title: string;
  slug: string;
  status: string;
  category: string;
  heroImageUrl: string;
  subjectName: string;
  subjectHometown: string | null;
  storyHtml: string;
  goalAmount: number;
  /** The campaign's own currency; its amounts are in THAT currency's minor units (`docs/92`). */
  currency: string;
  raisedAmount: number;
  donorCount: number;
  location: string | null;
  photoCredit: string | null;
  verificationStatus: string;
  totalReleasedAmount: number;
  pausedAt: string | null;
  pausedReason: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  publishedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastDonorId: string | null;
}

interface Donation {
  id: string;
  donorName: string;
  donorEmail: string;
  donorLocation: string | null;
  /** The donation's own currency. */
  currency: string;
  amount: number;
  message: string | null;
  isAnonymous: boolean;
  phaseAtTime: string;
  source: string;
  refunded: boolean;
  createdAt: string;
}

interface Update {
  id: string;
  title: string;
  bodyHtml: string;
  imageUrl: string | null;
  createdAt: string;
}

interface PhaseRow {
  phase: string;
  count: number;
  total: number;
}

interface CampaignDetailProps {
  campaign: CampaignData;
  donations: Donation[];
  updates: Update[];
  phaseBreakdown: PhaseRow[];
}

const PHASE_LABELS: Record<string, string> = {
  first_believers: 'First Believers',
  the_push: 'The Push',
  closing_in: 'Closing In',
  last_donor_zone: 'Last Donor Zone',
};

function formatCategory(cat: string) {
  return cat.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function CampaignDetail({ campaign, donations, updates, phaseBreakdown }: CampaignDetailProps) {
  const router = useRouter();
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [governanceAction, setGovernanceAction] = useState<{ action: string; label: string } | null>(null);
  const [governanceReason, setGovernanceReason] = useState('');

  const pct = campaign.goalAmount > 0
    ? Math.min((campaign.raisedAmount / campaign.goalAmount) * 100, 100)
    : 0;

  const canArchive = ['draft', 'completed'].includes(campaign.status);
  const canRestore = campaign.status === 'archived';
  const canPause = ['active', 'last_donor_zone'].includes(campaign.status);
  const canResume = campaign.status === 'paused';
  const canSuspend = ['active', 'last_donor_zone', 'paused', 'under_review'].includes(campaign.status);
  /*
    ⛔ `under_review` is NOT cancellable, and that is the `docs/93` decision
    being enforced rather than a new one.

    Refusing a campaign at review has exactly one path: suspend, with a
    reason, which emails the organiser the admin's own words. Cancel reached
    the same queue (`CANCELLABLE` listed `under_review`) and notifies NOBODY -
    `_processBulkRefundInner` returns early when there are no donations, which
    for an unpublished campaign is always, so not one of its emails fires. It
    is also terminal (`ALLOWED_TRANSITIONS.cancelled` is empty and nothing
    resumes it), and `cancelled` is publicly viewable, so it would hand a
    never-reviewed appeal about a named real person a permanent public page.
    `docs/120`.
  */
  const canCancel = !['cancelled', 'completed', 'archived', 'under_review'].includes(campaign.status);
  /*
    The approval door. The detail page used to offer BOTH refusal controls
    (Suspend, Cancel) and no way to approve - so the one screen an admin reads
    a queued campaign on could only say no. `docs/120`.
  */
  const canApprove = campaign.status === 'under_review';

  async function handleArchive() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/campaigns/${campaign.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.code === 'VALIDATION_ERROR' ? (data.error?.message ?? 'Archive failed') : 'Archive failed');
      }
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApprove() {
    setActionLoading(true);
    setActionError(null);
    try {
      /*
        PATCH is the ONE writer of a status transition: it checks
        `ALLOWED_TRANSITIONS`, stamps `publishedAt` only when it is null,
        writes `campaign.published`, and sends the organiser the "Your
        Campaign Is Live!" email. Saving the edit form used to do the same
        job silently through `PUT /api/v1/campaigns/<id>`, which did none of
        those four things. `docs/120`.
      */
      const res = await fetch(`/api/v1/admin/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? 'Approve failed');
      }
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRestore() {
    setActionLoading(true);
    setActionError(null);
    try {
      /*
        PATCH, not PUT. This button posted `{ status: 'draft' }` to
        `PUT /api/v1/campaigns/<id>`, which accepted a status with no
        transition check and no audit row; that route now answers 400, and
        `archived -> draft` is in `ALLOWED_TRANSITIONS` so PATCH takes it.
        `docs/120`.
      */
      const res = await fetch(`/api/v1/admin/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.code === 'VALIDATION_ERROR' ? (data.error?.message ?? 'Restore failed') : 'Restore failed');
      }
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleGovernanceAction() {
    if (!governanceAction) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const body: Record<string, unknown> = {};
      if (governanceAction.action === 'pause') body.reason = governanceReason || 'Administrative action';
      /*
        ⛔ This sent `publicReason` until 2026-10-25, and `suspendCampaignSchema`
        requires `reason` (min 3 characters). An unknown key is ignored by the
        schema and the required one was absent, so EVERY click of Suspend
        answered 400 "Reason must be at least 3 characters" - the button had
        never worked. Typecheck could not see it: the body is
        `Record<string, unknown>`.
      */
      if (governanceAction.action === 'suspend') body.reason = governanceReason || 'Under investigation';
      /*
        ⛔ No default, and no free text. `cancelCampaignSchema.reason` is
        `z.enum(CANCELLATION_REASONS)`, and this line used to send
        `governanceReason || 'policy_violation'` - a value that is NOT in that
        enum - into it. So the default 400'd and so did every sentence a human
        typed into the textarea above: the Cancel button had never worked
        either. That is the defect in the comment two lines up, repeated in
        the adjacent statement, which `docs/93`'s fix did not sweep. The
        dialog now offers the enum. `docs/120`.
      */
      if (governanceAction.action === 'cancel') body.reason = governanceReason;

      const res = await fetch(`/api/v1/admin/campaigns/${campaign.id}/${governanceAction.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.code === 'VALIDATION_ERROR' ? (data.error?.message ?? `${governanceAction.label} failed`) : `${governanceAction.label} failed`);
      }
      setGovernanceAction(null);
      setGovernanceReason('');
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* CDS page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{campaign.title}</h1>
            <CampaignStatusBadge status={campaign.status} />
            <VerificationBadge status={campaign.verificationStatus} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {campaign.subjectName}
            {campaign.subjectHometown && ` · ${campaign.subjectHometown}`}
            {' · '}
            {formatCategory(campaign.category)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Created {formatDate(campaign.createdAt)}
            {campaign.publishedAt && ` · Published ${formatDate(campaign.publishedAt)}`}
            {campaign.completedAt && ` · Completed ${formatDate(campaign.completedAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canApprove && (
            <button
              onClick={handleApprove}
              disabled={actionLoading}
              className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90 disabled:opacity-50"
            >
              <CheckCircleIcon className="mr-1.5 h-4 w-4" />
              Approve and publish
            </button>
          )}
          <Link
            href={`/admin/campaigns/${campaign.id}/edit`}
            className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-100 hover:bg-muted/60"
          >
            <PencilSquareIcon className="mr-1.5 h-4 w-4" />
            Edit
          </Link>
          {canPause && (
            <button
              onClick={() => setGovernanceAction({ action: 'pause', label: 'Pause Campaign' })}
              disabled={actionLoading}
              className="inline-flex items-center rounded-md border border-amber-500/40 px-3 py-2 text-sm font-medium text-amber-600 transition-colors duration-100 hover:bg-amber-50 disabled:opacity-50 dark:hover:bg-amber-950"
            >
              <PauseIcon className="mr-1.5 h-4 w-4" />
              Pause
            </button>
          )}
          {canResume && (
            <button
              onClick={() => setGovernanceAction({ action: 'resume', label: 'Resume Campaign' })}
              disabled={actionLoading}
              className="inline-flex items-center rounded-md border border-green-500/40 px-3 py-2 text-sm font-medium text-green-600 transition-colors duration-100 hover:bg-green-50 disabled:opacity-50 dark:hover:bg-green-950"
            >
              <PlayIcon className="mr-1.5 h-4 w-4" />
              Resume
            </button>
          )}
          {canSuspend && (
            <button
              onClick={() => setGovernanceAction({ action: 'suspend', label: 'Suspend Campaign' })}
              disabled={actionLoading}
              className="inline-flex items-center rounded-md border border-red-500/40 px-3 py-2 text-sm font-medium text-red-600 transition-colors duration-100 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
            >
              <NoSymbolIcon className="mr-1.5 h-4 w-4" />
              Suspend
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => setGovernanceAction({ action: 'cancel', label: 'Cancel Campaign' })}
              disabled={actionLoading}
              className="inline-flex items-center rounded-md border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive transition-colors duration-100 hover:bg-destructive/10 disabled:opacity-50"
            >
              <XCircleIcon className="mr-1.5 h-4 w-4" />
              Cancel
            </button>
          )}
          {canArchive && (
            <button
              onClick={handleArchive}
              disabled={actionLoading}
              className="inline-flex items-center rounded-md border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive transition-colors duration-100 hover:bg-destructive/10 disabled:opacity-50"
            >
              <ArchiveBoxIcon className="mr-1.5 h-4 w-4" />
              Archive
            </button>
          )}
          {canRestore && (
            <button
              onClick={handleRestore}
              disabled={actionLoading}
              className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-100 hover:bg-muted/60 disabled:opacity-50"
            >
              <ArrowPathIcon className="mr-1.5 h-4 w-4" />
              Restore to Draft
            </button>
          )}
        </div>
      </div>

      {/* Status banner for paused / suspended / cancelled */}
      {campaign.status === 'paused' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
          <p className="font-medium text-amber-800 dark:text-amber-200">Campaign Paused</p>
          {campaign.pausedReason && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">Reason: {campaign.pausedReason}</p>}
          {campaign.pausedAt && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Since {formatDate(campaign.pausedAt)}</p>}
        </div>
      )}
      {campaign.status === 'suspended' && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950">
          <p className="font-medium text-red-800 dark:text-red-200">Campaign Suspended</p>
          {campaign.suspendedReason && <p className="mt-1 text-sm text-red-700 dark:text-red-300">Reason: {campaign.suspendedReason}</p>}
          {campaign.suspendedAt && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Since {formatDate(campaign.suspendedAt)}</p>}
        </div>
      )}
      {campaign.status === 'cancelled' && (
        <div className="rounded-lg border border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="font-medium text-gray-800 dark:text-gray-200">Campaign Cancelled</p>
          {campaign.cancellationReason && <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">Reason: {campaign.cancellationReason}</p>}
          {campaign.cancelledAt && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Since {formatDate(campaign.cancelledAt)}</p>}
        </div>
      )}

      {actionError && (
        <p className="text-sm text-destructive">{actionError}</p>
      )}

      {/* CDS stat tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-background px-4 py-4">
          <p className="text-xs font-medium text-muted-foreground">Raised</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums leading-none"><Money minor={campaign.raisedAmount} currency={campaign.currency} precision="exact" /></p>
        </div>
        <div className="rounded-lg border border-border bg-background px-4 py-4">
          <p className="text-xs font-medium text-muted-foreground">Goal</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums leading-none"><Money minor={campaign.goalAmount} currency={campaign.currency} precision="exact" /></p>
        </div>
        <div className="rounded-lg border border-border bg-background px-4 py-4">
          <p className="text-xs font-medium text-muted-foreground">Donors</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums leading-none">{campaign.donorCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-background px-4 py-4">
          <p className="text-xs font-medium text-muted-foreground">Progress</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums leading-none">{pct.toFixed(1)}%</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* CDS phase breakdown */}
      {phaseBreakdown.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">
            Donation phase breakdown
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {phaseBreakdown.map((p) => (
              <div key={p.phase} className="rounded-lg border border-border bg-background px-4 py-4">
                <p className="text-xs font-medium text-muted-foreground">
                  {PHASE_LABELS[p.phase] ?? p.phase}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums leading-none"><Money minor={p.total} currency={campaign.currency} precision="exact" /></p>
                <p className="mt-1.5 text-xs text-muted-foreground/70">{p.count} donations</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CDS Data Table - Recent Donations */}
      <section>
        <h2 className="text-sm font-semibold">
          Recent donations ({donations.length})
        </h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Donor</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Amount</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground sm:table-cell">Phase</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground md:table-cell">Source</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground lg:table-cell">Message</th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground sm:table-cell">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {donations.map((d) => (
                <tr key={d.id} className={`transition-colors duration-100 hover:bg-muted/30${d.refunded ? ' opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">
                        {d.isAnonymous ? 'Anonymous' : d.donorName}
                      </p>
                      {!d.isAnonymous && (
                        <p className="text-xs text-muted-foreground">{d.donorEmail}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    <Money minor={d.amount} currency={d.currency} precision="exact" />
                    {d.refunded && (
                      <Badge variant="destructive" className="ml-1 text-[10px]">
                        Refunded
                      </Badge>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <Badge variant="outline" className="text-[10px]">
                      {PHASE_LABELS[d.phaseAtTime] ?? d.phaseAtTime}
                    </Badge>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <Badge
                      variant={d.source === 'seed' ? 'secondary' : 'default'}
                      className="text-[10px]"
                    >
                      {d.source}
                    </Badge>
                  </td>
                  <td className="hidden max-w-[200px] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                    {d.message || '-'}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                    {formatDate(d.createdAt)}
                  </td>
                </tr>
              ))}
              {donations.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No donations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </section>

      {/* CDS Updates section */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Updates ({updates.length})
          </h2>
          <Link
            href={`/admin/campaigns/${campaign.id}/updates/new`}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90"
          >
            <PlusIcon className="mr-1.5 h-4 w-4" />
            Add Update
          </Link>
        </div>
        <div className="mt-4 space-y-4">
          {updates.map((u) => (
            <div key={u.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between">
                <p className="font-medium">{u.title}</p>
                <span className="text-xs text-muted-foreground">
                  {formatDate(u.createdAt)}
                </span>
              </div>
              <div
                className="prose prose-sm mt-2 max-w-none text-muted-foreground dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(u.bodyHtml) }}
              />
              {u.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={u.imageUrl}
                  alt={u.title}
                  className="mt-3 max-h-48 rounded-md object-cover"
                />
              )}
            </div>
          ))}
          {updates.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              No updates posted yet.
            </div>
          )}
        </div>
      </section>

      {/* Payout Status */}
      <section>
        <h2 className="text-sm font-semibold">Payout Status</h2>
        <div className="mt-4">
          <FundReleaseIndicator
            totalReleased={campaign.totalReleasedAmount}
            raisedAmount={campaign.raisedAmount}
          />
        </div>
      </section>

      {/*
        Campaign link.

        ⛔ `publicCampaignPath`, not a template literal. `docs/118`'s rule -
        before rendering ANY link to `/campaigns/<slug>`, ask whether that page
        exists - was swept over the public UI and over notifications and NOT
        over `src/components/admin/`. This link was unconditional, so on a
        queued or draft campaign it pointed at a 404; Next prefetched it, which
        is how the browser walk in `docs/120` found it. `null` is a real return
        value and is rendered as text.
      */}
      <div className="text-sm text-muted-foreground">
        {publicCampaignPath({ slug: campaign.slug, status: campaign.status, publishedAt: campaign.publishedAt }) ? (
          <>
            Public link:{' '}
            <Link
              href={publicCampaignPath({ slug: campaign.slug, status: campaign.status, publishedAt: campaign.publishedAt })!}
              className="text-primary underline-offset-4 hover:underline"
            >
              /campaigns/{campaign.slug}
            </Link>
          </>
        ) : (
          <>No public page yet. The slug will be /campaigns/{campaign.slug}.</>
        )}
      </div>

      {/* Governance Action Dialog */}
      <Dialog open={!!governanceAction} onOpenChange={(open) => { if (!open) { setGovernanceAction(null); setGovernanceReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{governanceAction?.label}</DialogTitle>
            <DialogDescription>
              {governanceAction?.action === 'resume'
                ? 'Resume this campaign and make it active again.'
                : `Provide a reason to ${governanceAction?.action} this campaign.`}
            </DialogDescription>
          </DialogHeader>
          {governanceAction?.action === 'cancel' ? (
            /*
              A native <select> over the schema's own enum.

              The free-text textarea below could not satisfy
              `z.enum(CANCELLATION_REASONS)` unless the admin happened to type
              one of eight snake_case tokens, so Cancel answered 400 every
              time. Reading the options FROM the validator means the two
              cannot drift. Native rather than hand-rolled, per `docs/118`
              §10: a plain list of labels is a native control.
            */
            <div className="mt-2">
              <label htmlFor="cancel-reason" className="text-sm font-medium">
                Reason
              </label>
              <select
                id="cancel-reason"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={governanceReason}
                onChange={(e) => setGovernanceReason(e.target.value)}
              >
                <option value="">Choose a reason…</option>
                {CANCELLATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          ) : governanceAction?.action !== 'resume' ? (
            <textarea
              className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
              placeholder="Reason…"
              value={governanceReason}
              onChange={(e) => setGovernanceReason(e.target.value)}
            />
          ) : null}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGovernanceAction(null); setGovernanceReason(''); }}>
              Cancel
            </Button>
            <Button
              variant={governanceAction?.action === 'resume' ? 'default' : 'destructive'}
              disabled={
                actionLoading ||
                (governanceAction?.action === 'cancel' && governanceReason === '')
              }
              onClick={handleGovernanceAction}
            >
              {actionLoading ? 'Processing…' : governanceAction?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
