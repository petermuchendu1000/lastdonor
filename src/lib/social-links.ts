/**
 * The platform's social profiles. ONE list, two consumers.
 *
 * `Footer` renders it, and the Organization JSON-LD in `src/app/layout.tsx`
 * publishes it as `sameAs`. Keeping them on one list is the point: `sameAs`
 * is how a search engine resolves "is this the same organisation as that
 * account", and a footer link and a schema claim that disagree are worse
 * than either alone.
 *
 * ── A placeholder is `href: null`, and it is not a claim ──────────────────
 *
 * Added 2026-10-19 at the owner's request, ahead of the real URLs. An entry
 * with `href: null` is a platform we intend to be on and are not yet. It
 * renders in the footer as inert text, NOT as a link, and it is excluded
 * from `sameAs` entirely.
 *
 * That exclusion is the whole safety property of this file, so it is worth
 * saying why it is not merely tidiness. `sameAs` is not a link list. It is
 * a machine-readable assertion that the organisation described by this page
 * owns the account at that URL. A `sameAs` entry pointing at a handle we do
 * not control is a false ownership claim about someone else's account, made
 * to a search engine, by a site that asks strangers for money.
 *
 * The previous version of this file carried the consequence of getting that
 * wrong:
 *
 *     https://www.linkedin.com/company/lastdonor   → HTTP 404
 *     https://x.com/lastdonororg                   → HTTP 404
 *
 * Checked 2026-10-16, calibrated against GoFundMe's equivalents on the same
 * request shape, which return 200 — so the 404s were the absence of an
 * account, not a bot wall. See docs/76 and docs/91.
 *
 * ── Filling one in ────────────────────────────────────────────────────────
 *
 * Replace `href: null` with the canonical profile URL. The footer link and
 * the `sameAs` entry both appear from that one edit; nothing else changes.
 *
 * **Load the URL in a browser first.** Only add a profile that exists and
 * that this organisation controls. A nearly-right handle — the name taken
 * by someone else, a personal account, a parked page — is the failure mode
 * this file exists to prevent, and it is not caught by any test here,
 * because testing it needs the network.
 *
 * To drop a platform, delete its entry rather than leaving it null forever.
 */
export interface SocialLink {
  /** Shown to the visitor and used as the accessible name. */
  name: string;
  /**
   * The canonical profile URL, or `null` while the account does not exist.
   *
   * `null` means: render inert, publish nothing. It must never become a
   * guess at what the URL will probably be.
   */
  href: string | null;
}

/**
 * Platforms chosen by the owner on 2026-10-19. All awaiting real URLs.
 *
 * Order is the order they render in the footer: the four a crowdfunding
 * platform is conventionally found on first (GoFundMe's own footer carries
 * exactly these four), then video, then messaging.
 */
export const SOCIAL_LINKS: readonly SocialLink[] = [
  { name: 'X', href: null },
  { name: 'Instagram', href: null },
  { name: 'Facebook', href: null },
  { name: 'LinkedIn', href: null },
  { name: 'TikTok', href: null },
  { name: 'YouTube', href: null },
  // WhatsApp is here because `SMS_DEFAULT_REGION` is KE (docs/82) and it is
  // the dominant channel in that market, not because it is a conventional
  // footer entry for a US-facing site. That tension is the same one docs/82
  // parked at one constant.
  { name: 'WhatsApp', href: null },
];

/**
 * Only the profiles that actually exist.
 *
 * This is what `sameAs` publishes and what the footer links. Anything that
 * asserts ownership reads from here, never from `SOCIAL_LINKS` directly.
 */
export const PUBLISHED_SOCIAL_LINKS: readonly (SocialLink & { href: string })[] =
  SOCIAL_LINKS.filter((link): link is SocialLink & { href: string } => link.href !== null);
