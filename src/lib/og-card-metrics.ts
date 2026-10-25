/**
 * The share card's measurements, derived rather than chosen.
 *
 * ## The problem one image has to solve
 *
 * One 1200x630 picture is served to every platform, and each renders it at a
 * different width. **Nothing in the card is responsive**, so every type size
 * has to survive the NARROWEST rendering, not the average one.
 *
 * Measured from the per-platform frames in `docs/112` §8:
 *
 * | rendering | card width | downscale |
 * |---|---|---|
 * | iMessage | 290px | **4.14x** |
 * | Signal / Messenger / Instagram DM | 300px | 4.00x |
 * | WhatsApp | 322px | 3.73x |
 * | Slack / Discord | 330-340px | 3.6x |
 * | Facebook / X / LinkedIn / Threads / Bluesky | ~400px | 3.00x |
 *
 * So a message bubble shows the card at **a quarter size**. At the previous
 * scale that made four of six elements illegible, and left the TITLE - the
 * single most important thing on the card - at 10.6 effective pixels.
 *
 * ## The rule
 *
 * `cardPx = effectivePx x downscale`. Two tiers, because one number cannot
 * serve both jobs:
 *
 *  - **Primary** (title, amount) must read in a message bubble, so they are
 *    sized against `WORST_DOWNSCALE`.
 *  - **Secondary** (brand, context, goal line, guarantee) is sized against
 *    `FEED_DOWNSCALE`. It reads in a feed and is decorative in a bubble.
 *    That is a deliberate trade: making it legible at 4.14x would need 41px+
 *    each and there is not room for six such lines on one card.
 *
 * ⛔ Do not shrink a primary size to fit more in. The card loses its job the
 * moment the title cannot be read in a WhatsApp bubble, which is where this
 * platform's links actually travel (`docs/92`: the live rail is M-Pesa).
 */

/** Narrowest observed rendering: iMessage, 290px of a 1200px card. */
export const WORST_DOWNSCALE = 1200 / 290;

/** What a feed gives it: ~400px. */
export const FEED_DOWNSCALE = 1200 / 400;

/** Smallest size that reads comfortably on a phone. */
export const MIN_EFFECTIVE_PX = 10;

/** What the title and the amount are held to, in a message bubble. */
export const PRIMARY_EFFECTIVE_PX = 12;

/** Card-space size needed for a given effective size at a given downscale. */
export function cardPx(effectivePx: number, downscale: number): number {
  return Math.ceil(effectivePx * downscale);
}

/**
 * The type scale, in card pixels.
 *
 * Every value is justified by the two functions above; a test recomputes
 * them rather than pinning the numbers, so changing a downscale changes the
 * requirement and the test says so.
 */
export const OG_TYPE = {
  /** Secondary. Brand mark. */
  wordmark: 30,
  /** Secondary. `Category · Location`. */
  context: 30,
  /** PRIMARY. Must read at 4.14x. */
  title: 60,
  /** PRIMARY. The amount raised, or the zero-state ask. */
  headline: 52,
  /** Secondary. Goal and donor count. */
  subline: 30,
  /** Secondary. The review guarantee. */
  trust: 30,
} as const;

/**
 * Sizes the title may take, largest first.
 *
 * `title` above is the TOP of this ladder, not a fixed size: a short title
 * gets it, a long one steps down until the whole thing fits. The floor is
 * sized so the longest title the validator allows - 200 characters,
 * `src/lib/validators/campaign.ts:30` - still fits without truncation.
 *
 * The floor of 24 is MEASURED, not chosen: 200 characters of `W` - the
 * widest glyph in this face, and the worst string the validator can accept -
 * needs 7 lines and 192px of the 216px box at 24px, and does not fit at 26.
 * Real 200-character prose fits at 28px, and the longest title in production
 * (79 characters) fits at 48.
 *
 * ⛔ Do not raise the floor to make the card prettier. Below it the choice is
 * between a smaller title and a title with its ending cut off, and `docs/112`
 * §9 is about why the ending matters. ⚠️ A title long enough to reach the
 * floor is unreadable on every platform anyway - the answer to that is a
 * shorter title, not a cropped one.
 */
export const TITLE_SIZES = [60, 54, 48, 42, 36, 32, 28, 26, 24] as const;

/** Usable text width inside the right panel: 744px panel less 48px padding. */
export const TITLE_BOX_WIDTH = 744 - 48 * 2;

/**
 * Vertical space the title block may take.
 *
 * Derived: 630 card, less 80px of panel padding, less the measured height of
 * everything else on the panel (wordmark, context, the money block, the
 * progress bar and the guarantee). A test recomputes it.
 */
export const TITLE_BOX_HEIGHT = 216;

/** Line height the title is set at, used by both the fit and the render. */
export const TITLE_LINE_HEIGHT = 1.14;

/**
 * The letterform on the no-photograph panel.
 *
 * Deliberately NOT part of `OG_TYPE`: it is a brand mark, not text somebody
 * reads, so the legibility rules do not apply to it and it is allowed to be
 * larger than the title.
 */
export const FALLBACK_MARK_PX = 120;

/** Which entries must clear `PRIMARY_EFFECTIVE_PX` at `WORST_DOWNSCALE`. */
export const PRIMARY_KEYS = ['title', 'headline'] as const;

/**
 * Output budget.
 *
 * ⚠️ [COMMUNITY-OBSERVED, NOT A DOCUMENTED LIMIT - 2026-10-25] Meta
 * documents no file-size limit for a WhatsApp link preview; its developer
 * docs state only a 300px minimum width and a ratio of 4:1 or less. Multiple
 * third-party guides report that an `og:image` over roughly 300KB causes
 * WhatsApp to silently drop the preview image, while others give 600KB. The
 * sources do not agree, and none is authoritative.
 *
 * Treated as a safety target rather than a fact: the card is emitted as JPEG
 * and lands far enough below the lower figure that the disagreement stops
 * mattering. The previous PNG cards were **798-928KB in production**, over
 * even the generous reading.
 */
export const MAX_CARD_BYTES = 300 * 1024;

/**
 * JPEG quality. 90 measured at ~140KB against the heaviest photograph on the
 * platform, against 437KB for the same card as PNG - a quarter of the size
 * with margin to spare, and high enough that JPEG ringing around the text
 * stays invisible at any size the card is actually displayed.
 */
export const CARD_JPEG_QUALITY = 90;

/**
 * Bumped whenever the card's DESIGN changes, and appended to the `og:image`
 * URL.
 *
 * ⚠️ What this does and does not do. Platforms cache the scraped page - the
 * tags - AND the image bytes, keyed by the image URL. A new URL makes them
 * fetch fresh bytes **on their next scrape of the page**. It does NOT force
 * that scrape: Facebook will keep serving its cached card until it re-scrapes
 * (someone shares the link again, its own TTL expires, or somebody with an
 * access token asks it to). See `docs/112` §9.2.
 *
 * So this is for every future change, not for the backlog already cached.
 */
export const CARD_VERSION = 2;

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
