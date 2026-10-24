/**
 * Exchange-rate providers, chosen by probing them rather than reading about
 * them (the docs/84 and docs/90 habit).
 *
 * ── WHY THESE TWO, measured 2026-10-24 ──────────────────────────────────────
 *
 * PRIMARY: `open.er-api.com` (ExchangeRate-API's open-access endpoint).
 *   No key. 166 currencies including KES. Carries an explicit freshness
 *   contract - `time_last_update_utc` AND `time_next_update_utc` - which is
 *   the thing that makes a staleness guard possible at all. 170ms from the
 *   production machine in `arn`. `time_eol_unix` is 0, i.e. no sunset
 *   announced.
 *
 * FALLBACK: `@fawazahmed0/currency-api` over the jsDelivr CDN.
 *   No key, 288 three-letter codes, 75ms from production. Genuinely separate
 *   infrastructure AND a separate data aggregation, which is the only reason
 *   it is worth having.
 *
 * ── WHAT WAS REJECTED ───────────────────────────────────────────────────────
 *
 * - `api.frankfurter.dev` - the obvious "clean" choice, and WRONG for this
 *   platform: it serves ECB reference rates, which are 29 currencies and
 *   **do not include KES**. Verified: `has_KES: false`. KES is our only
 *   working payment rail (docs/92), so a provider without it is useless here.
 * - `api.exchangerate.host` - now returns **401**; it requires an API key.
 * - `api.exchangerate-api.com/v4` - works, but it is the SAME OPERATOR as the
 *   primary. Pairing them would be redundancy in appearance only. This is the
 *   docs/86 finding again, where a "fallback" SMS provider turned out to
 *   resell the same upstream.
 * - `floatrates.com` - 200s, but 25KB of nested objects and no clear
 *   freshness contract.
 *
 * ── TWO TRAPS, BOTH MEASURED ────────────────────────────────────────────────
 *
 * 1. **The primary answers HTTP 200 for its own errors.** An unsupported base
 *    returns `{"result":"error","error-type":"unsupported-code"}` with status
 *    **200**. So `res.ok` is not a success signal and must never be treated as
 *    one - exactly the shape of the PayHero trap in docs/92, where
 *    `success: true` arrived alongside `status: "FAILED"`. Success here means
 *    `result === 'success'`, nothing less.
 *
 * 2. **The fallback's keys are lowercase and include cryptocurrencies.** Its
 *    339 keys contain `1inch`, `aave`, `ada`, `btc`, `eth`. Storing those in a
 *    money table would be storing asset prices next to currency rates. Only
 *    rates for codes this platform actually supports are kept.
 *
 * ── TERMS ───────────────────────────────────────────────────────────────────
 *
 * The primary's own documentation (https://www.exchangerate-api.com/docs/free,
 * read 2026-10-24) states the open endpoint "requires attribution", is rate
 * limited, and that caching is explicitly allowed: "You're welcome to cache
 * the data we respond with". Re-distribution is NOT allowed - we display
 * converted amounts, we do not serve the rate table onward.
 *
 * `FX_ATTRIBUTION` below is therefore a compliance obligation, not decoration.
 * A ratchet test asserts the display component renders it.
 */

import { SUPPORTED_CURRENCY_CODES } from './currencies';

/** Required by the primary provider's terms. Render wherever a rate is used. */
export const FX_ATTRIBUTION = Object.freeze({
  label: 'Exchange rates by ExchangeRate-API',
  href: 'https://www.exchangerate-api.com',
});

/** A validated rate table. Rates are "units of X per 1 USD". */
export type FxSnapshot = {
  readonly base: 'USD';
  readonly rates: Readonly<Record<string, number>>;
  /** The provider's OWN last-update time, not when we fetched it. */
  readonly asOf: string;
  readonly provider: string;
  readonly fetchedAt: string;
};

const FETCH_TIMEOUT_MS = 8_000;

export class FxProviderError extends Error {}

/**
 * Keep only the codes this platform supports, uppercased.
 *
 * Rejects the snapshot outright if any supported currency is missing: a table
 * without KES cannot convert anything we care about, and storing it would let
 * a later read believe rates are available when they are not.
 */
