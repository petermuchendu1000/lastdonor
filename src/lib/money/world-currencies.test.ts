/**
 * The generated currency table, cross-checked against an INDEPENDENT source.
 *
 * The table's exponents come from the official ISO 4217 register. This file
 * checks every one of them against this runtime's own ICU/CLDR data, which is
 * a different source maintained by different people. An exponent that is
 * wrong by one is a money figure wrong by a factor of ten, and 152 of them
 * cannot be eyeballed - so the check runs on every build rather than once at
 * generation time.
 */

import { describe, it, expect } from 'vitest';
import {
  WORLD_CURRENCY_EXPONENTS,
  KNOWN_CURRENCY_CODES,
  isKnownCurrency,
  isCollectableCurrency,
  resolveDisplayCurrency,
} from './world-currencies';
import { CURRENCIES, SUPPORTED_CURRENCY_CODES, getCurrency } from './currencies';
import { ISO_MINOR_UNITS, EXPONENT_DIVERGENCES } from './world-currencies.generated';
import { COUNTRY_CURRENCY } from '@/lib/geo/country-currency.generated';
import { TIMEZONE_COUNTRY } from '@/lib/geo/timezone-country.generated';

/** ICU's own view of a currency's minor units. */
function icuExponent(code: string): number | null {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code })
      .resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

describe('every generated exponent agrees with ICU', () => {
  it('has a table worth checking', () => {
    expect(KNOWN_CURRENCY_CODES.length).toBeGreaterThan(140);
  });

  it.each(Object.keys(WORLD_CURRENCY_EXPONENTS))('%s', (code) => {
    const icu = icuExponent(code);
    // A code ICU does not know is reported, not silently skipped: it would
    // mean the two sources disagree about what a currency even is.
    expect(icu, `ICU does not know ${code}`).not.toBeNull();
    expect(WORLD_CURRENCY_EXPONENTS[code]).toBe(icu);
  });

  /*
    Spot values, written out so a future reader can see the shape of the risk
    without trusting the loop above. These are the currencies a hand-written
    table gets wrong.
  */
  it('gets the zero-decimal currencies right', () => {
    for (const code of ['JPY', 'UGX', 'RWF', 'XOF', 'XAF', 'CLP', 'ISK', 'VND', 'KRW']) {
      expect(WORLD_CURRENCY_EXPONENTS[code]).toBe(0);
    }
  });

  it('gets the THREE-decimal currencies right', () => {
    for (const code of ['KWD', 'BHD', 'JOD', 'OMR', 'TND']) {
      expect(WORLD_CURRENCY_EXPONENTS[code]).toBe(3);
    }
  });

  it('excludes cryptocurrencies, metals and fund codes', () => {
    for (const notTender of ['BTC', 'ETH', 'XAU', 'XAG', 'XDR', 'USN', 'USS']) {
      expect(isKnownCurrency(notTender)).toBe(false);
    }
  });
});

describe('where ISO and CLDR disagree about the minor unit', () => {
  /*
    MEASURED 2026-10-24: thirteen currencies whose ISO subunit has fallen out
    of use. ISO still defines the Iraqi fils, the Albanian qindarke, the
    Somali cent; no price is ever quoted in them, and CLDR records that by
    setting the display digits to 0.

    Both sources are right about different things, so the table takes CLDR for
    DISPLAY and keeps the ISO figure beside it. The list is pinned here so a
    fourteenth case cannot appear unnoticed when CLDR is next updated.
  */
  it('is exactly the thirteen known cases', () => {
    expect(EXPONENT_DIVERGENCES.map((d) => d.code).sort()).toEqual([
      'AFN', 'ALL', 'IQD', 'IRR', 'KPW', 'LAK', 'LBP', 'MGA',
      'MMK', 'RSD', 'SOS', 'SYP', 'YER',
    ]);
  });

  it('each divergence really is a disagreement, and display follows CLDR', () => {
    for (const d of EXPONENT_DIVERGENCES) {
      expect(d.cldrDigits).not.toBe(d.isoMinorUnits);
      expect(WORLD_CURRENCY_EXPONENTS[d.code]).toBe(d.cldrDigits);
      expect(ISO_MINOR_UNITS[d.code]).toBe(d.isoMinorUnits);
    }
  });

  /*
    THE LOAD-BEARING ONE.

    A currency where two authorities disagree about the minor unit must not
    be one the platform takes money in, because "minor units" would then mean
    two different things depending on who you ask - and the gap is a factor
    of 10 (IQD: 3 vs 0 is a factor of 1000). Whoever wires a gateway for one
    of these has to check which convention it expects FIRST, and this test is
    what makes them.
  */
  it('NONE of them is collectable', () => {
    const collectableAndAmbiguous = EXPONENT_DIVERGENCES
      .map((d) => d.code)
      .filter(isCollectableCurrency);
    expect(collectableAndAmbiguous).toEqual([]);
  });

  it('the currencies we DO collect are unambiguous', () => {
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(ISO_MINOR_UNITS[code]).toBe(WORLD_CURRENCY_EXPONENTS[code]);
    }
  });
});

