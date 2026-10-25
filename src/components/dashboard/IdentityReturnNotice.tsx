'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { XMarkIcon } from '@heroicons/react/24/outline';

/**
 * What an organiser sees when they come back from the ID check.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * [VERIFIED 2026-10-25] `verification/identity/session/route.ts` sends the
 * organiser to `/dashboard?verification=<slug>` when Didit is finished with
 * them. **Nothing read that parameter.** They completed an identity check and
 * arrived at an unchanged dashboard, with no acknowledgement that anything had
 * happened. See `docs/110`.
 *
 * ── WHAT IT MAY NOT SAY ─────────────────────────────────────────────────────
 *
 * ⛔ Not "you are verified". Coming back from the provider is not a decision:
 * `docs/81` records that Didit's "In Review" is their MANUAL queue and is NOT
 * a pass, and the status the webhook writes is whatever their decision API
 * reports later. The only thing this screen knows is that the organiser
 * returned.
 *
 * ⛔ No turnaround time (`docs/78`).
 */
export function IdentityReturnNotice() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  const slug = searchParams.get('verification');
  if (!slug || dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    router.replace(pathname, { scroll: false });
  }

  return (
    <div role="status" className="mb-6 rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">
            Thanks, we have your ID check
          </p>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            It is with the checking service now. You do not need to do anything
            else for this step. The campaign page below shows where it has got
            to, and updates on its own.
          </p>
          <Link
            href={`/dashboard/campaigns/${encodeURIComponent(slug)}/verification`}
            className="mt-2 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            See where this campaign has got to
          </Link>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
