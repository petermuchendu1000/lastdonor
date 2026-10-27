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
import { resolveDisplayCurrency } from './world-currencies';

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
 * The symbol a currency is written with, for an input's inline prefix.
 *
 * ⚠️ Derived from `Intl`, never a hand-kept map. There is no `symbol` field on
 * `CurrencyDefinition` on purpose - `formatMoney` already gets the symbol from
 * `Intl.NumberFormat`, and a second, hand-written list of symbols is a thing
 * that drifts from the first.
 *
 * ⛔ This is for a FORM PREFIX only, beside an input the reader types a major
 * amount into. A money figure is rendered by `formatMoney` or `<Money>`, which
 * place the symbol, the grouping and the decimals per locale. Do not build a
 * figure by concatenating this with a number.
 *
 * Falls back to the code itself, which is always meaningful - "KES 500" reads
 * fine, where an empty prefix would leave the amount unlabelled. Added
 * 2026-10-27 for the create wizard, which hardcoded `$` (`docs/118` §10).
 */
export function currencySymbol(currency: string): string {
  /*
    ⚠️ `resolveDisplayCurrency` is INSIDE the try. It throws
    `Unknown currency: ZZZ` for a code outside the 152 known ones, and the
    first version of this function called it outside - so the fallback this
    comment promised did not exist and the function threw. Found by probing
    the real output rather than assuming it (`docs/118` §10).
  */
  try {
    const def = resolveDisplayCurrency(currency);
    const parts = new Intl.NumberFormat(def.locale, {
      style: 'currency',
      currency: def.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? def.code;
  } catch {
    return (currency ?? '').trim().toUpperCase();
  }
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
  /*
    Resolved through the DISPLAY registry, not `getCurrency`, so an
    approximate figure can be rendered in any of the 152 known currencies
    (`src/lib/money/world-currencies.ts`). USD and KES still resolve to their
    collectable definitions first, so no existing output changes.

    `minorToMajor` below is deliberately NOT used here and deliberately stays
    strict: it is called by `payhero-settlement.ts` to check the amount a real
    payment settled for, and widening it would let a money comparison run on a
    currency no gateway can settle. The division is done inline instead.
  */
  const def = resolveDisplayCurrency(currency);
  const fractionDigits = precision === 'whole' ? 0 : def.exponent;
  const major = def.exponent === 0 ? minor : minor / 10 ** def.exponent;

  return new Intl.NumberFormat(def.locale, {
    style: 'currency',
    currency: def.code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(major);
}
