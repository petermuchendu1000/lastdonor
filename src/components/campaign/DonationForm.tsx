'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { ReviewedIcon } from '@/components/ui/icon';
import { centsToDollars, centsToDollarsWhole, dollarsToCents } from '@/lib/utils/currency';
import { CURRENCIES } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';
import { cn } from '@/lib/utils';
import { onRadioGroupKeyDown, rovingTabIndex } from '@/lib/radio-group-keys';
import { motion } from 'motion/react';
import { confirmDonation } from '@/lib/donations/confirm-client';

const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/**
 * `loadStripe('')` does not fail quietly: Stripe.js throws "Please call
 * Stripe() with your publishable key", the returned promise rejects, and the
 * payment step renders an empty box with no explanation. The Docker build
 * defaults this variable to the empty string (`Dockerfile:95`), so an image
 * built without it ships exactly that. Keep the promise null instead and say
 * so where it matters.
 */
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

/** The screens this form can show. */
export type DonationStep = 'details' | 'payment' | 'pending' | 'declined' | 'success';

/*
  ── WHY THIS FORM IS LEGITIMATELY IN DOLLARS, AND WHAT GUARDS THAT ──────────

  `src/app/campaigns/[slug]/donate/client.tsx:248` picks the form by GATEWAY:
  `getCurrency(currency).gateway === 'payhero'` renders `MpesaDonationForm`
  (which reads bounds and symbols from the currency registry), and everything
  else renders this one. `CURRENCIES` holds exactly two entries - USD on
  `stripe`, KES on `payhero` (`src/lib/money/currencies.ts`) - so every
  campaign that reaches THIS form is a dollar campaign, and its preset ladder,
  impact hints and `$` copy are correct rather than merely unnoticed.

  ⛔ That is true by construction TODAY and silently false the moment a third
  collectable currency lands on Stripe: a euro campaign would render this
  dollar ladder with no error anywhere - the shape of defect `docs/112`
  records ("the only non-USD campaign is archived, so no reader has seen it
  yet"). `donation-form-usd-premise.test.ts` fails the build at that moment,
  so the rewrite happens when the currency is added and not after somebody
  reports euros priced as dollars.

  The bounds are READ from the registry rather than re-declared, so they
  cannot drift from the validator that enforces them server-side.
*/
const MIN_DONATION_CENTS = CURRENCIES.USD.minDonationMinor;
const MAX_DONATION_CENTS = CURRENCIES.USD.maxDonationMinor;

const SUPPORT_EMAIL = 'support@lastdonor.org';

// Client-side validation schema (mirrors server-side createIntentSchema)
const donationFormSchema = z.object({
  amount: z
    .number({ invalid_type_error: 'Enter a valid amount' })
    .int()
    .min(MIN_DONATION_CENTS, `Minimum donation is ${formatMoney(MIN_DONATION_CENTS, 'USD', 'exact')}`)
    .max(MAX_DONATION_CENTS, `Maximum donation is ${formatMoney(MAX_DONATION_CENTS, 'USD')}`),
  donorName: z.string().max(100).optional(),
  donorEmail: z.string().email('Enter a valid email'),
  donorLocation: z.string().max(100).optional(),
  message: z.string().max(500).optional(),
  isAnonymous: z.boolean(),
  isRecurring: z.boolean(),
});

type DonationFormValues = z.infer<typeof donationFormSchema>;

/**
 * DonationForm: Primary conversion component.
 *
 * Design principles:
 * 1. ONE focal point per step (amount → payment → confirmation)
 * 2. Impact messaging on preset amounts ("$50 = 3 meals")
 * 3. Social proof integrated ("Secured by Stripe", "0% platform fees")
 * 4. Reduced fields visible initially (email only, rest collapsed)
 * 5. Large touch targets (48px min) for mobile
 * 6. Instant visual feedback on selection
 * 7. Clear, human error messages
 */

