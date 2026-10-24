/**
 * The currencies this platform can hold money in.
 *
 * Every amount column in the schema is an INTEGER in a currency's *minor unit*
 * (`donations.amount`, `campaigns.goal_amount`, `campaigns.raised_amount`,
 * `campaigns.total_released_amount`, `campaigns.total_withdrawn_amount`,
 * `campaign_withdrawals.amount`, `users.total_donated`). Until 2026-10-21 that
 * minor unit was always USD cents and the exponent 2 was written into the code
 * as a literal `/ 100` in 105 places.
 *
 * ## Why this is a registry and not a string
 *
 * **The minor-unit exponent is not 2 for every currency.** ISO 4217 assigns
 * zero decimal places to UGX, RWF, XOF, XAF, JPY, KRW and others, and three to
 * KWD, BHD and TND. Dividing a UGX amount by 100 understates it by 100x;
 * dividing a KWD amount by 100 overstates it by 10x. `src/lib/validators/payout.ts`
 * already spelled this failure mode out for Stripe transfers; the same hazard
 * now applies to every figure the platform renders or sums.
 *
 * KES happens to be a 2-decimal currency, so the first non-USD currency added
 * here could have been bolted on without this machinery. It is built anyway,
 * because the owner's direction (2026-10-21) is multi-country African coverage
 * through PayHero/FinoQ, and four of the currencies in that footprint are
 * zero-decimal. The 100x bug would be introduced by whoever adds UGX, long
 * after the person who left the exponent implicit had stopped looking.
 *
 * ## The invariant that replaces "there is no FX anywhere"
 *
 * There is still no FX conversion in this codebase, and this registry does not
 * add one. What it adds is the ability to state, per row, which currency an
 * integer is denominated in. The rule that keeps the ledger sound is:
 *
 *   **A campaign has exactly one currency. Every donation to it, every release
 *   and every withdrawal is in that same currency.**
 *
 * That is what lets `campaigns.raised_amount += donations.amount` stay correct
 * arithmetic and keeps the `campaigns_released_lte_raised` CHECK meaningful. It
 * is enforced in `assertSameCurrency` below, in the donation write path, and by
 * a database CHECK on `donations`. Two currencies may never be added together
 * anywhere in this system; where a cross-currency total is genuinely wanted
 * (platform-wide statistics), it must be reported per currency, never summed.
 *
 * See `docs/92-PAYHERO-GATEWAY-AND-MULTI-CURRENCY-ADR.md`.
 */

/** A currency the platform can transact in. */
export interface CurrencyDefinition {
  /** ISO 4217 alpha-3, uppercase. The canonical form everywhere in the app. */
  readonly code: string;
  /**
   * ISO 4217 minor units: how many decimal places the currency has.
   * `minorPerMajor` is `10 ** exponent`.
   */
  readonly exponent: number;
  /** BCP 47 tag used for `Intl.NumberFormat`. */
  readonly locale: string;
  /**
   * Smallest donation accepted, in minor units.
   *
   * Enforced in `src/lib/validators/donation.ts`. This is NOT enforced by a
   * database CHECK any more: the old `donations_amount_check CHECK (amount >= 500)`
   * was a USD-cents literal, and KES 5.00 (500 minor units) is about US$0.04,
   * so keeping it would have silently imposed a nonsense floor on one currency
   * and a meaningful one on the other. Migration 0005 relaxes the CHECK to
   * `amount > 0` and the real floor moved here, where it can differ per
   * currency. The trade-off accepted: a floor violation is now caught by the
   * validator and a test rather than by the database as a last resort.
   */
  readonly minDonationMinor: number;
  /** Largest donation accepted, in minor units. */
  readonly maxDonationMinor: number;
  /**
   * Most a campaign may raise, cumulatively, while it is NOT verified.
   *
   * This is a trust control, not a payment bound: `minDonationMinor` and
   * `maxDonationMinor` above bound a SINGLE donation, and nothing bounded the
   * running total until now. An unverified campaign could raise without limit
   * and only discover at payout that it could not be paid (payout has been
   * gated on `fully_verified` all along -
   * `src/app/api/v1/user-campaigns/[id]/withdraw/route.ts`). The cap moves
   * that discovery to before donors have given money rather than after.
   *
   * Measured against REAL, un-refunded donations only - never
   * `campaigns.raised_amount`, which is a BLENDED figure the simulation
   * engine also increments for `source = 'seed'` rows carrying no money. A
   * cap read off the blended column would let fabricated seed money lock a
   * campaign out of real donations.
   *
   * Chosen per currency, NOT converted: there is no FX anywhere in this
   * codebase, so these are two independent policy numbers that happen to be
   * the same order of magnitude. Set to `Infinity` to disable the cap for a
   * currency - that is the single-constant rollback.
   */
  readonly unverifiedCapMinor: number;
  /**
   * Which gateway takes money in this currency. Used to pick the rail and to
   * refuse a donation the platform cannot actually collect.
   */
  readonly gateway: 'stripe' | 'payhero';
}

/**
 * The enabled set.
 *
 * Deliberately short. `docs/81` established that this project does not ship a
 * provider path it has not exercised, and the same applies to a currency: a
 * currency listed here is one the platform can actually collect and account
 * for. Adding NGN, GHS, TZS, UGX, ZAR or XOF is a one-entry change *plus*
 * proving a real payment in it, in that order.
 */
