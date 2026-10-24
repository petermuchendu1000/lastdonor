/**
 * Country detection, and the guess it refuses to make.
 *
 * The centrepiece is the `maximize()` block. Everything else is parsing.
 */

import { describe, it, expect } from 'vitest';
import {
  detectLocale,
  countryFromTimeZone,
  countryFromLanguageTags,
  parseAcceptLanguage,
  currencyForCountry,
} from './detect-country';

describe('timezone -> country', () => {
  it.each([
    ['Africa/Nairobi', 'KE'],
    ['America/New_York', 'US'],
    ['Europe/London', 'GB'],
    ['Asia/Tokyo', 'JP'],
    ['Africa/Lagos', 'NG'],
    ['Africa/Kampala', 'UG'],
  ])('%s -> %s', (zone, country) => {
    expect(countryFromTimeZone(zone)).toBe(country);
  });

  it('returns the PRIMARY country for a zone spanning several', () => {
    // Africa/Abidjan covers about a dozen West African countries; zone1970.tab
    // lists Cote d'Ivoire first. A timezone narrows the country, it does not
    // always determine it.
    expect(countryFromTimeZone('Africa/Abidjan')).toBe('CI');
  });

  it.each([null, undefined, '', 'Not/AZone', 'UTC', 'Mars/Olympus'])(
    'returns null for %s rather than guessing',
    (zone) => {
      expect(countryFromTimeZone(zone as string | null)).toBeNull();
    },
  );
});

describe('language tags -> country: an explicit region, or nothing', () => {
  it('reads an explicit region', () => {
    expect(countryFromLanguageTags(['en-KE'])).toBe('KE');
    expect(countryFromLanguageTags(['sw-KE', 'en'])).toBe('KE');
    expect(countryFromLanguageTags(['fr-CI'])).toBe('CI');
  });

  it('takes the first tag that states one', () => {
    expect(countryFromLanguageTags(['en', 'de', 'pt-BR'])).toBe('BR');
  });

  it('handles a script subtag before the region', () => {
    expect(countryFromLanguageTags(['zh-Hant-TW'])).toBe('TW');
  });

  it('uppercases a lowercase region', () => {
    expect(countryFromLanguageTags(['en-ke'])).toBe('KE');
  });

  /*
    ⚠ THE TRAP THIS MODULE IS BUILT AROUND, measured 2026-10-24 on Node 22:

        new Intl.Locale('en').maximize().region  === 'US'
        new Intl.Locale('sw').maximize().region  === 'TZ'

    Those are CLDR's statistically likeliest regions for a language, not facts
    about the person holding the device. Using `maximize()` would tell a
    Kenyan on an English-only browser that they are in the United States and
    show them dollars, with no indication it had guessed. A Swahili speaker
    would be placed in Tanzania.

    So a region-less tag yields nothing, and the caller renders nothing.
  */
  it('NEVER infers a region from a language alone', () => {
    expect(countryFromLanguageTags(['en'])).toBeNull();
    expect(countryFromLanguageTags(['sw'])).toBeNull();
    expect(countryFromLanguageTags(['ar'])).toBeNull();
    expect(countryFromLanguageTags(['fr', 'de', 'ja'])).toBeNull();
  });

  it('and the thing it refuses to do is what Intl would have done', () => {
    // Proof the trap is real rather than theoretical.
    expect(new Intl.Locale('en').maximize().region).toBe('US');
    expect(countryFromLanguageTags(['en'])).toBeNull();
  });

  it.each([null, undefined, [], [''], ['*']])('returns null for %s', (tags) => {
    expect(countryFromLanguageTags(tags as string[] | null)).toBeNull();
  });

  it('ignores a two-letter subtag that is not in region position only if absent', () => {
    // 'en-US-POSIX' still states US.
    expect(countryFromLanguageTags(['en-US-POSIX'])).toBe('US');
  });
});

describe('Accept-Language parsing', () => {
  it('orders by quality, best first', () => {
    expect(parseAcceptLanguage('en;q=0.5,sw-KE;q=0.9,fr;q=0.1')).toEqual([
      'sw-KE', 'en', 'fr',
    ]);
  });

  it('treats a tag with no q as quality 1', () => {
    expect(parseAcceptLanguage('en-GB,en;q=0.9')).toEqual(['en-GB', 'en']);
  });

  it('drops the wildcard', () => {
    expect(parseAcceptLanguage('*')).toEqual([]);
  });

  it.each([null, undefined, ''])('returns [] for %s', (h) => {
    expect(parseAcceptLanguage(h as string | null)).toEqual([]);
  });

  it('feeds detection end to end', () => {
    const tags = parseAcceptLanguage('en;q=0.9,en-KE;q=1.0');
    expect(countryFromLanguageTags(tags)).toBe('KE');
  });
});

