/**
 * This sharer's attributed link, or the plain URL if one cannot be had.
 *
 * ## Why this is a module and not a copy in each component
 *
 * `docs/58` established that a signed-in person gets a countable
 * `/s/<token>` from a share surface, because `/dashboard/impact` can only
 * report what a link carried. The mint was then implemented inside
 * `SidebarShareButton`, and when a second surface needed it the obvious move
 * was to copy those twenty lines - which is how `docs/110` ended up with
 * seven divergent ideas of one status map. One implementation, two callers.
 *
 * ## The three properties that are deliberate
 *
 *  - **Minted on demand, never on mount.** A mint is a write. Resolving at
 *    render would create a link for every campaign a signed-in person merely
 *    looked at, and "Campaigns shared: 47" would then count 47 pages they
 *    scrolled past. See `docs/58`.
 *  - **Bounded, and never blocking.** `MINT_TIMEOUT_MS` caps the wait and
 *    every failure answers with the plain URL. Attribution is an
 *    enhancement; the share itself is the feature.
 *  - **`unknown` auth shares the plain URL.** Per `docs/44` a failed or
 *    rate-limited session read must not be read as signed out. Here it means
 *    no attribution, which is the harmless reading.
 */

/**
 * How long we will wait for an attributed link before sharing the plain URL.
 *
 * A sharer on a slow network gets an uncredited share, which is worse than a
 * credited one and far better than a control that appears broken.
 */
export const MINT_TIMEOUT_MS = 1_500;

/**
 * POST the mint route and return the attributed URL, or `null` if anything at
 * all went wrong. The caller decides what to fall back to, so this never
 * invents a URL of its own.
 *
 * `mintShareLink` is idempotent per (campaign, signed-in user), so calling
 * this twice costs one row and returns one token - a sharer who taps Share
 * ten times keeps one countable link instead of ten links none of which shows
 * their real total.
 */
export async function mintAttributedUrl(campaignSlug: string): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/v1/campaigns/${encodeURIComponent(campaignSlug)}/share-link`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    const body = await response.json();
    const attributed = body?.data?.url;
    return typeof attributed === 'string' && attributed ? attributed : null;
  } catch {
    // Offline, timed out, 401, malformed - all the same answer. Nothing here
    // is worth a toast; the sharer asked to share, not to hear about fetch.
    return null;
  }
}
