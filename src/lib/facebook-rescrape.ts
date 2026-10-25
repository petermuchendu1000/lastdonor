/**
 * Asking Facebook to re-read a page it has already cached.
 *
 * ## Why this exists
 *
 * Facebook caches the scraped tags AND the image bytes per URL. After the
 * share card was rebuilt (`docs/112` §7-§9) every live campaign still had the
 * old 798-928KB PNG and the old title-repeating description in Facebook's
 * cache, and nothing we can change on our own site clears it - a new
 * `og:image` URL is only noticed once the page is scraped again.
 *
 * ⚠️ **[VERIFIED 2026-10-25]** There is no unauthenticated way to do this.
 * `POST https://graph.facebook.com/v21.0/?id=<url>&scrape=true` answers
 * `(#100) Must have a valid access token or a valid url_hmac`.
 *
 * ## The token
 *
 * Supplied by the operator in `FACEBOOK_ACCESS_TOKEN` and **sent in the
 * request BODY, never the query string** - a token in a URL ends up in
 * proxy logs, browser history and error messages. `redactToken` is applied
 * to everything this module hands back for printing, so a token cannot reach
 * a log even if an error message quotes the request.
 *
 * Everything here is pure. The script that performs the calls is
 * `scripts/facebook-rescrape.ts`.
 */

/** Graph API version. Pinned, because an unversioned call follows Meta's default. */
export const GRAPH_VERSION = 'v21.0';

export const GRAPH_ENDPOINT = `https://graph.facebook.com/${GRAPH_VERSION}/`;

export type ScrapeOutcome =
  | 'refreshed'
  | 'auth'
  | 'rate_limited'
  | 'unreachable_page'
  | 'error';

export interface ScrapeResult {
  url: string;
  outcome: ScrapeOutcome;
  /** Safe to print: never contains the token. */
  detail: string;
  /** What Facebook holds for the page now, when it told us. */
  scraped?: { title?: string; image?: string; updatedTime?: string };
}

/**
 * Request body for one re-scrape.
 *
 * `scrape=true` is what makes this a write rather than a read: without it
 * the same call returns Facebook's CACHED view, which is precisely the thing
 * being replaced.
 */
export function scrapeBody(pageUrl: string, token: string): URLSearchParams {
  return new URLSearchParams({
    id: pageUrl,
    scrape: 'true',
    access_token: token,
  });
}

/**
 * Remove a secret from text before it is printed.
 *
 * Takes the token rather than guessing a pattern: Meta tokens have no single
 * stable shape, and a regex that half-matches is worse than none.
 */
export function redactToken(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join('***REDACTED***');
}

/**
 * Graph error codes worth telling apart.
 *
 * 190 and 102 are the token; 4, 17, 32, 80001 and 613 are throttling. They
 * need different responses from the operator - one is "fix the token", the
 * other is "wait and run it again" - so they are not collapsed into "error".
 */
const AUTH_CODES = new Set([100, 102, 190, 200, 294]);
const RATE_CODES = new Set([4, 17, 32, 613, 80001]);

/**
 * Decide what happened, from the HTTP status and the parsed body.
 *
 * ⚠️ HTTP status alone is not enough. Graph answers **HTTP 400 with a body**
 * for both a dead token and a URL it cannot fetch, and those are not the
 * same problem - the same shape as PayHero's `success: true` alongside
 * `status: FAILED` (`docs/92`) and the FX provider's HTTP 200 errors
 * (`docs/102`). Read the body.
 */
export function classifyScrape(
  httpStatus: number,
  body: unknown,
  token = '',
): Omit<ScrapeResult, 'url'> {
  const b = (body ?? {}) as Record<string, unknown>;
  const err = b.error as Record<string, unknown> | undefined;

  if (err) {
    const code = typeof err.code === 'number' ? err.code : -1;
    const message = redactToken(String(err.message ?? 'unknown error'), token);
    if (AUTH_CODES.has(code)) return { outcome: 'auth', detail: `[${code}] ${message}` };
    if (RATE_CODES.has(code)) return { outcome: 'rate_limited', detail: `[${code}] ${message}` };
    return { outcome: 'error', detail: `[${code}] ${message}` };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    return { outcome: 'error', detail: `HTTP ${httpStatus} with no error object` };
  }

  /*
    A successful scrape echoes what Facebook now holds. An empty `id` means
    it accepted the request and fetched nothing useful - usually a page it
    could not reach - which is NOT a refresh and must not be reported as one.
  */
  if (!b.id) {
    return { outcome: 'unreachable_page', detail: 'Facebook returned no object for the URL' };
  }

  return { outcome: 'refreshed', detail: 'scraped', scraped: summariseScraped(b) };
}

/** The fields worth showing the operator, when Facebook includes them. */
export function summariseScraped(body: Record<string, unknown>): ScrapeResult['scraped'] {
  const og = (body.og_object ?? {}) as Record<string, unknown>;
  const image = body.image;
  let imageUrl: string | undefined;
  if (Array.isArray(image) && image.length > 0) {
    const first = image[0] as Record<string, unknown>;
    if (typeof first?.url === 'string') imageUrl = first.url;
  }
  return {
    title: typeof og.title === 'string' ? og.title : undefined,
    image: imageUrl,
    updatedTime: typeof og.updated_time === 'string' ? og.updated_time : undefined,
  };
}

/**
 * Did Facebook actually pick up the current card?
 *
 * The point of running this is not that the call returned 200 - it is that
 * the cache now holds the NEW image. `og:image` carries `?v=<CARD_VERSION>`
 * (`src/lib/og-card-metrics.ts`), so the version in what Facebook echoes
 * back is the evidence. Returns null when Facebook told us no image, because
 * "unknown" and "wrong" are different answers.
 */
export function heldCardVersion(scraped: ScrapeResult['scraped']): number | null {
  if (!scraped?.image) return null;
  const m = /[?&]v=(\d+)/.exec(scraped.image);
  return m ? Number(m[1]) : null;
}
