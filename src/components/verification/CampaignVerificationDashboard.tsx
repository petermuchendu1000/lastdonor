'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDate, formatRelativeTime } from '@/lib/utils/dates';
import {
  ShieldCheckIcon,
  DocumentArrowUpIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  FingerPrintIcon,
  PaperClipIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { verificationStatusLabel } from '@/lib/campaign-labels';
import { publicCampaignPath } from '@/lib/campaign-links';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  title: string;
  slug: string;
  status: string;
  /** `docs/131`: a campaign has a public page only once a person approved its publication. */
  publishedAt: string | null;
  verificationStatus: string;
  verificationNotes: string | null;
  verificationReviewedAt: string | null;
  stripeVerificationId: string | null;
  stripeVerificationUrl: string | null;
  diditSessionId: string | null;
  diditSessionUrl: string | null;
}

interface VerificationDocument {
  id: string;
  documentType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  description: string | null;
  fileUrl: string;
  status: string;
  reviewerNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface InfoRequest {
  id: string;
  message: string;
  deadline: string | null;
  status: string;
  createdAt: string;
}

interface Props {
  campaign: Campaign;
  documents: VerificationDocument[];
  infoRequests: InfoRequest[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  unverified: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  documents_uploaded: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  submitted_for_review: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  identity_verified: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  fully_verified: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  info_requested: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const DOCUMENT_TYPES: Record<string, string> = {
  government_id: 'Government ID',
  selfie: 'Selfie with ID',
  hospital_letter: 'Hospital Letter',
  receipt: 'Receipt',
  utility_bill: 'Utility Bill',
  bank_statement: 'Bank Statement',
  official_letter: 'Official Letter',
  other: 'Other',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function CampaignVerificationDashboard({ campaign, documents, infoRequests }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [startingIdentity, setStartingIdentity] = useState(false);
  const [docType, setDocType] = useState<string>('government_id');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [responseFiles, setResponseFiles] = useState<File[]>([]);
  const [sendingResponse, setSendingResponse] = useState(false);
  const responseFileRef = useRef<HTMLInputElement>(null);

  const identityVerified = ['identity_verified', 'fully_verified'].includes(campaign.verificationStatus);
  /*
    ⛔ NOT `stripeVerificationId`.

    [VERIFIED 2026-10-25] Didit replaced Stripe Identity (docs/81) and writes
    `didit_session_id` / `didit_session_url` plus `verification_status:
    'pending'`. It never writes the Stripe column - so this read was
    permanently FALSE, which meant the status poll below never armed. An
    organiser started verification, finished it in the Didit tab, came back,
    and this screen looked exactly as it had before. docs/83's lesson a
    second time: the integration worked, the UI reflecting it pointed at a
    provider that had been replaced.

    `verification_status === 'pending'` is the authoritative signal because
    the session route sets it in the same update as the session id; the id
    is kept in the condition so a row written before that status existed is
    still recognised.
  */
  const identityPending =
    !identityVerified &&
    (campaign.verificationStatus === 'pending' || !!campaign.diditSessionId);
  const canUploadDocs = ['unverified', 'pending', 'documents_uploaded', 'info_requested', 'identity_verified'].includes(
    campaign.verificationStatus,
  );
  /*
    ⛔ `identity_verified` is NOT excluded here.

    It was, and it is the state the ID check leaves an organiser in - the one
    state where Step 2's upload form renders. So the only place they could
    attach a document was the only place the Submit control was hidden, and the
    route refused it too (`submit/route.ts`). `docs/121`.
  */
  const canSubmitForReview =
    !new Set([
      'documents_uploaded',
      'submitted_for_review',
      'fully_verified',
    ]).has(campaign.verificationStatus) && documents.length > 0;
  const isDocumentReviewPending =
    campaign.verificationStatus === 'documents_uploaded' ||
    campaign.verificationStatus === 'submitted_for_review';

  // ── Poll for the provider's decision while verification is pending ──
  useEffect(() => {
    if (!identityPending) return;

    let cancelled = false;
    let delay = 5_000; // Start at 5s, back off to 30s

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/v1/verification/identity/status?campaignId=${encodeURIComponent(campaign.id)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.decided && !cancelled) {
          router.refresh();
          return;
        }
      } catch {
        // Silently retry on next interval
      }
      if (!cancelled) {
        delay = Math.min(delay * 1.5, 30_000);
        setTimeout(poll, delay);
      }
    }

    const timer = setTimeout(poll, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [identityPending, campaign.id, router]);

  // ── Start identity verification ────────────────────────────────────────

  const handleStartIdentity = useCallback(async (opts?: { force?: boolean }) => {
    setStartingIdentity(true);
    try {
      const res = await fetch('/api/v1/verification/identity/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id, force: opts?.force }),
      });

      const data = await res.json();

      if (res.ok && data.data?.url) {
        window.open(data.data.url, '_blank', 'noopener,noreferrer');
        router.refresh();
      } else {
        const { toast } = await import('sonner');
        toast.error(data.error?.message || 'Failed to start identity verification');
      }
    } catch {
      const { toast } = await import('sonner');
      toast.error('Something went wrong. Please try again.');
    } finally {
      setStartingIdentity(false);
    }
  }, [campaign.id, router]);

  // ── Document upload ────────────────────────────────────────────────────

  const handleDocUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', docType);

      const res = await fetch(`/api/v1/user-campaigns/${campaign.id}/verification/documents`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const { toast } = await import('sonner');
        toast.success('Document uploaded successfully');
        router.refresh();
      } else {
        const data = await res.json();
        const { toast } = await import('sonner');
        toast.error(data.error?.message || 'Upload failed');
      }
    } catch {
      const { toast } = await import('sonner');
      toast.error('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [campaign.id, docType, router]);

  // ── Submit for review ──────────────────────────────────────────────────

  const handleSubmitForReview = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/user-campaigns/${campaign.id}/verification/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const { toast } = await import('sonner');
        toast.success('Submitted for review. We\'ll get back to you soon.');
        router.refresh();
      } else {
        const data = await res.json();
        const { toast } = await import('sonner');
        toast.error(data.error?.message || 'Submission failed');
      }
    } catch {
      const { toast } = await import('sonner');
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [campaign.id, router]);

  // ── Respond to info request ────────────────────────────────────────────

  const handleRespondToInfoRequest = useCallback(async (requestId: string) => {
    if (!responseText.trim() && responseFiles.length === 0) return;

    setSendingResponse(true);
    try {
      const formData = new FormData();
      formData.append('responseText', responseText.trim());
      for (const file of responseFiles) {
        formData.append('files', file);
      }

      const res = await fetch(`/api/v1/info-requests/${requestId}`, {
        method: 'PATCH',
        body: formData,
      });

      if (res.ok) {
        const { toast } = await import('sonner');
        toast.success('Response submitted successfully. Your campaign will be re-reviewed.');
        setRespondingTo(null);
        setResponseText('');
        setResponseFiles([]);
        router.refresh();
      } else {
        const data = await res.json();
        const { toast } = await import('sonner');
        toast.error(data.error?.message || 'Failed to submit response');
      }
    } catch {
      const { toast } = await import('sonner');
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSendingResponse(false);
    }
  }, [responseText, responseFiles, router]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumbs />

      {/* Header */}
      <div className="mt-6 flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">
            Verification
          </h1>
          <p className="mt-1 text-muted-foreground">
            {/*
              ⛔ `publicCampaignPath`, not a template literal (`docs/118`).
              This was unconditional, and an organiser is sent to this screen
              precisely when their campaign is `under_review` - the status the
              public page does not serve - so the campaign's own title was a
              404 at the exact moment they were told to come here and check
              their ID. `docs/121`.
            */}
            {publicCampaignPath({ slug: campaign.slug, status: campaign.status, publishedAt: campaign.publishedAt }) ? (
              <Link
                href={publicCampaignPath({ slug: campaign.slug, status: campaign.status, publishedAt: campaign.publishedAt })!}
                className="text-brand-teal hover:underline"
              >
                {campaign.title}
              </Link>
            ) : (
              campaign.title
            )}
          </p>
        </div>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
          STATUS_COLORS[campaign.verificationStatus] || STATUS_COLORS.unverified
        }`}>
          <ShieldCheckIcon className="mr-1.5 h-4 w-4" />
          {verificationStatusLabel(campaign.verificationStatus)}
        </span>
      </div>

      {/* Info Requests Banner */}
      {infoRequests.length > 0 && (
        <div className="mt-6 space-y-4">
          {infoRequests.map((req) => {
            const isPending = req.status === 'pending';
            const borderClass = isPending
              ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
              : 'border-border bg-muted/30';
            const iconClass = isPending
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground';

            return (
              <div key={req.id} className={`rounded-lg border p-4 ${borderClass}`}>
                <div className="flex items-start gap-3">
                  <ExclamationTriangleIcon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`font-medium ${isPending ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground'}`}>
                        {isPending ? 'Your Response Needed' : req.status === 'responded' ? 'Responded' : req.status === 'closed' ? 'Closed' : 'Expired'}
                      </p>
                      {!isPending && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
                          {req.status}
                        </span>
                      )}
                    </div>
                    <p className={`mt-1 text-sm ${isPending ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
                      {req.message}
                    </p>
                    {req.deadline && (
                      <p className={`mt-1 text-xs ${isPending ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                        {isPending ? 'Respond by: ' : 'Due by: '}{formatDate(req.deadline)}
                      </p>
                    )}

                    {/* Response form - only for pending */}
                    {isPending && (
                      <>
                        {respondingTo === req.id ? (
                          <div className="mt-3 space-y-2">
                            <textarea
                              value={responseText}
                              onChange={(e) => setResponseText(e.target.value)}
                              placeholder="Provide the requested information here..."
                              rows={4}
                              className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring dark:border-amber-700 dark:bg-amber-950/50"
                            />

                            {/* Attachments */}
                            {responseFiles.length > 0 && (
                              <div className="space-y-1">
                                {responseFiles.map((file, i) => (
                                  <div key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-md bg-white/60 px-2 py-1 text-sm dark:bg-amber-950/40">
                                    <PaperClipIcon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                    <span className="truncate text-amber-800 dark:text-amber-200">{file.name}</span>
                                    <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                                      {(file.size / 1024).toFixed(0)} KB
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setResponseFiles((prev) => prev.filter((_, j) => j !== i))}
                                      className="ml-auto shrink-0 text-amber-500 hover:text-red-600 dark:hover:text-red-400"
                                      aria-label={`Remove ${file.name}`}
                                    >
                                      <XMarkIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                disabled={sendingResponse || (!responseText.trim() && responseFiles.length === 0)}
                                onClick={() => handleRespondToInfoRequest(req.id)}
                              >
                                {sendingResponse ? 'Submitting...' : 'Submit Response'}
                              </Button>
                              <input
                                ref={responseFileRef}
                                type="file"
                                className="hidden"
                                multiple
                                accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx"
                                onChange={(e) => {
                                  if (e.target.files) {
                                    setResponseFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                                  }
                                  e.target.value = '';
                                }}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={sendingResponse}
                                onClick={() => responseFileRef.current?.click()}
                              >
                                <PaperClipIcon className="mr-1.5 h-4 w-4" />
                                Attach Files
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={sendingResponse}
                                onClick={() => { setRespondingTo(null); setResponseText(''); setResponseFiles([]); }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/50"
                              onClick={() => { setRespondingTo(req.id); setResponseText(''); setResponseFiles([]); }}
                            >
                              Respond to Request
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Verification Notes */}
      {campaign.verificationNotes && campaign.verificationStatus === 'rejected' && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <XCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-200">Verification Needs Review</p>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">{campaign.verificationNotes}</p>
            </div>
          </div>
        </div>
      )}

      {/* Documents Under Review Banner */}
      {isDocumentReviewPending && (
        <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
          <div className="flex items-start gap-3">
            <ClockIcon className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="font-medium text-blue-800 dark:text-blue-200">Documents Under Review</p>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                Your documents have been submitted and are being reviewed by our team.
                {/*
                  ⛔ No turnaround. `organiser-journey.ts` and `docs/78` forbid
                  quoting one, and this said "This typically takes 1 to 2
                  business days" on a platform where not one verification has
                  ever been reviewed. The email promise stays - it is true, the
                  Didit webhook sends it. `docs/121`.
                */}
                We will email you as soon as there is a decision.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 space-y-8">
        {/* ── Step 1: Identity Verification (Stripe Identity) ───────────── */}
        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            Step 1: Identity Verification
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Verify your identity using a government-issued photo ID. This is quick and secure.
          </p>

          {identityVerified ? (
            <Card className="mt-4">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <CheckCircleIcon className="h-6 w-6 shrink-0 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-300">
                      Identity Verified
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Your identity has been successfully confirmed.
                      {campaign.verificationReviewedAt && (
                        <> Verified {formatRelativeTime(campaign.verificationReviewedAt)}.</>
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : identityPending ? (
            <Card className="mt-4">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <ClockIcon className="mt-0.5 h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="flex-1">
                    <p className="font-medium text-amber-700 dark:text-amber-300">
                      Verification In Progress
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Your identity verification has been submitted and is being reviewed.
                      Most verifications complete within seconds, but some may take a few minutes.
                      You will be notified by email once the review is complete.
                    </p>
                    <p className="mt-3">
                      <button
                        type="button"
                        className="text-sm text-muted-foreground underline hover:text-foreground disabled:opacity-50"
                        disabled={startingIdentity}
                        onClick={() => handleStartIdentity({ force: true })}
                      >
                        {startingIdentity ? 'Starting...' : 'Experienced an issue? Start a new session'}
                      </button>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="mt-4">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <FingerPrintIcon className="mt-0.5 h-6 w-6 shrink-0 text-brand-teal" />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      Verify your identity to proceed
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      You&apos;ll be guided through a quick process to scan your ID and take a selfie.
                      {/*
                        ⛔ Said "This is handled securely by Stripe" until
                        2026-10-26 (`docs/116` §5). The button below calls
                        `/api/v1/verification/identity/session`, which creates a
                        DIDIT session (`createDiditSession`); Stripe Identity was
                        replaced in `docs/81` precisely because it could never
                        run on the same dead key as `docs/72`. So the one screen
                        where an organiser hands over their ID named the wrong
                        company.

                        It now names no company: the provider has changed once
                        already, and a vendor name here is a claim that goes
                        stale silently.
                      */}
                      Your ID is checked by a specialist identity service, not stored on
                      our servers.
                    </p>
                    <div className="mt-3">
                      <Button onClick={() => handleStartIdentity()} disabled={startingIdentity}>
                        <FingerPrintIcon className="mr-2 h-4 w-4" />
                        {startingIdentity ? 'Starting...' : 'Start Identity Verification'}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        {/* ── Step 2: Supporting Documents ───────────────────────────────── */}
        {/* Only shown once identity verification is complete or documents already exist */}
        {identityVerified || documents.length > 0 ? (
          <section>
            <h2 className="font-display text-xl font-bold text-foreground">
              Step 2: Supporting Documents
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload identity documents to verify yourself and your campaign.
            </p>

            {/* Upload form */}
            {canUploadDocs && (
              <Card className="mt-4">
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="docType">Document type</Label>
                      <Select value={docType} onValueChange={setDocType}>
                        <SelectTrigger id="docType">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(DOCUMENT_TYPES).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={handleDocUpload}
                        className="hidden"
                        id="doc-upload"
                      />
                      <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        <DocumentArrowUpIcon className="mr-2 h-4 w-4" />
                        {uploading ? 'Uploading\u2026' : 'Upload Document'}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Accepted formats: JPEG, PNG, WebP, PDF. Max 10 MB.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Document list */}
            {documents.length > 0 && (
              <div className="mt-4 space-y-3">
                {documents.map((doc) => (
                  <Card key={doc.id}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{doc.fileName}</p>
                            <Badge variant={
                              doc.status === 'approved' ? 'default'
                                : doc.status === 'rejected' ? 'destructive'
                                  : 'secondary'
                            }>
                              {doc.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {DOCUMENT_TYPES[doc.documentType] || doc.documentType} &middot;{' '}
                            {(doc.fileSize / 1024).toFixed(0)} KB &middot;{' '}
                            {formatRelativeTime(doc.createdAt)}
                          </p>
                          {doc.description && (
                            <p className="mt-1 text-xs text-muted-foreground">{doc.description}</p>
                          )}
                          {doc.reviewerNotes && (
                            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                              Reviewer: {doc.reviewerNotes}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {documents.length === 0 && !canUploadDocs && (
              <Card className="mt-4">
                <CardContent className="py-8 text-center text-muted-foreground">
                  No documents uploaded yet.
                </CardContent>
              </Card>
            )}

            {/* Submit for review button */}
            {canSubmitForReview && (
              <div className="mt-4">
                <Button onClick={handleSubmitForReview} disabled={submitting}>
                  {submitting ? 'Submitting\u2026' : 'Submit for Verification Review'}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  {/* No turnaround - see the note above. `docs/121`. */}
                  Once you send these, a person checks them and we email you the decision.
                </p>
              </div>
            )}
          </section>
        ) : (
          <section>
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-muted-foreground/25 px-5 py-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                2
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Supporting Documents
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Available after identity verification is complete.
                </p>
              </div>
            </div>
          </section>
        )}


      </div>
    </main>
  );
}
