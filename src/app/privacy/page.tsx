import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How LastDonor.org handles your data. Short version: we never sell it, we never share it for profit, and we use privacy-focused analytics that do not track you.',
  alternates: { canonical: 'https://lastdonor.org/privacy' },
  openGraph: {
    title: 'Privacy Policy | LastDonor.org',
    description:
      'We never sell your data. We never share it for profit. We use privacy-focused analytics that do not track you.',
    images: [
      {
        url: '/api/v1/og/page?title=Privacy+Policy&subtitle=We+never+sell+your+data.+We+use+privacy-focused+analytics.',
        width: 1200,
        height: 630,
        alt: 'Privacy Policy at LastDonor.org',
      },
    ],
  },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="mt-6 font-display text-4xl font-bold text-foreground">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: April 1, 2026
      </p>

      <p className="mt-4 text-muted-foreground leading-relaxed">
        We keep this simple because we think privacy policies should be readable
        by normal people, not just lawyers. Here is what we collect, why, and
        who sees it.
      </p>

      <div className="mt-8 space-y-8 text-muted-foreground leading-relaxed">
        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            1. What We Collect
          </h2>
          <p className="mt-3">
            When you use LastDonor.org, we collect information you provide
            directly:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              <strong>Account information:</strong> Name, email address,
              password (hashed), and optional location.
            </li>
            <li>
              <strong>Donation information:</strong> Donor name, email,
              location, donation amount, and optional message. If you pay by
              M-Pesa we also keep the phone number you paid from, so we can
              match the payment and stop the same number being used to send
              unwanted payment requests. We never hold your card number or
              your mobile money PIN: those go straight to the payment
              provider.
            </li>
            <li>
              <strong>Newsletter subscriptions:</strong> Email address and
              sign-up source.
            </li>
            <li>
              <strong>Story submissions:</strong> Name, email, and story
              details submitted via the Share Your Story form.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            2. How We Use Your Information
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-6">
            <li>Process and acknowledge donations</li>
            <li>Send donation confirmations and campaign updates</li>
            <li>Display public donor names on campaign pages (unless anonymous)</li>
            <li>Send newsletter updates (with your consent)</li>
            <li>Improve platform functionality and user experience</li>
            <li>Comply with legal and regulatory requirements</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            3. Cookies &amp; Analytics
          </h2>
          <p className="mt-3">
            We use Plausible Analytics, a privacy-focused analytics tool that
            does not use cookies and does not collect personal data. We may use
            essential cookies for authentication (session tokens) and saved
            theme preference.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            4. Who Sees Your Data
          </h2>
          <p className="mt-3">
            We do not sell, rent, or trade your personal information. Not now,
            not ever. We only share data with the services that make the
            platform work:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {/*
              ⛔ This list named **Vercel** for application hosting and omitted
              **PayHero** entirely. [VERIFIED three ways, `docs/152`]
              production answers `server: Fly/…`, `via: 2 fly.io` and a
              `fly-request-id` with no Vercel header at all; `fly.toml` is the
              deploy target while `vercel.json` is the inert file `docs/65`
              proved never ran; and this codebase's own comments say
              `VERCEL_ENV` is "UNSET on Fly". So the policy disclosed sharing
              with a company that hosts nothing here, while leaving out the one
              that receives every donor's PHONE NUMBER and the full donation
              amount - the only rail that has ever taken money (`docs/92`).

              ⚠️ Other integrated third parties are deliberately NOT added here
              on this pass; which of them receive personal data is a disclosure
              question for the owner, and `docs/152` §5 lists them.
            */}
            <li>
              <strong>Stripe:</strong> For card payment processing
            </li>
            <li>
              <strong>PayHero:</strong> For M-Pesa payment processing
            </li>
            <li>
              <strong>Resend:</strong> For transactional emails
            </li>
            <li>
              <strong>Supabase:</strong> For database hosting
            </li>
            <li>
              <strong>Fly.io:</strong> For application hosting
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            5. Your Privacy Rights
          </h2>
          <p className="mt-3">
            Depending on your location, you may have the following rights:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              <strong>California (CCPA):</strong> Right to know what personal information we collect, right to request deletion, right to opt out of data sales (we do not sell data), and right to non-discrimination for exercising these rights.
            </li>
            <li>
              <strong>European Economic Area / UK (GDPR / UK GDPR):</strong> Right of access, right to rectification, right to erasure (&ldquo;right to be forgotten&rdquo;), right to restriction of processing, right to data portability, right to object to processing, and the right to lodge a complaint with your national supervisory authority (e.g., the ICO in the UK or a EU Data Protection Authority).
            </li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, email{' '}
            <a href="mailto:privacy@lastdonor.org" className="text-primary underline underline-offset-4">
              privacy@lastdonor.org
            </a>. We will respond within 30 days.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            6. Data Retention
          </h2>
          <p className="mt-3">
            We retain account data for as long as your account is active. Donation and transaction records are retained for a minimum of 7 years for financial reporting and tax compliance. If you delete your account, personal identifiers are removed within 30 days; anonymized aggregate transaction data is retained for compliance purposes. You may request a copy of your data at any time by emailing{' '}
            <a href="mailto:privacy@lastdonor.org" className="text-primary underline underline-offset-4">
              privacy@lastdonor.org
            </a>.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            7. Security
          </h2>
          <p className="mt-3">
            We implement industry-standard security measures including
            encrypted connections (TLS), bcrypt password hashing, role-based
            access control, and regular security audits. Payments are handled
            by the payment provider for that currency, so we never hold your
            card number or your mobile money PIN: card payments go to Stripe,
            a PCI DSS Level 1 certified provider, and M-Pesa payments to
            PayHero.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-foreground">
            8. Contact &amp; Mailing Address
          </h2>
          <p className="mt-3">
            For privacy-related inquiries, contact us at{' '}
            <a
              href="mailto:privacy@lastdonor.org"
              className="text-primary underline underline-offset-4"
            >
              privacy@lastdonor.org
            </a>
            . For physical mail requests, contact us by email so we can provide
            the current mailing details.
          </p>
          {/*
            ⛔ NO COUNTRY LINE. Owner decision, 2026-10-29. Same reasoning as
            the footer block: a country with no street is a jurisdiction claim,
            not an address, and `/terms` establishes no governing law. The
            sentence directly above already tells the reader to email for the
            current mailing details, which is what we can actually substantiate
            - so the country line was adding a claim and no information.
          */}
          <address className="mt-3 not-italic text-sm leading-relaxed text-muted-foreground">
            LastDonor.org<br />
            privacy@lastdonor.org
          </address>
        </section>
      </div>
    </div>
  );
}