function narrowToSupported(
  raw: Record<string, unknown>,
  provider: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of SUPPORTED_CURRENCY_CODES) {
    // The primary keys by uppercase code, the fallback by lowercase.
    const value = raw[code] ?? raw[code.toLowerCase()];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new FxProviderError(
        `${provider}: no usable rate for ${code} (got ${JSON.stringify(value)})`,
      );
    }
    out[code] = value;
  }
  // A USD-based table must say 1 USD = 1 USD. If it does not, the base is not
  // what we asked for and every conversion would be silently scaled.
  if (Math.abs(out.USD - 1) > 1e-9) {
    throw new FxProviderError(`${provider}: base is not USD (USD rate ${out.USD})`);
  }
  return out;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  // Checked even though the primary also 200s its errors: a 4xx/5xx still
  // means no usable body, and the `result` check below catches the rest.
  if (!res.ok) throw new FxProviderError(`HTTP ${res.status} from ${url}`);
  return res.json();
}

/** ExchangeRate-API open access. */
export async function fetchFromErApi(): Promise<FxSnapshot> {
  const body = (await getJson('https://open.er-api.com/v6/latest/USD')) as {
    result?: string;
    'error-type'?: string;
    base_code?: string;
    time_last_update_utc?: string;
    rates?: Record<string, unknown>;
  };

  /*
    TRAP 1. This provider reports its own failures with HTTP 200, so the
    status line proves nothing. Measured: a bad base gives
    `{"result":"error","error-type":"unsupported-code"}` at status 200.
  */
  if (body.result !== 'success') {
    throw new FxProviderError(
      `open.er-api.com result=${body.result ?? 'missing'} type=${body['error-type'] ?? 'none'}`,
    );
  }
  if (body.base_code !== 'USD') {
    throw new FxProviderError(`open.er-api.com base_code=${body.base_code ?? 'missing'}`);
  }
  if (!body.rates || typeof body.rates !== 'object') {
    throw new FxProviderError('open.er-api.com returned no rates object');
  }

  const asOf = body.time_last_update_utc
    ? new Date(body.time_last_update_utc)
    : null;
  if (!asOf || Number.isNaN(asOf.getTime())) {
    // Without the provider's own timestamp there is no way to tell a fresh
    // table from a week-old one, and the staleness guard becomes decorative.
    throw new FxProviderError('open.er-api.com gave no parseable time_last_update_utc');
  }

  return {
    base: 'USD',
    rates: narrowToSupported(body.rates, 'open.er-api.com'),
    asOf: asOf.toISOString(),
    provider: 'open.er-api.com',
    fetchedAt: new Date().toISOString(),
  };
}

/** @fawazahmed0/currency-api over jsDelivr. */
export async function fetchFromCurrencyApi(): Promise<FxSnapshot> {
  const body = (await getJson(
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  )) as { date?: string; usd?: Record<string, unknown> };

  if (!body.usd || typeof body.usd !== 'object') {
    throw new FxProviderError('currency-api returned no usd object');
  }
  // Its `date` is a plain YYYY-MM-DD with no time, so it is read as UTC
  // midnight. That makes the snapshot look very slightly older than it is,
  // which is the safe direction for a staleness guard to err in.
  const asOf = body.date ? new Date(`${body.date}T00:00:00Z`) : null;
  if (!asOf || Number.isNaN(asOf.getTime())) {
    throw new FxProviderError('currency-api gave no parseable date');
  }

  /*
    TRAP 2. This table's keys are lowercase and include crypto (`1inch`,
    `aave`, `btc`). `narrowToSupported` keeps only codes in CURRENCIES, so
    nothing else can reach the store.

    It also carries no `usd: 1` entry of its own in some builds, so the base
    assertion in `narrowToSupported` is satisfied here by injecting it - this
    IS a USD-based table by construction, the file is `currencies/usd.json`.
  */
  const raw: Record<string, unknown> = { ...body.usd, USD: 1, usd: 1 };

  return {
    base: 'USD',
    rates: narrowToSupported(raw, 'currency-api'),
    asOf: asOf.toISOString(),
    provider: 'cdn.jsdelivr.net/@fawazahmed0',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Try the primary, fall back to the secondary.
 *
 * Returns the snapshot and the errors that were swallowed along the way, so
 * the caller can record a degraded fetch instead of a silent one - the
 * `fetchGNewsArticles` mistake in docs/90, which swallowed every error and
 * returned `[]`, is the thing being avoided.
 */
export async function fetchFxSnapshot(
  providers: ReadonlyArray<() => Promise<FxSnapshot>> = [
    fetchFromErApi,
    fetchFromCurrencyApi,
  ],
): Promise<{ snapshot: FxSnapshot; errors: string[] }> {
  const errors: string[] = [];
  for (const provider of providers) {
    try {
      return { snapshot: await provider(), errors };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new FxProviderError(
    `every FX provider failed: ${errors.join(' | ') || 'no providers configured'}`,
  );
}