export const CURRENCIES: Readonly<Record<string, CurrencyDefinition>> = Object.freeze({
  /**
   * The original ledger currency. Bounds carried over verbatim from the
   * pre-multi-currency `createIntentSchema` (min 500, max 10_000_000) so that
   * nothing about an existing USD campaign changes.
   */
  USD: Object.freeze({
    code: 'USD',
    exponent: 2,
    locale: 'en-US',
    minDonationMinor: 500,
    maxDonationMinor: 10_000_000,
    // US$500.00. The figure the owner named when specifying the tiered model.
    unverifiedCapMinor: 50_000,
    gateway: 'stripe' as const,
  }),

  /**
   * Kenyan shilling, collected over M-Pesa through PayHero/FinoQ.
   *
   * **Floor: KES 50.00.** Deliberately low, at a cost that is higher than
   * first documented.
   *
   * The original note here cited PayHero's published fee table
   * (`GET /api/transaction_fees`, no authentication) which charges KES 6 on
   * collections from KES 50 to KES 499, and concluded the platform absorbs
   * 12% at the floor. **Both figures were wrong.** Measured against this
   * account's own ledger on 2026-10-21, after a real KES 50 collection:
   *
   *   published tier for KES 50 .......... KES 6
   *   actually charged ................... KES 8.9
   *   actually charged on a KES 200 collection ... KES 8.9
   *
   * So the fee on this account is a **flat KES 8.9**, not the tiered figure
   * the public endpoint advertises, which makes the platform's absorbed cost
   * **17.8% at the KES 50 floor** — 8.9% at KES 100, 1.8% at KES 500. This is
   * the `docs/66` lesson again: measure the path the real calls take, not the
   * one the documentation describes.
   *
   * The floor stays at KES 50 because small contributions are the normal unit
   * of a harambee and excluding them to protect a margin would change what
   * the product is. But it is now a known-expensive choice rather than a
   * cheap one, and it is the owner's to revisit with these numbers. The donor
   * is never charged the fee, which is what keeps the 0% claim in `docs/59`
   * true.
   *
   * **Ceiling: KES 250,000.00.** Not a product choice. Safaricom's published
   * tariff page (verified 2026-10-21) caps a single M-Pesa transaction at
   * KES 250,000, with a KES 500,000 daily limit per subscriber. A larger
   * amount cannot succeed, so offering it would produce a failure the donor
   * cannot act on. The daily limit is not knowable from our side and is
   * handled in the failure copy instead.
   */
  KES: Object.freeze({
    code: 'KES',
    exponent: 2,
    locale: 'en-KE',
    minDonationMinor: 5_000,
    maxDonationMinor: 25_000_000,
    /*
      KES 50,000.00. A POLICY NUMBER, not a conversion of the USD cap: this
      codebase has no exchange rate and inventing one here would bake a
      moving figure into a constant. Chosen as a round harambee-scale amount
      of the same order as the USD cap, and it is one line to change.

      Note it is 2x M-Pesa's KES 250,000 single-transaction ceiling, so the
      cap is reachable only across several donations - never by one.
    */
    unverifiedCapMinor: 5_000_000,
    gateway: 'payhero' as const,
  }),
});

/** Every enabled currency code. */
export const SUPPORTED_CURRENCY_CODES: readonly string[] = Object.freeze(Object.keys(CURRENCIES));

/**
 * The currency a campaign gets when nothing says otherwise.
 *
 * Every campaign that existed before migration 0005 was created with a USD
 * goal by a USD-only codebase, so USD is the correct backfill rather than a
 * neutral default.
 */
export const DEFAULT_CURRENCY = 'USD';

/** Normalise user or gateway input to the canonical code. Does not validate. */
export function normaliseCurrencyCode(input: string | null | undefined): string {
  return (input ?? '').trim().toUpperCase();
}

/** True when the code names a currency the platform can actually transact in. */
export function isSupportedCurrency(input: string | null | undefined): boolean {
  return normaliseCurrencyCode(input) in CURRENCIES;
}

/**
 * The definition for a currency code.
 *
 * Throws on an unknown code rather than falling back to USD. A fallback here
 * would mean a KES amount silently rendered and summed as dollars, which is
 * precisely the class of bug this module exists to make impossible — and the
 * failure would be invisible, because `$` beside a KES figure still looks like
 * money. Callers that can legitimately receive an unknown code should test with
 * `isSupportedCurrency` first.
 */
export function getCurrency(input: string | null | undefined): CurrencyDefinition {
  const code = normaliseCurrencyCode(input);
  const found = CURRENCIES[code];
  if (!found) {
    throw new Error(
      `Unsupported currency ${JSON.stringify(code || String(input))}. ` +
        `Supported: ${SUPPORTED_CURRENCY_CODES.join(', ')}.`,
    );
  }
  return found;
}

/** Minor units in one major unit, e.g. 100 for USD, 1 for a zero-decimal currency. */
export function minorPerMajor(input: string | null | undefined): number {
  return 10 ** getCurrency(input).exponent;
}

/**
 * Guard that two amounts being combined are in the same currency.
 *
 * Called at every point where one amount is added to, subtracted from or
 * compared against another: the donation write path, refund accounting and
 * payouts. Mixing currencies is not a recoverable condition — the arithmetic is
 * already meaningless by the time it would be noticed — so this throws rather
 * than returning a boolean a caller can ignore.
 */
export function assertSameCurrency(
  a: string | null | undefined,
  b: string | null | undefined,
  context: string,
): void {
  const left = normaliseCurrencyCode(a);
  const right = normaliseCurrencyCode(b);
  if (left !== right) {
    throw new Error(
      `Currency mismatch in ${context}: ${left || '(none)'} vs ${right || '(none)'}. ` +
        'Amounts in different currencies must never be combined.',
    );
  }
}
