/**
 * A CHARGE QUOTE: how much to collect in the rail's currency for a given
 * credit in the campaign's currency.
 *
 * ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
 *
 * `campaigns.currency` is the DENOMINATION - what the appeal is stated in,
 * USD for a global audience. The rail's currency is whatever the rail can
 * actually charge: [VERIFIED] `initiateStkPush` sends `amount` with NO
 * currency field (`payhero.ts:503`), so M-Pesa charges KES and that is not a
 * choice we get to make.
 *
 * Every multi-currency processor models this as two currencies, not one.
 * Stripe calls them PRESENTMENT and SETTLEMENT
 * (https://docs.stripe.com/currencies); GoFundMe's donor "enters the amount
 * in the campaign's currency" and "is charged the equivalent" in theirs. We
 * are copying that shape, not inventing one.
 *
 * ── THE FX BOUNDARY IS CROSSED HERE, ON PURPOSE ───────────────────────────
 *
 * `fx-display-only.ratchet.test.ts` exists because "an exchange rate is the
 * one tool that makes violating [one-currency-per-campaign] feel reasonable".
 * That rule is still right. What changed is that a rate now legitimately
 * decides a charge - so this module is itself listed in `FX_MODULES`, and
 * anything importing it has to say so in the allowlist. The boundary moved;
 * it was not quietly stepped around.
 *
 * What replaces "display only" is stricter, not looser:
 *
 *   1. STALENESS REFUSES THE CHARGE. A display can skip a figure; a charge
 *      cannot guess one. Past `MAX_FX_AGE_HOURS` this returns a refusal and
 *      no money is asked for.
 *   2. THE QUOTE IS RECORDED. The rate and the moment it was read are
 *      persisted on the request row, so the conversion is reproducible.
 *   3. THE RATE IS NEVER RE-DERIVED. Settlement reads the recorded quote.
 *      `payment-service.ts` still may not import FX at all - re-reading the
 *      rate there would move the credit after the donor had agreed to it.
 *
 * ── THE MARGIN ────────────────────────────────────────────────────────────
 *
 * `FX_MARGIN_BPS` is 0: mid-market, no spread. Owner decision, 2026-11-02.
 *
 * ⛔ It is not 0 out of timidity. The platform tells donors, in five live
 * surfaces including the share-card image and the Organization JSON-LD on
 * every page, "We take 0%... we receive no part of that fee". There is no
 * third-party FX cost to pass through either - PayHero collects KES into a
 * KES wallet and performs no conversion - so any spread would be LastDonor
 * revenue and would make that promise false. Raising this constant is
 * therefore a copy change first and a code change second; see docs/168.
 *
 * For reference, the market: Wise 0% (fee charged separately), Stripe 1%
 * (its published currency-conversion rate), PayPal 3-4.5%.
 */
import { getCurrency, isSupportedCurrency } from '@/lib/money/currencies';
import { isFxFresh, MAX_FX_AGE_HOURS } from '@/lib/money/fx-convert';
import { readFxSnapshot } from '@/lib/money/fx-store.server';
import type { FxSnapshot } from '@/lib/money/fx-providers';

/** The spread applied over mid-market, in basis points. 0 = none. */
export const FX_MARGIN_BPS = 0;

export type ChargeQuote = {
  /** What the campaign is credited, in minor units of `creditCurrency`. */
  readonly creditMinor: number;
  readonly creditCurrency: string;
  /** What the donor is charged, in minor units of `chargeCurrency`. */
  readonly chargeMinor: number;
  readonly chargeCurrency: string;
  /**
   * MID-MARKET rate, charge-units per credit-unit, x1_000_000.
   * The margin is recorded separately and applied on top, so the two are
   * never conflated in the record.
   */
  readonly rateMicro: number;
  readonly marginBps: number;
  readonly quotedAt: Date;
};

export type QuoteRefusalReason =
  /** No snapshot stored at all. */
  | 'fx_unavailable'
  /** Older than MAX_FX_AGE_HOURS. A charge may not use a guessed rate. */
  | 'fx_stale'
  /** One side is not a currency this platform collects in. */
  | 'unsupported_currency'
  /** The snapshot carries no usable rate for one side. */
  | 'no_rate'
  /** Credit was not a positive whole number of minor units. */
  | 'bad_credit_amount';

export type QuoteResult =
  | { readonly ok: true; readonly quote: ChargeQuote }
  | { readonly ok: false; readonly reason: QuoteRefusalReason };

export type QuoteInput = {
  readonly creditMinor: number;
  readonly creditCurrency: string;
  readonly chargeCurrency: string;
  /**
   * Round the charge UP to a multiple of this many minor units.
   *
   * PayHero accepts WHOLE MAJOR UNITS only - [VERIFIED] `payhero.ts:472`
   * refuses `amountMinor % minorPerMajor !== 0` - so the M-Pesa caller passes
   * 100. Rounding UP, never to nearest, so we can never collect less than the
   * credit is worth; the residue is at most one minor-unit multiple
   * (~Ksh 1, under one US cent) and is absorbed by the platform.
   */
  readonly roundChargeUpToMultiple?: number;
};