/**
 * Presets in cents, highest first.
 *
 * CORRECTED 2026-10-16. This comment previously justified the descending
 * order as mirroring GoFundMe, "observed on 2026-10-15 offering $1,000 /
 * $500 / $350 / $100 / $50 in descending order". Re-measured on their live
 * donate form today, five loads of the same campaign: FOUR served
 * $25 / $50 / $100 / $200 / $300 / $500 ascending with $100 badged, and ONE
 * served $300 / $200 / $100 / $50 / $25 / $10 descending with $50 badged.
 * They are A/B testing both the order and the badge, so "GoFundMe does it"
 * cannot justify anything here - whatever we copy, half their traffic sees
 * the opposite.
 *
 * The order stays descending on the anchoring argument alone, which is the
 * only part of the original reasoning that survives: leading with the
 * largest figure anchors the choice set upward. Still unmeasured by us, and
 * still the A/B test this form most needs.
 * See `docs/47-MONEY-TYPOGRAPHY-AND-ZERO-STATE-ADR.md` and `docs/72`.
 */
const PRESET_AMOUNTS = [100000, 50000, 25000, 10000, 5000, 2500] as const; // cents

// Impact labels make abstract dollar amounts concrete
const IMPACT_HINTS: Record<number, string> = {
  2500: 'Covers a day of meals',
  5000: 'Week of groceries',
  10000: 'Critical supplies',
  25000: 'Major expense',
  50000: 'Significant support',
  100000: 'Game-changing gift',
};

/**
 * The preset carrying the "Suggested" badge.
 *
 * GoFundMe badges exactly one tile ("💚 SUGGESTED", verified live on their
 * donate form 2026-10-16) and, importantly, does NOT pre-select it: their
 * running total still reads $0.00 on arrival. Mirrored deliberately. A badge
 * is a recommendation the donor can ignore in one tap; a pre-filled amount is
 * money chosen on their behalf by a form they have not read yet.
 *
 * $100 is the figure their dominant arm badges - four of five loads sampled
 * today, the fifth badging $50 (see PRESET_AMOUNTS above on their A/B test).
 * That is a weak basis, and it is the only external one available: this
 * platform has recorded no donations, so there is no mode of our own to
 * derive. Hence the word "Suggested", which is a recommendation we are
 * making. Nothing here implies other donors chose it, because none have.
 */
const SUGGESTED_AMOUNT = 10000;

interface DonationFormProps {
  campaignId: string;
  campaignTitle: string;
  className?: string;
  /** Campaign slug for post-donation navigation (omit for general fund) */
  campaignSlug?: string;
  /** This donor's attributed share link, minted server-side. See docs/57. */
  attributedShareUrl?: string;
  /** When true, strips card wrapper (border/bg/padding) for use inside Dialog */
  embedded?: boolean;
  /** Pre-select an amount in cents when the form mounts */
  initialAmount?: number;
  /**
   * Start the form on a specific screen after the Stripe return leg. The
   * caller must have had this verified server-side ('success' is a receipt);
   * the form never decides it from the URL. See docs/42.
   */
  initialStep?: Exclude<DonationStep, 'payment'>;
  /** Cents, from Stripe. Only meaningful with initialStep='success'. */
  initialConfirmedAmount?: number;
  /** Called when a donation completes successfully */
  onDonationComplete?: () => void;
}

/* ─────────────────────────────────────────────
   Step 2 - Stripe Embedded Checkout
   ───────────────────────────────────────────── */

function CheckoutStep({
  clientSecret,
  onComplete,
  onBack,
}: {
  clientSecret: string;
  onComplete: () => void;
  onBack: () => void;
}) {
  if (!stripePromise) {
    // Honest dead end instead of a blank frame. The donor can still reach a
    // human, and the missing build variable is named for whoever is on call.
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
          <p className="text-sm font-semibold text-foreground">
            Card payments are unavailable right now.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This is a problem on our side, not with your card, and nothing has been charged.
            Please try again later or email {SUPPORT_EMAIL} so we can help you give.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="mx-auto block text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          &larr; Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{
          clientSecret,
          onComplete,
        }}
      >
        <EmbeddedCheckout className="min-h-[300px]" />
      </EmbeddedCheckoutProvider>

      <button
        type="button"
        onClick={onBack}
        className="mx-auto block text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        &larr; Back
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Step 3 - Success confirmation
   ───────────────────────────────────────────── */

