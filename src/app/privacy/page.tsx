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

      <section
        aria-labelledby="plain-english-summary"
        className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-[--shadow-elevation-1] sm:p-8"
      >
        <h2
          id="plain-english-summary"
          className="font-display text-xl font-bold text-foreground"
        >
          In plain English
        </h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          This is a short summary of the policy below. It is here to help you
          read it. The full policy below is the one that counts legally.
        </p>
        <ul className="mt-5 space-y-4 text-muted-foreground leading-relaxed">
          <li>
            <strong className="text-foreground">What we collect.</strong> Your
            name and email address. Your donation amount and any message you
            add. Your card details go straight to Stripe and are never stored
            on our servers.
          </li>
          <li>
            <strong className="text-foreground">What we use it for.</strong> To
            take your donation, email you a receipt and send campaign updates.
            We send newsletter emails only if you ask for them.
          </li>
          <li>
            <strong className="text-foreground">What other people see.</strong>{' '}
            Your donor name is shown on the campaign page. It is hidden if you
            give anonymously.
          </li>
          <li>
            <strong className="text-foreground">Do we sell your data.</strong>{' '}
            No. We do not sell, rent or trade your personal information.
          </li>
          <li>
            <strong className="text-foreground">Who else sees it.</strong>{' '}
            Stripe handles payments. Resend sends our emails. Our hosting and
            database providers store the data. Those are the services that make
            the platform work.
          </li>
          <li>
            <strong className="text-foreground">Cookies.</strong> Our analytics
            tool sets no cookies and collects no personal data. Our own cookies
            only keep you signed in and remember your theme.
          </li>
          <li>
            <strong className="text-foreground">
              Seeing or deleting your data.
            </strong>{' '}
            Email{' '}
            <a
              href="mailto:privacy@lastdonor.org"
              className="text-primary underline underline-offset-4"
            >
              privacy@lastdonor.org
            </a>
            . You can ask for a copy of your data, or ask us to delete it. We
            reply within 30 days. Where you live may give you extra rights, set
            out in section 5.
          </li>
          <li>
            <strong className="text-foreground">What we have to keep.</strong>{' '}
            Donation records are kept for at least 7 years for tax and
            financial rules. If you delete your account, we remove your
            personal details within 30 days.
          </li>
          <li>
            <strong className="text-foreground">Who to contact.</strong> Email{' '}
            <a
              href="mailto:privacy@lastdonor.org"
              className="text-primary underline underline-offset-4"
            >
              privacy@lastdonor.org
            </a>{' '}
            with any privacy question. Ask there for postal details too.
          </li>
        </ul>
      </section>

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
              location, donation amount, and optional message. Payment details
              (credit card numbers) are processed directly by Stripe and never
              stored on our servers.
            </li>
            <li>
              <strong>Newsletter subscriptions:</strong> Email address and
              sign-up source.
            </li>
            <li>
              <strong>Story submissions:</strong> Name, email, and story
              details submitted via the Share Your Story form.
            </li>
            <li>
              <strong>Phone number:</strong> Only if you add one. We send a
              six-digit code by text to check the number works. Checking your
              number is not permission to send you anything else. We ask for
              that separately.
            </li>
            <li>
              <strong>Identity checks:</strong> If you run a campaign, we ask
              you to prove who you are before we release money. Our checking
              partner collects your ID document and a photo of your face. We
              also keep any document you upload to us directly. Only our staff
              can open these.
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
            <li>Send a text message, but only if you gave us your number and said yes to texts</li>
            <li>Check that a campaign organiser is a real person before money is released</li>
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
            <li>
              <strong>Stripe:</strong> For payment processing
            </li>
            <li>
              <strong>Resend:</strong> For transactional emails
            </li>
            <li>
              <strong>Supabase:</strong> Database and file storage
            </li>
            <li>
              <strong>Fly.io:</strong> Runs the site itself
            </li>
            <li>
              <strong>Cloudflare:</strong> Sits in front of the site and
              handles scheduled jobs
            </li>
            <li>
              <strong>Didit:</strong> Checks the identity of campaign
              organisers
            </li>
            <li>
              <strong>Africa&apos;s Talking:</strong> Sends text messages
            </li>
            <li>
              <strong>Sentry:</strong> Records errors so we can fix them
            </li>
            <li>
              <strong>Plausible:</strong> Counts page visits. It does not use
              cookies and does not collect personal data.
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
            access control, and regular security audits. Payment processing is
            handled entirely by Stripe, a PCI DSS Level 1 certified provider.
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
          <address className="mt-3 not-italic text-sm leading-relaxed text-muted-foreground">
            LastDonor.org<br />
            United States<br />
            privacy@lastdonor.org
          </address>
        </section>
      </div>
    </div>
  );
}
