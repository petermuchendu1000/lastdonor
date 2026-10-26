'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { ListCount } from '@/components/admin/ListCount';
import { INSTITUTION_KINDS, INSTITUTION_KIND_LABELS } from '@/lib/validators/trust-network';
import { cn } from '@/lib/utils';

/**
 * Trusted organisations, and the one thing an admin needs to know about each.
 *
 * ── THE HIERARCHY THIS SCREEN IS BUILT ON ───────────────────────────────────
 *
 * An admin opens this screen to answer one of two questions: "is this
 * organisation allowed to verify campaigns right now?" and "how much of its
 * budget has it spent?". So a row leads with the name and the answer; the
 * registration number, the website and the notes are subordinate, and the
 * notes - which are a paragraph - are behind a disclosure rather than
 * flattening every row to the height of its longest note.
 *
 * The consequence of a row existing is stated ONCE, at the top of the screen,
 * in a sentence rather than as a warning banner on every row.
 */

export interface InstitutionRow {
  id: string;
  name: string;
  kind: string;
  country: string;
  website: string | null;
  registrationId: string | null;
  registrationVerifiedAt: string | null;
  status: string;
  verifiedAt: string;
  verificationNotes: string | null;
  monthlyVouchLimit: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  verifiedByEmail: string | null;
  liveVouches: number;
  vouchesInWindow: number;
}

interface Props {
  institutions: InstitutionRow[];
  loaded: number;
  total: number;
  windowDays: number;
}

