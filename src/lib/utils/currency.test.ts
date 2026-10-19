import { describe, it, expect } from 'vitest';
import {
  centsToDollars,
  dollarsToCents,
  formatMoney,
  toProviderUnits,
  fromProviderUnits,
  assertSingleCurrency,
} from '@/lib/utils/currency';

describe('centsToDollars', () => {
  it('formats 0 cents as $0.00', () => {
    expect(centsToDollars(0)).toBe('$0.00');
  });

  it('formats 500 cents as $5.00', () => {
    expect(centsToDollars(500)).toBe('$5.00');
  });

  it('formats 1050 cents as $10.50', () => {
    expect(centsToDollars(1050)).toBe('$10.50');
  });

  it('formats 100000 cents as $1,000.00', () => {
    expect(centsToDollars(100000)).toBe('$1,000.00');
  });

  it('formats 1 cent as $0.01', () => {
    expect(centsToDollars(1)).toBe('$0.01');
  });

  it('formats large amounts with commas', () => {
    expect(centsToDollars(10_000_000)).toBe('$100,000.00');
  });
});

describe('dollarsToCents', () => {
  it('converts $5 to 500 cents', () => {
    expect(dollarsToCents(5)).toBe(500);
  });

  it('converts $10.50 to 1050 cents', () => {
    expect(dollarsToCents(10.50)).toBe(1050);
  });

  it('converts $0.01 to 1 cent', () => {
    expect(dollarsToCents(0.01)).toBe(1);
  });

  it('converts $0 to 0 cents', () => {
    expect(dollarsToCents(0)).toBe(0);
  });

  it('rounds floating point precisely', () => {
    // 19.99 * 100 = 1998.9999... → Math.round = 1999
    expect(dollarsToCents(19.99)).toBe(1999);
  });

  it('converts $1000 to 100000 cents', () => {
    expect(dollarsToCents(1000)).toBe(100000);
  });
});

/*
  Multi-currency behaviour, added 2026-10-19 alongside the FinoQ (formerly
  PayHero) second rail. See docs/94.

  The case that motivated all of it is `toProviderUnits`: Stripe takes
  cents and FinoQ takes whole shillings, so sending our stored amount
  unconverted to FinoQ charges a Kenyan donor one hundred times what they
  agreed to pay.
*/
describe('multi-currency money', () => {
  it('still defaults to USD, so existing call sites are unchanged', () => {
    expect(formatMoney(125050)).toBe('$1,250.50');
    expect(formatMoney(125050, 'usd', 'whole')).toBe('$1,251');
  });

  it('formats KES as KES and not as dollars', () => {
    expect(formatMoney(125050, 'kes', 'exact')).toContain('1,250.50');
    expect(formatMoney(125050, 'kes', 'exact')).not.toContain('$');
  });

  describe('provider units', () => {
    it('passes cents through to Stripe unchanged', () => {
      expect(toProviderUnits(125050, 'usd', 'stripe')).toBe(125050);
    });

    it('converts cents to WHOLE SHILLINGS for FinoQ', () => {
      // The 100x bug. 5000 minor units is KES 50, and FinoQ wants 50.
      expect(toProviderUnits(5000, 'kes', 'finoq')).toBe(50);
      expect(toProviderUnits(100, 'kes', 'finoq')).toBe(1);
    });

    it('refuses an amount it cannot send honestly rather than rounding', () => {
      // KES 12.50 cannot be expressed as an integer number of shillings.
      // Rounding here would move real money by a cent nobody authorised,
      // under a rounding mode no reader of the call site can see.
      expect(() => toProviderUnits(1250, 'kes', 'finoq')).toThrow(/whole KES/);
    });

    it('rejects a non-integer amount outright', () => {
      expect(() => toProviderUnits(10.5, 'usd', 'stripe')).toThrow(/integer/);
    });

    it('round-trips back from a provider callback', () => {
      expect(fromProviderUnits(50, 'kes', 'finoq')).toBe(5000);
      expect(fromProviderUnits(125050, 'usd', 'stripe')).toBe(125050);
    });
  });

  describe('aggregate guard', () => {
    it('allows a single currency and returns it', () => {
      expect(assertSingleCurrency(['kes', 'kes'], 'test')).toBe('kes');
    });

    it('treats no rows as the platform currency', () => {
      expect(assertSingleCurrency([], 'test')).toBe('usd');
    });

    it('refuses to total dollars and shillings together', () => {
      /*
        The failure this exists to prevent is silent: SUM() over mixed
        rows returns a plausible number that /transparency would publish
        as dollars.
      */
      expect(() => assertSingleCurrency(['usd', 'kes'], '/transparency')).toThrow(
        /cannot total amounts across currencies kes, usd/,
      );
    });

    it('rejects a currency the platform does not support', () => {
      expect(() => assertSingleCurrency(['gbp'], 'test')).toThrow(/unsupported currency gbp/);
    });
  });
});
