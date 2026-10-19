import Link from 'next/link';

/**
 * Where your money goes: the fee claim, as a worked example.
 *
 * ## Why this was rebuilt (2026-10-16, docs/59)
 *
 * The previous version had four problems, three of them visible on the live
 * homepage and one of them a false claim:
 *
 *  1. A missing space rendered "...fees apply.Operations are funded...". The
 *     `<br className="hidden md:block" />` between two sentences supplied the
 *     gap on desktop and nothing at all on mobile.
 *  2. The donut animated to a COMPLETE ring and put "0%" in its middle. A
 *     full ring reads as 100%, and it was drawn in the same teal the legend
 *     used for "Campaign Support" - so it asserted "100% goes to the
 *     campaign" directly above body text explaining that Stripe takes a cut.
 *     Two different metrics in one graphic, one of them untrue.
 *  3. On a 390px screen the section ran 1,383px for 90 words. An 85px
 *     right-aligned value column forced "Your donation" and "Stripe fee" to
 *     wrap, and the CTA was aligned to it with a hardcoded `pl-[109px]`.
 *  4. The donut - the only visual - sat BELOW the call to action, so a phone
 *     user met the button before the point it was meant to make.
 *
 * ## What replaced it
 *
 * A ledger with real money in it. "$50.00 in, $1.75 to Stripe, $0.00 to us,
 * $48.25 to the campaign" answers the donor's actual question, which is not
 * "what percentage" but "how much of mine arrives". The $0.00 line is the
 * whole competitive claim and it needs no chart.
 *
 * 2.9% + $0.30 is Stripe's published US rate and is already stated in
 * `ShareYourStoryForm`; this reuses that existing claim rather than
 * introducing a new one. The figures are computed below, not typed, so the
 * arithmetic cannot drift from the rate.
 *
 * ## Why this section inverts
 *
 * It is the only band on the homepage that does. GoFundMe reserves the same
 * device for their trust block ("GoFundMe is a trusted leader...", a dark
 * green full-bleed band) and it is the most memorable thing on their page.
 * Ours previously used `bg-surface-amber`, the same cream as its neighbours,
 * which made the product's single strongest differentiator visually
 * indistinguishable from the FAQ.
 *
 * Server component on purpose: the old one was `'use client'` and pulled in
 * framer-motion to fade in three list items. See docs/49 on what motion
 * wrappers cost on this page.
 */

/** Stripe's published US rate, already claimed in the campaign-creation flow. */
const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED_CENTS = 30;
/** The example gift. Round, typical, and large enough that the fee is legible. */
const EXAMPLE_CENTS = 5000;

const processingCents = Math.round(EXAMPLE_CENTS * STRIPE_PERCENT) + STRIPE_FIXED_CENTS;
const toCampaignCents = EXAMPLE_CENTS - processingCents;

const usd = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface LedgerRow {
  label: string;
  note: string;
  amount: string;
  /** The row that carries the claim. Rendered in the brand accent. */
  emphasis?: 'zero' | 'total';
}

const ROWS: LedgerRow[] = [
  {
    label: 'Payment processing',
    note: 'Stripe’s rate on a US card (2.9% + $0.30). We never receive any part of it.',
    amount: `− ${usd(processingCents)}`,
  },
  {
    label: 'LastDonor platform fee',
    note: 'No platform cut. No tip request added to your donation.',
    amount: `− ${usd(0)}`,
    emphasis: 'zero',
  },
];

export function WhereYourMoneyGoes() {
  return (
    <section className="bg-surface-ink py-16 text-white sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        {/*
          Three children, placed explicitly, so one DOM order serves both
          layouts. On a phone this is a plain flex column and reads
          heading -> ledger -> link; on desktop the ledger moves to its own
          column and the link sits back under the copy.

          The link MUST come after the ledger on mobile. The version this
          replaced put the donut below the call to action, so a phone user met
          the button before the point it was meant to make - and the first
          rewrite reproduced the same mistake with the link above the ledger.
        */}
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-x-16 lg:gap-y-6">
          {/* ── The claim ─────────────────────────────────────────────── */}
          <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
            <span className="inline-flex rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-white/90">
              0% platform fee
            </span>

            <h2 className="mt-5 text-balance font-display text-[2.1rem] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[2.75rem]">
              Where your money goes
            </h2>

            {/*
              One sentence. The old copy spent 54 words explaining how the
              organisation is funded, which is a question nobody asks while
              deciding whether to give; it lives on /how-it-works, one tap away.
            */}
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-white/75">
              We take nothing from a fundraiser donation. The only deduction is
              what the card networks charge to move the money.
            </p>
          </div>

          {/* ── The ledger ────────────────────────────────────────────── */}
          <div className="rounded-2xl bg-white/[0.07] p-5 ring-1 ring-inset ring-white/10 sm:p-7 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-center">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium text-white/70">
                If you give
              </span>
              <span className="font-sans text-[1.75rem] font-bold tabular-nums leading-none sm:text-[2rem]">
                {usd(EXAMPLE_CENTS)}
              </span>
            </div>

            <ul className="mt-5 space-y-4 border-t border-white/10 pt-5">
              {ROWS.map((row) => (
                <li key={row.label} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p
                      className={
                        row.emphasis === 'zero'
                          ? 'text-[15px] font-bold text-white'
                          : 'text-[15px] font-semibold text-white/90'
                      }
                    >
                      {row.label}
                    </p>
                    <p className="mt-1 text-[13px] leading-snug text-white/60">
                      {row.note}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-sans text-base font-bold tabular-nums ${
                      row.emphasis === 'zero' ? 'text-brand-live' : 'text-white/80'
                    }`}
                  >
                    {row.amount}
                  </span>
                </li>
              ))}
            </ul>

            {/*
              The answer to the question the donor actually asked. Given its
              own weight because every row above it exists to arrive here.
            */}
            <div className="mt-5 flex items-baseline justify-between gap-4 border-t border-white/20 pt-5">
              <span className="text-[15px] font-bold">Reaches the campaign</span>
              <span className="font-sans text-[1.75rem] font-bold tabular-nums leading-none text-brand-live sm:text-[2rem]">
                {usd(toCampaignCents)}
              </span>
            </div>

            {/*
              white/65, not white/50. Measured against the CARD background
              (bg-white/[0.07] over the ink band), not against the band: at
              white/50 this 12px line is 4.36:1 in light mode and 4.20:1 in
              dark, both below the WCAG AA 4.5:1 floor. At white/65 it is
              6.18:1 and 5.88:1. Do not lower it.
            */}
            <p className="mt-4 text-[12px] leading-snug text-white/65">
              Processing is deducted by Stripe, not by LastDonor. Recurring
              gifts carry no extra platform charge.
            </p>
          </div>

          {/* Third child: under the copy on desktop, after the ledger on mobile. */}
          <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-1.5 text-[15px] font-bold text-white underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-white"
            >
              See the full breakdown
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
