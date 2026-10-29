'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, CheckIcon, ErrorCircleIcon } from '@/components/ui/icon';
import { Money } from '@/components/ui/Money';
import { CURRENCIES } from '@/lib/money/currencies';
import { formatMoney, majorToMinor, minorToMajor } from '@/lib/money/format';

const SUPPORT_EMAIL = 'support@lastdonor.org';

/**
 * How often to ask whether the payment resolved.
 *
 * Five seconds, which is the interval M-Pesa integration guidance converges
 * on for a status poll when no callback has landed. Fast enough that a donor
 * who paid in three seconds is not left staring, slow enough that a
 * three-minute prompt costs around 36 requests - which is why the poll
 * endpoint has its own rate-limit tier (120/60s) instead of inheriting the
 * 10/60s donations tier that would have 429'd an honest donor mid-payment.
 */
const POLL_INTERVAL_MS = 5_000;

type Phase = 'form' | 'waiting' | 'succeeded' | 'failed';

interface Props {
  campaignId: string;
  campaignTitle: string;
  /**
   * Where "Back to …" goes when the payment finishes, or `null` when there is
   * nowhere to go back to.
   *
   * ⛔ This replaced a `campaignSlug` prop that two sites interpolated as
   * `` `/campaigns/${campaignSlug}` ``, which is the hand-written campaign
   * link `docs/118` forbids. It became load-bearing with `docs/147`: the
   * platform's general fund collects through this form and has **no public
   * campaign page**, so that template literal would have handed a donor a
   * 404 immediately after taking their money - the worst possible moment for
   * one.
   *
   * The CALLER decides, because the caller is what holds `status` and
   * `published_at` and can ask `publicCampaignPath`. A component's job is not
   * to decide what is publicly visible.
   */
  backTo: { href: string; label: string } | null;
  /** ISO 4217. The campaign decides it; this form only collects in it. */
  currency: string;
  onDonationComplete?: () => void;
}

/** Preset ladder, in major units of the campaign currency. */
function presetsFor(currency: string): number[] {
  /*
    KES: 2,000 / 1,000 / 500 / 200 / 100 / 50, descending.

    Descending for the anchoring reason `docs/72` settled on - and NOT because
    GoFundMe descends, which that doc withdrew after sampling found they A/B
    test the order. The ladder is in round shilling figures a Kenyan donor
    types into M-Pesa without thinking, and it bottoms out at the platform
    floor so the smallest tile is always payable.
  */
  if (currency === 'KES') return [2_000, 1_000, 500, 200, 100, 50];
  const def = CURRENCIES[currency];
  const floor = def ? minorToMajor(def.minDonationMinor, currency) : 5;
  return [floor * 40, floor * 20, floor * 10, floor * 4, floor * 2, floor];
}

