'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BellSlashIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

type State = 'loading' | 'success' | 'error' | 'missing-params';

/**
 * Published support mailbox. Hardcoded rather than imported from
 * `@/lib/unsubscribe-tokens` because that module imports node `crypto` and
 * this is a client component; the same literal appears across the app's
 * client surfaces.
 */
const SUPPORT_MAILBOX = 'support@lastdonor.org';

export function UnsubscribeClient() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email');
  const campaignSlug = searchParams.get('campaign');
  /**
   * The HMAC token minted by the email footer
   * (`campaignUnsubscribeMechanism` in `@/lib/unsubscribe-tokens`).
   *
   * `DELETE /api/v1/campaigns/[slug]/subscribe` authorises on this token OR a
   * session owning the address, so it must be forwarded or the email-link
   * flow answers 403. It is sent in the JSON body; the route's `readToken`
   * accepts either, and the body is where `email` already travels.
   *
   * Its absence is deliberately NOT treated as `missing-params`: links minted
   * before this fix carry no token, and a signed-in donor can still
   * unsubscribe through the session path. The attempt is made either way, and
   * a genuine failure lands in the error state, which offers the support
   * mailbox.
   */
  const token = searchParams.get('token');
  const [state, setState] = useState<State>('loading');

  const unsubscribe = useCallback(async () => {
    if (!email || !campaignSlug) {
      setState('missing-params');
      return;
    }

    try {
      const res = await fetch(`/api/v1/campaigns/${encodeURIComponent(campaignSlug)}/subscribe`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token ? { email, token } : { email }),
      });
      const json = await res.json();
      setState(json.ok ? 'success' : 'error');
    } catch {
      setState('error');
    }
  }, [email, campaignSlug, token]);

  useEffect(() => {
    unsubscribe();
  }, [unsubscribe]);

  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
      {state === 'loading' && (
        <>
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">Unsubscribing...</p>
        </>
      )}

      {state === 'success' && (
        <>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
            <CheckCircleIcon className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-lg font-bold text-foreground">Unsubscribed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You will no longer receive updates for this campaign.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to Home
          </Link>
        </>
      )}

      {state === 'error' && (
        <>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
            <ExclamationCircleIcon className="h-7 w-7 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-lg font-bold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We could not process your unsubscribe request. Try again, or email us and we will
            stop these campaign updates for you.
          </p>
          <button
            type="button"
            onClick={() => { setState('loading'); unsubscribe(); }}
            className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try Again
          </button>
          <p className="mt-4 text-sm text-muted-foreground">
            <a
              href={`mailto:${SUPPORT_MAILBOX}?subject=${encodeURIComponent(
                campaignSlug
                  ? `Unsubscribe from campaign updates: ${campaignSlug}`
                  : 'Unsubscribe from campaign updates',
              )}`}
              className="text-primary underline underline-offset-4"
            >
              {SUPPORT_MAILBOX}
            </a>
          </p>
        </>
      )}

      {state === 'missing-params' && (
        <>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <BellSlashIcon className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-lg font-bold text-foreground">Invalid Link</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This unsubscribe link appears to be incomplete. Use the link from your email, or
            email us and we will stop these campaign updates for you.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            <a
              href={`mailto:${SUPPORT_MAILBOX}?subject=${encodeURIComponent(
                'Unsubscribe from campaign updates',
              )}`}
              className="text-primary underline underline-offset-4"
            >
              {SUPPORT_MAILBOX}
            </a>
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to Home
          </Link>
        </>
      )}
    </div>
  );
}
