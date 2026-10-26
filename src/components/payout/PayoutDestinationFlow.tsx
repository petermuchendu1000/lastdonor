'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button, buttonVariants } from '@/components/ui/button';
import { INSTITUTION_KIND_LABELS } from '@/lib/validators/trust-network';

/**
 * Screens B1-B4 of `docs/113` §11.
 *
 * ── WHY NATIVE RADIOS ───────────────────────────────────────────────────────
 *
 * `docs/100`: seven hand-rolled `role="radiogroup"`s in this codebase claimed
 * a behaviour none of them implemented, and the rule it landed on is to use a
 * native `<input type="radio">` when the options are a list of labels. These
 * are. Native radios get arrow keys, one tab stop and screen-reader
 * announcement for free, and none of it can rot.
 *
 * ── THE TWO THINGS THIS SCREEN MUST GET RIGHT ───────────────────────────────
 *
 * 1. The organiser understands they will NOT receive the money (B4). It is
 *    the only screen where that is said, and once money moves it cannot be
 *    undone.
 * 2. The bill number is typed twice (B3). The paybill was checked by an
 *    admin; this number was not and cannot be. A right paybill with a wrong
 *    reference pays a stranger's bill at the right hospital.
 */

interface Account {
  id: string;
  institutionName: string;
  institutionKind: string;
  country: string;
  accountReferenceLabel: string;
}

interface Existing {
  institutionName: string;
  accountReference: string;
  accountReferenceLabel: string;
  locked: boolean;
}

interface Props {
  campaignId: string;
  campaignTitle: string;
  subjectName: string;
  canDesignate: boolean;
  existing: Existing | null;
  accounts: Account[];
}

type Step = 'offer' | 'choose' | 'reference' | 'confirm';

