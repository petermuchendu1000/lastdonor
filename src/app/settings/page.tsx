import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Settings - LastDonor.org',
  robots: { index: false, follow: false },
};

/**
 * The link in the footer of every email this platform sends.
 *
 * ── WHY THIS IS NOT JUST A REDIRECT ─────────────────────────────────────────
 *
 * It was `redirect('/dashboard/settings')`, unconditionally — and that lives
 * behind the authenticated dashboard layout. `renderEmail`'s footer
 * (`src/lib/email-shell.ts:361`) sends **every** template here under "Manage
 * your notifications", and no caller in `src/` passes `footerLinks`, so this
 * is the only opt-out link in the product's outgoing mail.
 *
 * A guest donor therefore clicked the one thing offered to them and hit a
 * login wall for an account they do not have. That is not hypothetical: the
 * M-Pesa form takes a phone and an email and creates no account, so a guest
 * is the default — and the only — shape of donor on the rail that works.
 * `docs/122`.
 *
 * ⚠️ The honest fallback is a human one. `unsubscribeMechanism(null)` in
 * `src/lib/unsubscribe-tokens.ts` already reaches the same conclusion for a
 * recipient with no signed token: a `mailto:`. There is no stored suppression
 * for an address with no `newsletter_subscribers` row and no
 * `donor_campaign_subscriptions` row, so promising a one-click opt-out here
 * would be a claim the platform cannot keep.
 */
export default async function SettingsPage() {
  const session = await auth();
  if (session?.user?.id) redirect('/dashboard/settings');

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-foreground">
        Your email settings
      </h1>

      <p className="mt-4 text-muted-foreground">
        You are not signed in. If you gave without making an account, there is
        nothing to sign in to, and that is fine.
      </p>

      <div className="mt-8 rounded-lg border border-border bg-muted/30 p-5">
        <h2 className="font-semibold text-foreground">To stop these emails</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Email{' '}
          <a
            href="mailto:support@lastdonor.org?subject=Stop%20emails"
            className="text-primary underline underline-offset-4"
          >
            support@lastdonor.org
          </a>{' '}
          and a person will take you off the list. Send it from the address you
          want removed, so we know which one you mean.
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-border p-5">
        <h2 className="font-semibold text-foreground">If you do have an account</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in and you can change every email setting yourself.
        </p>
        <Link
          href="/login?callbackUrl=/dashboard/settings"
          className="mt-3 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in
        </Link>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Every campaign update email also carries its own unsubscribe link, which
        works without signing in.
      </p>
    </main>
  );
}
