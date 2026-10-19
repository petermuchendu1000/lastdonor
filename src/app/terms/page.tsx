import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

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
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: April 1, 2026
      </p>

      <p className="mt-4 text-muted-foreground leading-relaxed">
        We wrote these to be fair and readable. If something does not make
        sense, email us and we will explain it in plain English.
      </p>

      <section
        aria-labelledby="plain-english"
        className="mt-8 rounded-lg border border-border bg-muted/40 p-5 sm:p-6"
      >
        <h2
          id="plain-english"
          className="font-display text-xl font-bold text-foreground"
        >
          In plain English
        </h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          This is a short summary of the terms below. It is not the agreement
          itself. If the two ever differ, the full terms below are the ones
          that count legally.
        </p>

        <ul className="mt-4 space-y-3 text-muted-foreground leading-relaxed">
          <li>
            <strong className="text-foreground">
              Using the site means you agree.
            </strong>{' '}
            If you do not agree with these terms, please do not use
            LastDonor.org.
          </li>
          <li>
            <strong className="text-foreground">You must be 18 or older</strong>{' '}
            to open an account or to give money.
          </li>
          <li>
            <strong className="text-foreground">A donation is a gift.</strong>{' '}
            You are not buying anything. We do not sell goods. There is nothing
            to ship and nothing to return.
          </li>
          <li>
            <strong className="text-foreground">How much you can give.</strong>{' '}
            The smallest donation is $5.00. The largest is $100,000.00 in one
            payment. Stripe handles the payment.
          </li>
          <li>
            <strong className="text-foreground">Tax is not settled yet.</strong>{' '}
            Our tax-exempt status is not confirmed. Please do not assume your
            donation can be deducted from your taxes. Ask a tax advisor about
            your own case.
          </li>
          <li>
            <strong className="text-foreground">
              Your name may be shown.
            </strong>{' '}
            Your name and the amount appear on the campaign page. They stay
            hidden if you choose to give anonymously.
          </li>
          <li>
            <strong className="text-foreground">Refunds are limited.</strong> A
            donation is usually final. We refund a fraudulent or unauthorized
            charge. We refund a duplicate charge caused by a technical error.
            We refund every donor if we cancel a campaign over editorial
            concerns. Email{' '}
            <a
              href="mailto:support@lastdonor.org"
              className="text-primary underline underline-offset-4"
            >
              support@lastdonor.org
            </a>{' '}
            within 30 days if you can. The{' '}
            <Link
              href="/refund-policy"
              className="text-primary underline underline-offset-4"
            >
              Refund Policy
            </Link>{' '}
            has the full detail.
          </li>
          <li>
            <strong className="text-foreground">
              You can stop a monthly donation.
            </strong>{' '}
            Cancel it at any time. Use your account tools where they are
            available, or email support.
          </li>
          <li>
            <strong className="text-foreground">What you may not post.</strong>{' '}
            No hate speech, threats or harassment. No false or misleading
            information. No spam and no ads. Nothing that breaks the law.
            We can remove content that breaks these rules.
          </li>
          <li>
            <strong className="text-foreground">Look after your account.</strong>{' '}
            Keep your password private. Give us true and complete details. We
            can suspend or close an account that breaks these terms.
          </li>
          <li>
            <strong className="text-foreground">
              We can review any campaign.
            </strong>{' '}
            We can reject it, pause it, remove it, or ask for more information.
            Before we release money we may ask for identity checks and
            documents.
          </li>
          <li>
            <strong className="text-foreground">
              The site comes &quot;as is&quot;.
            </strong>{' '}
            We do not promise it will always work. Section 9 below sets out the
            limits on what we are liable for.
          </li>
          <li>
            <strong className="text-foreground">Who to contact.</strong> Email{' '}
            <a
              href="mailto:legal@lastdonor.org"
              className="text-primary underline underline-offset-4"
            >
              legal@lastdonor.org
            </a>{' '}
            about these terms. Email{' '}
            <a
              href="mailto:support@lastdonor.org"
              className="text-primary underline underline-offset-4"
            >
              support@lastdonor.org
            </a>{' '}
            about a refund or a monthly donation.
          </li>
        </ul>
      </section>

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
              All donations are processed by Stripe and are final upon
              completion.
            </li>
            <li>
              The minimum donation amount is $5.00 USD. The maximum is
              $100,000.00 USD per transaction.
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
            A person reviews every campaign before it goes live. We may also
            reject, pause, suspend, remove, or request more information about
            any campaign at any time. Fund release may require
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
