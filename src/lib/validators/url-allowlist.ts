import { z } from 'zod';

/**
 * URL Allowlist Validators
 *
 * Defense in Depth: Validates that user-supplied URLs only point to
 * trusted domains. Prevents stored XSS via javascript: URIs and SSRF
 * via internal network URLs.
 *
 * This module is the single source of truth for the SSRF guard. Every
 * outbound fetch that takes a host from untrusted input (news articles,
 * og:image tags, user-pasted URLs) must route through `assertSafeOutboundUrl`
 * or `isSafeOutboundUrl` here — including after each redirect hop.
 * See `src/lib/news/safe-fetch.ts` for the fetch wrapper that does this.
 */

/** Domains allowed for campaign hero/gallery images. */
const IMAGE_URL_ALLOWED_HOSTS = new Set([
  'ntnrcedafgmeyajmzvga.supabase.co',  // Our Supabase storage
  'images.unsplash.com',
  'cdn.pixabay.com',
  'images.pexels.com',
]);

/** Domains allowed for YouTube embeds. */
const YOUTUBE_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
]);

/** Blocked URL schemes */
const BLOCKED_SCHEMES = /^(javascript|data|vbscript|file|ftp):/i;

/** Only these schemes may ever be fetched server-side. */
const ALLOWED_OUTBOUND_PROTOCOLS = new Set(['https:', 'http:']);

/**
 * Blocked internal network patterns (SSRF prevention).
 *
 * Retained as a cheap raw-string pre-filter. It is NOT sufficient on its own:
 * `https://trusted.example.com@169.254.169.254/` defeats every one of these
 * because the string does not *start* with the internal host. The
 * authoritative check is `isInternalHostname`, which runs against the parsed
 * `URL.hostname`.
 */
const INTERNAL_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/0\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/169\.254\./,    // AWS metadata
  /^https?:\/\/\[::1\]/,       // IPv6 loopback
  /^https?:\/\/\[fd/i,         // IPv6 private
  /^https?:\/\/metadata\./i,   // Cloud metadata services
];

// ── Hostname-level SSRF guard ──────────────────────────────────────────────

/**
 * Hostname suffixes that only ever resolve inside a private network.
 * `.test`/`.example`/`.invalid` are RFC 2606 reserved, `.onion` is Tor.
 */
const INTERNAL_HOST_SUFFIXES = [
  '.localhost',
  '.localdomain',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.corp',
  '.private',
  '.onion',
  '.test',
  '.example',
  '.invalid',
];

/** Exact hostnames that are always internal. */
const INTERNAL_HOST_EXACT = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/** IPv4 ranges that must never be reachable from a server-side fetch. */
const BLOCKED_V4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],        // "this network" / 0.0.0.0
  ['10.0.0.0', 8],       // RFC1918
  ['100.64.0.0', 10],    // RFC6598 carrier-grade NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local — AWS/GCP/Azure instance metadata
  ['172.16.0.0', 12],    // RFC1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],   // RFC1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved + 255.255.255.255
];

function ipv4ToInt(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1, 5).map((o) => Number(o));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (
    ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  );
}

function isBlockedV4(addr: number): boolean {
  for (const [base, bits] of BLOCKED_V4_CIDRS) {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((addr & mask) === (baseInt & mask)) return true;
  }
  return false;
}