function SuccessStep({ amount, campaignTitle, campaignSlug, embedded, attributedShareUrl }: { amount: number; campaignTitle: string; campaignSlug?: string; embedded?: boolean; attributedShareUrl?: string }) {
  /*
   * Prefer this donor's own attributed link. Sharing the plain campaign URL
   * is the thing docs/30 §1 says is explicitly NOT parity: nothing it
   * produces can be counted, so an organizer can never see which supporter
   * actually reached anyone. Falls back to the plain URL when no link could
   * be minted, because a share that cannot be attributed still beats no
   * share. See docs/57.
   */
  const shareUrl = attributedShareUrl
    ?? (campaignSlug
      ? (typeof window !== 'undefined'
          ? `${window.location.origin}/campaigns/${campaignSlug}`
          : `https://lastdonor.org/campaigns/${campaignSlug}`)
      : '');

  const shareText = `I just donated to ${campaignTitle} on LastDonor - join me.`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="py-2 text-center"
    >
      {/* Peak moment: spring-scale checkmark with a soft halo ring. */}
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.1 }}
        className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10"
      >
        <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-primary/10" aria-hidden="true" />
        <svg className="relative h-10 w-10 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </motion.div>

      <motion.h3
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.25 }}
        className="font-display text-2xl font-bold text-card-foreground"
      >
        Thank you.
      </motion.h3>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32, duration: 0.25 }}
        className="mx-auto mt-2 max-w-md text-sm text-muted-foreground"
      >
        Your{amount >= 500 ? <> <span className="font-semibold text-foreground">{centsToDollars(amount)}</span></> : null} donation to{' '}
        <span className="font-medium text-foreground">{campaignTitle}</span> is on its way.
      </motion.p>
      {/* Substantiated: `processPaymentSuccess` fires `sendDonationReceipt`
          (src/lib/services/payment-service.ts) for every donation row it
          inserts, from "receipts@lastdonor.org" with subject
          "Donation Receipt - <campaign title>". It is sent best-effort and a
          signed-in donor who turned `emailDonationReceipts` off gets none, so
          the copy promises a send and not an arrival. This step is only
          reached when Stripe itself reported the payment as succeeded. */}
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        A receipt is on its way to the email address you gave us.
      </p>

      {/* Reciprocity amplification: encourage one share. Each share, on average,
          brings additional donors - framed as "multiplying impact" not begging. */}
      {campaignSlug && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.3 }}
          className="mx-auto mt-6 max-w-md rounded-xl border border-border bg-muted/40 p-4 text-left"
        >
          <p className="text-sm font-semibold text-card-foreground">
            Multiply your impact
          </p>
          {/*
            Was "One share brings an average of two new donors." That number
            appears in no document, no analysis and no data source in this
            repository - it was invented. On a platform whose CLAUDE.md says
            never to add a claim it cannot substantiate, and which already
            had a forged-attribution incident (docs/36), a fabricated
            conversion statistic shown to a donor who has just paid is not a
            small thing. Replaced with what is actually true: the link is
            theirs and the campaign can see it worked.
          */}
          <p className="mt-1 text-xs text-muted-foreground">
            {attributedShareUrl
              ? 'This link is yours. Anyone who gives through it is credited to you.'
              : 'Share it anywhere:'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-press inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-4 py-1.5 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5"
            >
              WhatsApp
            </a>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-press inline-flex items-center gap-1.5 rounded-full bg-[#1877F2] px-4 py-1.5 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5"
            >
              Facebook
            </a>
            <a
              href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-press inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background transition-transform hover:-translate-y-0.5"
            >
              X
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(campaignTitle)}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`}
              className="btn-press inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-1.5 text-xs font-semibold text-foreground transition-transform hover:-translate-y-0.5"
            >
              Email
            </a>
          </div>
        </motion.div>
      )}

      {!embedded && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.3 }}
          className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center"
        >
          {campaignSlug ? (
            <>
              <Link
                href={`/campaigns/${campaignSlug}`}
                className="btn-press inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Back to Campaign
              </Link>
              <Link
                href="/campaigns"
                className="btn-press inline-flex items-center justify-center rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                Browse Campaigns
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/campaigns"
                className="btn-press inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Browse Campaigns
              </Link>
              <Link
                href="/"
                className="btn-press inline-flex items-center justify-center rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                Return Home
              </Link>
            </>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

/* ─────────────────────────────────────────────
   Return leg - payment not yet verified
   ───────────────────────────────────────────── */

/**
 * Shown whenever the platform cannot prove the money moved: Stripe says the
 * PaymentIntent is still processing, Stripe could not be reached, or the ids in
 * the URL mean nothing (the hand-typed `?donation=success` case). It states
 * what is and is not known and never names an amount.
 */
function PendingStep({ campaignSlug }: { campaignSlug?: string }) {
  return (
    <div className="py-2 text-center" role="status" aria-live="polite">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <svg className="h-7 w-7 animate-spin text-muted-foreground" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>

      <h3 className="font-display text-2xl font-bold text-card-foreground">
        We are confirming your payment
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        We have not been able to confirm this payment with our payment
        processor yet, so we are not showing a receipt. If your card was
        charged, your donation is recorded and a receipt follows by email.
      </p>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
        Nothing is charged twice by reloading this page. If you see no receipt
        within an hour, email {SUPPORT_EMAIL} and we will check it for you.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        {campaignSlug && (
          <Link
            href={`/campaigns/${campaignSlug}`}
            className="btn-press inline-flex items-center justify-center rounded-full border border-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            Back to campaign
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

/**
 * Shown when Stripe says the payment did not happen: declined, cancelled or
 * abandoned. Previously this returned the donor to an empty form with no
 * acknowledgement at all.
 */
function DeclinedStep({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-2 text-center" role="alert">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <svg className="h-8 w-8 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>

      <h3 className="font-display text-2xl font-bold text-card-foreground">
        Your donation was not completed
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        The payment was cancelled or declined, so you have not been charged and
        no donation was recorded. Card issuers decline for ordinary reasons:
        an expired card, a daily limit, or a fraud check on a new recipient.
      </p>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
        You can try again with the same or a different card, or email{' '}
        {SUPPORT_EMAIL} if it keeps failing.
      </p>

      <button
        type="button"
        onClick={onRetry}
        className="btn-press mt-6 inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main DonationForm - Step 1 (donor info + amount)
   ───────────────────────────────────────────── */

export function DonationForm({
  campaignId,
  campaignTitle,
  className,
  campaignSlug,
  embedded,
  initialAmount,
  initialStep,
  initialConfirmedAmount,
  onDonationComplete,
  attributedShareUrl,
}: DonationFormProps) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(() => {
    if (initialAmount && (PRESET_AMOUNTS as readonly number[]).includes(initialAmount)) return initialAmount;
    return null;
  });
  const [customAmount, setCustomAmount] = useState(() => {
    if (initialAmount && initialAmount > 0) {
      return (initialAmount / 100).toFixed(2);
    }
    return '';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [step, setStep] = useState<DonationStep>(initialStep ?? 'details');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [confirmedAmount, setConfirmedAmount] = useState(initialConfirmedAmount ?? 0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * Single-flight latch for the submit handler.
   *
   * `isSubmitting` cannot do this job: it is React state, so three clicks
   * dispatched inside one task all read the pre-render value and all three
   * fired a create-checkout POST (measured: 3 requests). A ref is written
   * synchronously, so the second click sees the latch the first one set
   * regardless of how React batches the re-render.
   */
  const submitInFlight = useRef(false);

  // The old sessionStorage recovery lived here: it read back the amount this
  // browser had written before paying and displayed it as the confirmed
  // figure. Removed deliberately. A receipt amount comes from Stripe or it is
  // not shown (docs/42).

  // Follow the caller: the donate page re-checks a processing payment through
  // the confirm route and raises the state when Stripe settles it.
  useEffect(() => {
    if (initialStep) setStep(initialStep);
  }, [initialStep]);

  useEffect(() => {
    if (initialConfirmedAmount && initialConfirmedAmount > 0) {
      setConfirmedAmount(initialConfirmedAmount);
    }
  }, [initialConfirmedAmount]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DonationFormValues>({
    resolver: zodResolver(donationFormSchema),
    defaultValues: {
      amount: initialAmount ?? 0,
      donorName: '',
      donorEmail: '',
      donorLocation: '',
      message: '',
      isAnonymous: false,
      isRecurring: false,
    },
  });

  const messageValue = watch('message') ?? '';
  const isAnonymous = watch('isAnonymous');
  const isRecurring = watch('isRecurring');
  const currentAmount = watch('amount');
  /** An amount the API would accept, so the CTA never quotes an impossible figure. */
  const amountIsPayable =
    Number.isInteger(currentAmount) &&
    currentAmount >= MIN_DONATION_CENTS &&
    currentAmount <= MAX_DONATION_CENTS;

  /*
    What the ledger shows. Only a figure this form would actually submit:
    an out-of-range entry already has its own error beside the input and its
    own button copy, and quoting "Total charged today $999,999,999.00" next
    to "the maximum is $100,000" was the exact defect the button copy below
    was fixed for. Anything unpayable reads as zero.
  */
  const ledgerAmount = amountIsPayable ? currentAmount : 0;

  const handlePresetSelect = useCallback((amountCents: number) => {
    setSelectedPreset(amountCents);
    setCustomAmount((amountCents / 100).toFixed(2));
    setValue('amount', amountCents, { shouldValidate: true });
  }, [setValue]);

  const handleCustomAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomAmount(val);
    // Deselect preset only if the typed value differs
    const dollars = parseFloat(val);
    const cents = !isNaN(dollars) && dollars > 0 ? dollarsToCents(dollars) : 0;
    if (cents !== selectedPreset) setSelectedPreset(null);
    setValue('amount', cents, { shouldValidate: true });
  }, [setValue, selectedPreset]);

  // Listen for amount selection from ImpactTiers via CustomEvent
  useEffect(() => {
    function handleDonationAmount(e: Event) {
      const amountCents = (e as CustomEvent<number>).detail;
      const matchesPreset = (PRESET_AMOUNTS as readonly number[]).includes(amountCents);
      if (matchesPreset) {
        setSelectedPreset(amountCents);
        setCustomAmount('');
      } else {
        setSelectedPreset(null);
        setCustomAmount((amountCents / 100).toString());
      }
      setValue('amount', amountCents, { shouldValidate: true });
    }

    window.addEventListener('donation-amount', handleDonationAmount);
    return () => window.removeEventListener('donation-amount', handleDonationAmount);
  }, [setValue]);

  /**
   * Put the failure in front of the donor.
   *
   * Inline and synchronous first: it needs no network, it is what a screen
   * reader announces, and it survives a failed chunk fetch. The toast is a
   * bonus, so its dynamic import is no longer allowed to swallow the only
   * signal the donor gets - that is how a declined submit came to render
   * nothing at all.
   */
  const showSubmitError = useCallback((message: string) => {
    setSubmitError(message);
    import('sonner')
      .then(({ toast }) => toast.error(message))
      .catch(() => {});
  }, []);

  async function onSubmit(data: DonationFormValues) {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/v1/donations/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          amount: data.amount,
          donorName: data.donorName || undefined,
          donorEmail: data.donorEmail,
          donorLocation: data.donorLocation || undefined,
          message: data.message || undefined,
          isAnonymous: data.isAnonymous,
          isRecurring: data.isRecurring,
        }),
      });

      const json = await res.json().catch(() => null);

      // The API answers validation failures with a specific, field-tagged
      // message ("Minimum donation is $5.00", "Enter a valid email address").
      // Show the donor what it said.
      if (!json?.ok) {
        showSubmitError(
          typeof json?.error?.message === 'string' && json.error.message
            ? json.error.message
            : 'Something went wrong. Please try again.',
        );
        return;
      }

      const secret = json.data?.clientSecret;
      if (typeof secret !== 'string' || !secret) {
        showSubmitError('We could not open the payment form. Please try again.');
        return;
      }

      setClientSecret(secret);
      setCheckoutSessionId(typeof json.data?.sessionId === 'string' ? json.data.sessionId : null);
      // No amount is recorded here. The confirmed figure comes from Stripe
      // once the payment is verified, never from what was typed (docs/42).
      setStep('payment');
    } catch {
      showSubmitError('Network error. Please check your connection and try again.');
    } finally {
      submitInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  // Wrapper container - embedded mode strips card chrome for page use
  const wrapperClass = embedded
    ? cn('space-y-5', className)
    : cn('space-y-5 rounded-xl border border-border bg-card p-6', className);

  /* ── Success state (only ever reached from a Stripe-verified payment) ── */
  if (step === 'success') {
    return (
      <div className={wrapperClass}>
        <SuccessStep amount={confirmedAmount} campaignTitle={campaignTitle} campaignSlug={campaignSlug} embedded={embedded} attributedShareUrl={attributedShareUrl} />
      </div>
    );
  }

  /* ── Payment taken but not verified ── */
  if (step === 'pending') {
    return (
      <div className={wrapperClass}>
        <PendingStep campaignSlug={campaignSlug} />
      </div>
    );
  }

  /* ── Declined, cancelled or abandoned ── */
  if (step === 'declined') {
    return (
      <div className={wrapperClass}>
        <DeclinedStep
          onRetry={() => {
            setStep('details');
            setClientSecret(null);
            setCheckoutSessionId(null);
            setConfirmedAmount(0);
          }}
        />
      </div>
    );
  }

  /* ── Payment state (Stripe Embedded Checkout) ── */
  if (step === 'payment' && clientSecret) {
    return (
      <div className={wrapperClass}>
        <CheckoutStep
          clientSecret={clientSecret}
          onComplete={() => {
            // Stripe finished its part. That is not proof the money moved, so
            // hold the donor on the pending screen and ask our server, which
            // asks Stripe (docs/42).
            setStep('pending');
            onDonationComplete?.();
            confirmDonation({ campaignId, sessionId: checkoutSessionId ?? undefined })
              .then((result) => {
                if (result.state === 'succeeded') {
                  if (result.amountCents) setConfirmedAmount(result.amountCents);
                  setStep('success');
                } else if (result.state === 'failed') {
                  setStep('declined');
                }
              })
              .catch(() => {});
          }}
          onBack={() => {
            setStep('details');
            setClientSecret(null);
            setCheckoutSessionId(null);
          }}
        />
      </div>
    );
  }

  /* ── Details form (Step 1) ── */
  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit(onSubmit)}
      className={wrapperClass}
      noValidate
    >
      {!embedded && (
        <h3 className="font-display text-lg font-semibold text-card-foreground">
          Make a Donation
        </h3>
      )}

      {/*
        Frequency toggle - Give Once / Monthly.

        `onKeyDown` and the roving `tabIndex` are what make `role="radiogroup"`
        true rather than decorative: a radio group is one tab stop with arrow
        keys inside it, and this one had neither. See `src/lib/radio-group-keys.ts`.
      */}
      <div
        className="flex rounded-full border border-border bg-muted/50 p-1"
        role="radiogroup"
        aria-label="Donation frequency"
        onKeyDown={onRadioGroupKeyDown}
      >
        <button
          type="button"
          role="radio"
          aria-checked={!isRecurring}
          // One of the two is ALWAYS checked here, so no first-option
          // fallback is needed: `anySelected` is unconditionally true.
          tabIndex={!isRecurring ? 0 : -1}
          onClick={() => setValue('isRecurring', false)}
          className={cn(
            'flex-1 rounded-full py-2.5 text-center text-sm font-medium transition-colors',
            !isRecurring
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-card-foreground',
          )}
        >
          Give Once
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={isRecurring}
          tabIndex={isRecurring ? 0 : -1}
          onClick={() => setValue('isRecurring', true)}
          className={cn(
            'flex-1 rounded-full py-2.5 text-center text-sm font-medium transition-colors',
            isRecurring
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-card-foreground',
          )}
        >
          Monthly
        </button>
      </div>

      {/* Preset amounts with impact hints */}
      <div
        className="grid grid-cols-3 gap-2.5"
        role="radiogroup"
        aria-label="Donation amount"
        onKeyDown={onRadioGroupKeyDown}
      >
        {PRESET_AMOUNTS.map((amount, i) => (
          <motion.button
            key={amount}
            type="button"
            role="radio"
            aria-checked={selectedPreset === amount}
            /*
              Roving, so the amounts are ONE tab stop instead of nine.
              `selectedPreset` starts null on purpose - no amount is
              pre-chosen - so the first tile holds the tab stop until a
              choice is made, or the group would be unreachable.
            */
            tabIndex={rovingTabIndex({
              isSelected: selectedPreset === amount,
              isFirst: i === 0,
              anySelected: selectedPreset !== null,
            })}
            /*
              Without this the accessible name concatenates the two child
              spans into "$50Week of groceries", which a screen reader reads
              as one run-on token.
            */
            aria-label={
              amount === SUGGESTED_AMOUNT
                ? `${centsToDollarsWhole(amount)}, ${IMPACT_HINTS[amount]}, suggested`
                : `${centsToDollarsWhole(amount)}, ${IMPACT_HINTS[amount]}`
            }
            onClick={() => handlePresetSelect(amount)}
            whileTap={{ scale: 0.95 }}
            className={cn(
              /*
                `relative` + `pb-5` on EVERY tile, so the badge below can be
                taken out of flow and still have room.

                Measured live after the badge first shipped: row one was 77px
                and row two 97px, because only the badged tile carried an
                extra line. Two rows of amount buttons at visibly different
                heights reads as a layout fault, and GoFundMe's six tiles are
                uniform. Reserving the space everywhere makes them 85px each -
                4px SHORTER in total than the mismatched version.
              */
              'group/amt relative flex flex-col items-center rounded-xl border px-2 pb-5 pt-3 text-center transition-all duration-200',
              selectedPreset === amount
                ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20'
                : 'border-border text-card-foreground hover:border-primary/40 hover:bg-muted/50',
            )}
          >
            <span className="text-base font-bold tabular-nums">
              {centsToDollarsWhole(amount)}
            </span>
            <span className={cn(
              'mt-0.5 text-[10px] leading-tight',
              selectedPreset === amount ? 'text-primary-foreground/70' : 'text-muted-foreground',
            )}>
              {IMPACT_HINTS[amount]}
            </span>
            {amount === SUGGESTED_AMOUNT && (
              <span
                className={cn(
                  'absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide',
                  selectedPreset === amount
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-primary/10 text-primary',
                )}
              >
                Suggested
              </span>
            )}
          </motion.button>
        ))}
      </div>

      {/* Custom amount */}
      <div>
        <label htmlFor="custom-amount" className="block text-sm font-medium text-muted-foreground">
          Custom amount
        </label>
        <div className="relative mt-1.5">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base font-medium text-muted-foreground">
            $
          </span>
          <input
            id="custom-amount"
            type="number"
            min="5"
            max="100000"
            step="0.01"
            placeholder="0.00"
            value={customAmount}
            onChange={handleCustomAmountChange}
            className="w-full rounded-lg border border-input bg-background py-3 pl-8 pr-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            aria-describedby={errors.amount ? 'amount-error' : undefined}
          />
        </div>
        {errors.amount && (
          <p id="amount-error" className="mt-1 text-sm text-destructive" role="alert">
            {errors.amount.message}
          </p>
        )}
      </div>

      {/* Donor email - always visible (required) */}
      <div>
        <label htmlFor="donor-email" className="block text-sm font-medium text-muted-foreground">
          Email address
        </label>
        <input
          id="donor-email"
          type="email"
          {...register('donorEmail')}
          className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          aria-describedby={errors.donorEmail ? 'email-error' : undefined}
        />
        {errors.donorEmail && (
          <p id="email-error" className="mt-1 text-sm text-destructive" role="alert">
            {errors.donorEmail.message}
          </p>
        )}
      </div>

      {/* Collapsible donation options */}
      <div className="rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setOptionsOpen(!optionsOpen)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-card-foreground hover:bg-muted/50 transition-colors"
          aria-expanded={optionsOpen}
          aria-controls="donation-options"
        >
          Add a message or dedicate your gift
          <svg
            className={cn('h-4 w-4 text-muted-foreground transition-transform', optionsOpen && 'rotate-180')}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {optionsOpen && (
          <div id="donation-options" className="space-y-4 border-t border-border px-4 pb-4 pt-3">
            {/* Donor name (optional) */}
            <div>
              <label htmlFor="donor-name" className="block text-sm font-medium text-card-foreground">
                Your name <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="donor-name"
                type="text"
                {...register('donorName')}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            {/* Donor location (optional) */}
            <div>
              <label htmlFor="donor-location" className="block text-sm font-medium text-card-foreground">
                Location <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="donor-location"
                type="text"
                placeholder="City, State"
                {...register('donorLocation')}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            {/* Message (optional) */}
            <div>
              <label htmlFor="donor-message" className="block text-sm font-medium text-card-foreground">
                Message <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="donor-message"
                rows={3}
                maxLength={500}
                {...register('message')}
                className="mt-1 w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                aria-describedby="message-counter"
              />
              <p id="message-counter" className="mt-1 text-right text-xs text-muted-foreground">
                {messageValue.length}/500
              </p>
            </div>

            {/* Anonymous toggle */}
            <div className="flex items-center justify-between">
              <label htmlFor="anonymous-toggle" className="text-sm text-card-foreground">
                Donate anonymously
              </label>
              <Switch
                id="anonymous-toggle"
                checked={isAnonymous}
                onCheckedChange={(checked) => setValue('isAnonymous', checked)}
              />
            </div>
          </div>
        )}
      </div>

      {/*
        The running total, directly above the pay button.

        GoFundMe's donate form carries this same ledger and, on the monthly
        tab, its middle line reads "Recurring fee (5%)" (verified live
        2026-10-16). Ours reads $0.00, which is the single strongest thing
        this product can say and was previously said only as three words of
        11px grey text under the button.

        The figures are the donor's own arithmetic, not a claim: total equals
        donation because nothing is added to the card. Stripe's cut is named
        in the note rather than shown as a row - it is real, but it is taken
        out of the payout, so putting it in a column headed "charged today"
        would misstate what the card is debited.
      */}
      <dl className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Your donation</dt>
          <dd className="font-medium tabular-nums text-card-foreground">
            {centsToDollars(ledgerAmount)}
          </dd>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">LastDonor platform fee</dt>
          <dd className="font-semibold tabular-nums text-primary">{centsToDollars(0)}</dd>
        </div>
        <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
          <dt className="font-semibold text-card-foreground">
            {isRecurring ? 'Total charged monthly' : 'Total charged today'}
          </dt>
          <dd className="font-bold tabular-nums text-card-foreground">
            {centsToDollars(ledgerAmount)}
          </dd>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Stripe&rsquo;s processing fee (2.9% + $0.30) comes out of the payout, not your
          card. LastDonor takes no cut and adds no tip request.
        </p>
      </dl>

      {/* Whatever the server said, in the page. Not only in a toast. */}
      {submitError && (
        <p
          id="donation-submit-error"
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {submitError}
        </p>
      )}

      {/* Submit -- dominant CTA with state feedback */}
      <motion.button
        type="submit"
        disabled={isSubmitting || !amountIsPayable}
        aria-busy={isSubmitting}
        aria-describedby={submitError ? 'donation-submit-error' : undefined}
        whileTap={{ scale: 0.97 }}
        className={cn(
          'btn-press w-full rounded-full py-4 text-base font-bold shadow-sm transition-all duration-200',
          amountIsPayable
            ? 'bg-brand-amber text-white hover:shadow-[--shadow-amber] hover:-translate-y-0.5'
            : 'bg-primary text-primary-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none',
        )}
      >
        {isSubmitting ? (
          <span className="inline-flex items-center justify-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Processing...
          </span>
        ) : amountIsPayable ? (
          // Only ever quote an amount this form will actually submit. It used
          // to read "Donate $999,999,999.00" directly above the error saying
          // the maximum is $100,000.
          `Donate ${centsToDollars(currentAmount)}`
        ) : currentAmount > MAX_DONATION_CENTS ? (
          `Enter an amount up to ${centsToDollars(MAX_DONATION_CENTS)}`
        ) : (
          'Select an amount to donate'
        )}
      </motion.button>

      {/* Trust signals -- directly below CTA to reduce payment anxiety */}
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Secured by Stripe
          </span>
          <span className="h-3 w-px bg-border" aria-hidden="true" />
          <span>Reviewed campaign</span>
          <span className="h-3 w-px bg-border" aria-hidden="true" />
          <span>0% platform fees</span>
        </div>
        <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
          By continuing, you agree to the{' '}
          <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms
          </Link>
          ,{' '}
          <Link href="/refund-policy" className="underline underline-offset-2 hover:text-foreground">
            Refund Policy
          </Link>
          , and{' '}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
          . Monthly donations can be cancelled before the next billing date.
        </p>
      </div>

      {/*
        The closing block GoFundMe's donate page ends on ("GoFundMe protects
        your donation - we guarantee you a full refund for up to a year in
        the rare case that fraud occurs", verified live 2026-10-16).

        Ours states only what `/refund-policy` actually commits us to, and it
        deliberately carries NO time window: that page sets no outer bound
        and inventing "up to a year" to match theirs would be a refund
        promise the platform has not made. Each clause below is one of the
        listed situations in which a refund is available.
      */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <ReviewedIcon size="lg" className="mt-0.5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-card-foreground">
            Your donation is protected
          </p>
          {/*
            This sentence was removed on 2026-10-17 and restored the same
            day, which is the whole story of docs/77 -> docs/79.

            It came out because it was false: both creation paths inserted
            `status: 'active'` and nothing was read before publication. It
            is back because both paths now insert `status: 'under_review'`
            and a person approves - user submissions in docs/78, the news
            generator in docs/79. The claim is substantiated by the code,
            not by the marketing copy that used to assert it.

            If either gate is ever removed, this sentence goes with it.
          */}
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Every campaign is reviewed by a person before it goes live. If a charge is
            unauthorised, a campaign is removed before funds are released, or it fails
            verification after you give, we refund donors.{' '}
            <Link href="/refund-policy" className="underline underline-offset-2 hover:text-foreground">
              Refund Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </form>
  );
}

