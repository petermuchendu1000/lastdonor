/**
 * Rendering money, in any supported currency.
 *
 * `src/lib/utils/currency.ts` is the USD-only ancestor of this module and now
 * delegates to it, so its exact output is preserved for every existing call
 * site. New code should call `formatMoney` and pass a currency.
 *
 * Verified output on this runtime (Node 22, ICU 77.1), 2026-10-21:
 *
 * | currency | minor      | `exact`          | `whole`     |
 * |----------|------------|------------------|-------------|
 * | USD      | 500        | `$5.00`          | `$5`        |
 * | USD      | 10_000_000 | `$100,000.00`    | `$100,000`  |
 * | KES      | 5_000      | `Ksh 50.00`      | `Ksh 50`    |
 * | KES      | 25_000_000 | `Ksh 250,000.00` | `Ksh 250,000` |
 *
 * These are read off `Intl.NumberFormat`, not hardcoded, so a CLDR update can
 * change the KES symbol. That is why the tests assert the *numeric* part and
 * the presence of a currency marker separately, rather than pinning a literal
 * `"Ksh 50.00"` that a future ICU bump would break for no real reason.
 */

import { getCurrency } from './currencies';

/**
 * `whole` drops the minor units (`$1,250`) and is the default for every
 * donor-facing total, goal and preset. `exact` keeps them (`$1,250.00`) and is
 * for receipts and ledgers, where the trailing digits carry meaning.
 *
 * Carried over unchanged from the `Money` component's original contract
 * (`docs/47`).
 */
export type MoneyPrecision = 'whole' | 'exact';

/**
 * Convert a minor-unit integer to its major-unit number.
 *
 * Uses the currency's own exponent, so a zero-decimal currency is not divided
 * at all. The returned value is a float and is for formatting only — never
 * store it, never do arithmetic on it, and never send it to a gateway. All
 * money arithmetic in this codebase happens in integer minor units.
 */
export function minorToMajor(minor: number, currency: string): number {
  const { exponent } = getCurrency(currency);
  return exponent === 0 ? minor : minor / 10 ** exponent;
}

/**
 * Convert a major-unit amount to minor units.
 *
 * `Math.round` is load-bearing: `19.99 * 100` is `1998.9999999999998` in IEEE
 * 754, so truncation would lose a cent on a large fraction of all inputs. This
 * is the same rounding the USD-only `dollarsToCents` has always applied.
 */
export function majorToMinor(major: number, currency: string): number {
  const { exponent } = getCurrency(currency);
  return Math.round(major * 10 ** exponent);
}

/**
 * Format a minor-unit integer as money in its own currency.
 *
 * @param minor    amount in the currency's minor unit
 * @param currency ISO 4217 code; throws if the platform does not support it
 */
export function formatMoney(
  minor: number,
  currency: string,
  precision: MoneyPrecision = 'whole',
): string {
  const def = getCurrency(currency);
  const fractionDigits = precision === 'whole' ? 0 : def.exponent;

  return new Intl.NumberFormat(def.locale, {
    style: 'currency',
    currency: def.code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(minorToMajor(minor, currency));
}
