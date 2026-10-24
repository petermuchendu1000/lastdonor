/**
 * Converting one currency to another, for DISPLAY ONLY.
 *
 * ── THE BOUNDARY, AND WHY IT IS DRAWN HERE ──────────────────────────────────
 *
 * CLAUDE.md: "A campaign has exactly one currency, and two currencies are
 * never added together... Where a cross-currency total is wanted, report per
 * currency - never sum." That is not a style rule. It is enforced by a
 * COMPOSITE FOREIGN KEY on `(campaign_id, currency)` referencing
 * `campaigns (id, currency)` (docs/92), which also makes a campaign's
 * currency immutable once any donation exists.
 *
 * Nothing in this file changes that. A converted figure is an INDICATION for a
 * human reading a page. It must never be:
 *
 *   - written to any amount column,
 *   - summed with an amount in another currency,
 *   - used to decide a payout, a refund, a cap, or a goal,
 *   - stored as if it were the amount the donor gave.
 *
 * Two existing comments in this codebase say why, and they were written about
 * real incidents: a cross-currency figure rendered with the wrong symbol "is
 * not a formatting slip - it is a wrong figure, off by the exchange rate"
 * (`src/lib/services/payment-service.ts`, `src/lib/email-templates.ts`).
 *
 * `src/lib/money/fx-display-only.ratchet.test.ts` enforces the boundary
 * mechanically: it fails the build if a money-writing module imports this one.
 *
 * ── STALENESS IS A REFUSAL, NOT A WARNING ───────────────────────────────────
 *
 * Rates update once a day. If the stored snapshot is older than
 * `MAX_FX_AGE_HOURS`, every conversion returns `null` and the UI renders
 * nothing at all. Showing yesterday's rate as though it were today's is the
 * failure mode this whole file exists to avoid, and a figure a reader cannot
 * date is worse than no figure.
 */

import { getCurrency, isSupportedCurrency } from './currencies';
import type { FxSnapshot } from './fx-providers';

/**
 * How old a snapshot may be and still be used.
 *
 * The primary provider updates daily and publishes `time_next_update_utc`
 * about 24h out, so 24 would reject a perfectly good table a few minutes
 * before its successor exists. 48 tolerates exactly one missed refresh and no
 * more: a second consecutive failure stops conversion rather than quietly
 * widening the window.
 */
export const MAX_FX_AGE_HOURS = 48;

export function fxAgeHours(snapshot: FxSnapshot, now: Date = new Date()): number {
  const asOf = new Date(snapshot.asOf).getTime();
  if (Number.isNaN(asOf)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - asOf) / 3_600_000;
}

export function isFxFresh(snapshot: FxSnapshot, now: Date = new Date()): boolean {
  const age = fxAgeHours(snapshot, now);
  // A negative age means the provider's clock is ahead of ours, which is
  // normal by a few seconds and suspicious by hours. Allow a small skew.
  return age <= MAX_FX_AGE_HOURS && age >= -1;
}

export type ConvertInput = {
  amountMinor: number;
  fromCurrency: string;
  toCurrency: string;
};

/**
 * Convert between currencies in minor units, pivoting through USD.
 *
 * Returns `null` - never a guess - when the snapshot is stale, either currency
 * is unknown, a rate is missing or unusable, or the input is not a whole
 * number of minor units.
 *
 * Exponents are read per currency rather than assumed to be 2, because UGX,
 * RWF, XOF and XAF are zero-decimal: dividing those by 100 understates them
 * a hundredfold (CLAUDE.md, docs/92).
 */
export function convertMinor(
  snapshot: FxSnapshot,
  { amountMinor, fromCurrency, toCurrency }: ConvertInput,
  now: Date = new Date(),
): number | null {
  if (!Number.isInteger(amountMinor) || !Number.isFinite(amountMinor)) return null;
  if (!isFxFresh(snapshot, now)) return null;
  if (!isSupportedCurrency(fromCurrency) || !isSupportedCurrency(toCurrency)) return null;

  const from = getCurrency(fromCurrency);
  const to = getCurrency(toCurrency);
  if (from.code === to.code) return amountMinor;

  const rateFrom = snapshot.rates[from.code];
  const rateTo = snapshot.rates[to.code];
  if (
    typeof rateFrom !== 'number' || !Number.isFinite(rateFrom) || rateFrom <= 0 ||
    typeof rateTo !== 'number' || !Number.isFinite(rateTo) || rateTo <= 0
  ) {
    return null;
  }

  return convertWithRates(
    amountMinor,
    { exponent: from.exponent, rate: rateFrom },
    { exponent: to.exponent, rate: rateTo },
  );
}

/**
 * The arithmetic, with the exponents and rates passed in.
 *
 * Extracted so the ZERO-DECIMAL path can be tested. `CURRENCIES` holds only
 * USD and KES today and both are exponent 2, which made
 * `10 ** exponent` and a hardcoded `100` behaviourally identical - a
 * mutation test confirmed the hardcoded version survived the whole suite.
 * That is harmless now and a 100x error the day UGX, RWF, XOF or XAF is
 * added, since those are zero-decimal (CLAUDE.md, docs/92).
 *
 * Taking the exponent as a parameter means the case can be exercised before
 * such a currency exists, rather than being a comment promising it works.
 */
export function convertWithRates(
  amountMinor: number,
  from: { exponent: number; rate: number },
  to: { exponent: number; rate: number },
): number | null {
  if (!Number.isInteger(amountMinor)) return null;
  if (!Number.isFinite(from.rate) || from.rate <= 0) return null;
  if (!Number.isFinite(to.rate) || to.rate <= 0) return null;
  if (!Number.isInteger(from.exponent) || from.exponent < 0) return null;
  if (!Number.isInteger(to.exponent) || to.exponent < 0) return null;

  // rates are "units of X per 1 USD", so divide out of the source and
  // multiply into the target. Majors in between, because the two currencies
  // can have different exponents.
  const majorFrom = amountMinor / 10 ** from.exponent;
  const usd = majorFrom / from.rate;
  const majorTo = usd * to.rate;
  const minorTo = Math.round(majorTo * 10 ** to.exponent);

  if (!Number.isFinite(minorTo) || !Number.isSafeInteger(minorTo)) return null;
  return minorTo;
}
