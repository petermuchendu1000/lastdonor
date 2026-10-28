/**
 * Which URL paths this application actually serves a page for.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `Breadcrumbs` built an href for EVERY path segment and rendered each one as
 * a `<Link>`, with nothing checking that the prefix resolved to a route. Four
 * of them pointed at a 404, and one was public and indexable:
 *
 *   /campaigns/category/<cat>              -> crumb "Category"
 *                                             -> /campaigns/category  (404)
 *   /admin/blog/<id>/edit                  -> /admin/blog/<id>        (404)
 *   /admin/campaigns/<id>/updates/new      -> /admin/campaigns/<id>/updates (404)
 *   /admin/institutions/<id>/payout-accounts -> /admin/institutions/<id> (404)
 *
 * [VERIFIED against live production] `/campaigns/category` answers HTTP 404
 * while `/campaigns` and `/blog` answer 200; `/campaigns/category/medical`
 * answers 200, contains `href="/campaigns/category"`, carries
 * `<meta name="robots" content="index, follow">`, and advertises
 * `https://lastdonor.org/campaigns/category` at position 3 of its
 * `BreadcrumbList` JSON-LD. **23 category URLs are in the production
 * sitemap.**
 *
 * This is `docs/118`'s rule one level up: *a link is BUILT, never written by
 * hand* - and a breadcrumb is a link, just one assembled from a pathname
 * rather than typed out. `docs/118` §2.1 found the same class in notifications
 * after the UI had been swept and notifications had not.
 *
 * ── WHY A LIST AND NOT A LOOKUP ─────────────────────────────────────────────
 *
 * `Breadcrumbs` is a client component: it has `usePathname()` and nothing
 * else. It cannot read the filesystem, and making it a server component to
 * find out would mean a dynamic API on pages that are currently static -
 * `docs/106` §10a measured what that costs (181 dynamic / 32 static / 3 ISR
 * would have become 216 dynamic).
 *
 * ⛔ So the list lives here, and `navigable-routes.ratchet.test.ts` DERIVES
 * the same list from `src/app/` and fails the build if the two disagree.
 * Nobody has to remember to update it; the build does the remembering. Same
 * shape as `docs/103`'s generated currency tables and `docs/109`'s
 * derive-both-ends rule.
 */

/**
 * Every route that has a `page.tsx`, with dynamic segments written as `*`.
 *
 * ⛔ Do NOT hand-edit to make something pass. Run the ratchet - it prints the
 * exact list `src/app/` currently implies.
 */
export const ROUTE_PATTERNS: readonly string[] = [
  '/',
  '/about',
  '/admin',
  '/admin/activity',
  '/admin/audit-log',
  '/admin/blog',
  '/admin/blog/*/edit',
  '/admin/blog/new',
  '/admin/blog/topics',
  '/admin/campaigns',
  '/admin/campaigns/*',
  '/admin/campaigns/*/edit',
  '/admin/campaigns/*/updates/new',
  '/admin/campaigns/new',
  '/admin/communications',
  '/admin/donations',
  '/admin/donors',
  '/admin/fund-releases',
  '/admin/governance',
  '/admin/impact-updates',
  '/admin/info-requests',
  '/admin/institutions',
  '/admin/institutions/*/payout-accounts',
  '/admin/monitoring',
  '/admin/news-feed',
  '/admin/notifications',
  '/admin/payout-queue',
  '/admin/payouts',
  '/admin/refunds',
  '/admin/reports',
  '/admin/screening',
  '/admin/settings',
  '/admin/simulation',
  '/admin/simulation/analytics',
  '/admin/simulation/fund-pool',
  '/admin/users',
  '/admin/users/*',
  '/admin/verification',
  '/blog',
  '/blog/*',
  '/campaign-rules',
  '/campaign-verification-policy',
  '/campaigns',
  '/campaigns/*',
  '/campaigns/*/congratulations',
  '/campaigns/*/donate',
  '/campaigns/category/*',
  '/cancelled-campaigns',
  '/collaborate/accept',
  '/compare',
  '/completed-campaigns',
  '/dashboard',
  '/dashboard/campaigns',
  '/dashboard/campaigns/*',
  '/dashboard/campaigns/*/donors',
  '/dashboard/campaigns/*/edit',
  '/dashboard/campaigns/*/impact-update',
  '/dashboard/campaigns/*/payout-destination',
  '/dashboard/campaigns/*/updates',
  '/dashboard/campaigns/*/verification',
  '/dashboard/donations',
  '/dashboard/finances',
  '/dashboard/finances/fund-releases',
  '/dashboard/finances/payouts',
  '/dashboard/impact',
  '/dashboard/notifications',
  '/dashboard/payout-settings',
  '/dashboard/profile',
  '/dashboard/settings',
  '/dashboard/subscriptions',
  '/dashboard/supported',
  '/dashboard/updates',
  '/dashboard/withdrawals',
  '/donate',
  '/donor-faq',
  '/editorial-standards',
  '/fund-release-policy',
  '/how-it-works',
  '/last-donor-wall',
  '/login',
  '/login/forgot-password',
  '/login/reset-password',
  '/newsletter',
  '/notifications',
  '/privacy',
  '/profile',
  '/refund-policy',
  '/register',
  '/search',
  '/settings',
  '/share-your-story',
  '/terms',
  '/transparency',
  '/unsubscribe',
];

