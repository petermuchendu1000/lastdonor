/**
 * Conversion arithmetic and, more importantly, its refusals.
 *
 * The tests that matter here are the ones where `convertMinor` returns `null`.
 * A conversion function that guesses when it is unsure is worse than one that
 * does not exist, because the guess arrives formatted as money.
 */

import { describe, it, expect } from 'vitest';
import { convertMinor, convertWithRates, isFxFresh, fxAgeHours, MAX_FX_AGE_HOURS } from './fx-convert';
import { getCurrency } from './currencies';
import type { FxSnapshot } from './fx-providers';

const NOW = new Date('2026-10-24T12:00:00Z');

function snapshot(overrides: Partial<FxSnapshot> = {}): FxSnapshot {
  return {
    base: 'USD',
    // The real measured rate on 2026-10-24.
    rates: { USD: 1, KES: 129.84786 },
    asOf: '2026-10-24T00:02:31Z',
    provider: 'open.er-api.com',
    fetchedAt: '2026-10-24T02:00:00Z',
    ...overrides,
  };
}

describe('conversion arithmetic', () => {
  it('converts USD to KES through the stored rate', () => {
    // $500.00 -> 50000 minor USD -> 500 * 129.84786 = KES 64,923.93
    const out = convertMinor(snapshot(), { amountMinor: 50_000, fromCurrency: 'USD', toCurrency: 'KES' }, NOW);
    expect(out).toBe(6_492_393);
  });

  it('converts KES to USD', () => {
    // KES 64,923.93 -> back to about $500.00
    const out = convertMinor(snapshot(), { amountMinor: 6_492_393, fromCurrency: 'KES', toCurrency: 'USD' }, NOW);
    expect(out).toBe(50_000);
  });

  it('is the identity for the same currency, without consulting a rate', () => {
    const out = convertMinor(
      snapshot({ rates: { USD: 1, KES: 129.84786 } }),
      { amountMinor: 12_345, fromCurrency: 'USD', toCurrency: 'USD' },
      NOW,
    );
    expect(out).toBe(12_345);
  });

  it('round-trips within one minor unit', () => {
    const start = 7_777;
    const there = convertMinor(snapshot(), { amountMinor: start, fromCurrency: 'USD', toCurrency: 'KES' }, NOW)!;
    const back = convertMinor(snapshot(), { amountMinor: there, fromCurrency: 'KES', toCurrency: 'USD' }, NOW)!;
    expect(Math.abs(back - start)).toBeLessThanOrEqual(1);
  });

  it('returns whole minor units, never a fraction', () => {
    const out = convertMinor(snapshot(), { amountMinor: 1, fromCurrency: 'USD', toCurrency: 'KES' }, NOW)!;
    expect(Number.isInteger(out)).toBe(true);
  });

  it('reads each currency exponent rather than assuming 100', () => {
    // Both supported currencies happen to be exponent 2, so this asserts the
    // relationship instead of a literal: a USD minor unit must map to about
    // `rate` KES minor units when the exponents match.
    const usd = getCurrency('USD');
    const kes = getCurrency('KES');
    expect(usd.exponent).toBe(kes.exponent);
    const out = convertMinor(snapshot(), { amountMinor: 10 ** usd.exponent, fromCurrency: 'USD', toCurrency: 'KES' }, NOW)!;
    expect(out).toBe(Math.round(129.84786 * 10 ** kes.exponent));
  });
});

