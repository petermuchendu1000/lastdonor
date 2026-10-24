/**
 * KNOWN currencies, as distinct from COLLECTABLE ones.
 *
 * ── THE DISTINCTION THIS MODULE EXISTS FOR ──────────────────────────────────
 *
 * `CURRENCIES` in `./currencies.ts` means **the platform can take money in
 * this**. Every entry carries a `gateway`, a donation floor and ceiling, and a
 * pre-verification cap, and it is read by `checkDonationAmount`,
 * `checkRaiseCap`, `payment-service`, the PayHero client and the composite
 * foreign key on `(campaign_id, currency)`.
 *
 * `WORLD_CURRENCY_EXPONENTS` here means **this is a real currency and we know
 * how many decimal places it has**. Nothing more. It is for formatting a
 * figure and for converting one for display.
 *
 * Keeping them apart is the whole point. The owner asked for every country to
 * be added now with gateways to follow, and the unsafe way to do that is to
 * pour 152 currencies into `CURRENCIES`: that would silently tell every money
 * path they are collectable, let a campaign be created in a currency no
 * gateway can settle, and - because `(campaign_id, currency)` makes a
 * campaign's currency immutable once any donation exists (docs/92) - strand
 * it there permanently. It would also hand `checkDonationAmount` and
 * `checkRaiseCap` 150 invented floors and caps, which is the unexercisable
 * path docs/81 forbids.
 *
 * So: adding a country is a data change here. Making its currency collectable
 * is a deliberate, separate edit to `CURRENCIES` once a gateway exists.
 */

import { CURRENCIES, isSupportedCurrency } from './currencies';
import { WORLD_CURRENCY_EXPONENTS } from './world-currencies.generated';

export { WORLD_CURRENCY_EXPONENTS };

/** Every currency the platform can name. 152 of them. */
export const KNOWN_CURRENCY_CODES: readonly string[] = Object.freeze(
  Object.keys(WORLD_CURRENCY_EXPONENTS).sort(),
);

/** True when this is a real currency with a known exponent. */
export function isKnownCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORLD_CURRENCY_EXPONENTS, code);
}

/**
 * True when the platform can actually take money in this currency.
 *
 * Re-exported under a name that says what it means, because `isSupported`
 * reads as "we know about it" and the distinction is the one thing this file
 * is for.
 */
export function isCollectableCurrency(code: string): boolean {
  return isSupportedCurrency(code);
}

export type DisplayCurrency = {
  readonly code: string;
  readonly exponent: number;
  readonly locale: string;
};

/**
 * Resolve a currency for FORMATTING ONLY.
 *
 * Prefers the collectable definition, so USD and KES keep the exact locale
 * they already render with and no existing output changes. Falls back to the
 * known table for the other 150.
 *
 * `'en'` is used as the locale for a known-but-not-collectable currency rather
 * than guessing a country locale. `Intl.NumberFormat` takes the SYMBOL from
 * the currency code, not the locale, so the figure still renders as the right
 * money; the locale only decides grouping and symbol placement, and inventing
 * `en-UG` for UGX would imply a regional format we have not checked.
 *
 * Throws on a code that is not a currency at all. Do NOT use this to decide
 * anything about money - `getCurrency` is the strict accessor for that, and it
 * still refuses everything outside `CURRENCIES`.
 */
export function resolveDisplayCurrency(code: string): DisplayCurrency {
  if (isSupportedCurrency(code)) {
    const def = CURRENCIES[code];
    return { code: def.code, exponent: def.exponent, locale: def.locale };
  }
  const exponent = WORLD_CURRENCY_EXPONENTS[code];
  if (typeof exponent !== 'number') {
    throw new Error(`Unknown currency: ${code}`);
  }
  return { code, exponent, locale: 'en' };
}
