import { describe, it, expect } from 'vitest';
import {
  CURRENCIES,
  SUPPORTED_CURRENCY_CODES,
  DEFAULT_CURRENCY,
  assertSameCurrency,
  getCurrency,
  isSupportedCurrency,
  minorPerMajor,
  normaliseCurrencyCode,
} from '@/lib/money/currencies';
import { formatMoney, majorToMinor, minorToMajor } from '@/lib/money/format';

describe('currency registry', () => {
  it('enables exactly the currencies the platform can collect', () => {
    // Short on purpose. A currency here must have a working rail behind it
    // (docs/81: no unexercised provider path). Growing this list is a
    // deliberate act, so it is pinned.
    expect([...SUPPORTED_CURRENCY_CODES].sort()).toEqual(['KES', 'USD']);
  });

  it('defaults to USD, which is what every pre-migration campaign was', () => {
    expect(DEFAULT_CURRENCY).toBe('USD');
    expect(isSupportedCurrency(DEFAULT_CURRENCY)).toBe(true);
  });

  it('routes each currency to the gateway that can actually collect it', () => {
    expect(CURRENCIES.USD.gateway).toBe('stripe');
    expect(CURRENCIES.KES.gateway).toBe('payhero');
  });

  it('normalises case and surrounding whitespace', () => {
    expect(normaliseCurrencyCode(' kes ')).toBe('KES');
    expect(normaliseCurrencyCode('usd')).toBe('USD');
    expect(normaliseCurrencyCode(null)).toBe('');
    expect(normaliseCurrencyCode(undefined)).toBe('');
  });

  it('accepts a lowercase code as the same currency', () => {
    expect(isSupportedCurrency('kes')).toBe(true);
    expect(getCurrency('kes').code).toBe('KES');
  });

  it('rejects a currency with no rail behind it', () => {
    for (const code of ['NGN', 'UGX', 'EUR', 'GBP', 'ZAR', 'JPY']) {
      expect(isSupportedCurrency(code)).toBe(false);
    }
  });

  // The whole point of the module: never silently answer "USD" for an
  // unknown code, because a KES figure rendered with a $ still looks
  // like money and nothing downstream would notice.
  it('throws on an unknown currency rather than falling back to USD', () => {
    expect(() => getCurrency('NGN')).toThrow(/Unsupported currency "NGN"/);
    expect(() => getCurrency('')).toThrow(/Unsupported currency/);
    expect(() => getCurrency(null)).toThrow(/Unsupported currency/);
  });

  it('names the supported set in the error, so the fix is obvious', () => {
    expect(() => getCurrency('EUR')).toThrow(/Supported: USD, KES/);
  });

  it('is frozen, so a caller cannot register a currency at runtime', () => {
    expect(Object.isFrozen(CURRENCIES)).toBe(true);
    expect(Object.isFrozen(CURRENCIES.KES)).toBe(true);
  });
});

describe('minor-unit exponent', () => {
  it('reports 100 minor units per major for both 2-decimal currencies', () => {
    expect(minorPerMajor('USD')).toBe(100);
    expect(minorPerMajor('KES')).toBe(100);
  });

  it('every enabled currency declares an exponent ISO 4217 recognises', () => {
    for (const def of Object.values(CURRENCIES)) {
      expect([0, 2, 3]).toContain(def.exponent);
    }
  });
});

describe('minorToMajor / majorToMinor', () => {
  it('round-trips USD cents', () => {
    expect(minorToMajor(500, 'USD')).toBe(5);
    expect(majorToMinor(5, 'USD')).toBe(500);
  });

  it('round-trips KES cents', () => {
    expect(minorToMajor(5_000, 'KES')).toBe(50);
    expect(majorToMinor(50, 'KES')).toBe(5_000);
  });

  it('rounds binary floating point to the nearest minor unit', () => {
    // 19.99 * 100 === 1998.9999999999998
    expect(majorToMinor(19.99, 'USD')).toBe(1999);
    expect(majorToMinor(0.01, 'USD')).toBe(1);
    expect(majorToMinor(0, 'USD')).toBe(0);
  });
});