describe('staleness is a refusal', () => {
  it('accepts a snapshot inside the window', () => {
    expect(isFxFresh(snapshot(), NOW)).toBe(true);
  });

  it('refuses at exactly one second past the window', () => {
    const asOf = new Date(NOW.getTime() - (MAX_FX_AGE_HOURS * 3_600_000 + 1_000)).toISOString();
    const s = snapshot({ asOf });
    expect(isFxFresh(s, NOW)).toBe(false);
    expect(convertMinor(s, { amountMinor: 50_000, fromCurrency: 'USD', toCurrency: 'KES' }, NOW)).toBeNull();
  });

  it('accepts at exactly the window boundary', () => {
    const asOf = new Date(NOW.getTime() - MAX_FX_AGE_HOURS * 3_600_000).toISOString();
    expect(isFxFresh(snapshot({ asOf }), NOW)).toBe(true);
  });

  it('refuses a snapshot from the future by more than clock skew', () => {
    // A provider timestamp hours ahead of ours means something is wrong with
    // one of the two clocks, and a rate we cannot date is not usable.
    const asOf = new Date(NOW.getTime() + 6 * 3_600_000).toISOString();
    expect(isFxFresh(snapshot({ asOf }), NOW)).toBe(false);
  });

  it('tolerates a few seconds of clock skew', () => {
    const asOf = new Date(NOW.getTime() + 30_000).toISOString();
    expect(isFxFresh(snapshot({ asOf }), NOW)).toBe(true);
  });

  it('treats an unparseable timestamp as infinitely old', () => {
    const s = snapshot({ asOf: 'not a date' });
    expect(fxAgeHours(s, NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(convertMinor(s, { amountMinor: 50_000, fromCurrency: 'USD', toCurrency: 'KES' }, NOW)).toBeNull();
  });

  /*
    The cadence invariant. The refresh cron runs daily
    (`src/lib/cron-schedule.ts`), so the window must be more than one interval
    or a single missed run takes every converted figure off the site. It must
    also not be so wide that a long outage goes unnoticed.
  */
  it('leaves room for exactly one missed daily refresh', () => {
    expect(MAX_FX_AGE_HOURS).toBeGreaterThan(24);
    expect(MAX_FX_AGE_HOURS).toBeLessThanOrEqual(48);
  });
});

describe('refuses rather than guesses', () => {
  it.each([
    ['unknown source currency', { amountMinor: 100, fromCurrency: 'ZZZ', toCurrency: 'USD' }],
    ['unknown target currency', { amountMinor: 100, fromCurrency: 'USD', toCurrency: 'ZZZ' }],
    ['fractional minor units', { amountMinor: 100.5, fromCurrency: 'USD', toCurrency: 'KES' }],
    ['NaN amount', { amountMinor: Number.NaN, fromCurrency: 'USD', toCurrency: 'KES' }],
    ['infinite amount', { amountMinor: Number.POSITIVE_INFINITY, fromCurrency: 'USD', toCurrency: 'KES' }],
  ])('returns null for %s', (_label, input) => {
    expect(convertMinor(snapshot(), input, NOW)).toBeNull();
  });

  it.each([
    ['a missing rate', { USD: 1 }],
    ['a zero rate', { USD: 1, KES: 0 }],
    ['a negative rate', { USD: 1, KES: -3 }],
    ['a NaN rate', { USD: 1, KES: Number.NaN }],
    ['an infinite rate', { USD: 1, KES: Number.POSITIVE_INFINITY }],
  ])('returns null for %s', (_label, rates) => {
    const s = snapshot({ rates: rates as Record<string, number> });
    expect(convertMinor(s, { amountMinor: 50_000, fromCurrency: 'USD', toCurrency: 'KES' }, NOW)).toBeNull();
  });

  it('returns null rather than an unsafe integer on an absurd amount', () => {
    const out = convertMinor(
      snapshot(),
      { amountMinor: Number.MAX_SAFE_INTEGER, fromCurrency: 'USD', toCurrency: 'KES' },
      NOW,
    );
    expect(out).toBeNull();
  });
});

describe('zero-decimal currencies (the exponent must be read, not assumed)', () => {
  /*
    CURRENCIES holds only USD and KES today, both exponent 2, so `10 **
    exponent` and a hardcoded `100` behave identically and a mutation test
    confirmed the hardcoded version survived every other test in this file.

    UGX, RWF, XOF and XAF are ZERO-DECIMAL. Dividing those by 100 understates
    them a hundredfold - CLAUDE.md calls this out as the reason amount columns
    are "minor units of its row's currency", not "cents". These tests exercise
    that path through `convertWithRates` before such a currency exists.
  */

  it('converts a 2-decimal currency into a 0-decimal one', () => {
    // $10.00 (1000 minor, exp 2) at 1 USD = 3700 UGX (exp 0) -> 37000 minor
    const out = convertWithRates(1_000, { exponent: 2, rate: 1 }, { exponent: 0, rate: 3_700 });
    expect(out).toBe(37_000);
  });

  it('converts a 0-decimal currency into a 2-decimal one', () => {
    // UGX 37,000 (37000 minor, exp 0) at 3700 per USD -> $10.00 = 1000 minor
    const out = convertWithRates(37_000, { exponent: 0, rate: 3_700 }, { exponent: 2, rate: 1 });
    expect(out).toBe(1_000);
  });

  it('a hardcoded 100 is wrong by exactly 100x on a 0-decimal target', () => {
    /*
      The assertion that kills the mutant, with the arithmetic spelled out.

      Correct, reading exponents:
        1000 minor / 10^2 = 10.00 USD -> x3700 -> UGX 37,000 -> x10^0 = 37000
      Hardcoding 100 in both places:
        1000 / 100 = 10.00 -> x3700 -> 37,000 -> x100 = 3,700,000

      So it OVERSTATES a zero-decimal target 100-fold (and understates a
      zero-decimal SOURCE by the same factor in the other direction). Either
      way it is a money figure wrong by two orders of magnitude.
    */
    const correct = convertWithRates(1_000, { exponent: 2, rate: 1 }, { exponent: 0, rate: 3_700 })!;
    const ifHardcoded = Math.round((1_000 / 100 / 1) * 3_700 * 100);

    expect(correct).toBe(37_000);
    expect(ifHardcoded).toBe(3_700_000);
    expect(ifHardcoded).toBe(correct * 100);
    expect(correct).not.toBe(ifHardcoded);
  });

  it('round-trips through a zero-decimal currency within one minor unit', () => {
    const there = convertWithRates(5_000, { exponent: 2, rate: 1 }, { exponent: 0, rate: 129 })!;
    const back = convertWithRates(there, { exponent: 0, rate: 129 }, { exponent: 2, rate: 1 })!;
    expect(Math.abs(back - 5_000)).toBeLessThanOrEqual(1);
  });

  it.each([
    ['a negative exponent', { exponent: -1, rate: 1 }, { exponent: 2, rate: 1 }],
    ['a fractional exponent', { exponent: 1.5, rate: 1 }, { exponent: 2, rate: 1 }],
    ['a zero source rate', { exponent: 2, rate: 0 }, { exponent: 2, rate: 1 }],
    ['a NaN target rate', { exponent: 2, rate: 1 }, { exponent: 2, rate: Number.NaN }],
  ])('refuses %s', (_label, from, to) => {
    expect(convertWithRates(1_000, from, to)).toBeNull();
  });
});