/** Normalise a URL hostname for comparison: lowercase, de-bracketed, no root dot. */
function normaliseHostname(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/**
 * True when a hostname must not be fetched server-side.
 *
 * Deliberately strict: every form of IP literal is refused, not just the
 * private ranges. Decimal (`2130706433`), hex (`0x7f000001`), octal
 * (`0177.0.0.1`), short-form (`127.1`) and IPv4-mapped IPv6
 * (`[::ffff:169.254.169.254]`) are all ways to spell a private address past a
 * range check, and no legitimate news/CDN host is ever a bare IP. Single-label
 * hostnames (`router`, `metadata`) are refused for the same reason — they can
 * only resolve through an internal search domain.
 */
export function isInternalHostname(rawHost: string): boolean {
  const host = normaliseHostname(rawHost);
  if (!host) return true;

  // Any IPv6 literal (contains a colon) — including IPv4-mapped forms.
  if (host.includes(':')) return true;

  // Explicitly internal names.
  if (INTERNAL_HOST_EXACT.has(host)) return true;
  if (INTERNAL_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (host.startsWith('metadata.')) return true;

  // Any numeric or hex/octal-encoded host form is an IP literal in disguise.
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^[0-9.]+$/.test(host)) {
    const addr = ipv4ToInt(host);
    // A well-formed dotted quad is checked against the private ranges; any
    // other all-numeric form (decimal, octal, 2-part short form) is refused
    // outright because it cannot be a real public hostname.
    return addr === null ? true : isBlockedV4(addr);
  }

  // Single-label hostnames cannot be public.
  if (!host.includes('.')) return true;

  return false;
}

/** Legacy raw-string check, kept for callers that pass unparsed strings. */
export function isInternalUrl(url: string): boolean {
  if (INTERNAL_PATTERNS.some((p) => p.test(url))) return true;
  try {
    return isInternalHostname(new URL(url).hostname);
  } catch {
    return true;
  }
}

function isBlockedScheme(url: string): boolean {
  return BLOCKED_SCHEMES.test(url.trim());
}

/** Raised when an outbound fetch target fails the SSRF guard. */
export class SsrfBlockedError extends Error {
  readonly url: string;
  constructor(url: string, reason: string) {
    super(`Blocked outbound request to ${url}: ${reason}`);
    this.name = 'SsrfBlockedError';
    this.url = url;
  }
}

/**
 * Validate a URL as a server-side fetch target and return the parsed URL.
 * Throws `SsrfBlockedError` otherwise.
 *
 * MUST be called again for every redirect hop — a permitted host that
 * 302s to `http://169.254.169.254/` defeats a pre-flight-only check.
 */
export function assertSafeOutboundUrl(url: string | URL): URL {
  const raw = typeof url === 'string' ? url.trim() : url.toString();

  if (isBlockedScheme(raw)) {
    throw new SsrfBlockedError(raw, 'blocked URL scheme');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SsrfBlockedError(raw, 'not an absolute URL');
  }

  if (!ALLOWED_OUTBOUND_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfBlockedError(raw, `disallowed protocol ${parsed.protocol}`);
  }

  // Credentials in the authority are a classic way to make a URL *look* like
  // it targets an allowed host while resolving somewhere else.
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError(raw, 'credentials in URL authority');
  }

  if (isInternalHostname(parsed.hostname)) {
    throw new SsrfBlockedError(raw, `internal or non-public host ${parsed.hostname}`);
  }

  return parsed;
}

/** Non-throwing form of {@link assertSafeOutboundUrl}. */
export function isSafeOutboundUrl(url: string | URL): boolean {
  try {
    assertSafeOutboundUrl(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a URL is HTTPS and from an allowed host.
 * Falls back to allowing any HTTPS URL if allowAnyHttps is true (for hero images
 * that may come from arbitrary news sources during automated pipeline).
 */
export function validateImageUrl(url: string, allowAnyHttps = false): boolean {
  if (isBlockedScheme(url) || isInternalUrl(url)) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (allowAnyHttps) return true;
    return IMAGE_URL_ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function validateYouTubeUrl(url: string): boolean {
  if (isBlockedScheme(url) || isInternalUrl(url)) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return YOUTUBE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Zod refinement for image URLs. Used in campaign create/update validators.
 * For automated pipeline (news images), pass allowAnyHttps = true.
 */
export const safeImageUrl = (allowAnyHttps = false) =>
  z.string().url().refine(
    (url) => validateImageUrl(url, allowAnyHttps),
    allowAnyHttps
      ? 'Image URL must use HTTPS and not point to internal networks'
      : 'Image URL must be from an allowed domain (upload via our platform)',
  );

export const safeYouTubeUrl = z.string().url().refine(
  (url) => validateYouTubeUrl(url),
  'URL must be a YouTube link using HTTPS',
);
