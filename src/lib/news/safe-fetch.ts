/**
 * SSRF-safe outbound fetch for the news ingestion pipeline (audit P1-15).
 *
 * The pipeline fetches hosts it was handed by untrusted third-party content:
 * RSS `media:content` URLs, GNews `article.image`, and `og:image` /
 * `twitter:image` / LD+JSON values scraped out of an arbitrary publisher's
 * HTML. Before this module those fetches used `redirect: 'follow'` and
 * validated nothing beyond `startsWith('https://')`.
 *
 * The attack this closes: an indexed article sets
 * `<meta property="og:image" content="https://attacker.example/pic.jpg">`,
 * that host answers `302 Location: http://169.254.169.254/latest/meta-data/`,
 * and `fetch` follows it from inside our server. A pre-flight check on the
 * original URL cannot see that, which is why every hop is re-validated here
 * rather than delegating redirects to the runtime.
 *
 * Three guarantees:
 *   1. Redirects are handled manually (`redirect: 'manual'`) and every hop is
 *      re-checked with `assertSafeOutboundUrl`.
 *   2. The redirect chain is bounded (`DEFAULT_MAX_REDIRECTS`).
 *   3. One `AbortController` bounds the WHOLE chain, so a chain of slow hops
 *      cannot multiply the timeout.
 */

import { assertSafeOutboundUrl, SsrfBlockedError } from '@/lib/validators/url-allowlist';

export { SsrfBlockedError };

/** Redirect statuses `fetch` would otherwise follow for us. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Hard cap on redirect hops. Real news CDNs use one or two. */
export const DEFAULT_MAX_REDIRECTS = 4;

/** Fallback timeout when a caller does not specify one. */
export const DEFAULT_TIMEOUT_MS = 6_000;

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  /** Total budget for the entire redirect chain, not per hop. */
  timeoutMs?: number;
  maxRedirects?: number;
}

/**
 * Fetch an untrusted URL with the SSRF guard applied to the initial target
 * and to every redirect hop.
 *
 * Throws `SsrfBlockedError` when a hop targets a non-public host, and
 * whatever `fetch` throws otherwise (including `AbortError` on timeout).
 * Callers in this pipeline all degrade gracefully, so they catch broadly.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const {
    method = 'GET',
    headers,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
  } = options;

  // Validate before spending a timer or a socket.
  let target = assertSafeOutboundUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetch(target.toString(), {
        method,
        headers,
        signal: controller.signal,
        // Never delegate redirects to the runtime: a followed redirect is an
        // unvalidated fetch.
        redirect: 'manual',
      });

      if (!REDIRECT_STATUSES.has(res.status)) {
        // Defence in depth: if a runtime ignores `redirect: 'manual'` and
        // follows anyway, `res.url` is the final hop. Re-check it.
        if (res.url && res.url !== target.toString()) {
          assertSafeOutboundUrl(res.url);
        }
        return res;
      }

      const location = res.headers.get('location');
      if (!location) return res; // Redirect status with no target; let the caller see it.

      // Resolve relative Locations against the current hop, then re-validate.
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        throw new SsrfBlockedError(location, 'unparseable redirect Location');
      }
      target = assertSafeOutboundUrl(next.toString());
    }

    throw new SsrfBlockedError(url, `exceeded ${maxRedirects} redirects`);
  } finally {
    clearTimeout(timeout);
  }
}
