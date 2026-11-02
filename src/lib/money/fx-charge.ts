/**
 * The credit-to-charge arithmetic. Pure, and deliberately rate-blind.
 *
 * ── WHY THIS IS NOT AN "FX MODULE" ────────────────────────────────────────
 *
 * `fx-display-only.ratchet.test.ts` keeps an allowlist of files that may
 * "see an exchange rate", and its header warns that a list growing past a
 * handful has stopped being a boundary. So the split matters.
 *
 * This file READS NO SNAPSHOT and holds no rate. It takes numbers as
 * arguments and returns a number - it can no more leak a rate than
 * `Math.round` can. What the boundary is actually about is reading
 * `fx-store.server`, and nothing here does.
 *
 * `convertWithRates` is the same shape and lives inside `fx-convert.ts` only
 * because it shares a file with the snapshot reader.
 *
 * The consequence that makes this worth doing: the donation form is a client
 * component, and `fx-quote.server.ts` reaches `@/db` through the snapshot
 * reader. The form needs this arithmetic to state the charge honestly while
 * the donor types, and it gets the rate as a plain prop from a server page
 * that IS allowlisted.
 */

/** Minor units per major unit, from the currency's exponent. */
function minorPer(exponent: number): number {
  return 10 ** exponent;
}

/**
 * What to charge, in minor units of the charge currency, for a given credit.
 *
 * `rate` on each side is that currency's units per one unit of the
 * snapshot's base (USD), so the cross rate is one divided by the other.
 *
 * ⛔ Exponents are parameters, not a hardcoded 100. `CURRENCIES` holds only
 * USD and KES and both are exponent 2, which makes the two forms
 * behaviourally identical today - `fx-convert.ts` records a mutation test
 * proving the hardcoded version survives the entire suite - and a 100x error
 * the day a zero-decimal currency (UGX, RWF, XOF, XAF) becomes collectable.
 * Taking them as parameters means the case can be exercised now.
 *
 * ⛔ Rounds UP, never to nearest. The campaign is credited exactly what the
 * donor chose, so the charge must never be short; the residue is at most one
 * `roundUpToMultiple` and is absorbed by the platform.
 */
export function chargeMinorFor(
  creditMinor: number,
  credit: { exponent: number; rate: number },
  charge: { exponent: number; rate: number },
  marginBps: number,
  roundUpToMultiple: number,
): number {
  const effectiveRate = (charge.rate / credit.rate) * (1 + marginBps / 10_000);
  const creditMajor = creditMinor / minorPer(credit.exponent);
  const chargeMinorExact = creditMajor * effectiveRate * minorPer(charge.exponent);
  return Math.ceil(chargeMinorExact / roundUpToMultiple) * roundUpToMultiple;
}

/**
 * Everything a client needs to state the charge while the donor types.
 *
 * `rateMicro` is the MID-market rate x1_000_000, and `marginBps` is applied
 * on top - the same two numbers persisted on the request row, so what the
 * donor was shown and what the server quoted cannot drift apart.
 *
 * `null` when the campaign is denominated in the rail's own currency, which
 * is the case where there is nothing to convert and nothing to disclose.
 */
export type ChargePreview = {
  readonly chargeCurrency: string;
  readonly chargeExponent: number;
  readonly creditExponent: number;
  readonly rateMicro: number;
  readonly marginBps: number;
  /** PayHero takes whole major units only, so the M-Pesa caller passes 100. */
  readonly roundUpToMultiple: number;
};

/** Applies a `ChargePreview` to an amount the donor has typed. */
export function previewChargeMinor(
  preview: ChargePreview,
  creditMinor: number,
): number {
  return chargeMinorFor(
    creditMinor,
    { exponent: preview.creditExponent, rate: 1_000_000 },
    { exponent: preview.chargeExponent, rate: preview.rateMicro },
    preview.marginBps,
    preview.roundUpToMultiple,
  );
}
