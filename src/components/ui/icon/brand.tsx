import { createIcon } from './createIcon';

/**
 * Icons that are ours, because the concept is ours.
 *
 * A generic set has no mark for "a human read this campaign before it went
 * live" or "this is what your money bought, with the receipt attached".
 * Those are the two things this product is actually about, and they were
 * being represented by a borrowed shield and a borrowed eye.
 *
 * Every path is drawn on the same 24x24 grid as the rest of the system and
 * inherits stroke, colour and size from `createIcon`, so these sit beside
 * the generic icons without looking pasted in.
 *
 * See `docs/70`.
 */

/**
 * Reviewed: a document with a check, not a shield.
 *
 * A shield says "protected", which is a claim about security. What actually
 * happens here is that a person reads the campaign and its supporting
 * documents before it is allowed to go live, so the mark is a page with a
 * tick, not armour. It replaces `ShieldCheckIcon` at the places that mean
 * review rather than safety.
 */
export const ReviewedIcon = createIcon(
  'ReviewedIcon',
  <>
    <path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5Z" />
    <path d="M14.5 3v3.5a1 1 0 0 0 1 1H19" />
    <path d="m8.75 13.25 2 2 4-4.5" />
  </>,
);

/**
 * Impact update: a photograph with a receipt behind it.
 *
 * The product promise is a photo AND the receipt that proves what it cost,
 * so the mark carries both. An eye, which this replaces, says "visible" and
 * stops there.
 */
export const ImpactUpdateIcon = createIcon(
  'ImpactUpdateIcon',
  <>
    <path d="M20 8.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h1.3a1 1 0 0 0 .86-.49l.74-1.26a1 1 0 0 1 .86-.5h4.48a1 1 0 0 1 .86.5l.74 1.26a1 1 0 0 0 .86.49H18a2 2 0 0 1 2 2Z" />
    <circle cx="12" cy="12.75" r="3.25" />
  </>,
);

/**
 * Zero platform fee.
 *
 * A currency glyph says "money", not "none of it is ours". A struck-through
 * percent does. Used wherever the 0% claim is made as a mark rather than as
 * a sentence.
 */
export const ZeroFeeIcon = createIcon(
  'ZeroFeeIcon',
  <>
    {/*
      A banknote struck through, not a struck-through percent.

      Two earlier attempts failed at the size this is actually used. A bare
      percent glyph read as "fee", the opposite of the claim. Adding a
      perpendicular bar to negate it produced two crossing diagonals over
      two small circles, which reads as a scribble at 32px and as mud at 16.

      Three large shapes survive the scale instead: the note, the coin
      inside it, and one slash. Each is legible on its own at `sm`, which is
      the size this renders at in the trust bar.
    */}
    <rect x="2.75" y="6.25" width="18.5" height="11.5" rx="2" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M3.5 19.75 20.5 4.25" />
  </>,
);
/**
 * Receipt: the document a donor is promised, with the amount line called out.
 */
export const ReceiptIcon = createIcon(
  'ReceiptIcon',
  <>
    <path d="M6 3h12a1 1 0 0 1 1 1v16.5a.5.5 0 0 1-.76.43L16 19.5l-2.24 1.43a.5.5 0 0 1-.52 0L11 19.5l-2.24 1.43a.5.5 0 0 1-.52 0L6 19.5l-2.24 1.43A.5.5 0 0 1 3 20.5V4a1 1 0 0 1 1-1Z" />
    <path d="M8 8.5h8" />
    <path d="M8 12.5h5" />
  </>,
);

/**
 * Payout: money leaving the platform for a verified account, which is the
 * direction that matters. An arrow out of a card, not a generic bank.
 */
export const PayoutIcon = createIcon(
  'PayoutIcon',
  <>
    <path d="M21 11V7.5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7" />
    <path d="M3 10h18" />
    <path d="M16.5 20.5 20 17l-3.5-3.5" />
    <path d="M20 17h-6.5" />
  </>,
);

/**
 * The last donor: the person who closes a campaign.
 *
 * A heart completed by a final mark. This is the product's own idea and had
 * no representation at all.
 */
export const LastDonorIcon = createIcon(
  'LastDonorIcon',
  <>
    <path d="M12 20.25s-7.5-4.6-7.5-9.75a4.25 4.25 0 0 1 7.5-2.75 4.25 4.25 0 0 1 7.5 2.75c0 1.2-.41 2.33-1.04 3.37" />
    <path d="m14 17.5 2 2 4-4" />
  </>,
);

/**
 * A campaign still waiting for its first donation. Used for the zero state,
 * where a progress bar would otherwise render as an empty trough.
 */
export const FirstDonationIcon = createIcon(
  'FirstDonationIcon',
  <>
    <circle cx="12" cy="12" r="8.25" strokeDasharray="2.5 3" />
    <path d="M12 8.5v7" />
    <path d="M14 10.25a2.25 2.25 0 0 0-2-1.25c-1.24 0-2.25.78-2.25 1.75S10.76 12.25 12 12.25s2.25.78 2.25 1.75S13.24 15.75 12 15.75a2.25 2.25 0 0 1-2-1.25" />
  </>,
);
