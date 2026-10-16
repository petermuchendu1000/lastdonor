'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import { DonationForm } from '@/components/campaign/DonationForm';
import type { DonationStep } from '@/components/campaign/DonationForm';
import { ProgressBar } from '@/components/campaign/ProgressBar';
import { centsToDollarsWhole } from '@/lib/utils/currency';
import { confirmDonation } from '@/lib/donations/confirm-client';
import type { DonationReturnState } from '@/lib/donations/verify-return';

interface DonatePageClientProps {
  campaignId: string;
  campaignSlug: string;
  campaignTitle: string;
  raisedAmount: number;
  goalAmount: number;
  donorCount: number;
  initialAmount?: number;
  /** What Stripe said about this return, decided on the server. See docs/42. */
  returnState?: DonationReturnState;
  /** Cents from Stripe. Only ever set alongside returnState 'succeeded'. */
  confirmedAmount?: number;
  sessionId?: string;
  paymentIntentId?: string;
  /** This donor's attributed share link. See docs/57. */
  attributedShareUrl?: string;
}

/** How a verified Stripe state is shown to the donor. */
function stepForState(
  state: DonationReturnState | undefined,
): Exclude<DonationStep, 'payment'> | undefined {
  switch (state) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'declined';
    case 'processing':
    case 'unverified':
      // Both render "we are confirming your payment". Unverified covers the
      // hand-typed `?donation=success` URL, which must never see a receipt.
      return 'pending';
    default:
      return undefined;
  }
}

/** Re-checks while a payment is still settling, then gives up and leaves the pending copy. */
const CONFIRM_ATTEMPTS = 3;
const CONFIRM_RETRY_MS = 2500;

export function DonatePageClient({
  campaignId,
  campaignSlug,
  campaignTitle,
  raisedAmount,
  goalAmount,
  donorCount,
  initialAmount,
  returnState,
  confirmedAmount: verifiedAmount,
  sessionId,
  paymentIntentId,
  attributedShareUrl,
}: DonatePageClientProps) {
  const router = useRouter();
  const confirmSent = useRef(false);
  const [state, setState] = useState<DonationReturnState | undefined>(returnState);
  const [confirmedAmount, setConfirmedAmount] = useState<number>(verifiedAmount ?? 0);

  // Hand the return leg to the confirm route, which records the donation
  // without waiting for the Stripe webhook (idempotently: the unique
  // stripe_payment_id index is the replay guard) and answers with what Stripe
  // currently says. A payment that has not settled yet is asked about again a
  // few times. The server is always the one deciding; the client never
  // promotes a payment on its own.
  useEffect(() => {
    if (confirmSent.current) return;
    if (!returnState || returnState === 'failed') return;
    if (!sessionId && !paymentIntentId) return;

    confirmSent.current = true;
    let cancelled = false;
    // The page already rendered a verified receipt. A later answer may add
    // nothing, but it must never take the receipt away.
    const alreadyVerified = returnState === 'succeeded';

    (async () => {
      for (let attempt = 0; attempt < CONFIRM_ATTEMPTS && !cancelled; attempt += 1) {
        const result = await confirmDonation({ campaignId, sessionId, paymentIntentId });
        if (cancelled) return;

        if (result.state === 'succeeded') {
          if (result.amountCents) setConfirmedAmount(result.amountCents);
          setState('succeeded');
          // Pull the campaign totals again now that the donation is recorded.
          router.refresh();
          return;
        }
        if (alreadyVerified) return;
        if (result.state === 'failed') {
          setState('failed');
          return;
        }
        if (attempt < CONFIRM_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, CONFIRM_RETRY_MS));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [returnState, sessionId, paymentIntentId, campaignId, router]);

  // Scrub the Stripe ids and any `donation=` flag off the address bar once the
  // outcome is settled, so the URL in the donor's history is not a receipt
  // someone can forward. A still-pending URL is left alone: a reload has to be
  // able to re-verify.
  useEffect(() => {
    if (state !== 'succeeded' && state !== 'failed') return;
    window.history.replaceState({}, '', window.location.pathname);
  }, [state]);

  /** Clamped: an over-funded campaign must not report a negative gap. */
  const remainingAmount = Math.max(0, goalAmount - raisedAmount);



  return (
    /*
      `data-checkout` suppresses the sitewide navbar and footer for this page
      (the `:has()` rule in globals.css). Measured 2026-10-16 at 390px, they
      were 1,095px of the page's 2,155px - more than half of it, all of it
      below the pay button, and 25 links competing with one action.
      GoFundMe's donate page carries neither.
    */
    <div data-checkout className="min-h-[100dvh] bg-muted/30">
      {/*
        The one bar this page gets, replacing both the sitewide navbar and
        the old back-only strip. Same two jobs GoFundMe's checkout header
        does: a way back to the fundraiser, and proof of whose site this is
        at the moment a card is about to be typed in.
      */}
      <nav className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-6 py-3">
          <Link
            href={`/campaigns/${campaignSlug}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
          >
            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
            Back to campaign
          </Link>
          <span className="font-display text-base font-bold tracking-tight text-foreground">
            Last<span className="text-primary">Donor</span>
            <span className="text-accent">.</span>
          </span>
        </div>
      </nav>

      {/* Main content */}
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-2xl border border-border bg-card shadow-[--shadow-elevation-2]">
          {/* Campaign context + Goal-Gradient progress strip.
              Shows users the campaign progress their donation will advance. */}
          <div className="border-b border-border px-8 pt-8 sm:px-10 sm:pt-10">
            <h1 className="font-display text-xl font-bold text-card-foreground sm:text-2xl">
              {campaignTitle}
            </h1>

            {/*
              What the top of a checkout screen says about progress.

              This block used to render, unconditionally, a $0 figure, an
              empty progress trough and "0 people have donated" - three
              separate statements of "nobody has given to this" on the one
              screen whose job is to ask for a gift. GoFundMe's donate page
              states the gap instead ("Still $4,725 to go.", verified live
              2026-10-16), which is the same arithmetic pointed forward.

              So: the remaining amount leads when there is progress to
              describe, and an unfunded campaign gets the invitation that
              docs/47 and docs/71 settled on everywhere else rather than a
              bar drawn at zero.
            */}
            <div className="mt-4 space-y-2">
              {raisedAmount === 0 ? (
                <>
                  <p className="text-sm font-semibold text-foreground">
                    Be the first to donate.
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {centsToDollarsWhole(goalAmount)} goal
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {remainingAmount > 0
                      ? `Still ${centsToDollarsWhole(remainingAmount)} to go.`
                      : `Goal reached - ${centsToDollarsWhole(raisedAmount)} raised.`}
                  </p>
                  <ProgressBar
                    raisedAmount={raisedAmount}
                    goalAmount={goalAmount}
                    compact
                  />
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {centsToDollarsWhole(raisedAmount)} of {centsToDollarsWhole(goalAmount)}
                    {' · '}
                    {donorCount.toLocaleString()} {donorCount === 1 ? 'donor' : 'donors'}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Donation form */}
          <div className="px-8 pb-8 pt-6 sm:px-10 sm:pb-10">
            <DonationForm
              campaignId={campaignId}
              campaignTitle={campaignTitle}
              campaignSlug={campaignSlug}
              embedded
              initialAmount={initialAmount}
              initialStep={stepForState(state)}
              initialConfirmedAmount={confirmedAmount}
              attributedShareUrl={attributedShareUrl}
              onDonationComplete={() => router.refresh()}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
