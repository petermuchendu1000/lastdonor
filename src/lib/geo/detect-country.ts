/**
 * Working out which country a visitor is in, and therefore which currency to
 * show them an approximate figure in.
 *
 * ── WHAT IS NOT AVAILABLE, MEASURED 2026-10-24 ──────────────────────────────
 *
 * **`CF-IPCountry` cannot be used.** `docs/26` describes a Cloudflare edge in
 * front of Fly, but every DNS record for `lastdonor.org` is `proxied=false`
 * and a response from it carries no `cf-ray` - the apex A record points
 * straight at the Fly IP. Requests do not pass through Cloudflare at all, so
 * Cloudflare adds no country header. Fly adds none either (checked: only
 * `fly-request-id`).
 *
 * So detection happens from what the BROWSER tells us, which is also what the
 * owner asked for. No IP geolocation service is involved: it would be a paid
 * external dependency on every page render, and it would turn a cosmetic
 * figure into a privacy question.
 *
 * ── THE RULE THAT MATTERS: AN EXPLICIT REGION, OR NOTHING ───────────────────
 *
 * `Intl.Locale('en').maximize().region` returns **US**, and `'sw'` maximizes
 * to **TZ**, not KE. Those are CLDR's statistically likeliest regions, not
 * facts about the visitor - so maximizing a region-less tag would confidently
 * tell a Kenyan on an English-only browser that they are American, and show
 * them dollars as though it had found out something.
 *
 * This module therefore reads a region ONLY where the tag states one
 * (`en-KE`), and otherwise reports nothing and lets the caller show nothing.
 */

import { COUNTRY_CURRENCY } from './country-currency.generated';
import { TIMEZONE_COUNTRY } from './timezone-country.generated';
import { isKnownCurrency } from '@/lib/money/world-currencies';

export { COUNTRY_CURRENCY, TIMEZONE_COUNTRY };

/** Which signal produced a detection, so the caller can be honest about it. */
export type CountrySignal = 'timezone' | 'language-region';

export type DetectedLocale = {
  readonly country: string;
  readonly currency: string;
  readonly signal: CountrySignal;
};

const ALPHA2 = /^[A-Za-z]{2}$/;

/**
 * The country whose primary timezone this is.
 *
 * A zone can cover several countries - `Africa/Abidjan` covers about a dozen -
 * and this returns the primary one, so a timezone narrows the country without
 * always determining it. Unknown or aliased zones return null rather than a
 * guess.
 */
export function countryFromTimeZone(timeZone: string | null | undefined): string | null {
  if (!timeZone) return null;
  return TIMEZONE_COUNTRY[timeZone] ?? null;
}

/**
 * The first region explicitly stated by a list of BCP 47 language tags.
 *
 * `navigator.languages` on the client, or a parsed `Accept-Language` on the
 * server. A tag with no region contributes nothing - see the note above on
 * why `maximize()` is not used.
 */
export function countryFromLanguageTags(
  tags: readonly string[] | null | undefined,
): string | null {
  if (!tags) return null;
  for (const raw of tags) {
    const tag = String(raw).trim();
    if (!tag) continue;
    // Read the subtag directly rather than through Intl.Locale, so there is
    // no path on which a region can be inferred rather than read.
    const parts = tag.split('-');
    for (const part of parts.slice(1)) {
      if (ALPHA2.test(part)) return part.toUpperCase();
    }
  }
  return null;
}

/**
 * Parse an `Accept-Language` header into tags, best quality first.
 *
 * `en-GB,en;q=0.9,sw-KE;q=0.8` -> ['en-GB', 'en', 'sw-KE']
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.split(';').map((s) => s.trim());
      const q = params
        .map((p) => /^q=([0-9.]+)$/.exec(p))
        .find(Boolean);
      const quality = q ? Number.parseFloat(q[1]) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((e) => e.tag && e.tag !== '*')
    .sort((a, b) => b.quality - a.quality)
    .map((e) => e.tag);
}

/** The current legal tender of a country, if we know the country. */
export function currencyForCountry(country: string | null | undefined): string | null {
  if (!country || !ALPHA2.test(country)) return null;
  const code = COUNTRY_CURRENCY[country.toUpperCase()];
  // A currency we cannot even name cannot be formatted, so report nothing.
  return code && isKnownCurrency(code) ? code : null;
}

/**
 * Detect the visitor's country and currency.
 *
 * Timezone first: it reflects where the device says it is, whereas a language
 * tag reflects what the person chose to read in - a Kenyan browsing in
 * `en-US` is common, and their timezone is still `Africa/Nairobi`. The
 * language region is the fallback for a browser that reports a zone we do not
 * recognise.
 *
 * Returns null when nothing can be established. Callers must render nothing
 * in that case, not a default.
 */
export function detectLocale(input: {
  timeZone?: string | null;
  languageTags?: readonly string[] | null;
}): DetectedLocale | null {
  const fromZone = countryFromTimeZone(input.timeZone);
  if (fromZone) {
    const currency = currencyForCountry(fromZone);
    if (currency) return { country: fromZone, currency, signal: 'timezone' };
  }
  const fromLang = countryFromLanguageTags(input.languageTags);
  if (fromLang) {
    const currency = currencyForCountry(fromLang);
    if (currency) return { country: fromLang, currency, signal: 'language-region' };
  }
  return null;
}