describe('formatMoney', () => {
  // Pinned because these are the strings the platform has always rendered.
  // If this breaks, USD display has changed and 105 call sites changed with it.
  it('renders USD exactly as the USD-only helper always did', () => {
    expect(formatMoney(0, 'USD', 'exact')).toBe('$0.00');
    expect(formatMoney(1, 'USD', 'exact')).toBe('$0.01');
    expect(formatMoney(500, 'USD', 'exact')).toBe('$5.00');
    expect(formatMoney(1050, 'USD', 'exact')).toBe('$10.50');
    expect(formatMoney(100000, 'USD', 'exact')).toBe('$1,000.00');
    expect(formatMoney(10_000_000, 'USD', 'exact')).toBe('$100,000.00');
  });

  it('drops the minor units for whole precision', () => {
    expect(formatMoney(500, 'USD', 'whole')).toBe('$5');
    expect(formatMoney(10_000_000, 'USD', 'whole')).toBe('$100,000');
  });

  it('defaults to whole precision', () => {
    expect(formatMoney(500, 'USD')).toBe(formatMoney(500, 'USD', 'whole'));
  });

  /*
   * KES is asserted structurally rather than as a literal. The symbol comes
   * from CLDR (`Ksh` on ICU 77.1 for en-KE, 2026-10-21) and a future ICU bump
   * may legitimately change it; what must never change is the number, the
   * grouping and the fact that a currency marker is present at all. Pinning
   * "Ksh 50.00" would turn a harmless CLDR update into a red build.
   */
  it('renders KES with the right number, grouping and a currency marker', () => {
    const fifty = formatMoney(5_000, 'KES', 'exact');
    expect(fifty).toContain('50.00');
    expect(fifty).toMatch(/K(sh|ES)/);

    const ceiling = formatMoney(25_000_000, 'KES', 'exact');
    expect(ceiling).toContain('250,000.00');

    expect(formatMoney(5_000, 'KES', 'whole')).toContain('50');
    expect(formatMoney(5_000, 'KES', 'whole')).not.toContain('.00');
  });

  it('never renders a KES amount with a dollar sign', () => {
    // The specific confusion this module exists to prevent.
    for (const minor of [100, 5_000, 1_234_567, 25_000_000]) {
      expect(formatMoney(minor, 'KES', 'exact')).not.toContain('$');
    }
  });

  it('refuses to format in a currency with no rail behind it', () => {
    expect(() => formatMoney(100, 'NGN')).toThrow(/Unsupported currency/);
  });
});

describe('assertSameCurrency', () => {
  it('passes for the same currency, in any case', () => {
    expect(() => assertSameCurrency('KES', 'kes', 'test')).not.toThrow();
    expect(() => assertSameCurrency('USD', 'USD', 'test')).not.toThrow();
  });

  it('throws when two currencies would be combined', () => {
    expect(() => assertSameCurrency('USD', 'KES', 'donation write')).toThrow(
      /Currency mismatch in donation write: USD vs KES/,
    );
  });

  it('treats a missing currency as a mismatch, not as the default', () => {
    expect(() => assertSameCurrency('KES', null, 'payout')).toThrow(/KES vs \(none\)/);
    expect(() => assertSameCurrency(undefined, 'USD', 'payout')).toThrow(/\(none\) vs USD/);
  });
});

describe('donation bounds', () => {
  it('keeps the USD bounds the platform already advertised', () => {
    // docs/72 and /terms both state $5 minimum, $100,000 maximum.
    expect(CURRENCIES.USD.minDonationMinor).toBe(500);
    expect(CURRENCIES.USD.maxDonationMinor).toBe(10_000_000);
  });

  it('caps KES at the M-Pesa per-transaction limit', () => {
    // Safaricom published tariff, verified 2026-10-21: KES 250,000 per
    // transaction. A larger STK push cannot succeed, so it must not be offered.
    expect(CURRENCIES.KES.maxDonationMinor).toBe(25_000_000);
    expect(minorToMajor(CURRENCIES.KES.maxDonationMinor, 'KES')).toBe(250_000);
  });

  it('sets the KES floor at KES 50', () => {
    expect(minorToMajor(CURRENCIES.KES.minDonationMinor, 'KES')).toBe(50);
  });

  it('gives every currency a floor above zero and below its ceiling', () => {
    for (const def of Object.values(CURRENCIES)) {
      expect(def.minDonationMinor).toBeGreaterThan(0);
      expect(def.maxDonationMinor).toBeGreaterThan(def.minDonationMinor);
      expect(Number.isInteger(def.minDonationMinor)).toBe(true);
      expect(Number.isInteger(def.maxDonationMinor)).toBe(true);
    }
  });
});
