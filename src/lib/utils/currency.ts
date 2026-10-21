/**
 * USD-only money helpers, kept as a thin shim over `@/lib/money`.
 *
 * These three functions predate multi-currency support and are called from 105
 * places. Rather than rewrite every one of them in the same change that
 * introduced the currency registry — which would have mixed a mechanical
 * rename into a change that alters money semantics — they now delegate to
 * `formatMoney` / `majorToMinor` with the currency pinned to USD. Output is
 * byte-identical to the previous implementation; `src/lib/utils/currency.test.ts`
 * still asserts it.
 *
 * **New code should not use these.** Use `formatMoney(minor, currency)` or the
 * `Money` component with an explicit `currency`, because a figure formatted
 * through here is a dollar figure whatever currency the underlying row is in.
 * That is exactly the mistake `src/lib/money/currencies.ts` exists to prevent,
 * so these are left in place only for the USD call sites that were already
 * correct.
 */

import { formatMoney, majorToMinor } from '@/lib/money/format';

/** Format USD cents as `$1,250.00`. Prefer `formatMoney(minor, currency, 'exact')`. */
export function centsToDollars(cents: number): string {
  return formatMoney(cents, 'USD', 'exact');
}

/** Format USD cents as `$1,250`. Prefer `formatMoney(minor, currency, 'whole')`. */
export function centsToDollarsWhole(cents: number): string {
  return formatMoney(cents, 'USD', 'whole');
}

/** Convert dollars to USD cents. Prefer `majorToMinor(major, currency)`. */
export function dollarsToCents(dollars: number): number {
  return majorToMinor(dollars, 'USD');
}
