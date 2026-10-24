/**
 * Which routes wear the public marketing chrome.
 *
 * `src/app/layout.tsx` is the ONLY root layout, so everything it renders wraps
 * every route - including `/admin`, an authenticated internal tool that was
 * carrying a newsletter signup and a four-column marketing footer taking
 * roughly half the screen.
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
const PRIVATE_PREFIXES = ['/admin'] as const;

/**
 * Does this path get the public marketing footer?
 *
 * ⚠️ ANCHORED, deliberately. A bare `startsWith('/admin')` also matches
 * `/administrator` and `/admin-guide`, which is the same prefix-dragging bug
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
