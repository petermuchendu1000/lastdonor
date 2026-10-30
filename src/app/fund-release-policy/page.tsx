import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Fund Release Policy',
  description:
    'How LastDonor holds, reviews, releases, pauses, and refunds campaign funds after donations are processed.',
  alternates: { canonical: 'https://lastdonor.org/fund-release-policy' },
  openGraph: {
    title: 'Fund Release Policy | LastDonor.org',
    description:
      'How LastDonor holds, reviews, releases, pauses, and refunds campaign funds after donations are processed.',
    images: [
      {
        url: '/api/v1/og/page?title=Fund+Release+Policy&subtitle=How+donation+funds+move+from+payment+to+verified+recipient.',
        width: 1200,
        height: 630,
        alt: 'Fund Release Policy at LastDonor.org',
      },
    ],
  },
};

export default function FundReleasePolicyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
        Fund Release Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: April 27, 2026
      </p>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
        This page explains how donation funds move from checkout to campaign
        recipients. LastDonor is a donation platform; there are no shipped goods
        or delivery services.
      </p>

      <div className="mt-10 space-y-9 text-muted-foreground">
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Payment Processing
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            {/*
              ⛔ This said "Stripe processes donations and handles card,
              wallet, subscription, and settlement mechanics" - one collection
              rail, on a platform where every donation ever taken went over
              M-Pesa (`docs/152`). The PAYOUT bullets below still name Stripe
              alone and are CORRECT to: `createTransfer` has exactly one
              caller and `withdraw/route.ts:223` refuses any currency but
              `PLATFORM_PAYOUT_CURRENCY`, so Stripe really is the only way
              money leaves (`docs/121`). Collection and payout are different
              questions and only one of them has two answers.
            */}
            <li>Card donations are processed by Stripe, which handles card, wallet, subscription, and settlement mechanics. M-Pesa donations are processed by PayHero.</li>
            <li>LastDonor records donation details needed for donor support, campaign progress, fraud prevention, and compliance.</li>
            <li>LastDonor charges 0% platform fees on fundraisers, and no processing fee is deducted from a donation or from a payout.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Release Requirements
          </h2>
          <p className="mt-3 leading-relaxed">
            Funds are not released solely because a donation has been made.
            Before funds become available to a campaign recipient or organizer,
            LastDonor may require:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>Campaign review and approval.</li>
            <li>Identity verification for the organizer, recipient, or payout account holder.</li>
            <li>Supporting documents showing the stated need or intended use of funds.</li>
            <li>Stripe Connect onboarding and payout eligibility.</li>
            <li>Internal review for fraud, sanctions, chargebacks, duplicate charges, or policy concerns.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            How Funds Are Released
          </h2>
          <p className="mt-3 leading-relaxed">
            Once required verification is complete, the verified available
            amount may be released for withdrawal. The platform currently
            supports lump-sum release after full verification, with withdrawal
            records tracked in the campaign dashboard. Funds usually move
            through Stripe-connected payout rails and arrive according to
            Stripe, bank, and card network timing.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Holds, Pauses, and Failed Withdrawals
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>LastDonor may hold or pause release while verification is incomplete.</li>
            <li>Funds may remain unavailable while a campaign is paused, suspended, cancelled, or under review.</li>
            <li>Withdrawals can fail if a payout account is restricted, incomplete, mismatched, or not eligible to receive transfers.</li>
            <li>LastDonor may delay release when there are unresolved disputes, refund requests, chargebacks, or compliance flags.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Impact Updates and Records
          </h2>
          <p className="mt-3 leading-relaxed">
            Campaign recipients may be asked to provide impact updates, receipts,
            photos, or written outcome notes. Public campaign pages can show
            updates and completed campaign status so donors can follow what
            happened after a fundraiser closes.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Refunds Instead of Release
          </h2>
          <p className="mt-3 leading-relaxed">
            If a campaign cannot be verified, violates policy, is cancelled, or
            otherwise cannot receive funds, LastDonor may refund donors instead
            of releasing funds. See the{' '}
            <Link href="/refund-policy" className="text-primary underline underline-offset-4">
              Refund Policy
            </Link>{' '}
            for details.
          </p>
        </section>
      </div>
    </div>
  );
}
