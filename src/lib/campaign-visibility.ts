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
 *
 * ⚠️ `archived` was added 2026-10-27 (`docs/118` §9, owner decision) for
 * exactly the reason stated above - it had simply been omitted rather than
 * decided against. It is the status a CLOSED campaign holds, and the email its
 * donors receive says "We have a record of every donation, including yours",
 * so a 404 was the one answer that contradicted the message they had just
 * been sent. [VERIFIED] it also removed the `docs/118` §2.1 defect at source:
 * the `campaign_archived` notification's link now resolves.
 *
 * ⛔ Adding a status here is NOT the same as indexing it. `isIndexable` in
 * `campaigns/[slug]/page.tsx` and `LIVE_SITEMAP_STATUSES` in `sitemap.ts` are
 * the narrower set `active|last_donor_zone|completed`, and both stay that way
 * - a URL that is both in a sitemap and served `noindex` is a contradiction
 * Google reports. Serving a page and advertising it are separate decisions.
 */

/** Statuses for which the public campaign page returns a page, not a 404. */
export const PUBLICLY_VIEWABLE_STATUSES = [
  'active',
  'last_donor_zone',
  'completed',
  'paused',
  'suspended',
  'cancelled',
  'archived',
] as const;

/**
 * Is there a public page for this campaign yet?
 *
 * Use this before rendering ANY link to `/campaigns/<slug>`. An unknown status
 * answers `false`: the failure mode of hiding a working link is a missing
 * button, and the failure mode of showing a broken one is a 404 handed to the
 * person whose campaign it is.
 *
 * ── ⛔ WHY `publishedAt` IS REQUIRED, AND WHY A STATUS LIST WAS NOT ENOUGH ───
 *
 * A status allowlist answers "would this page render a status like this one".
 * It cannot answer the question that actually matters, which is **"did a person
 * approve this campaign for publication"** - and three of the seven statuses
 * above are reachable from a campaign nobody ever read:
 *
 *   `under_review` -> `suspended`   `POST .../suspend` (`SUSPENDABLE:18`)
 *   `under_review` -> `archived`    `DELETE /api/v1/user-campaigns/[id]:245`
 *   `draft`        -> `archived`    `PATCH  .../[campaignId]` (ALLOWED_TRANSITIONS)
 *   `draft`        -> `archived`    `DELETE /api/v1/campaigns/[slug]:217`
 *
 * The first of those is the DOCUMENTED refusal path (`docs/93`, owner
 * decision): refusing a campaign at review set `suspended`, which this list
 * served - so the one action that means *"no, this may not be published"*
 * published it. [VERIFIED by execution, `docs/131`] HTTP **200**, the whole
 * appeal about a named real person rendered, and `suspendedReason` - the
 * admin's own typed words - printed on the page, twice. While
 * `campaignRefusedEmail` told the organiser *"Your campaign is not public.
 * Nobody can see it or give to it."*
 *
 * `docs/120` §5 had already made exactly this argument, and acted on it for
 * ONE door: it removed `under_review` from `CANCELLABLE` because "`cancelled`
 * is publicly viewable" and cancelling "would give a never-reviewed appeal
 * about a named real person a permanent public page". It did not sweep the
 * sibling route it designated as the refusal path in the same breath.
 *
 * ⛔ So the predicate is not a fifth guard on a fourth door. `published_at` is
 * the RECORD that a person approved publication - `docs/120` pinned it to
 * exactly two UPDATE writers with
 * `src/db/campaign-publication-writers.ratchet.test.ts` - so asking the column
 * closes the class rather than the instances, and the fifth door somebody adds
 * next week is closed before it is written.
 *
 * ⚠️ It also settles what a status alone could not. `docs/93` records that
 * *"one status, two situations"*: suspending a LIVE campaign is an
 * investigation whose donors must be told, and suspending an `under_review`
 * one is a refusal with no donors to tell. `published_at` tells those two
 * apart - the live one keeps its page and its notice, the refused one never
 * had either - which is why this needs no new status and takes nothing away
 * from the `docs/118` §9 decision to serve closed campaigns.
 *
 * ⚠️ `Date | string` because the same row is read on both sides of the
 * serialization boundary: a server component holds a `Date`, a client
 * component handed the same row through props holds an ISO string.
 */
export function hasPublicPage(p: {
  status: string | null | undefined;
  publishedAt: Date | string | null | undefined;
}): boolean {
  if (!p.publishedAt) return false;
  if (!p.status) return false;
  return (PUBLICLY_VIEWABLE_STATUSES as readonly string[]).includes(p.status);
}
