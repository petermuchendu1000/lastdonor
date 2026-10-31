/**
 * How long an M-Pesa PIN prompt can plausibly still be live.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────────
 *
 * Both the server and the donor's browser need this number, and they must not
 * hold two copies of it:
 *
 *   - `payhero-abuse-guard.ts` refuses a second prompt to the same phone while
 *     one is still live, and `status/route.ts` uses it to decide when to stop
 *     telling the client to poll;
 *   - `MpesaDonationForm` derives its own poll ceiling from it, and that
 *     ceiling MUST exceed the lifetime or the browser gives up while the
 *     prompt is still answerable (`docs/159`).
 *
 * It used to live in `payhero-abuse-guard.ts`, which imports `@/db` — so a
 * client component could not reach it without pulling the database client into
 * the bundle. `docs/139` §7 is the rule: a constant shared across the
 * server/client boundary lives in a module neither side owns. ⛔ This file
 * must therefore import NOTHING.
 */

/**
 * Three minutes. Safaricom's STK prompt expires well before this; the margin
 * is deliberate, because the consequence of being too SHORT is refusing a
 * donor who is still typing their PIN, and the consequence of being too long
 * is only a slightly later retry.
 */
export const PROMPT_LIFETIME_MS = 3 * 60_000;

/**
 * What a donor is told when PayHero collected the money and no donation row
 * was written.
 *
 * ── WHY IT IS SHARED ───────────────────────────────────────────────────────
 *
 * Three branches of `status/route.ts` can reach this outcome - the first poll,
 * a poll that lost the settlement race, and every later poll reading the
 * terminal row - and `docs/146`'s rule is that one question gets one answer.
 * A second copy of this sentence is a second answer.
 *
 * ⛔ It states only what is established: PayHero reported SUCCESS, and no
 * donation exists. It does NOT promise a refund - nothing in this platform
 * returns money on a clock (`docs/140` PART A) and PayHero exposes no refund
 * API at all (`docs/122`) - and it does not say "nothing has been charged",
 * which would be the `docs/158` error with its sign flipped: here we KNOW the
 * money moved.
 */
export const COLLECTED_UNRECORDED_MESSAGE =
  'Your payment went through, but we could not record it as a donation.';

/** What the status route may answer for a collection PayHero has settled. */
export type SettledCollectionClaim = 'succeeded' | 'collected_unrecorded';

/**
 * Whether a settled collection may be reported to the donor as a donation.
 *
 * ── WHY THIS IS A PURE FUNCTION AND NOT AN INLINE TERNARY ──────────────────
 *
 * It was an inline ternary in `status/route.ts`, guarded by a structural
 * test: one answering site, and that site must mention `donationId`. An
 * injection then INVERTED it - claim success when nothing was booked, refuse
 * when it was - and **every rule still passed**, because a text rule cannot
 * see which way a ternary points (`docs/162` §5.1).
 *
 * `docs/157` §4.1 settled this shape: the judgement has to be pure so a test
 * can execute it on both inputs. The direction is now verified, not read.
 *
 * ⛔ A donation row is the ONLY evidence that the money was booked. A
 * `succeeded` request row is evidence that PayHero COLLECTED it, which is a
 * different claim.
 */
export function claimForSettledCollection(
  donationId: string | null | undefined,
): SettledCollectionClaim {
  return donationId == null ? 'collected_unrecorded' : 'succeeded';
}