describe('known is a superset of collectable, and they stay distinct', () => {
  it('every collectable currency is also known', () => {
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(isKnownCurrency(code)).toBe(true);
    }
  });

  it('a collectable currency agrees with the generated table on its exponent', () => {
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(CURRENCIES[code].exponent).toBe(WORLD_CURRENCY_EXPONENTS[code]);
    }
  });

  it('most known currencies are NOT collectable, which is the point', () => {
    const collectable = KNOWN_CURRENCY_CODES.filter(isCollectableCurrency);
    expect(collectable.sort()).toEqual([...SUPPORTED_CURRENCY_CODES].sort());
    expect(KNOWN_CURRENCY_CODES.length).toBeGreaterThan(collectable.length + 100);
  });

  it('getCurrency STILL refuses a known-but-not-collectable currency', () => {
    // The money accessor must not have widened. This is the guarantee that
    // lets 152 currencies exist without touching any money path.
    expect(() => getCurrency('NGN')).toThrow();
    expect(() => getCurrency('UGX')).toThrow();
    expect(() => getCurrency('KES')).not.toThrow();
  });
});

describe('resolveDisplayCurrency', () => {
  it('prefers the collectable definition, so existing output cannot change', () => {
    expect(resolveDisplayCurrency('KES')).toEqual({
      code: 'KES',
      exponent: CURRENCIES.KES.exponent,
      locale: CURRENCIES.KES.locale,
    });
  });

  it('falls back to the known table with a neutral locale', () => {
    expect(resolveDisplayCurrency('UGX')).toEqual({ code: 'UGX', exponent: 0, locale: 'en' });
  });

  it('throws on something that is not a currency', () => {
    expect(() => resolveDisplayCurrency('ZZZ')).toThrow(/Unknown currency/);
  });
});

describe('the generated country and timezone tables are internally consistent', () => {
  it('every country maps to a currency we know how to format', () => {
    const unknown = Object.entries(COUNTRY_CURRENCY)
      .filter(([, ccy]) => !isKnownCurrency(ccy))
      .map(([cc, ccy]) => `${cc}->${ccy}`);
    expect(unknown).toEqual([]);
  });

  it('every country key is an ISO 3166 alpha-2 shape', () => {
    const bad = Object.keys(COUNTRY_CURRENCY).filter((cc) => !/^[A-Z]{2}$/.test(cc));
    expect(bad).toEqual([]);
  });

  it('every timezone maps to a country we have a currency for', () => {
    const orphans = Object.entries(TIMEZONE_COUNTRY)
      .filter(([, cc]) => !(cc in COUNTRY_CURRENCY))
      .map(([z, cc]) => `${z}->${cc}`);
    // Antarctic and uninhabited-territory zones legitimately have no tender.
    expect(orphans.length).toBeLessThan(20);
  });

  it('covers the countries this platform actually operates in', () => {
    expect(COUNTRY_CURRENCY.KE).toBe('KES');
    expect(COUNTRY_CURRENCY.US).toBe('USD');
    expect(TIMEZONE_COUNTRY['Africa/Nairobi']).toBe('KE');
    expect(TIMEZONE_COUNTRY['America/New_York']).toBe('US');
  });
});
