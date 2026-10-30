'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { PAYOUT_RAILS, PAYOUT_RAIL_LABELS } from '@/lib/validators/trust-network';
import { SUPPORTED_CURRENCY_CODES } from '@/lib/money/currencies';

/**
 * Screen A1 of `docs/113` §11: recording how an institution is paid.
 *
 * ⛔ This form creates the row that can send a grieving family's money to a
 * stranger. M-Pesa reversals are manual, slow and not guaranteed, and a
 * paybill typo that is still six digits passes every check we can write. So
 * the screen's job is not validation - it is making the admin say, in
 * writing, how a human confirmed the number.
 *
 * ⚠️ `confirmationNotes` is required by the schema AND by a database CHECK of
 * at least 10 characters. Both, because `docs/108` learned that a required
 * field enforced in only one place becomes optional the first time somebody
 * writes a different insert.
 */

interface Account {
  id: string;
  currency: string;
  rail: string;
  accountIdentifier: string;
  accountReferenceLabel: string;
  status: string;
  confirmationNotes: string;
  confirmedAt: string;
  retiredReason: string | null;
}

interface Props {
  institutionId: string;
  institutionName: string;
  institutionSuspended: boolean;
  accounts: Account[];
}

export function PayoutAccountsPanel({
  institutionId,
  institutionName,
  institutionSuspended,
  accounts,
}: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currency, setCurrency] = useState(SUPPORTED_CURRENCY_CODES[0] ?? 'KES');
  const [rail, setRail] = useState<string>(PAYOUT_RAILS[0]);
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [accountReferenceLabel, setAccountReferenceLabel] = useState('');
  const [confirmationNotes, setConfirmationNotes] = useState('');

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/institutions/${institutionId}/payout-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency,
          rail,
          accountIdentifier: accountIdentifier.trim(),
          accountReferenceLabel: accountReferenceLabel.trim(),
          confirmationNotes: confirmationNotes.trim(),
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!res.ok || !body.ok) {
        setError(body.error?.message ?? 'Could not save');
        return;
      }
      setAdding(false);
      setAccountIdentifier('');
      setAccountReferenceLabel('');
      setConfirmationNotes('');
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function retire(accountId: string) {
    const reason = window.prompt('Why is this account being retired? (at least 3 characters)');
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/institutions/${institutionId}/payout-accounts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, reason: reason.trim() }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!res.ok || !body.ok) setError(body.error?.message ?? 'Could not retire');
      else router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-l-4 border-destructive bg-destructive/5 p-4">
        <p className="text-sm font-semibold">
          This is the record that can send a family&apos;s money to a stranger
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          A wrong number is not recoverable by us. Confirm it with {institutionName} directly - on a
          number from an official invoice, not from a website or a message - and say below who you
          spoke to.
        </p>
      </div>

      {institutionSuspended && (
        <p className="rounded-lg bg-muted p-3 text-sm">
          This organisation is suspended, so no new payment account can be added.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!adding && !institutionSuspended && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={buttonVariants({ size: 'sm' })}
        >
          Add payment details
        </button>
      )}

      {adding && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Currency">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                {/*
                  Only currencies the platform can COLLECT (`docs/103`:
                  known is not collectable). A campaign's currency is
                  immutable once money arrives, so an account in a currency
                  nothing settles would strand it.
                */}
                {SUPPORTED_CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Rail">
              <select
                value={rail}
                onChange={(e) => setRail(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                {PAYOUT_RAILS.map((r) => (
                  <option key={r} value={r}>
                    {PAYOUT_RAIL_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Paybill or shortcode" hint="5 to 7 digits.">
              <input
                value={accountIdentifier}
                onChange={(e) => setAccountIdentifier(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm tabular-nums"
              />
            </Field>

            <Field
              label="What they call the reference"
              hint="Shown to the organiser word for word. A generic label is how somebody types the wrong number."
            >
              <input
                value={accountReferenceLabel}
                onChange={(e) => setAccountReferenceLabel(e.target.value)}
                placeholder="e.g. patient file number"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <Field
            label="How you confirmed this"
            hint="Required. Who you spoke to, on what number, and when."
          >
            <textarea
              value={confirmationNotes}
              onChange={(e) => setConfirmationNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </Field>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={create}
              className={buttonVariants({ size: 'sm' })}
            >
              {busy ? 'Saving…' : 'Save payment details'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAdding(false)}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border">
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['Destination', 'Reference label', 'Currency', 'How it was checked', ''].map((h, i) => (
                  <th
                    key={`${h}-${i}`}
                    className="whitespace-nowrap px-3 pb-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No payment details recorded. Nothing can be sent here.
                  </td>
                </tr>
              )}
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-3 tabular-nums">
                    {a.accountIdentifier}
                    <span className="block text-xs text-muted-foreground">
                      {PAYOUT_RAIL_LABELS[a.rail as keyof typeof PAYOUT_RAIL_LABELS] ?? a.rail}
                    </span>
                  </td>
                  <td className="px-3 py-3">{a.accountReferenceLabel}</td>
                  <td className="px-3 py-3">{a.currency}</td>
                  <td className="max-w-[22rem] px-3 py-3 text-xs text-muted-foreground">
                    {a.confirmationNotes}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {a.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => retire(a.id)}
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        Retire
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Retired{a.retiredReason ? ` - ${a.retiredReason}` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

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
      <span className="mb-1 block text-xs font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
