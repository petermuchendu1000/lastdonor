'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthState } from '@/lib/auth-state';
import { BellIcon } from '@heroicons/react/24/outline';
import { BellAlertIcon } from '@heroicons/react/24/solid';
import { cn } from '@/lib/utils';

interface SubscribeButtonProps {
  campaignSlug: string;
  className?: string;
}

export function SubscribeButton({ campaignSlug, className }: SubscribeButtonProps) {
  /*
    ⛔ `useAuthState`, not `useSession` (CLAUDE.md, `docs/44`).

    This read `status !== 'authenticated'` and returned null, so a rate-limited
    or failed session read - which `docs/44` says must render as UNKNOWN, never
    as signed out - silently removed the only subscribe control in the product,
    with no error shown. `MessageForm` on the same page does it correctly.
    `docs/122`.
  */
  const { state, session, isAuthenticated } = useAuthState();
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  // Check current subscription status on mount (authed users only)
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    fetch(`/api/v1/campaigns/${campaignSlug}/subscribe`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.ok) {
          setSubscribed(json.data.subscribed);
          setChecked(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [campaignSlug, isAuthenticated]);

  const toggle = useCallback(async () => {
    const email = session?.user?.email;
    if (!email || loading) return;

    setLoading(true);
    const method = subscribed ? 'DELETE' : 'POST';
    try {
      const res = await fetch(`/api/v1/campaigns/${campaignSlug}/subscribe`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (json.ok) {
        setSubscribed(json.data.subscribed);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [campaignSlug, session?.user?.email, subscribed, loading]);

  /*
    Hidden only when the reader is KNOWN to be signed out, or while we do not
    know yet. `docs/44`: an unknown state renders as unknown - here, as the
    skeleton below rather than as a missing control - so a 429 on the session
    read does not quietly remove the only subscribe door in the product.
  */
  if (state === 'anonymous') return null;
  if (!isAuthenticated) {
    return <div className={cn('h-9 w-36 animate-pulse rounded-lg bg-muted', className)} />;
  }

  // Don't flash wrong state while checking
  if (!checked) {
    return (
      <div className={cn('h-9 w-36 animate-pulse rounded-lg bg-muted', className)} />
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      aria-pressed={subscribed}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors',
        'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
        loading && 'pointer-events-none opacity-60',
        className,
      )}
    >
      {subscribed ? (
        <>
          <BellAlertIcon className="h-4 w-4" />
          Subscribed
        </>
      ) : (
        <>
          <BellIcon className="h-4 w-4" />
          Get Updates
        </>
      )}
    </button>
  );
}