/**
 * Path prefixes that a breadcrumb would build, which serve NO page.
 *
 * ⛔ This list is the fix, and `ROUTE_PATTERNS` alone was not enough.
 *
 * `/campaigns/category` matches the pattern `/campaigns/*`, because
 * `/campaigns/[slug]` exists and a wildcard matches any one segment - so
 * asking "is there a route here" answered YES for the one case that is
 * public, indexable and 404ing in production. A Next route does resolve;
 * `getCampaign('category')` then finds nothing and calls `notFound()`.
 *
 * `category` is a routing NAMESPACE, not a slug: it is a literal directory in
 * `src/app/campaigns/category/[category]`. The same is true of `updates` in
 * `/admin/campaigns/[id]/updates/new`. A wildcard matching one of those is a
 * coincidence of shape, not evidence that anything is served.
 *
 * So these are listed outright, derived by the ratchet from the route tree:
 * every ancestor a breadcrumb would link that has no `page.tsx` of its own.
 */
export const UNSERVED_PREFIXES: readonly string[] = [
  '/admin/blog/*',
  '/admin/campaigns/*/updates',
  '/admin/institutions/*',
  '/campaigns/category',
  '/collaborate',
];

/** Split a path into segments, dropping the empty strings around the slashes. */
function segmentsOf(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Does `path` match `pattern`, where `*` stands for exactly one segment? */
function matches(pattern: string, segs: string[]): boolean {
  const pat = segmentsOf(pattern);
  if (pat.length !== segs.length) return false;
  return pat.every((p, i) => p === '*' || p === segs[i]);
}

/**
 * Does this application serve a page at `path`?
 *
 * ⚠️ `UNSERVED_PREFIXES` is checked FIRST and that order is load-bearing. A
 * path such as `/campaigns/category` matches a wildcard route pattern, so a
 * ROUTE_PATTERNS-only answer is `true` - which is how the public case
 * survived the first version of this module. The ratchet carries that exact
 * case as an assertion.
 *
 * ⚠️ It answers for a ROUTE, not for a row. A route that exists can still
 * `notFound()` on a missing record, or redirect somebody without the role -
 * neither is knowable from a pathname, and neither is what a breadcrumb
 * claims. `docs/118`'s `hasPublicPage` is the predicate for "will this
 * campaign's page serve"; this one is "is anything served here at all".
 */
export function isNavigablePath(path: string): boolean {
  const segs = segmentsOf(path);
  if (segs.length === 0) return true; // '/'

  if (UNSERVED_PREFIXES.some((pattern) => matches(pattern, segs))) return false;
  return ROUTE_PATTERNS.some((pattern) => matches(pattern, segs));
}
