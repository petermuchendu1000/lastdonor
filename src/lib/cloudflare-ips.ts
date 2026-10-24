/**
 * Cloudflare's published edge address space, and a containment test for it.
 *
 * WHY THIS EXISTS
 *
 * `CF-Connecting-IP` is only authoritative on a request that actually passed
 * through Cloudflare. Cloudflare overwrites that header at its edge, so a
 * client cannot forge it *on that path* - but it is an ordinary request header
 * on every other path, and this app keeps two paths that bypass Cloudflare
 * permanently:
 *
 *   - `lastdonor.fly.dev`      - Fly's own hostname, outside the DNS zone
 *   - `origin.lastdonor.org`   - deliberately grey-cloud (docs/104 §3.3)
 *
 * So "we are behind Cloudflare" is NOT a property of the deployment that can be
 * asserted in configuration; it is a property of an individual request, and the
 * only evidence for it is the address the request actually arrived from. If that
 * peer is inside Cloudflare's address space, the request came through
 * Cloudflare. If it is not, the request came straight to the origin and
 * `CF-Connecting-IP` is whatever the caller typed.
 *
 * See `docs/105-EDGE-TRUST-AND-CLOUDFLARE-CUTOVER-ADR.md`.
 *
 * STALENESS
 *
 * [VERIFIED 2026-10-24] Fetched from `https://api.cloudflare.com/client/v4/ips`,
 * which answered `success: true` with 15 IPv4 and 7 IPv6 prefixes at
 * `etag: 38f79d050aa027e3be3865e495dcc9bc`.
 *
 * Cloudflare adds ranges rarely, but it does add them. The failure mode if this
 * list goes stale is bounded and non-silent in the right direction: a request
 * arriving from a NEW Cloudflare range is treated as a direct hit, so its
 * rate-limit key becomes the Cloudflare edge address rather than the visitor's.
 * That over-counts (visitors through one new edge share a bucket) and never
 * under-counts, so it cannot be used to escape a limit. Refresh the list with
 *
 *   CF_IPS_LIVE_CONTRACT=1 npx vitest run src/lib/cloudflare-ips.contract.live.test.ts
 *
 * which compares these constants against the live endpoint and names any drift.
 */

/** The day the constants below were read from Cloudflare's own endpoint. */
export const CLOUDFLARE_IPS_FETCHED_AT = '2026-10-24';

/** The `etag` Cloudflare reported for that snapshot. */
export const CLOUDFLARE_IPS_ETAG = '38f79d050aa027e3be3865e495dcc9bc';

export const CLOUDFLARE_IPV4_CIDRS = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
] as const;

export const CLOUDFLARE_IPV6_CIDRS = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
] as const;

/*
  Addresses are compared as plain numbers, not BigInt: this project targets
  ES2017 (`tsconfig.json`) where a BigInt literal does not compile. An IPv4
  address fits exactly in a double (max 4,294,967,295) and an IPv6 address is
  held as eight 16-bit groups, so no value is ever approximated.

  Prefix comparison divides rather than shifting. `x >>> 32` is a NO-OP in
  JavaScript - the shift count is taken modulo 32 - so a `/0` prefix compared
  with `>>>` would silently test the whole address instead of nothing.
*/

function ipv4ToNumber(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n;
}

/** Eight 16-bit groups, most significant first, or `null` if unparseable. */
function ipv6ToGroups(value: string): number[] | null {
  let text = value.trim().toLowerCase();
  if (!text) return null;

  // Drop a zone index ("fe80::1%eth0") - irrelevant to containment.
  const percent = text.indexOf('%');
  if (percent !== -1) text = text.slice(0, percent);

  // An embedded IPv4 tail ("::ffff:1.2.3.4") becomes two hex groups.
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon === -1) return null;
    const embedded = ipv4ToNumber(text.slice(lastColon + 1));
    if (embedded === null) return null;
    const high = Math.floor(embedded / 0x10000);
    const low = embedded % 0x10000;
    text = `${text.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const double = text.indexOf('::');
  let groupText: string[];
  if (double === -1) {
    groupText = text.split(':');
    if (groupText.length !== 8) return null;
  } else {
    if (text.indexOf('::', double + 1) !== -1) return null; // only one "::"
    const headText = text.slice(0, double);
    const tailText = text.slice(double + 2);
    const head = headText ? headText.split(':') : [];
    const tail = tailText ? tailText.split(':') : [];
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groupText = [...head, ...Array<string>(fill).fill('0'), ...tail];
  }

  const groups: number[] = [];
  for (const group of groupText) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    groups.push(parseInt(group, 16));
  }
  return groups;
}

function withinIpv4Cidr(address: number, cidr: string): boolean {
  const slash = cidr.indexOf('/');
  if (slash === -1) return false;
  const network = ipv4ToNumber(cidr.slice(0, slash));
  if (network === null) return false;
  const length = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(length) || length < 0 || length > 32) return false;

  const block = Math.pow(2, 32 - length);
  return Math.floor(address / block) === Math.floor(network / block);
}

function withinIpv6Cidr(address: number[], cidr: string): boolean {
  const slash = cidr.indexOf('/');
  if (slash === -1) return false;
  const network = ipv6ToGroups(cidr.slice(0, slash));
  if (network === null) return false;
  const length = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(length) || length < 0 || length > 128) return false;

  const whole = Math.floor(length / 16);
  for (let i = 0; i < whole; i += 1) {
    if (address[i] !== network[i]) return false;
  }
  const remainder = length % 16;
  if (remainder === 0) return true;
  const mask = (0xffff << (16 - remainder)) & 0xffff;
  return (address[whole] & mask) === (network[whole] & mask);
}

/** `::ffff:0:0/96` - an IPv4 address wearing an IPv6 hat. */
function mappedIpv4(groups: number[]): number | null {
  for (let i = 0; i < 5; i += 1) if (groups[i] !== 0) return null;
  if (groups[5] !== 0xffff) return null;
  return groups[6] * 0x10000 + groups[7];
}

/**
 * Is this address inside Cloudflare's published edge space?
 *
 * Takes a bare address as `getClientIp` normalises them (no port, no brackets).
 * Anything unparseable answers `false`, which is the safe direction: an address
 * we cannot read is not evidence that Cloudflare sent the request.
 */
export function isCloudflareIp(value: string | null | undefined): boolean {
  if (!value) return false;
  const text = value.trim();
  if (!text || text.length > 64) return false;

  if (!text.includes(':')) {
    const v4 = ipv4ToNumber(text);
    return v4 === null ? false : CLOUDFLARE_IPV4_CIDRS.some((c) => withinIpv4Cidr(v4, c));
  }

  const groups = ipv6ToGroups(text);
  if (groups === null) return false;

  // Test a mapped address as IPv4, or a Cloudflare v4 edge arriving as
  // `::ffff:104.16.0.1` would read as a direct hit.
  const mapped = mappedIpv4(groups);
  if (mapped !== null) {
    return CLOUDFLARE_IPV4_CIDRS.some((c) => withinIpv4Cidr(mapped, c));
  }

  return CLOUDFLARE_IPV6_CIDRS.some((c) => withinIpv6Cidr(groups, c));
}