export function PayoutDestinationFlow({
  campaignId,
  campaignTitle,
  subjectName,
  canDesignate,
  existing,
  accounts,
}: Props) {
  const router = useRouter();
  const groupName = useId();

  const [step, setStep] = useState<Step>('offer');
  const [accountId, setAccountId] = useState<string>('');
  const [reference, setReference] = useState('');
  const [reference2, setReference2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const referencesMatch = reference.trim().length > 0 && reference.trim() === reference2.trim();

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/user-campaigns/${campaignId}/payout-designation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payoutAccountId: accountId, accountReference: reference.trim() }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!res.ok || !body.ok) {
        setError(body.error?.message ?? 'Something went wrong. Please try again.');
        return;
      }
      router.refresh();
      router.push('/dashboard/campaigns?destination=set');
    } catch {
      setError('We could not reach LastDonor. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function removeChoice() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/user-campaigns/${campaignId}/payout-designation`, {
        method: 'DELETE',
      });
      const body = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!res.ok || !body.ok) {
        setError(body.error?.message ?? 'Something went wrong. Please try again.');
        return;
      }
      router.refresh();
    } catch {
      setError('We could not reach LastDonor. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  // ── Already chosen ────────────────────────────────────────────────────────
  if (existing) {
    return (
      <Shell title="Where the money goes" campaignTitle={campaignTitle}>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-semibold">We send this money to {existing.institutionName}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {existing.accountReferenceLabel}: {existing.accountReference}
          </p>
        </div>

        {existing.locked ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Money has already gone to {existing.institutionName}, so this cannot be changed. Email{' '}
            <a className="underline" href="mailto:support@lastdonor.org">
              support@lastdonor.org
            </a>{' '}
            if something is wrong.
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm text-muted-foreground">
              You can change this until the first payment leaves.
            </p>
            <Button variant="outline" className="mt-3" onClick={removeChoice} disabled={busy}>
              {busy ? 'Working…' : 'Pay it to me instead'}
            </Button>
          </>
        )}
        {error && <Problem>{error}</Problem>}
      </Shell>
    );
  }

  if (!canDesignate) {
    return (
      <Shell title="Where the money goes" campaignTitle={campaignTitle}>
        <p className="text-sm text-muted-foreground">
          This campaign is closed, so you cannot change where its money goes.
        </p>
      </Shell>
    );
  }

  // ── B1: the offer ─────────────────────────────────────────────────────────
  if (step === 'offer') {
    return (
      <Shell title={`Send the money straight to where ${subjectName} is being helped?`} campaignTitle={campaignTitle}>
        <p className="text-sm text-muted-foreground">
          You can have what people give sent directly to the hospital, funeral home or school,
          instead of to you. Many donors trust this more.
        </p>
        <p className="mt-3 text-sm font-semibold">
          If you choose it, you will not receive this money yourself.
        </p>

        {accounts.length === 0 ? (
          <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
            <p className="text-sm">
              We do not yet have a checked account for anywhere that takes this kind of money.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Email <a className="underline" href="mailto:support@lastdonor.org">support@lastdonor.org</a>{' '}
              with the name of the place and we will look into it.
            </p>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <Button onClick={() => setStep('choose')}>Choose where to send it</Button>
            <Link
              href="/dashboard/campaigns"
              className={buttonVariants({ variant: 'outline' })}
            >
              Keep it paid to me
            </Link>
          </div>
        )}
      </Shell>
    );
  }

  // ── B2: pick the institution ──────────────────────────────────────────────
  if (step === 'choose') {
    return (
      <Shell title="Where is the money going?" campaignTitle={campaignTitle} step={2}>
        <p className="text-sm text-muted-foreground">
          We can only send money to places we have checked ourselves.
        </p>

        <fieldset className="mt-5">
          <legend className="sr-only">Choose a place</legend>
          <div className="flex flex-col gap-2">
            {accounts.map((a) => (
              <label
                key={a.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                  accountId === a.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
                }`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={a.id}
                  checked={accountId === a.id}
                  onChange={() => setAccountId(a.id)}
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-sm font-semibold">{a.institutionName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {INSTITUTION_KIND_LABELS[a.institutionKind as keyof typeof INSTITUTION_KIND_LABELS] ??
                      a.institutionKind}{' '}
                    · {a.country}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    We checked that this account belongs to them.
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="mt-4 text-xs text-muted-foreground">
          Not on the list? Email{' '}
          <a className="underline" href="mailto:support@lastdonor.org">support@lastdonor.org</a>. We
          check every place ourselves, so nobody can add one.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Button disabled={!account} onClick={() => setStep('reference')}>
            Continue
          </Button>
          <Button variant="outline" onClick={() => setStep('offer')}>
            Go back
          </Button>
        </div>
      </Shell>
    );
  }

  // ── B3: the bill number ───────────────────────────────────────────────────
  if (step === 'reference' && account) {
    return (
      <Shell title={`What is ${subjectName}'s bill number?`} campaignTitle={campaignTitle} step={3}>
        <p className="text-sm text-muted-foreground">
          {account.institutionName} asks for the <strong>{account.accountReferenceLabel}</strong>.
          You will find it on any bill they gave you.
        </p>

        <div className="mt-5">
          <label className="block text-xs font-semibold" htmlFor="ref-1">
            {account.accountReferenceLabel}
          </label>
          <input
            id="ref-1"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            autoComplete="off"
          />
        </div>

        <div className="mt-4">
          <label className="block text-xs font-semibold" htmlFor="ref-2">
            Type it again
          </label>
          <input
            id="ref-2"
            value={reference2}
            onChange={(e) => setReference2(e.target.value)}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            We ask twice because we cannot get this money back if it goes to the wrong bill.
          </p>
          {reference2.length > 0 && !referencesMatch && (
            <p className="mt-1 text-xs font-semibold text-destructive">
              These two do not match yet.
            </p>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            We will send to
          </p>
          <p className="mt-1 text-sm font-semibold">{account.institutionName}</p>
          {referencesMatch && (
            <p className="text-sm text-muted-foreground">
              {account.accountReferenceLabel}: {reference.trim()}
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <Button disabled={!referencesMatch} onClick={() => setStep('confirm')}>
            Continue
          </Button>
          <Button variant="outline" onClick={() => setStep('choose')}>
            Go back
          </Button>
        </div>
      </Shell>
    );
  }

  // ── B4: what they give up ─────────────────────────────────────────────────
  if (step === 'confirm' && account) {
    return (
      <Shell title="Read this before you agree" campaignTitle={campaignTitle} step={4}>
        <ul className="mt-2 flex flex-col gap-3">
          <Point title="You will not get this money">
            Everything people give goes to {account.institutionName}, to the{' '}
            {account.accountReferenceLabel.toLowerCase()} you typed. It will not reach your own
            account at any point.
          </Point>
          <Point title="You cannot change it once we have sent money">
            You can change this until the first payment leaves. After that it stays.
          </Point>
          <Point title="We still need to see your ID">
            Sending to {account.institutionName} does not replace the ID check. We still check who
            you are before any money moves.
          </Point>
        </ul>

        {error && <Problem>{error}</Problem>}

        <div className="mt-6 flex flex-col gap-3">
          {/*
            ⚠️ `h-auto whitespace-normal py-3`: the shared button style sets
            `whitespace-nowrap`, and this label carries an institution name
            of unbounded length. At 390px "Kenyatta National Hospital" made
            the primary action CLIP ON BOTH SIDES and read
            "understand - send it to Kenyatta National Hospita". Found by
            screenshotting the real flow on a phone viewport.
          */}
          <Button
            onClick={submit}
            disabled={busy}
            className="h-auto whitespace-normal py-3 leading-snug"
          >
            {busy ? 'Saving…' : `I understand - send it to ${account.institutionName}`}
          </Button>
          <Button variant="outline" onClick={() => setStep('reference')} disabled={busy}>
            Go back
          </Button>
        </div>
      </Shell>
    );
  }

  return null;
}

function Shell({
  title,
  campaignTitle,
  step,
  children,
}: {
  title: string;
  campaignTitle: string;
  step?: number;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      {step && (
        <div className="mb-4 flex items-center gap-1.5" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-border'}`}
            />
          ))}
        </div>
      )}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {campaignTitle}
      </p>
      <h1 className="mt-1 font-serif text-2xl leading-tight">{title}</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-border p-4">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </li>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
      {children}
    </p>
  );
}
