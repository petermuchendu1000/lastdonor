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

/**
 * CLDR revisions published AFTER the vintage our table is generated from.
 *
 * ⛔ This is NOT an allowlist and must never be used to make an inconvenient
 * code pass. Each entry records a change **Unicode itself** made, with BOTH
 * values, which is what lets the assertion below tell two very different
 * things apart:
 *
 *   - our table disagrees with reality          -> a defect, must fail
 *   - this runtime ships a newer CLDR than the
 *     table was generated from                  -> a fact about the runtime
 *
 * The old assertion could not tell them apart, and on 2026-10-30 that took
 * CI red on `main`: `scripts/generate-world-currencies.py` pins
 * **cldr-core@46**, the test compared that snapshot against the **ambient**
 * runtime's ICU, and GitHub's runner image moved to a Node whose ICU carries
 * CLDR 48. Two independent data vintages, coupled by nothing, so they were
 * always going to drift - and when they did, the failure looked like a money
 * bug in a file nobody had touched for six days.
 *
 * [VERIFIED 2026-10-30, independently of CI] fetched
 * `supplemental/currencyData.json` from cldr-core@46 and cldr-core@48 and
 * diffed `_digits`: across all 152 codes in our table these five are the ONLY
 * ones that changed, in exactly these directions.
 *
 * ⚠️ None of the five is collectable, so none can reach a money path - a
 * separate test below pins that, because it is the reason this is a display
 * question rather than an incident.
 */
export const CLDR_REVISIONS_AFTER_PINNED_VINTAGE: Readonly<
  Record<string, { pinned: number; later: number; since: string }>
> = Object.freeze({
  COP: { pinned: 2, later: 0, since: 'cldr-core@48' },
  HUF: { pinned: 2, later: 0, since: 'cldr-core@48' },
  IDR: { pinned: 2, later: 0, since: 'cldr-core@48' },
  PKR: { pinned: 2, later: 0, since: 'cldr-core@48' },
  RSD: { pinned: 0, later: 2, since: 'cldr-core@48' },
});

export type ExponentVerdict =
  | 'agree'
  | 'known-cldr-revision'
  | 'icu-unknown-code'
  | 'unexplained-divergence'
  | 'table-moved-under-the-record'
  | 'third-vintage';

/**
 * Judge one code. A PURE function, deliberately.
 *
 * ⛔ It is pure because the branch that matters cannot be reached on every
 * runtime: on a CLDR-46 machine nothing diverges, so a test driven only by
 * the ambient ICU exercises the `agree` path and NOTHING else - and a rule
 * whose interesting half never runs where it is being developed is the shape
 * `docs/76`, `docs/77` and `docs/81` are all about. The synthetic cases below
 * drive every verdict on any runtime; the sweep then feeds this the real
 * values. Same reasoning as `docs/107` and `docs/130`: move the decision
 * somewhere a test can actually execute it.
 */
export function exponentVerdict(
  ours: number | undefined,
  icu: number | null,
  revision?: { pinned: number; later: number },
): ExponentVerdict {
  if (icu === null) return 'icu-unknown-code';
  if (ours === icu) return 'agree';
  if (!revision) return 'unexplained-divergence';
  // Our table must still hold the value the record says it holds; if someone
  // regenerates at a newer vintage, this is what forces the record updated
  // rather than left to rot.
  if (ours !== revision.pinned) return 'table-moved-under-the-record';
  // A value that is neither our vintage's nor the recorded later one means a
  // THIRD CLDR release changed it again. Somebody must look.
  if (icu !== revision.later) return 'third-vintage';
  return 'known-cldr-revision';
}

