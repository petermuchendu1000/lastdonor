'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { INSTITUTION_KIND_LABELS } from '@/lib/validators/trust-network';

/**
 * The institutional vouches for one campaign, and the form that records one.
 *
 * ── THE ONE SENTENCE THIS COMPONENT EXISTS TO PUT ON THE SCREEN ─────────────
 *
 * When a campaign is `identity_verified` because an organisation vouched for
 * it, an administrator deciding on a payout must be able to see that **no
 * document was ever uploaded**. Showing the verified status without that fact
 * lets a vouch read as a document review that happened. So the document count
 * is rendered beside the vouch, in the same block, and it is stated even when
 * it is zero - especially when it is zero.
 *
 * ⚠️ The representative's name is ATTRIBUTION, not AUTHENTICATION. The copy
 * says who the organisation said was speaking for it, and never implies the
 * platform proved who that person is.
 */

export interface VouchRow {
  id: string;
  institutionId: string;
  institutionName: string;
  institutionKind: string;
  institutionCountry: string;
  institutionStatus: string;
  institutionWebsite: string | null;
  representativeName: string;
  representativeRole: string;
  representativeEmail: string;
  relationship: string;
  statement: string;
  createdAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface VouchableInstitution {
  id: string;
  name: string;
  country: string;
  vouchesInWindow: number;
  monthlyVouchLimit: number;
}

interface Props {
  campaignId: string;
  verificationStatus: string;
  verificationSource: string | null;
  vouches: VouchRow[];
  documents: { total: number; approved: number };
  institutions: VouchableInstitution[];
  windowDays: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function CampaignVouches({
  campaignId,
  verificationStatus,
  verificationSource,
  vouches,
  documents,
  institutions,
  windowDays,
}: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const live = vouches.filter((v) => !v.revokedAt);
  const vouchVerified = verificationSource === 'institution_vouch';

  async function revoke(id: string) {
    const reason = window.prompt('Why is this vouch being revoked? (at least 5 characters)');
    if (!reason || reason.trim().length < 5) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/vouches/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not revoke that vouch.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke that vouch.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Vouched for by an organisation</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            A hospital, church, school or registered charity can confirm a crisis
            instead of the organiser uploading documents. It lifts the raise cap.
            It does not release money and it does not publish the campaign.
          </p>
        </div>
        {institutions.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className={buttonVariants({ variant: adding ? 'outline' : 'default', size: 'sm' })}
          >
            {adding ? 'Cancel' : 'Record a vouch'}
          </button>
        )}
      </div>

      {/*
        ⚠️ The load-bearing line. Said whenever a vouch is what verified this
        campaign, and said in the same block as the vouch, because an admin
        approving a payout reads this block and nothing else.
      */}
      {vouchVerified && (
        <p className="mt-3 rounded-md border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-sm">
          This campaign is <strong>ID verified on an organisation&rsquo;s word</strong>.{' '}
          {documents.total === 0
            ? 'Nobody has uploaded any documents, and no one at LastDonor has seen the organiser’s ID.'
            : `${documents.approved} of ${documents.total} uploaded ${documents.total === 1 ? 'document has' : 'documents have'} been approved.`}
        </p>
      )}

      {institutions.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          There are no active organisations yet.{' '}
          <Link href="/admin/institutions" className="underline underline-offset-2">
            Add one first
          </Link>
          .
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {adding && (
        <VouchForm
          campaignId={campaignId}
          institutions={institutions}
          windowDays={windowDays}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {vouches.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No organisation has vouched for this campaign.
          {verificationStatus === 'unverified' && ' It is under its pre-verification raise cap.'}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {vouches.map((v) => (
            <li
              key={v.id}
              className={`rounded-md border p-3 ${v.revokedAt ? 'opacity-60' : ''}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {v.institutionName}
                    {v.institutionStatus === 'suspended' && (
                      <Badge variant="destructive" className="ml-2">
                        Organisation suspended
                      </Badge>
                    )}
                    {v.revokedAt && (
                      <Badge variant="secondary" className="ml-2">
                        Revoked {formatDate(v.revokedAt)}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {INSTITUTION_KIND_LABELS[
                      v.institutionKind as keyof typeof INSTITUTION_KIND_LABELS
                    ] ?? v.institutionKind}
                    {' · '}
                    recorded {formatDate(v.createdAt)}
                  </p>
                </div>
                {!v.revokedAt && (
                  <button
                    type="button"
                    disabled={busy === v.id}
                    onClick={() => revoke(v.id)}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Revoke
                  </button>
                )}
              </div>

              <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm">{v.statement}</p>
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                <span className="font-medium text-foreground">How they know the family:</span>{' '}
                {v.relationship}
              </p>
              {/*
                "said this came from" and not "verified": nothing here proves
                who that person is. See the component header.
              */}
              <p className="mt-2 text-xs text-muted-foreground">
                {v.institutionName} said this came from {v.representativeName},{' '}
                {v.representativeRole} ({v.representativeEmail}). We have not checked
                who they are.
              </p>
              {v.revokedAt && v.revokedReason && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Revoked because:</span>{' '}
                  {v.revokedReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {live.length > 0 && !vouchVerified && (
        <p className="mt-3 text-xs text-muted-foreground">
          This campaign&rsquo;s verification was not set by a vouch, so revoking one
          will not change it.
        </p>
      )}
    </section>
  );
}

function VouchForm({
  campaignId,
  institutions,
  windowDays,
  onDone,
  onError,
}: {
  campaignId: string;
  institutions: VouchableInstitution[];
  windowDays: number;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  // The docs/42 latch: a disabled attribute set in a state update does not
  // stop a second submit dispatched before that render lands.
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    onError(null);

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/v1/admin/campaigns/${campaignId}/vouch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institutionId: String(form.get('institutionId') ?? ''),
          representativeName: String(form.get('representativeName') ?? '').trim(),
          representativeRole: String(form.get('representativeRole') ?? '').trim(),
          representativeEmail: String(form.get('representativeEmail') ?? '').trim(),
          relationship: String(form.get('relationship') ?? '').trim(),
          statement: String(form.get('statement') ?? '').trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not record that vouch.');
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not record that vouch.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4 rounded-md border bg-muted/20 p-4">
      <label className="block">
        <span className="text-sm font-medium">Which organisation?</span>
        <select name="institutionId" required defaultValue="" className={fieldClass}>
          <option value="" disabled>
            Choose one
          </option>
          {institutions.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.country}) - {i.vouchesInWindow}/{i.monthlyVouchLimit} used in{' '}
              {windowDays} days
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium">Who told you?</span>
          <input name="representativeName" required minLength={2} maxLength={200} className={fieldClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Their role there</span>
          <input name="representativeRole" required minLength={2} maxLength={200} className={fieldClass} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Their email</span>
          <input name="representativeEmail" type="email" required maxLength={320} className={fieldClass} />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">How does the organisation know this family?</span>
        <textarea name="relationship" required minLength={10} maxLength={1000} rows={2} className={fieldClass} />
      </label>

      <label className="block">
        <span className="text-sm font-medium">What are they vouching for?</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          In their words, as close as you can.
        </span>
        <textarea name="statement" required minLength={20} maxLength={4000} rows={3} className={fieldClass} />
      </label>

      <button type="submit" disabled={submitting} className={buttonVariants({ size: 'sm' })}>
        {submitting ? 'Recording…' : 'Record vouch'}
      </button>
    </form>
  );
}

const fieldClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-ring';