/** `Intl` knows the country names; a 254-row table in the bundle would not. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function TrustedInstitutions({ institutions, loaded, total, windowDays }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const active = useMemo(() => institutions.filter((i) => i.status === 'active').length, [institutions]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/institutions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not save that change.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that change.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight">Trusted organisations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            An organisation here can verify a campaign by vouching for it, with no
            documents uploaded. That lifts the campaign&rsquo;s pre-verification raise
            cap. It does not release any money and it does not publish the campaign.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className={buttonVariants({ variant: adding ? 'outline' : 'default', size: 'sm' })}
        >
          {adding ? 'Cancel' : 'Add an organisation'}
        </button>
      </div>

      {adding && <AddInstitutionForm onDone={() => { setAdding(false); router.refresh(); }} />}

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Organisations" value={total} />
        <Tile label="Active" value={active} />
        <Tile label={`Vouches in ${windowDays} days`} value={institutions.reduce((n, i) => n + i.vouchesInWindow, 0)} />
      </div>

      {institutions.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="text-sm font-medium">No organisations yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add one once you have confirmed it exists and that the person who
            contacted you really works there.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-2">Organisation</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Registration</th>
                    <th className="px-4 py-2 text-right">Vouches</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {institutions.map((i) => (
                    <InstitutionTableRow
                      key={i.id}
                      institution={i}
                      windowDays={windowDays}
                      busy={busy === i.id}
                      onPatch={patch}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <ListCount
            from={1}
            to={institutions.length}
            shown={institutions.length}
            loaded={loaded}
            total={total}
            noun="organisations"
          />
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function InstitutionTableRow({
  institution: i,
  windowDays,
  busy,
  onPatch,
}: {
  institution: InstitutionRow;
  windowDays: number;
  busy: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const suspended = i.status === 'suspended';
  const spent = i.vouchesInWindow >= i.monthlyVouchLimit;

  return (
    <tr className="align-top hover:bg-muted/30">
      <td className="px-4 py-3">
        <p className="font-medium">{i.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {INSTITUTION_KIND_LABELS[i.kind as keyof typeof INSTITUTION_KIND_LABELS] ?? i.kind}
          {' · '}
          {countryName(i.country)}
        </p>
        {i.website && (
          <a
            href={i.website}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-0.5 inline-block text-xs underline underline-offset-2"
          >
            {i.website.replace(/^https?:\/\//, '')}
          </a>
        )}
        {i.verificationNotes && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              How it was checked
            </summary>
            <p className="mt-1 max-w-prose whitespace-pre-wrap text-xs text-muted-foreground">
              {i.verificationNotes}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Added {formatDate(i.verifiedAt)}
              {i.verifiedByEmail ? ` by ${i.verifiedByEmail}` : ''}
            </p>
          </details>
        )}
      </td>
      <td className="hidden px-4 py-3 sm:table-cell">
        {i.registrationId ? (
          <>
            <p className="font-mono text-xs">{i.registrationId}</p>
            {/*
              ⚠️ Said plainly, because the number alone reads as verified. The
              platform checks nothing about it unless somebody did and said so.
            */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {i.registrationVerifiedAt
                ? `Checked ${formatDate(i.registrationVerifiedAt)}`
                : 'Not checked - as stated by them'}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">None given</p>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <p className={cn('tabular-nums', spent && 'text-brand-amber')}>
          {i.vouchesInWindow} / {i.monthlyVouchLimit}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          in {windowDays} days
          {i.liveVouches !== i.vouchesInWindow && ` · ${i.liveVouches} live`}
        </p>
      </td>
      <td className="px-4 py-3">
        <Badge variant={suspended ? 'destructive' : 'default'}>
          {suspended ? 'Suspended' : 'Active'}
        </Badge>
        {suspended && i.suspendedReason && (
          <p className="mt-1 max-w-[18rem] text-xs text-muted-foreground">{i.suspendedReason}</p>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex flex-col items-end gap-1">
          {suspended ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onPatch(i.id, { status: 'active' })}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Reactivate
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Why is it suspended? (at least 5 characters)');
                if (!reason || reason.trim().length < 5) return;
                onPatch(i.id, { status: 'suspended', suspendedReason: reason.trim() });
              }}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Suspend
            </button>
          )}
          {/*
            `docs/113` §11 screen A1. A separate screen because recording a
            payee is a separate decision from trusting a voucher - and a
            route nobody can click is a route that does not exist
            (`docs/83`).
          */}
          <Link
            href={`/admin/institutions/${i.id}/payout-accounts`}
            className="whitespace-nowrap text-xs text-muted-foreground underline underline-offset-2"
          >
            Payment details
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const raw = window.prompt(
                `Vouches allowed per ${windowDays} days`,
                String(i.monthlyVouchLimit),
              );
              if (raw === null) return;
              const n = Number(raw.trim());
              if (!Number.isInteger(n) || n < 0 || n > 1000) return;
              onPatch(i.id, { monthlyVouchLimit: n });
            }}
            className="whitespace-nowrap text-xs text-muted-foreground underline underline-offset-2"
          >
            Change limit
          </button>
          {i.registrationId && !i.registrationVerifiedAt && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onPatch(i.id, { registrationVerified: true })}
              className="whitespace-nowrap text-xs text-muted-foreground underline underline-offset-2"
            >
              Mark registration checked
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function AddInstitutionForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  /*
    A `useRef` latch rather than the `submitting` state alone, for the reason
    docs/42 records about the donate form: a disabled attribute set in a React
    state update does not stop a second submit dispatched before that render
    lands, and a double submit here means a duplicate organisation.
  */
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const limit = String(form.get('monthlyVouchLimit') ?? '').trim();
    const website = String(form.get('website') ?? '').trim();
    const registrationId = String(form.get('registrationId') ?? '').trim();

    try {
      const res = await fetch('/api/v1/admin/institutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? '').trim(),
          kind: String(form.get('kind') ?? ''),
          country: String(form.get('country') ?? '').trim().toUpperCase(),
          verificationNotes: String(form.get('verificationNotes') ?? '').trim(),
          ...(website ? { website } : {}),
          ...(registrationId ? { registrationId } : {}),
          ...(limit ? { monthlyVouchLimit: Number(limit) } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not add that organisation.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that organisation.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="As the organisation writes it.">
          <input name="name" required minLength={2} maxLength={200} className={inputClass} />
        </Field>
        <Field label="Kind">
          <select name="kind" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choose one
            </option>
            {INSTITUTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {INSTITUTION_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Country" hint="Two-letter code, such as KE or US.">
          <input
            name="country"
            required
            maxLength={2}
            pattern="[A-Za-z]{2}"
            className={cn(inputClass, 'uppercase')}
          />
        </Field>
        <Field label="Vouches per 30 days" hint="Leave blank for 10.">
          <input name="monthlyVouchLimit" type="number" min={0} max={1000} className={inputClass} />
        </Field>
        <Field label="Website" hint="Optional.">
          <input name="website" type="url" placeholder="https://" className={inputClass} />
        </Field>
        <Field label="Registration number" hint="Optional. Recorded as they state it.">
          <input name="registrationId" maxLength={100} className={inputClass} />
        </Field>
      </div>

      <Field
        label="How did you confirm this organisation is real?"
        hint="Required. Say what you did: who you called, which register you looked in. The next admin reads this."
      >
        <textarea
          name="verificationNotes"
          required
          minLength={20}
          maxLength={2000}
          rows={3}
          className={inputClass}
        />
      </Field>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button type="submit" disabled={submitting} className={buttonVariants({ size: 'sm' })}>
        {submitting ? 'Adding…' : 'Add organisation'}
      </button>
    </form>
  );
}

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-ring';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
