/**
 * "Round up to the next round figure" at the moment of giving.
 *
 * This is the M-Pesa-compatible half of the round-up idea. It is NOT the
 * Acorns model: there is no balance, no mandate and no background charge.
 * The donor is offered a larger number before they authorise, and if they
 * take it the result is byte-identical to their having typed it — one
 * authorised debit, on the rail that works.
 *
 * ── Why it rounds the CREDIT and never the CHARGE ───────────────────────
 *
 * ⛔ Load-bearing (`docs/168`). The donor enters an amount in the CAMPAIGN's
 * currency and `quoteCharge` derives what their phone is debited in KES.
 * Rounding the CHARGE up would take more from the donor while crediting the
 * campaign the same — which is a spread, i.e. LastDonor revenue, and the
 * platform promises "We take 0%… we receive no part of that fee" in five
 * live surfaces. `FX_MARGIN_BPS` is 0 for exactly that reason.
 *
 * So this function rounds the credit. The charge re-derives from it through
 * the existing quote, and every shilling of the increase reaches the
 * campaign.
 *
 * ── Why a step per currency ─────────────────────────────────────────────
 *
 * A "round figure" is a fact about how people in a currency think, not an
 * arithmetic property. KES 100 is the note a Kenyan donor reaches for; the
 * dollar is the unit of spare change the Acorns model is named after. Same
 * reasoning as `presetsFor`'s KES ladder in `MpesaDonationForm`.
 *
 * ⛔ A currency with no step gets NO offer, rather than a guessed one — the
 * `docs/103` rule that a currency we merely know is not a currency we can
 * act in. `round-up.test.ts` asserts every collectable currency has a step,
 * so adding one to `CURRENCIES` without deciding its step fails the build.
 */
import { CURRENCIES, getCurrency } from './currencies';
import { previewChargeMinor, type ChargePreview } from './fx-charge';

/**
 * The "next round figure" step, in MINOR units of each currency.
 *
 * KES 100.00 and USD 1.00. Both currencies have exponent 2, so these are
 * 100x their major value; they are written as the arithmetic rather than as
 * bare literals so a zero-decimal currency cannot inherit a 100x error
 * (`docs/118` §10's `* 100` trap).
 */
export const ROUND_UP_STEP_MINOR: Readonly<Record<string, number>> = Object.freeze({
  KES: 100 * 10 ** 2,
  USD: 1 * 10 ** 2,
});

/**
 * The arithmetic, with its bounds passed in.
 *
 * ⚠️ Split out from `roundUpOffer` for one reason, and it is a Gate-4 reason
 * rather than tidiness: with today's constants the maximum guard below
 * **cannot fire**. KES 25,000,000 / 10,000 = 2,500 and USD 10,000,000 / 100
 * = 100,000, both exact — so `Math.ceil` of any in-bounds amount lands on or
 * below the maximum, and a test driven only through `roundUpOffer` would
 * pass with the guard deleted.
 *
 * Taking the bounds as arguments makes that branch reachable, so the test
 * can prove it bites. `round-up.test.ts` also pins the divisibility fact, so
 * if a future `maxDonationMinor` stops being a whole number of steps the
 * guard is already there and already tested.
 */
export function nextRoundFigure(
  amountMinor: number,
  stepMinor: number,
  maxMinor: number,
): number | null {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return null;
  if (!Number.isInteger(stepMinor) || stepMinor <= 0) return null;

  // Ceil, never round: rounding to NEAREST would offer to REDUCE the
  // donation whenever the amount sits below the midpoint of its step.
  const rounded = Math.ceil(amountMinor / stepMinor) * stepMinor;

  // Already on a round figure — every preset is, so presets never show this.
  if (rounded === amountMinor) return null;

  /*
    ⛔ THE INVARIANT. `withinBounds` gates `canSubmit`, so an offer above the
    maximum would hand the donor a tile that DISABLES the pay button. Worse
    than no feature.
  */
  if (rounded > maxMinor) return null;

  return rounded;
}

/**
 * The amount to offer, or `null` when there is nothing honest to offer.
 *
 * `null` for: a currency with no step, an amount already on a round figure,
 * an amount outside the donation bounds, or a rounded figure that would be
 * refused — by the credit bound, or by the charge bound after conversion.
 *
 * @param creditMinor what the donor has entered, in minor units of
 *   `creditCurrency`. This is the CREDIT (`initiate/route.ts:168`).
 * @param creditCurrency the campaign's own currency.
 * @param charge the live conversion preview, or null when the campaign is
 *   already denominated in the rail's currency and nothing converts.
 */
export function roundUpOffer(
  creditMinor: number,
  creditCurrency: string,
  charge?: ChargePreview | null,
): number | null {
  if (!Number.isInteger(creditMinor) || creditMinor <= 0) return null;

  const step = ROUND_UP_STEP_MINOR[creditCurrency];
  if (step === undefined || step <= 0) return null;

  const def = CURRENCIES[creditCurrency];
  if (def === undefined) return null;

  /*
    Only offer from a position that is already payable. If what the donor has
    typed is out of bounds the form is already telling them so, and a
    round-up tile beside that message would be a second answer to one
    question.
  */
  if (creditMinor < def.minDonationMinor || creditMinor > def.maxDonationMinor) {
    return null;
  }

  /*
    ⛔ No offer below the first round figure.

    Found by a test that expected every preset to be silent and was not:
    the KES 50.00 floor tile is not a multiple of KES 100.00, so the
    arithmetic cheerfully offered to round it to KES 100.00 — DOUBLING the
    smallest gift the platform accepts, aimed at the donor who chose the
    cheapest tile on the ladder. Correct arithmetic, bad behaviour, and the
    kind of nudge `docs/94` and `docs/127` keep out of this product.

    The rule is derived from the step rather than from an invented
    percentage: you cannot round to the NEXT round figure before reaching
    the first one.

    ⚠️ Accepted limitation, not solved: an amount just above a step (Ksh
    101.00) still rounds to Ksh 200.00, a large relative jump. Any
    round-to-next-multiple has that property near a boundary. It is left
    because the offer states the exact figure and is opt-in — it can be
    ignored, never applied by surprise.
  */
  if (creditMinor < step) return null;

  const rounded = nextRoundFigure(creditMinor, step, def.maxDonationMinor);
  if (rounded === null) return null;

  /*
    And the charge has its own bounds, checked server-side at
    `initiate/route.ts:235` against the charge currency. A credit inside its
    own bounds can convert to a charge outside the rail's, so the offer is
    withheld rather than refused after the donor has committed to it.
  */
  if (charge) {
    const chargeDef = CURRENCIES[charge.chargeCurrency];
    if (chargeDef === undefined) return null;
    const chargeMinor = previewChargeMinor(charge, rounded);
    if (chargeMinor < chargeDef.minDonationMinor || chargeMinor > chargeDef.maxDonationMinor) {
      return null;
    }
  }

  return rounded;
}

/** The extra the campaign receives if the offer is taken, in credit minor units. */
export function roundUpIncrementMinor(
  creditMinor: number,
  offerMinor: number,
): number {
  return offerMinor - creditMinor;
}

/**
 * Exposed so a test can assert the step table covers every collectable
 * currency, rather than the table validating itself.
 */
export function hasRoundUpStep(currency: string): boolean {
  return ROUND_UP_STEP_MINOR[getCurrency(currency).code] !== undefined;
}