describe('country -> currency', () => {
  it.each([
    ['KE', 'KES'],
    ['US', 'USD'],
    ['UG', 'UGX'],
    ['NG', 'NGN'],
    ['DE', 'EUR'],
    ['CI', 'XOF'],
  ])('%s -> %s', (cc, ccy) => {
    expect(currencyForCountry(cc)).toBe(ccy);
  });

  it('accepts lowercase', () => {
    expect(currencyForCountry('ke')).toBe('KES');
  });

  it.each([null, undefined, '', 'K', 'KEN', 'ZZ', '12'])(
    'returns null for %s',
    (cc) => {
      expect(currencyForCountry(cc as string | null)).toBeNull();
    },
  );
});

describe('detectLocale precedence', () => {
  it('prefers the timezone, because it says where the device is', () => {
    /*
      The common real case: a Kenyan browsing in en-US Chrome. The language
      says America, the timezone says Nairobi. The timezone is right about
      where they are, and it is what decides.
    */
    const d = detectLocale({ timeZone: 'Africa/Nairobi', languageTags: ['en-US'] });
    expect(d).toEqual({ country: 'KE', currency: 'KES', signal: 'timezone' });
  });

  it('falls back to an explicit language region when the zone is unknown', () => {
    const d = detectLocale({ timeZone: 'Not/AZone', languageTags: ['en-KE'] });
    expect(d).toEqual({ country: 'KE', currency: 'KES', signal: 'language-region' });
  });

  it('reports the signal it used, so the caller can be honest', () => {
    expect(detectLocale({ timeZone: 'Europe/Berlin' })?.signal).toBe('timezone');
    expect(detectLocale({ languageTags: ['pt-BR'] })?.signal).toBe('language-region');
  });

  it('returns null when nothing can be established', () => {
    expect(detectLocale({})).toBeNull();
    expect(detectLocale({ timeZone: null, languageTags: null })).toBeNull();
    // A region-less language is NOT something established.
    expect(detectLocale({ timeZone: 'UTC', languageTags: ['en'] })).toBeNull();
  });
});

describe('coverage against the runtime\'s own timezone list', () => {
  /*
    The completeness check. `Intl.supportedValuesOf('timeZone')` is what a
    browser on this ICU version can report, so any zone in it that we cannot
    map is a visitor we silently fail to detect.

    It passes at 418/418 today. It is here because it CAN fail: Node ships a
    new ICU with new zones periodically, and the generated table is a
    committed file that does not move on its own. A failure means
    `python3 -I scripts/generate-world-currencies.py` needs re-running.
  */
  it('maps every timezone this runtime knows', () => {
    const zones = Intl.supportedValuesOf('timeZone');
    expect(zones.length).toBeGreaterThan(400);
    const unmapped = zones.filter((z) => countryFromTimeZone(z) === null);
    expect(unmapped).toEqual([]);
  });

  it('and resolves every one of them to a currency', () => {
    const zones = Intl.supportedValuesOf('timeZone');
    const noCurrency = zones.filter((z) => {
      const d = detectLocale({ timeZone: z });
      return d === null;
    });
    // Antarctic bases and a few uninhabited territories have no tender of
    // their own; everything else must resolve.
    expect(noCurrency.length).toBeLessThan(15);
  });

  it('handles the alias zones real systems actually report', () => {
    // These are backward-compat links, not canonical zones, and a phone in
    // Kampala or Kolkata reports them verbatim - ICU does not canonicalize.
    expect(countryFromTimeZone('Africa/Kampala')).toBe('UG');
    expect(countryFromTimeZone('Asia/Calcutta')).toBe('IN');
    expect(countryFromTimeZone('Europe/Kiev')).toBe('UA');
    expect(countryFromTimeZone('Asia/Rangoon')).toBe('MM');
    // And the one that proves the link inference alone would have been wrong:
    // Africa/Kampala LINKS to Africa/Nairobi, which is Kenya.
    expect(countryFromTimeZone('Africa/Nairobi')).toBe('KE');
    expect(currencyForCountry(countryFromTimeZone('Africa/Kampala'))).toBe('UGX');
  });
});
