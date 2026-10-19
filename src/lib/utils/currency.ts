/*
  The one place currency arithmetic and formatting live.

  docs/88 (F4+F5) consolidated FIVE separate currency implementations into
  this module after `/admin/payouts` rendered $1,250.5 and $1,200 while
  `/admin` showed $1,250.50 for the same row. Extend this file; do not add
  a sixth implementation beside it.

  ── Why this file grew a currency parameter (2026-10-19) ──────────────

  Every amount in this system is an integer, and every one of them was
  USD by assumption: `create-checkout` hardcodes `currency: 'usd'`,
  `donations.amount` is a bare `integer` with no currency column, and the
  three functions below hardcoded `'USD'`. That assumption was CORRECT
  while Stripe was the only rail, and entirely unwritten down.

  A second rail (FinoQ, formerly PayHero - Kenyan M-Pesa and Airtel
  Money) makes the assumption false. Without a currency alongside each
  amount, `SUM(amount)` on `/transparency` and the homepage would add
  shillings to dollars and publish the total as dollars. See docs/94.

  Defaults keep every existing call site correct and unchanged: omit the
  currency and you get USD, which is what all 40 of them mean today.
*/

/**
 * The currency every existing row is denominated in, and the default for
 * anything that does not say otherwise.
 *
 * Stored lowercase to match Stripe's convention and the `donations.currency`
 * column, and upper-cased only at the formatting boundary where
 * `Intl.NumberFormat` wants an ISO 4217 code.
 */
export const PLATFORM_CURRENCY = 'usd';

/**
 * Currencies the platform can hold. Adding one means adding its exponent
 * below AND confirming the provider's unit convention - see
 * `toProviderUnits`.
 */
export const SUPPORTED_CURRENCIES = ['usd', 'kes'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Minor units per major unit, as the exponent of ten.
 *
 * **Verified** against ISO 4217 (2026-10-19): USD and KES are both
 * two-decimal currencies, so 100 minor units to the major unit.
 *
 * This is a table and not a constant `2` on purpose. Several currencies a
 * pan-African rail would reach are NOT two-decimal - UGX, RWF and XOF are
 * zero-decimal, where "cents" do not exist and dividing by 100 silently
 * inflates every figure 100x. When one of those is added here, its
 * exponent is 0 and the arithmetic below already handles it.
 */
const MINOR_UNIT_EXPONENT: Record<SupportedCurrency, number> = {
  usd: 2,
  kes: 2,
};

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** Minor units in one major unit of `currency` (100 for USD and KES). */
export function minorUnitsPerMajor(currency: SupportedCurrency): number {
  return 10 ** MINOR_UNIT_EXPONENT[currency];
}

/**
 * Render an amount held in MINOR units (cents) for a human.
 *
 * `precision: 'whole'` drops the fractional part and is the default for
 * donor-facing totals and goals; `'exact'` keeps it, for receipts and
 * ledgers where the trailing digits carry meaning. On a zero-decimal
 * currency the two are identical, which is correct rather than a bug.
 */
export function formatMoney(
  minorUnits: number,
  currency: SupportedCurrency = PLATFORM_CURRENCY,
  precision: 'whole' | 'exact' = 'exact',
): string {
  const exponent = MINOR_UNIT_EXPONENT[currency];
  const digits = precision === 'whole' ? 0 : exponent;

  return (minorUnits / minorUnitsPerMajor(currency)).toLocaleString('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Convert an amount in MINOR units to the units a payment provider expects.
 *
 * This exists because the two providers disagree, and getting it wrong is
 * a 100x error in real money moving between real people.
 *
 * **Stripe** takes the smallest currency unit - cents - which is what we
 * store, so the conversion is the identity. **Verified** against our own
 * `create-checkout`, which passes `unit_amount` straight through.
 *
 * **FinoQ / PayHero** takes WHOLE SHILLINGS. **Verified** from their
 * published API: the STK-push body carries a bare `amount` with examples
 * of `100` and `10`, and their integration guides use "KES 1" as the test
 * amount - not 100. Passing our cents unconverted would charge every
 * Kenyan donor one hundred times what they agreed to.
 *
 * Returns an integer. A conversion that is not exact throws rather than
 * rounding silently: with a whole-unit provider, 1,250 cents is KES 12.50
 * and there is no honest way to send that as an integer number of
 * shillings. The caller has to decide (constrain the input to whole
 * shillings at the form), and it must not be decided here by a rounding
 * mode nobody reads.
 */
export function toProviderUnits(
  minorUnits: number,
  currency: SupportedCurrency,
  provider: 'stripe' | 'finoq',
): number {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`amount must be an integer number of minor units, got ${minorUnits}`);
  }

  if (provider === 'stripe') return minorUnits;

  const per = minorUnitsPerMajor(currency);
  if (minorUnits % per !== 0) {
    throw new Error(
      `${provider} takes whole ${currency.toUpperCase()}, but ${minorUnits} minor units is not a whole amount`,
    );
  }
  return minorUnits / per;
}

/** Inverse of `toProviderUnits`, for reading an amount back off a callback. */
export function fromProviderUnits(
  providerAmount: number,
  currency: SupportedCurrency,
  provider: 'stripe' | 'finoq',
): number {
  if (provider === 'stripe') return providerAmount;
  return Math.round(providerAmount * minorUnitsPerMajor(currency));
}

/**
 * Guard an aggregate against mixing currencies.
 *
 * `SUM(amount)` over rows of different currencies is not a number that
 * means anything, and the failure is silent: it renders as a plausible
 * dollar figure on a page whose entire purpose is honest numbers. Any
 * code that totals amounts from more than one row either groups by
 * currency or calls this.
 */
export function assertSingleCurrency(
  currencies: readonly string[],
  context: string,
): SupportedCurrency {
  const distinct = Array.from(new Set(currencies));

  if (distinct.length === 0) return PLATFORM_CURRENCY;
  if (distinct.length > 1) {
    throw new Error(
      `${context}: cannot total amounts across currencies ${distinct.sort().join(', ')} - group by currency instead`,
    );
  }

  const [only] = distinct;
  if (!isSupportedCurrency(only)) {
    throw new Error(`${context}: unsupported currency ${only}`);
  }
  return only;
}

/*
  ── The original USD helpers ──────────────────────────────────────────

  Kept with their existing names and signatures because 40 call sites use
  them and every one of those sites genuinely means USD. They now
  delegate, so there is still one implementation of the arithmetic.
*/

export function centsToDollars(cents: number): string {
  return formatMoney(cents, PLATFORM_CURRENCY, 'exact');
}

export function centsToDollarsWhole(cents: number): string {
  return formatMoney(cents, PLATFORM_CURRENCY, 'whole');
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * minorUnitsPerMajor(PLATFORM_CURRENCY));
}
