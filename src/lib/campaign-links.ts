import { hasPublicPage } from './campaign-visibility';

/**
 * Where a link to a campaign may point, and for whom.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `docs/109` established the rule: *before rendering ANY link to
 * `/campaigns/<slug>`, call `hasPublicPage`*. It was enforced for links
 * rendered in the UI (`CampaignsListClient`), and **notifications were never
 * swept**. A notification is a link too - it is just stored in a column and
 * rendered later - so the rule applies to it exactly, and nothing checked.
 *
 * [VERIFIED 2026-10-27 against live production] two of them hand a person a
 * 404:
 *
 *  1. `notifyCampaignStatusChange` wrote `link: /campaigns/<slug>` for **all
 *     three** of its branches, the `archived` one included - and `archived` is
 *     absent from `PUBLICLY_VIEWABLE_STATUSES` and from the page's own filter
 *     (`campaigns/[slug]/page.tsx:117-122`). So the ONLY condition that
 *     produces a `campaign_archived` notification is the one condition under
 *     which its link cannot resolve. `GET /campaigns/zz-payments-test-mpesa-gateway`
 *     (a real `archived` row) answered **404**; an `active` slug answered 200,
 *     which is the control proving the probe can tell them apart. The
 *     recipients are real un-refunded donors - the people who gave money.
 *
 *     ⚠️ **That specific case is now closed at source** (`docs/118` §9, owner
 *     decision): `archived` is served with a closed notice, so this builder
 *     returns a path for it and the test that named it has been repointed.
 *     The guard still matters - `draft` and `under_review` are not public,
 *     every newly created campaign is `under_review`, and
 *     `ALLOWED_TRANSITIONS` still permits `active -> draft`.
 *
 *  2. The message-moderation route wrote `link: /campaigns/<campaignId>` - a
 *     **UUID in the slug position**. `/campaigns/[slug]` resolves only
 *     `eq(campaigns.slug, slug)`, so it misses every time.
 *     `GET /campaigns/<uuid>` answers **404**.
 *
 * ── ⚠️ WHY A MODULE AND NOT TWO ONE-LINE FIXES ──────────────────────────────
 *
 * Because the root cause is not those two lines. **Nothing in this codebase
 * built a link to a campaign.** Twenty-plus call sites each decided
 * slug-vs-id and public-vs-not for themselves, and they disagree - which is
 * why some are correct by luck and others are not.
 *
 * The sharpest evidence is that the organiser routes are split 3/3 on whether
 * they accept a slug at all:
 *
 *   accepts slug OR uuid   `[id]/verification:27`, `[id]/impact-update:26`,
 *                          `[id]/payout-destination:55`
 *   UUID ONLY              `[id]:33`, `[id]/updates:19`, `[id]/donors:30`,
 *                          `[id]/edit:19`   (a slug there calls `notFound()`)
 *
 * So `/dashboard/campaigns/<slug>/verification` works and
 * `/dashboard/campaigns/<slug>` is a 404, and every author of a link has to
 * know which half they are addressing. `campaign-links.ratchet.test.ts`
 * discovers the hand-built ones from disk and fails the build.
 */

/**
 * The public campaign page - or `null` when there is nothing public to link to.
 *
 * ⛔ `null` is a real answer and every caller must handle it. Both renderers
 * already do: `NotificationsClient.tsx:279-285` renders the title as plain
 * text, and `NotificationBell.tsx:246-249` simply does not navigate. So an
 * unlinkable notification still tells the person what happened; it just does
 * not promise a page that is not there.
 *
 * That choice is `hasPublicPage`'s own stated philosophy, applied one layer
 * out: *"the failure mode of hiding a working link is a missing button, and
 * the failure mode of showing a broken one is a 404"*.
 *
 * ⚠️ The empty slug is refused too. Two admin call sites pass
 * `campaignSlug: full?.slug ?? ''`, which produced the string
 * `'/campaigns/'` - not a 404 but a silent 308 to the whole listing, so a
 * donor told their campaign had concluded landed on a browse page.
 */
export function publicCampaignPath(p: {
  slug: string | null | undefined;
  status: string | null | undefined;
}): string | null {
  if (!p.slug) return null;
  if (!hasPublicPage(p.status)) return null;
  return `/campaigns/${p.slug}`;
}

/** The organiser screens that live under `/dashboard/campaigns/<id>`. */
export type OrganiserCampaignScreen =
  | 'updates'
  | 'edit'
  | 'donors'
  | 'verification'
  | 'impact-update'
  | 'payout-destination';

/**
 * An organiser's own screen for a campaign, keyed on the **UUID**.
 *
 * ⛔ Always the id, never the slug. `/dashboard/campaigns/[id]/page.tsx:33` is
 * `if (!UUID_RE.test(id)) notFound()`, and `updates`, `donors` and `edit`
 * carry the same guard - so a slug reaches a 404 on four of the seven screens.
 * Three siblings happen to accept either, which is exactly what made the
 * mistake survivable long enough to spread: `notifications.ts:1000` passes a
 * slug and works, `notifications.ts:1520` passes a slug and 404s, and the two
 * lines look identical.
 *
 * Passing the id everywhere is correct on all seven, so this does not care
 * which half of the split it is addressing.
 */
export function organiserCampaignPath(
  campaignId: string,
  screen?: OrganiserCampaignScreen,
): string {
  const base = `/dashboard/campaigns/${campaignId}`;
  return screen ? `${base}/${screen}` : base;
}
