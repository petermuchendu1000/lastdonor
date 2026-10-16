/**
 * The platform's social profiles. ONE list, two consumers.
 *
 * `Footer` renders it, and the Organization JSON-LD in `src/app/layout.tsx`
 * publishes it as `sameAs`. Keeping them on one list is the point: `sameAs`
 * is how a search engine resolves "is this the same organisation as that
 * account", and a footer link and a schema claim that disagree are worse
 * than either alone.
 *
 * ── Why this list is empty ────────────────────────────────────────────────
 *
 * It is not a placeholder waiting to be filled with something plausible. The
 * `sameAs` array in `layout.tsx` previously asserted two profiles:
 *
 *     https://www.linkedin.com/company/lastdonor   → HTTP 404
 *     https://x.com/lastdonororg                   → HTTP 404
 *
 * Checked 2026-10-16. Neither account exists. The check was calibrated
 * against GoFundMe's equivalents on the same request shape, which return
 * 200, so the 404s are the absence of an account and not a bot wall.
 *
 * The comment directly above that array reads "Keep the entity graph factual
 * and conservative. Donation/YMYL pages lose trust quickly when schema
 * asserts authority that the visible site cannot prove." It was right, and
 * the array under it did the opposite.
 *
 * ── Adding one ────────────────────────────────────────────────────────────
 *
 * Add the entry here and both the footer and `sameAs` pick it up. Only add a
 * profile that exists and that this organisation controls: an `href` here is
 * a public claim of ownership, and pointing at a handle someone else owns is
 * the failure mode this file exists to prevent. Load the URL before adding it.
 */
export interface SocialLink {
  /** Shown to the visitor and used as the accessible name. */
  name: string;
  /** The canonical profile URL. Must resolve, and must be ours. */
  href: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [];
