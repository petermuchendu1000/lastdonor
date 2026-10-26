/**
 * Which routes wear the public marketing chrome.
 *
 * `src/app/layout.tsx` is the ONLY root layout, so everything it renders wraps
 * every route - including `/admin` and `/dashboard`, two authenticated,
 * sidebar-driven screens that were each carrying a newsletter signup and a
 * four-column marketing footer taking roughly half the viewport.
 *
 * Both have their own navigation shell (`AdminSidebar`, `DashboardShell`), so
 * the marketing footer is not a second way around - it is a second, longer,
 * contradictory one offered to someone who is already signed in and already
 * somewhere.
 *
 * ── WHY A PREDICATE AND NOT A `headers()` CHECK ─────────────────────────────
 *
 * The obvious fix is to forward the pathname from middleware and branch on
 * `headers()` in the root layout. That would work and would silently
 * de-optimise the whole site: a dynamic API in the ROOT layout opts every
 * route out of static rendering. Measured before this change, the build
 * produced 32 static and 3 ISR routes out of 216; all 35 would have become
 * dynamic to hide a footer.
 *
 * So the decision is made in a client component instead (`PublicFooterGate`),
 * which leaves the root layout free of dynamic APIs. The Footer itself stays a
 * SERVER component - it is passed through as children, not re-implemented.
 */

/** Route prefixes that do not get the public footer. */
const PRIVATE_PREFIXES = ['/admin', '/dashboard'] as const;

/**
 * Does this path get the public marketing footer?
 *
 * ⚠️ ANCHORED, deliberately. A bare `startsWith('/admin')` also matches
 * `/administrator` and `/admin-guide` - and `startsWith('/dashboard')` would
 * match a future `/dashboards` marketing page - which is the same
 * prefix-dragging bug
 * `middleware.public-routes.test.ts` guards against on the public API list:
 * "every public-route entry is anchored, so a prefix cannot drag sub-routes
 * public". A path matches only when it IS the prefix or sits beneath it.
 *
 * An unreadable pathname returns `true`: the failure mode of showing a footer
 * where it is not wanted is cosmetic, and the failure mode of hiding it
 * everywhere is a site with no navigation.
 */
export function showsPublicFooter(pathname: string | null | undefined): boolean {
  if (!pathname || !pathname.startsWith('/')) return true;

  // Normalise a trailing slash so `/admin/` behaves like `/admin`.
  const path = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  return !PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Route prefixes that do not get the public NAVBAR.
 *
 * ⛔ `/dashboard` ONLY, and `/admin` is deliberately absent. The two are not
 * symmetric, and the asymmetry is a fact about the code rather than a
 * preference:
 *
 *   `DashboardSidebar.tsx` has a Sign out button, and the mobile sheet
 *   (`DashboardMobileNav`) renders that same sidebar - so an organiser has a
 *   way out of the product at every breakpoint without the public navbar.
 *
 *   `AdminSidebar.tsx` has NO sign-out (checked: no `signOut` in that file),
 *   so for an administrator the public navbar is still the only way out.
 *   Hiding it there would strand them, which is the trade `PublicFooterGate`
 *   refused and this does not reopen.
 *
 * ⚠️ If the admin sidebar ever gains a sign-out, `/admin` may join this list -
 * and `public-chrome.test.ts` reads both sidebars to keep this comment honest.
 */
const NAVBAR_PRIVATE_PREFIXES = ['/dashboard'] as const;

/**
 * Does this path get the public marketing navbar?
 *
 * On a phone the dashboard was wearing TWO stacked bars: the site header, and
 * the dashboard's own nav trigger directly beneath it - two hamburgers before
 * any content, and 40% of an 844px fold spent on chrome.
 *
 * Anchored for the same reason as `showsPublicFooter`, and an unreadable
 * pathname returns `true` for the same reason: a navbar where it is not wanted
 * is cosmetic, and a site with no navigation is not.
 */
export function showsPublicNavbar(pathname: string | null | undefined): boolean {
  if (!pathname || !pathname.startsWith('/')) return true;

  const path = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  return !NAVBAR_PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
