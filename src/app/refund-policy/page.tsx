import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Refund, Cancellation, and Dispute Policy',
  description:
    'What happens when you ask for a refund, cancel a monthly donation, or dispute a charge on LastDonor.',
  alternates: { canonical: 'https://lastdonor.org/refund-policy' },
  openGraph: {
    title: 'Refund, Cancellation, and Dispute Policy | LastDonor.org',
    description:
      'Clear rules for refunds, monthly cancellations, and card disputes.',
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
        When you give on LastDonor, you make a donation. You are not buying a
        product or a service. So there is nothing to ship, nothing to deliver,
        no return window, and no warranty. This page explains when we may refund
        a donation. It also explains how to stop a monthly donation.
      </p>

      <div className="mt-10 space-y-9 text-muted-foreground">
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            How donation payments work
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>We charge donations in US dollars.</li>
            <li>The smallest donation is $5.00. The largest is $100,000.00 per payment.</li>
            <li>Stripe handles your card details securely. We do not store your full card number.</li>
            <li>
              We take 0%. Stripe charges 2.9% plus 30 cents on a US card. 
              payment. On a $50 donation that is $1.75, so the campaign gets
              $48.25.
            </li>
            <li>Your name and the amount you gave may show in public. They do not if you choose to give anonymously.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            When refunds are possible
          </h2>
          <p className="mt-3 leading-relaxed">
            A donation is usually final once it goes through. We do review
            refund requests in these cases:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>A charge is reported as unauthorized or fraudulent.</li>
            <li>A technical problem charges you twice, or charges the wrong amount.</li>
            <li>A campaign is cancelled, suspended, or removed before the money is released.</li>
            <li>A campaign fails a required verification check after donors have given.</li>
            <li>A rule requires a refund. That can be a compliance rule, a sanctions rule, a payment network rule, or the law.</li>
            <li>We decide that refunding donors is the fairest outcome for a campaign.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            When refunds may not be possible
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>You change your mind after the money has already gone to a verified campaign recipient.</li>
            <li>The campaign is still active, still accurate, and still allowed under our rules.</li>
            <li>You ask after the deadline set by the card network or the payment processor.</li>
            <li>The donation was part of a monthly subscription period that already went through and funded a campaign.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            How to ask for a refund
          </h2>
          <p className="mt-3 leading-relaxed">
            Email{' '}
            <a href="mailto:support@lastdonor.org" className="text-primary underline underline-offset-4">
              support@lastdonor.org
            </a>{' '}
            within 30 days of the donation if you can. Tell us:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>the email address you donated with</li>
            <li>the date of the donation</li>
            <li>the campaign name</li>
            <li>the amount</li>
            <li>a short explanation</li>
          </ul>
          <p className="mt-3 leading-relaxed">
            We usually review a refund request within 5 business days. If we
            approve it, we send the refund through Stripe. It can take 5 to 10
            business days to show up on the payment method you used.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            How to stop a monthly donation
          </h2>
          <p className="mt-3 leading-relaxed">
            You can cancel a monthly donation at any time before the next
            payment date. Cancel it in your account, where that option is
            available. You can also email{' '}
            <a href="mailto:support@lastdonor.org" className="text-primary underline underline-offset-4">
              support@lastdonor.org
            </a>
            . Cancelling stops future charges. It does not automatically refund
            past donations.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Payment disputes
          </h2>
          <p className="mt-3 leading-relaxed">
            If something looks wrong, tell us before you file a card dispute.
            Then we can look into it quickly. If a dispute is opened through a
            bank or card issuer, Stripe and the payment network may ask us for
            records. That can include transaction, donation, and campaign
            records. We work with genuine dispute investigations. We may pause a
            campaign while the issue is reviewed.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Related policies
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
