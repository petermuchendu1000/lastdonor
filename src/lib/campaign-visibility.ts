/**
 * Which campaign statuses `/campaigns/[slug]` will actually serve.
 *
 * ── WHY THIS IS A SHARED CONSTANT ───────────────────────────────────────────
 *
 * `docs/109` records the create-campaign wizard sending organisers to
 * `/campaigns/<slug>` for a campaign that was `under_review`, which answers
 * **404**. Fixing the redirect found a second door to the same page: the
 * **"View"** button on every row of `/dashboard/campaigns` links there too,
 * for every campaign in every status - so an organiser with a campaign still
 * in the queue got the same 404 from their own dashboard.
 *
 * Both are the same mistake: a link to the public page written without
 * reference to what that page serves. So the answer lives in one place, and
 * `campaign-visibility.test.ts` asserts this list is exactly the set the page
 * query uses - parsed from its source, so the two cannot drift apart silently.
 *
 * ⚠️ `suspended` and `cancelled` ARE here, deliberately. The page serves them
 * and renders an explanatory notice; a donor following an old link deserves to
 * be told what happened rather than that the appeal never existed. `draft` and
 * `under_review` are not public and never have been since `docs/78`/`docs/79`.
 */

/** Statuses for which the public campaign page returns a page, not a 404. */
export const PUBLICLY_VIEWABLE_STATUSES = [
  'active',
  'last_donor_zone',
  'completed',
  'paused',
  'suspended',
  'cancelled',
] as const;

/**
 * Is there a public page for this campaign yet?
 *
 * Use this before rendering ANY link to `/campaigns/<slug>`. An unknown status
 * answers `false`: the failure mode of hiding a working link is a missing
 * button, and the failure mode of showing a broken one is a 404 handed to the
 * person whose campaign it is.
 */
export function hasPublicPage(status: string | null | undefined): boolean {
  if (!status) return false;
  return (PUBLICLY_VIEWABLE_STATUSES as readonly string[]).includes(status);
}
