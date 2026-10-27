'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { XMarkIcon } from '@heroicons/react/24/outline';

/**
 * What a helper sees the moment they accept an invitation.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `AcceptInviteClient` has always redirected to
 * `/dashboard/campaigns?joined=1`, and [VERIFIED 2026-10-27 by grepping
 * `src/`] **nothing read that parameter** - the redirect that sets it was its
 * only occurrence in the codebase. So a person who had just been given access
 * to somebody's fundraiser arrived at a page that said:
 *
 *     "You haven't created any campaigns yet. Start one now"
 *
 * with no confirmation that anything had happened. The membership row was
 * live and accepted at that exact moment, and the API answered 200 for the
 * same session - the grant was real and entirely invisible (`docs/117`).
 *
 * The same shape as `docs/109`: a redirect pointing somewhere that could not
 * say what had just happened. `SubmittedForReviewNotice` is the sibling for
 * `?submitted=1`, and this follows it deliberately.
 *
 * ── WHAT IT MAY AND MAY NOT SAY ─────────────────────────────────────────────
 *
 * ⛔ It must not imply any access to money. A person accepting an invitation
 * to "help run a fundraiser" will reasonably assume it includes the money
 * unless told plainly, which is why the invitation email and the accept
 * screen both say so and why this says it a third time, at the moment the
 * access actually begins. `docs/111` §1 has the traced reason the line is
 * where it is.
 */
export function JoinedTeamNotice() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  if (!searchParams.get('joined') || dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    // Clean the URL so a refresh does not re-show it.
    router.replace(pathname, { scroll: false });
  }

  return (
    <div role="status" className="mt-6 rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">
            You are now helping with a fundraiser
          </p>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            It is in the list below, marked <strong>Helping</strong>. You can
            write updates for its page and change what it says.
          </p>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            You cannot touch the money. Only the person who started the
            campaign can ask for a payout or change where it goes.
          </p>
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
