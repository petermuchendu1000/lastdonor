'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { XMarkIcon } from '@heroicons/react/24/outline';

/**
 * What an organiser sees the moment they submit a campaign.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Submitting used to redirect to `/campaigns/<slug>?launched=true`, which was
 * right when campaigns went live instantly. `docs/78` and `docs/79` made every
 * campaign wait for a person, so the row is inserted `under_review` with
 * `published_at: null` — and `getCampaign` on the public page accepts only
 * `active`, `last_donor_zone`, `completed`, `paused`, `suspended` and
 * `cancelled`. The organiser therefore finished the wizard and landed on a
 * **404**, with no confirmation that anything had been received.
 *
 * Nothing failed. A redirect stopped being valid as a side effect of work in
 * another file — the same shape as `docs/83`, where the Didit flow worked and
 * its only link had quietly become unreachable.
 *
 * ── WHAT THIS MAY AND MAY NOT SAY ───────────────────────────────────────────
 *
 * ⛔ It must NOT promise an email on the decision. `docs/93` removed exactly
 * that sentence from the submission receipt, because a REFUSED campaign
 * notifies nobody — `under_review` transitions only to `active` or
 * `suspended`, and the suspend path addresses donors, of which an unpublished
 * campaign has none. That is still open, and inventing the promise here would
 * re-introduce the thing that doc deleted.
 *
 * What is true, and all this claims: a receipt has been sent (
 * `notifyCampaignSubmittedForReview`), and approval sends a second email with
 * the link (`docs/78`). Nothing is said about refusal.
 *
 * ⛔ And no turnaround time, deliberately — `docs/78` quotes none anywhere.
 */
export function SubmittedForReviewNotice() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  if (!searchParams.get('submitted') || dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    // Clean the URL so a refresh does not re-show it.
    router.replace(pathname, { scroll: false });
  }

  return (
    <div
      role="status"
      className="mt-6 rounded-lg border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">
            We have your campaign
          </p>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            A person reads every campaign before it goes live, so yours is not
            public yet. We have emailed you a receipt. If it is approved, we
            will email you again with the link to share.
          </p>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            You can see it below, marked <strong>Under Review</strong>, with
            everything that still needs doing.
          </p>
          {/*
            ⚠️ This used to say "You can start verifying your ID now" with NO
            LINK, on the one list that had no verification row - a patch, and
            the exact complaint that led to docs/110. The next step now comes
            from `organiser-journey.ts` and is rendered on each campaign row
            below, with a link.
          */}
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            The next thing is to <strong>check your ID</strong>. You can start
            now, while you wait. We cannot pay out any money until it is done.
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
