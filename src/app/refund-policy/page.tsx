import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { CURRENCIES, SUPPORTED_CURRENCY_CODES } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';

/**
 * The per-transaction donation limits, DERIVED rather than written as prose.
 *
 * This list used to read "The minimum donation is $5.00 and the maximum is
 * $100,000.00 per transaction" - correct for USD, and wrong for KES, whose
 * real bounds are 5,000 and 25,000,000 minor units. Since `docs/118` §10 an
 * organiser chooses the campaign's currency, so a single-currency sentence on
 * a policy page is a statement that is false for every other currency.
 *
 * Derived from `CURRENCIES`, which is the set money can actually be collected
 * in (`docs/103`: KNOWN is not COLLECTABLE), so a third collectable currency
 * appears here the day it is added. `docs/136` §7's lesson: the one string
 * written as prose is the one that goes stale.
 */
const DONATION_LIMITS = SUPPORTED_CURRENCY_CODES.map((code) => {
  const def = CURRENCIES[code];
  return {
    code,
    min: formatMoney(def.minDonationMinor, code, 'exact'),
    max: formatMoney(def.maxDonationMinor, code, 'exact'),
  };
});

export const metadata: Metadata = {
  title: 'Refund, Cancellation, and Dispute Policy',
  description:
    'How LastDonor handles donation refunds, recurring donation cancellations, duplicate charges, campaign removals, and payment disputes.',
  alternates: { canonical: 'https://lastdonor.org/refund-policy' },
  openGraph: {
    title: 'Refund, Cancellation, and Dispute Policy | LastDonor.org',
    description:
      'Clear rules for donation refunds, recurring donation cancellations, duplicate charges, campaign removals, and disputes.',
    images: [
      {
        url: '/api/v1/og/page?title=Refund+Policy&subtitle=Clear+rules+for+donations%2C+cancellations%2C+and+disputes.',
        width: 1200,
        height: 630,
        alt: 'Refund Policy at LastDonor.org',
      },
    ],
  },
};

export default function RefundPolicyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
        Refund, Cancellation, and Dispute Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: April 27, 2026
      </p>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        LastDonor accepts donations, not purchases of goods or services. There
        is no shipping, delivery, return window, or product warranty. This
        policy explains when a donation may be refunded and how donors can cancel
        recurring donations.
      </p>

      <div className="mt-10 space-y-9 text-muted-foreground">
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Donation Payments
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>
              Donations are charged in the currency the campaign collects in. A
              campaign has one currency, and the donation form states it before
              you pay.
            </li>
            <li>
              Per-transaction limits depend on that currency:{' '}
              {DONATION_LIMITS.map((l, i) => (
                <span key={l.code}>
                  {i > 0 ? '; ' : ''}
                  {l.code} {l.min} to {l.max}
                </span>
              ))}
              .
            </li>
            <li>
              Payment details are handled by the payment provider for that
              currency, and LastDonor does not store full card numbers or
              mobile money PINs. Card payments are processed by Stripe, and
              M-Pesa payments by PayHero.
            </li>
            <li>LastDonor charges 0% platform fees on fundraisers, and no processing fee is deducted from a donation.</li>
            <li>Donor names and donation amounts may appear publicly unless the donor selects anonymous.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            When Refunds Are Available
          </h2>
          <p className="mt-3 leading-relaxed">
            Donations are generally final after processing, but we review refund
            requests in the following situations:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>An unauthorized or fraudulent transaction is reported.</li>
            <li>A technical issue creates a duplicate charge or wrong donation amount.</li>
            <li>A campaign is cancelled, suspended, or removed before funds are released.</li>
            <li>A campaign fails required verification after donors have contributed.</li>
            <li>A compliance, sanctions, payment network, or legal requirement requires a refund.</li>
            <li>LastDonor determines that refunding donors is the fairest outcome for a campaign.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            When Refunds May Not Be Available
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>A donor changes their mind after funds have already been released to a verified campaign recipient.</li>
            <li>The campaign remains active, accurate, and eligible under LastDonor policies.</li>
            <li>The refund request is submitted after card network or payment processor deadlines.</li>
            <li>The donation was part of a recurring subscription period that already processed and funded a campaign.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            How To Request a Refund
          </h2>
          <p className="mt-3 leading-relaxed">
            Email{' '}
            <a href="mailto:support@lastdonor.org" className="text-primary underline underline-offset-4">
              support@lastdonor.org
            </a>{' '}
            within 30 days of the donation when possible. Include the donor
            email address, donation date, campaign name, amount, and a short
            explanation. We usually review refund requests within 5 business
            days. If approved, the refund is submitted through Stripe and may
            take 5 to 10 business days to appear on the original payment method.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Recurring Donation Cancellations
          </h2>
          <p className="mt-3 leading-relaxed">
            Monthly donations can be cancelled at any time before the next billing
            date. Donors can manage subscriptions from their account when
            available or email{' '}
            <a href="mailto:support@lastdonor.org" className="text-primary underline underline-offset-4">
              support@lastdonor.org
            </a>
            . Cancellation stops future charges; it does not automatically refund
            past donations.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Payment Disputes
          </h2>
          <p className="mt-3 leading-relaxed">
            If something looks wrong, contact us before filing a card dispute so
            we can investigate quickly. If a dispute is opened through a bank or
            card issuer, Stripe and the payment network may request transaction,
            donation, and campaign records from LastDonor. We cooperate with
            legitimate dispute investigations and may pause a campaign while the
            issue is reviewed.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Related Policies
          </h2>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href="/fund-release-policy" className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted">
              Fund Release Policy
            </Link>
            <Link href="/campaign-verification-policy" className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted">
              Campaign Verification Policy
            </Link>
            <Link href="/campaign-rules" className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted">
              Campaign Rules
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