/**
 * The arithmetic, with exponents and per-USD rates passed in.
 *
 * ⛔ Extracted so the ZERO-DECIMAL path can be tested. `CURRENCIES` holds
 * only USD and KES and both are exponent 2, which makes a hardcoded 100 and
 * a real exponent behaviourally identical today - `fx-convert.ts` records a
 * mutation test proving the hardcoded version survives the whole suite. That
 * is harmless now and a 100x error the day UGX, RWF, XOF or XAF becomes
 * collectable. Taking the exponent as a parameter means the case can be
 * exercised before such a currency exists, rather than being a comment
 * promising it works.
 *
 * Rounds the charge UP, never to nearest: we must never collect less than
 * the credit is worth.
 */
export function chargeMinorFor(
  creditMinor: number,
  credit: { exponent: number; rate: number },
  charge: { exponent: number; rate: number },
  marginBps: number,
  roundUpToMultiple: number,
): number {
  const effectiveRate = (charge.rate / credit.rate) * (1 + marginBps / 10_000);
  const creditMajor = creditMinor / 10 ** credit.exponent;
  const chargeMinorExact = creditMajor * effectiveRate * 10 ** charge.exponent;
  return Math.ceil(chargeMinorExact / roundUpToMultiple) * roundUpToMultiple;
}

/**
 * The pure quote, with the snapshot passed in.
 *
 * Separated from the IO so the stale path can be exercised without a
 * database - the same reason `convertWithRates` is split out of
 * `convertMinor`.
 */
export function quoteChargeFrom(
  snapshot: FxSnapshot,
  input: QuoteInput,
  now: Date = new Date(),
): QuoteResult {
  const { creditMinor, creditCurrency, chargeCurrency } = input;
  const multiple = input.roundChargeUpToMultiple ?? 1;

  if (!Number.isInteger(creditMinor) || creditMinor <= 0) {
    return { ok: false, reason: 'bad_credit_amount' };
  }
  if (!isSupportedCurrency(creditCurrency) || !isSupportedCurrency(chargeCurrency)) {
    return { ok: false, reason: 'unsupported_currency' };
  }
  /*
    ⛔ The hard gate. `convertMinor` returns null here and the UI renders
    nothing; a charge cannot do that - it would have to invent a rate. Past
    the staleness window we refuse to ask for money at all.
  */
  if (!isFxFresh(snapshot, now)) {
    return { ok: false, reason: 'fx_stale' };
  }

  const credit = getCurrency(creditCurrency);
  const charge = getCurrency(chargeCurrency);

  // Rates are per-USD, so the cross rate is one divided by the other.
  const rateCredit = snapshot.rates[credit.code];
  const rateCharge = snapshot.rates[charge.code];
  const usable = (r: unknown): r is number =>
    typeof r === 'number' && Number.isFinite(r) && r > 0;
  if (!usable(rateCredit) || !usable(rateCharge)) {
    return { ok: false, reason: 'no_rate' };
  }

  const midRate = rateCharge / rateCredit;
  const chargeMinor = chargeMinorFor(
    creditMinor,
    { exponent: credit.exponent, rate: rateCredit },
    { exponent: charge.exponent, rate: rateCharge },
    FX_MARGIN_BPS,
    multiple,
  );

  return {
    ok: true,
    quote: {
      creditMinor,
      creditCurrency: credit.code,
      chargeMinor,
      chargeCurrency: charge.code,
      rateMicro: Math.round(midRate * 1_000_000),
      marginBps: FX_MARGIN_BPS,
      quotedAt: new Date(now),
    },
  };
}

/** Reads the stored snapshot, then quotes. One database read. */
export async function quoteCharge(
  input: QuoteInput,
  now: Date = new Date(),
): Promise<QuoteResult> {
  const snapshot = await readFxSnapshot();
  if (!snapshot) return { ok: false, reason: 'fx_unavailable' };
  return quoteChargeFrom(snapshot, input, now);
}

/** For the donor-facing message, so the refusal says something true. */
export function quoteRefusalMessage(reason: QuoteRefusalReason): string {
  switch (reason) {
    case 'fx_stale':
    case 'fx_unavailable':
    case 'no_rate':
      /*
        No turnaround quoted (docs/78), and no claim about the donor's money,
        because nothing has been asked for yet.
      */
      return (
        'We cannot work out the M-Pesa amount for this campaign right now, so ' +
        'we have not asked for any money. Please try again shortly.'
      );
    case 'unsupported_currency':
      return 'This campaign cannot be paid by M-Pesa yet.';
    case 'bad_credit_amount':
      return 'Enter a whole amount.';
  }
}

/** Exported for the tests that pin the staleness window to the shared constant. */
export { MAX_FX_AGE_HOURS };