describe('every generated exponent agrees with ICU', () => {
  it('has a table worth checking', () => {
    expect(KNOWN_CURRENCY_CODES.length).toBeGreaterThan(140);
  });

  it.each(Object.keys(WORLD_CURRENCY_EXPONENTS))('%s', (code) => {
    const icu = icuExponent(code);
    const verdict = exponentVerdict(
      WORLD_CURRENCY_EXPONENTS[code],
      icu,
      CLDR_REVISIONS_AFTER_PINNED_VINTAGE[code],
    );
    expect(
      verdict,
      `${code}: table says ${WORLD_CURRENCY_EXPONENTS[code]}, this runtime's ICU ` +
        `says ${icu}. An exponent wrong by one is a money figure wrong by a ` +
        `factor of ten. If Unicode changed this code after cldr-core@46, record ` +
        `it in CLDR_REVISIONS_AFTER_PINNED_VINTAGE with BOTH values and the ` +
        `release - after checking the change is real. Do not widen that record ` +
        `to silence a failure.`,
    ).toMatch(/^(agree|known-cldr-revision)$/);
  });

  /*
    The judgement itself, on synthetic values, so every branch runs on every
    runtime - including the ones this machine's own ICU can never produce.
  */
  it('⛔ an unrecorded divergence is a failure, not a shrug', () => {
    expect(exponentVerdict(2, 0, undefined)).toBe('unexplained-divergence');
  });

  it('a recorded CLDR revision is accepted, in both directions', () => {
    expect(exponentVerdict(2, 0, { pinned: 2, later: 0 })).toBe('known-cldr-revision');
    expect(exponentVerdict(0, 2, { pinned: 0, later: 2 })).toBe('known-cldr-revision');
  });

  it('⚠️ agreement short-circuits, so the record is inert on our own vintage', () => {
    // This is why removing an entry cannot be detected on a CLDR-46 machine.
    expect(exponentVerdict(2, 2, { pinned: 2, later: 0 })).toBe('agree');
    expect(exponentVerdict(2, 2, undefined)).toBe('agree');
  });

  it('⛔ regenerating the table makes the record stale, and that FAILS', () => {
    // ours=0 after a regenerate at @48, while the record still says pinned=2
    expect(exponentVerdict(0, 0, { pinned: 2, later: 0 })).toBe('agree');
    expect(exponentVerdict(0, 2, { pinned: 2, later: 0 })).toBe('table-moved-under-the-record');
  });

  it('⛔ a THIRD vintage is not covered by a two-value record', () => {
    expect(exponentVerdict(2, 3, { pinned: 2, later: 0 })).toBe('third-vintage');
  });

  it('a code ICU does not know is reported, never silently skipped', () => {
    expect(exponentVerdict(2, null, undefined)).toBe('icu-unknown-code');
  });

  it('⛔ the sweep passes on a CLDR-48 runtime, which is what CI now is', () => {
    /*
      THE EVIDENCE THAT THIS FIX WORKS WHERE IT BROKE. This machine ships ICU
      77.1 (CLDR 46), so the sweep above exercises only the `agree` path here
      and would pass with the record deleted - running it locally proves
      nothing about CI. These are the real cldr-core@48 `_digits` values,
      fetched from jsdelivr on 2026-10-30 and diffed against @46, fed through
      the same judgement the sweep uses.

      Measured on GitHub's runner before the fix: 5 failed | 8160 passed, the
      same five codes on `main` as on the branch.
    */
    const CLDR_48_DIGITS: Record<string, number> = {
      COP: 0, HUF: 0, IDR: 0, PKR: 0, RSD: 2,
    };
    for (const [code, icu48] of Object.entries(CLDR_48_DIGITS)) {
      expect(
        exponentVerdict(
          WORLD_CURRENCY_EXPONENTS[code],
          icu48,
          CLDR_REVISIONS_AFTER_PINNED_VINTAGE[code],
        ),
        `${code} would still fail on a CLDR-48 runtime`,
      ).toBe('known-cldr-revision');
    }
  });

  it('⚠️ and a currency CLDR did NOT change still fails if it diverges', () => {
    // The control on the test above: it must not pass by accepting anything.
    expect(
      exponentVerdict(WORLD_CURRENCY_EXPONENTS.KES, 0, CLDR_REVISIONS_AFTER_PINNED_VINTAGE.KES),
      'KES has no record, so a divergence must be unexplained',
    ).toBe('unexplained-divergence');
  });

  it('⚠️ every recorded code still holds its recorded pinned value', () => {
    /*
      The anti-rot control. Without it the record could describe a table that
      no longer exists, and the sweep above would keep passing on a CLDR-46
      runtime by short-circuiting on `agree`.
    */
    for (const [code, rev] of Object.entries(CLDR_REVISIONS_AFTER_PINNED_VINTAGE)) {
      expect(
        WORLD_CURRENCY_EXPONENTS[code],
        `${code} is recorded as pinned=${rev.pinned} but the table says ` +
          `${WORLD_CURRENCY_EXPONENTS[code]} - update the record`,
      ).toBe(rev.pinned);
      expect(rev.pinned, `${code}: a record whose two values are equal records nothing`)
        .not.toBe(rev.later);
    }
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

  it('⛔ NOR is any code whose CLDR exponent moved after our pinned vintage', () => {
    /*
      The same rule for the same reason, applied to the other way a code's
      exponent can be two numbers at once. A currency whose decimals differ
      between CLDR releases is only a DISPLAY question while nothing can be
      charged in it; the moment it becomes collectable the gap is a factor of
      100 on real money, and whoever wires that gateway has to settle which
      vintage it expects first. This test is what makes them.
    */
    const collectableAndDrifting = Object.keys(CLDR_REVISIONS_AFTER_PINNED_VINTAGE)
      .filter(isCollectableCurrency);
    expect(
      collectableAndDrifting,
      'a currency whose CLDR exponent is in flux must not be collectable - see ' +
        'CLDR_REVISIONS_AFTER_PINNED_VINTAGE and docs/157',
    ).toEqual([]);
  });

  it('⚠️ the control: our two collectable currencies are NOT in that record', () => {
    // Otherwise the rule above could be satisfied by an empty record.
    expect(Object.keys(CLDR_REVISIONS_AFTER_PINNED_VINTAGE).length).toBeGreaterThan(0);
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(CLDR_REVISIONS_AFTER_PINNED_VINTAGE[code]).toBeUndefined();
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
