import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Fund Release Policy',
  description:
    'When a campaign gets the money you donated, what can hold it up, and when we refund you instead.',
  alternates: { canonical: 'https://lastdonor.org/fund-release-policy' },
  openGraph: {
    title: 'Fund Release Policy | LastDonor.org',
    description:
      'When a campaign gets the money you donated, and what can hold it up.',
    images: [
      {
        url: '/api/v1/og/page?title=Fund+Release+Policy&subtitle=How+money+moves+from+your+payment+to+the+campaign.',
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
        This page explains how your money moves. It starts when you pay. It ends
        when a campaign gets it. LastDonor is a donation platform. We do not
        sell or ship anything.
      </p>

      <div className="mt-10 space-y-9 text-muted-foreground">
        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            How the payment works
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>Stripe takes the payment. Stripe handles cards, digital wallets, monthly donations, and settling the money.</li>
            <li>We keep a record of each donation. We need it to help donors, show campaign progress, stop fraud, and follow the law.</li>
            <li>We take 0%. Stripe charges 2.9% plus 30 cents on a US card. On a $50 donation that is $1.75, so the campaign gets $48.25.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            What has to happen before money moves
          </h2>
          <p className="mt-3 leading-relaxed">
            A donation on its own does not release the money. Before it can
            reach a recipient or an organizer, we may need any of these:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>A review of the campaign, and our approval.</li>
            <li>Proof of who the organizer, the recipient, or the bank account holder is.</li>
            <li>Documents that show the need, or show what the money is for.</li>
            <li>A Stripe Connect account that is set up and cleared to receive payments.</li>
            <li>A check by our team for fraud, sanctions, chargebacks, double charges, or rule breaches.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            How we send the money
          </h2>
          <p className="mt-3 leading-relaxed">
            Once the checks we need are done, the verified amount may become
            available to withdraw. Right now we release it in one lump sum,
            after all checks are done. The campaign dashboard keeps a record of
            each withdrawal. The money usually moves by bank transfer through
            Stripe. How long it takes depends on Stripe, the bank, and the card
            networks.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            When money is held, or a withdrawal fails
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
            <li>We may hold or pause the money while the checks are not finished.</li>
            <li>The money may stay unavailable while a campaign is paused, suspended, cancelled, or under review.</li>
            <li>A withdrawal can fail if the bank account is restricted, unfinished, does not match, or cannot receive transfers.</li>
            <li>We may delay the money when a dispute, a refund request, a chargeback, or a compliance flag is still open.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            Updates after the money is spent
          </h2>
          <p className="mt-3 leading-relaxed">
            We may ask the people who get the money for an update. That can be
            receipts, photos, or a written note about what happened. A campaign
            page can show those updates. It can also show that the campaign is
            finished. Donors can then see what happened after it closed.
          </p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-bold text-foreground">
            When we refund instead
          </h2>
          <p className="mt-3 leading-relaxed">
            Sometimes a campaign cannot get the money. It may fail our checks,
            break our rules, or be cancelled. There can be other reasons it
            cannot receive the money. In any of those cases we may refund the
            donors instead of releasing the money. See the{' '}
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
