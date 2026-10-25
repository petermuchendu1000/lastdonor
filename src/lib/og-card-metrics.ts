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

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
