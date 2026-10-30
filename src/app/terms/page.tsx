import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { CURRENCIES, SUPPORTED_CURRENCY_CODES } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';
import { termsVersionLabel } from '@/lib/campaign-consent';

/**
 * Per-currency donation limits, derived rather than written out.
 *
 * ⛔ This section used to say "The minimum donation amount is $5.00 USD. The
 * maximum is $100,000.00 USD per transaction." - a single-currency claim on a
 * platform where an organiser picks the campaign's currency (`docs/118` §10)
 * and where every donation ever taken was in shillings. `docs/148` §B derived
 * three such sites and `docs/152` found this fourth one; the sibling claim on
 * `/refund-policy` was already derived, so the two pages disagreed about the
 * same fact.
 *
 * Reads `CURRENCIES`, the set money can actually be COLLECTED in (`docs/103`:
 * known is not collectable), so a third rail appears here the day it is added.
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
  title: 'Terms of Service',
  description:
    'Terms of service for LastDonor.org. Plain language, no tricks. Here is what you agree to when you use the platform.',
  alternates: { canonical: 'https://lastdonor.org/terms' },
  openGraph: {
    title: 'Terms of Service | LastDonor.org',
    description:
      'Plain language, no tricks. Here is what you agree to when you use the platform.',
    images: [
      {
        url: '/api/v1/og/page?title=Terms+of+Service&subtitle=Plain+language%2C+no+tricks.',
        width: 1200,
        height: 630,
        alt: 'Terms of Service at LastDonor.org',
      },
    ],
  },
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
        Terms of Service
      </h1>
      {/*
        ⛔ DERIVED from `TERMS_VERSION`, not written out. This line said
        "April 1, 2026" while the constant that every consent record attests
        to said 2026-10-25, and the page had been materially edited since
        both. `docs/113` §10.2 asked whoever edits the terms to bump the
        constant by hand; `docs/152` is the turn where that step was skipped
        by somebody who had just read the warning.
      */}
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: {termsVersionLabel()}
      </p>

      <p className="mt-4 text-muted-foreground leading-relaxed">
        We wrote these to be fair and readable. If something does not make
        sense, email us and we will explain it in plain English.
      </p>

      <div className="mt-8 space-y-8 text-muted-foreground leading-relaxed">
        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            1. Acceptance of Terms
          </h2>
          <p className="mt-3">
            By accessing or using LastDonor.org, you agree to be bound by these
            Terms of Service. If you do not agree, do not use the platform.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            2. Eligibility
          </h2>
          <p className="mt-3">
            You must be at least 18 years of age to create an account or make a
            donation on LastDonor.org.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            3. Donations
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              Donations are final once they complete. Card donations are
              processed by Stripe, and M-Pesa donations by PayHero.
            </li>
            <li>
              Per-transaction limits depend on the campaign&rsquo;s currency:{' '}
              {DONATION_LIMITS.map((l, i) => (
                <span key={l.code}>
                  {i > 0 ? '; ' : ''}
                  {l.code} {l.min} to {l.max}
                </span>
              ))}
              .
            </li>
            <li>
              LastDonor.org is finalizing its federal tax-exempt status and EIN
              details. Until that status is confirmed, do not assume donations are
              deductible for tax purposes. Consult a tax advisor for your specific situation.
            </li>
            <li>
              Recurring donations can be canceled at any time by contacting
              support or by using account tools when available.
            </li>
            <li>
              Donor names and amounts are publicly displayed on campaign pages
              unless the donor selects anonymous.
            </li>
            <li>
              LastDonor accepts donations only. We do not sell physical goods,
              ship products, or provide product returns.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            4. Refund Policy
          </h2>
          <p className="mt-3">
            Donations are generally final once processed. Refunds are issued when:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Fraudulent or unauthorized transactions</li>
            <li>
              Campaign cancellation due to editorial concerns (all donors
              refunded)
            </li>
            <li>Technical errors resulting in duplicate charges</li>
          </ul>
          <p className="mt-2">
            Refund requests should be sent to{' '}
            <a
              href="mailto:support@lastdonor.org"
              className="text-primary underline underline-offset-4"
            >
              support@lastdonor.org
            </a>{' '}
            within 30 days of the transaction when possible. See the detailed{' '}
            <Link href="/refund-policy" className="text-primary underline underline-offset-4">
              Refund, Cancellation, and Dispute Policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            5. Campaign Review and Fund Release
          </h2>
          <p className="mt-3">
            LastDonor may review, reject, pause, suspend, remove, or request
            more information about any campaign. Fund release may require
            identity checks, supporting documents, Stripe Connect onboarding,
            fraud review, and compliance review. See the{' '}
            <Link href="/campaign-verification-policy" className="text-primary underline underline-offset-4">
              Campaign Verification Policy
            </Link>{' '}
            and{' '}
            <Link href="/fund-release-policy" className="text-primary underline underline-offset-4">
              Fund Release Policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            6. User Accounts
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              You are responsible for maintaining the confidentiality of your
              account credentials.
            </li>
            <li>
              You agree to provide accurate and complete information during
              registration.
            </li>
            <li>
              We reserve the right to suspend or terminate accounts that
              violate these terms.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            7. Content Policies
          </h2>
          <p className="mt-3">
            User-generated content (donation messages, story submissions) must
            not contain:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Hate speech, threats, or harassment</li>
            <li>False or misleading information</li>
            <li>Spam or commercial advertising</li>
            <li>Content that violates any applicable law</li>
          </ul>
          <p className="mt-2">
            We reserve the right to remove content that violates these policies.
            Campaigns must also follow the{' '}
            <Link href="/campaign-rules" className="text-primary underline underline-offset-4">
              Campaign Rules
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            8. Intellectual Property
          </h2>
          <p className="mt-3">
            All content on LastDonor.org, including text, images, design, and
            code, is the property of LastDonor.org or its content suppliers and
            is protected by copyright law.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            9. Limitation of Liability
          </h2>
          <p className="mt-3">
            LastDonor.org provides its platform &quot;as is&quot; without
            warranties of any kind. We are not liable for any indirect,
            incidental, or consequential damages arising from your use of the
            platform.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            10. Contact
          </h2>
          <p className="mt-3">
            For questions about these terms, contact us at{' '}
            <a
              href="mailto:legal@lastdonor.org"
              className="text-primary underline underline-offset-4"
            >
              legal@lastdonor.org
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