export function MpesaDonationForm({
  campaignId,
  campaignTitle,
  backTo,
  currency,
  onDonationComplete,
}: Props) {
  const def = CURRENCIES[currency];
  const presets = presetsFor(currency);

  const [amountMajor, setAmountMajor] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [phone, setPhone] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [waitingSeconds, setWaitingSeconds] = useState(0);

  /*
    The same `useRef` latch `docs/42` put on the Stripe submit button. A
    double tap here is worse than a duplicate charge attempt: it is a second
    PIN prompt on the donor's handset, and two unanswered prompts are two of
    the ten that get their number blocked by PayHero for 24 hours. React state
    is not synchronous enough to stop the second click.
  */
  const submitting = useRef(false);

  const amountMinor = (() => {
    const n = Number(amountMajor);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return majorToMinor(n, currency);
  })();

  const withinBounds =
    def != null && amountMinor >= def.minDonationMinor && amountMinor <= def.maxDonationMinor;

  const canSubmit =
    phase === 'form' && withinBounds && phone.trim().length >= 7 && donorEmail.includes('@');

  // ── Polling ───────────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    if (!reference) return;
    try {
      const res = await fetch(
        `/api/v1/donations/payhero/status?reference=${encodeURIComponent(reference)}`,
        { cache: 'no-store' },
      );
      const body = await res.json();
      if (!body?.ok) return;

      const { state, keepPolling, message } = body.data as {
        state: Phase | 'abandoned';
        keepPolling: boolean;
        message: string | null;
      };

      if (state === 'succeeded') {
        setPhase('succeeded');
        onDonationComplete?.();
        return;
      }
      if (state === 'failed' || state === 'abandoned') {
        setPhase('failed');
        setStatusMessage(message ?? null);
        return;
      }
      if (!keepPolling) {
        /*
          Still pending, but the prompt can no longer be live. The donation is
          NOT called failed - the row stays pending server-side, because a
          prompt we never heard about is not a prompt known to have failed.
          The donor is told the truth and given somewhere to go.
        */
        setStatusMessage(message ?? null);
      }
    } catch {
      // A dropped poll is not evidence about the payment. Try again.
    }
  }, [reference, onDonationComplete]);

  useEffect(() => {
    if (phase !== 'waiting' || !reference) return;

    const tick = setInterval(() => setWaitingSeconds((s) => s + 1), 1_000);
    const poller = setInterval(poll, POLL_INTERVAL_MS);
    // Ask once immediately: a donor who approves in three seconds should not
    // wait five more to be told so.
    void poll();

    return () => {
      clearInterval(tick);
      clearInterval(poller);
    };
  }, [phase, reference, poll]);

  async function submit() {
    if (submitting.current || !canSubmit) return;
    submitting.current = true;
    setError(null);

    try {
      const res = await fetch('/api/v1/donations/payhero/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          amount: amountMinor,
          phone: phone.trim(),
          donorName: donorName.trim() || undefined,
          donorEmail: donorEmail.trim(),
          isAnonymous,
          subscribedToUpdates: false,
        }),
      });
      const body = await res.json();

      if (!res.ok || !body?.ok) {
        setError(
          body?.error?.message ??
            'We could not start that payment and nothing has been charged.',
        );
        submitting.current = false;
        return;
      }

      setReference(body.data.reference);
      setMaskedPhone(body.data.maskedPhone ?? null);
      setWaitingSeconds(0);
      setPhase('waiting');
    } catch {
      setError(
        'We could not reach our payment service and nothing has been charged. ' +
          'Please check your connection and try again.',
      );
      submitting.current = false;
    }
  }

  function retry() {
    submitting.current = false;
    setPhase('form');
    setReference(null);
    setStatusMessage(null);
    setError(null);
    setWaitingSeconds(0);
  }

  // ── Waiting ───────────────────────────────────────────────────────────────
  if (phase === 'waiting') {
    return (
      <div className="py-2 text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          {/*
            `ArrowPathIcon` spun, rather than a hand-drawn spinner. docs/70
            made the icon system the only source of marks and put two ratchets
            behind it; the first draft of this file hand-rolled three SVGs and
            the ratchet caught all three.
          */}
          <ArrowPathIcon className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>

        {/*
          The single most important sentence on this screen. The donor's
          attention has to move from this page to their handset, and nothing
          will happen until it does. Research on payment waits is consistent
          that the damage comes from not knowing whether to wait or walk away,
          so the instruction is first and the amount is restated with it.
        */}
        <h3 className="font-display text-2xl font-bold text-card-foreground">
          Check your phone
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          We sent an M-Pesa request for{' '}
          <strong className="text-foreground">
            {formatMoney(amountMinor, currency, 'exact')}
          </strong>
          {maskedPhone ? <> to {maskedPhone}</> : null}. Enter your M-Pesa PIN
          on your phone to confirm it.
        </p>

        {/*
          A visible, moving counter. Not a progress bar: a progress bar would
          be a lie, because we do not know how long the donor will take or how
          long the prompt lives. An elapsed count says "still working" without
          predicting anything.
        */}
        <p className="mt-4 text-xs tabular-nums text-muted-foreground">
          Waiting for your confirmation · {waitingSeconds}s
        </p>

        {statusMessage ? (
          <p className="mx-auto mt-4 max-w-md rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
            {statusMessage}
          </p>
        ) : (
          <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">
            No prompt? It can take a few seconds. Do not start another payment
            - that would send a second request to your phone. This page updates
            on its own.
          </p>
        )}

        <div className="mt-6">
          {/*
            There is always a way out of this screen. With no campaign page to
            return to (the general fund, `docs/147`), the browse listing is
            the honest destination - never a link built from a slug.
          */}
          <Link
            href={backTo?.href ?? '/campaigns'}
            className="btn-press inline-flex items-center justify-center rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            {backTo?.label ?? 'Browse campaigns'}
          </Link>
        </div>
      </div>
    );
  }

  // ── Succeeded ─────────────────────────────────────────────────────────────
  if (phase === 'succeeded') {
    return (
      <div className="py-2 text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CheckIcon className="h-8 w-8 text-primary" />
        </div>

        <h3 className="font-display text-2xl font-bold text-card-foreground">
          Thank you - your donation is in
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          You gave <strong className="text-foreground">{formatMoney(amountMinor, currency, 'exact')}</strong>{' '}
          to {campaignTitle}. Your M-Pesa confirmation message is your receipt,
          and we are sending one by email too.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {backTo && (
            <Link
              href={backTo.href}
              className="btn-press inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              {backTo.label}
            </Link>
          )}
          <Link
            href="/campaigns"
            className="btn-press inline-flex items-center justify-center rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            Browse campaigns
          </Link>
        </div>
      </div>
    );
  }

  // ── Failed ────────────────────────────────────────────────────────────────
  if (phase === 'failed') {
    return (
      <div className="py-2 text-center" role="alert">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <ErrorCircleIcon className="h-8 w-8 text-destructive" />
        </div>

        <h3 className="font-display text-2xl font-bold text-card-foreground">
          Your donation was not completed
        </h3>
        {/*
          Deliberately does not name a cause. PayHero reports a cancelled
          prompt, an expired prompt and insufficient funds all as the single
          value FAILED, so picking one would be inventing a reason the donor
          may know to be wrong - and being told the wrong reason is worse than
          being told none. The three ordinary causes are listed as
          possibilities instead.
        */}
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {statusMessage ??
            'The payment did not go through, so nothing has been charged and no donation was recorded.'}{' '}
          That usually means the prompt was cancelled, it timed out before the
          PIN was entered, or there was not enough in the M-Pesa balance.
        </p>
        <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
          You can try again, or email {SUPPORT_EMAIL} if it keeps failing.
        </p>

        <button
          type="button"
          onClick={retry}
          className="btn-press mt-6 inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── The form ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-lg font-bold text-card-foreground">
          Give with M-Pesa
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          You will get a prompt on your phone to enter your M-Pesa PIN.
        </p>
      </div>

      {/* Amount */}
      <fieldset>
        <legend className="text-sm font-semibold text-foreground">Amount</legend>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {presets.map((major) => {
            const active = selectedPreset === major;
            return (
              <button
                key={major}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSelectedPreset(major);
                  setAmountMajor(String(major));
                }}
                className={`btn-press rounded-xl border px-3 py-3 text-sm font-semibold tabular-nums transition-colors ${
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-foreground hover:bg-accent'
                }`}
              >
                <Money minor={majorToMinor(major, currency)} currency={currency} />
              </button>
            );
          })}
        </div>

        <label htmlFor="mpesa-amount" className="mt-4 block text-sm font-medium text-foreground">
          Or enter an amount
        </label>
        <input
          id="mpesa-amount"
          type="number"
          inputMode="numeric"
          min={def ? minorToMajor(def.minDonationMinor, currency) : undefined}
          max={def ? minorToMajor(def.maxDonationMinor, currency) : undefined}
          value={amountMajor}
          onChange={(e) => {
            setAmountMajor(e.target.value);
            setSelectedPreset(null);
          }}
          className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-base tabular-nums text-foreground"
          placeholder={def ? String(minorToMajor(def.minDonationMinor, currency)) : ''}
        />
        {amountMajor !== '' && !withinBounds && def ? (
          <p className="mt-2 text-xs text-destructive">
            Enter between {formatMoney(def.minDonationMinor, currency, 'exact')} and{' '}
            {formatMoney(def.maxDonationMinor, currency, 'exact')}.
          </p>
        ) : null}
      </fieldset>

      {/* Phone */}
      <div>
        <label htmlFor="mpesa-phone" className="block text-sm font-medium text-foreground">
          M-Pesa number
        </label>
        <input
          id="mpesa-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground"
          placeholder="0712 345 678"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          The number that will receive the PIN prompt.
        </p>
      </div>

      {/* Donor */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="mpesa-name" className="block text-sm font-medium text-foreground">
            Your name <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="mpesa-name"
            type="text"
            autoComplete="name"
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground"
          />
        </div>
        <div>
          <label htmlFor="mpesa-email" className="block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="mpesa-email"
            type="email"
            autoComplete="email"
            value={donorEmail}
            onChange={(e) => setDonorEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground"
            placeholder="you@example.com"
          />
          <p className="mt-1 text-xs text-muted-foreground">For your receipt.</p>
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm text-foreground">
        <input
          type="checkbox"
          checked={isAnonymous}
          onChange={(e) => setIsAnonymous(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border"
        />
        <span>Give anonymously</span>
      </label>

      {/*
        The fee ledger `docs/59` established, in this currency. The 0% line is
        the product's strongest claim and belongs directly above the pay
        button, where GoFundMe prints a 5% deduction. An unpayable figure
        renders as zero rather than restating a number the donor cannot give.
      */}
      <dl className="space-y-1.5 rounded-xl bg-muted px-4 py-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Your donation</dt>
          <dd className="font-medium tabular-nums text-foreground">
            <Money minor={withinBounds ? amountMinor : 0} currency={currency} precision="exact" />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">LastDonor platform fee</dt>
          <dd className="font-medium tabular-nums text-foreground">
            <Money minor={0} currency={currency} precision="exact" />
          </dd>
        </div>
        <div className="flex justify-between border-t border-border pt-1.5">
          <dt className="font-semibold text-foreground">Total charged today</dt>
          <dd className="font-semibold tabular-nums text-foreground">
            <Money minor={withinBounds ? amountMinor : 0} currency={currency} precision="exact" />
          </dd>
        </div>
      </dl>

      {error ? (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="btn-press w-full rounded-full bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {withinBounds ? (
          <>Send M-Pesa request for {formatMoney(amountMinor, currency, 'exact')}</>
        ) : (
          'Enter an amount to continue'
        )}
      </button>

      <p className="text-center text-xs text-muted-foreground">
        Your donation is protected. If a campaign is removed before funds are
        released, or fails verification after you give, you get your money
        back.
      </p>
    </div>
  );
}
