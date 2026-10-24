/**
 * Containment tests for Cloudflare's published edge space.
 *
 * This decides whether `CF-Connecting-IP` is believed, so a false positive
 * hands rate-limit key control to any caller who can reach the Fly hostname.
 * The boundary cases below are the ones a hand-rolled CIDR check gets wrong.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

import {
  isCloudflareIp,
  CLOUDFLARE_IPV4_CIDRS,
  CLOUDFLARE_IPV6_CIDRS,
  CLOUDFLARE_IPS_FETCHED_AT,
} from './cloudflare-ips';

describe('isCloudflareIp - inside the published space', () => {
  it('accepts an address from each published IPv4 prefix', () => {
    // The first usable address of every prefix, derived from the prefix itself,
    // so adding a range to the constant extends the test automatically.
    for (const cidr of CLOUDFLARE_IPV4_CIDRS) {
      const network = cidr.slice(0, cidr.indexOf('/'));
      expect(isCloudflareIp(network), `${cidr} network address`).toBe(true);
    }
  });

  it('accepts an address from each published IPv6 prefix', () => {
    for (const cidr of CLOUDFLARE_IPV6_CIDRS) {
      const network = cidr.slice(0, cidr.indexOf('/'));
      expect(isCloudflareIp(network), `${cidr} network address`).toBe(true);
    }
  });

  it('accepts real edge addresses in the middle of a prefix', () => {
    expect(isCloudflareIp('104.16.123.45')).toBe(true); // 104.16.0.0/13
    expect(isCloudflareIp('162.158.1.1')).toBe(true); // 162.158.0.0/15
    expect(isCloudflareIp('172.68.5.9')).toBe(true); // 172.64.0.0/13
    expect(isCloudflareIp('2606:4700::1111')).toBe(true); // 2606:4700::/32
  });
});

describe('isCloudflareIp - outside it', () => {
  it('rejects ordinary public addresses', () => {
    expect(isCloudflareIp('8.8.8.8')).toBe(false);
    expect(isCloudflareIp('203.0.113.7')).toBe(false);
    expect(isCloudflareIp('2001:db8::1')).toBe(false);
  });

  it("rejects 1.1.1.1 - Cloudflare's RESOLVER is not a proxy edge", () => {
    /*
      The most tempting wrong answer. `1.1.1.1` is Cloudflare's public DNS
      service and is absent from the proxy ranges, so a request from it did NOT
      come through the reverse proxy and its CF-Connecting-IP means nothing.
    */
    expect(isCloudflareIp('1.1.1.1')).toBe(false);
    expect(isCloudflareIp('1.0.0.1')).toBe(false);
  });

  it('rejects Fly internal and loopback addresses', () => {
    expect(isCloudflareIp('127.0.0.1')).toBe(false);
    expect(isCloudflareIp('::1')).toBe(false);
    expect(isCloudflareIp('fdaa:0:1::3')).toBe(false); // Fly 6PN
  });
});

describe('isCloudflareIp - prefix boundaries', () => {
  it('is exact at the edges of 104.16.0.0/13', () => {
    expect(isCloudflareIp('104.15.255.255')).toBe(false); // one below
    expect(isCloudflareIp('104.16.0.0')).toBe(true);
    expect(isCloudflareIp('104.23.255.255')).toBe(true); // last in /13
  });

  it('is exact at the edges of 172.64.0.0/13', () => {
    expect(isCloudflareIp('172.63.255.255')).toBe(false);
    expect(isCloudflareIp('172.71.255.255')).toBe(true); // last in /13
    expect(isCloudflareIp('172.72.0.0')).toBe(false); // one above
  });

  it('handles a /29 IPv6 prefix, where the mask falls inside a group', () => {
    // 2a06:98c0::/29 - 29 bits is group 0 whole plus 13 bits of group 1.
    expect(isCloudflareIp('2a06:98c0::1')).toBe(true);
    expect(isCloudflareIp('2a06:98c7:ffff::1')).toBe(true); // 0x98c7 & 0xfff8 == 0x98c0
    expect(isCloudflareIp('2a06:98c8::1')).toBe(false); // 0x98c8 is outside
    expect(isCloudflareIp('2a06:98bf::1')).toBe(false); // one below
  });
});

describe('isCloudflareIp - the forms an address actually arrives in', () => {
  it('treats an IPv4-mapped IPv6 address as the IPv4 address it is', () => {
    /*
      Load-bearing. A Cloudflare v4 edge can reach a dual-stack origin as
      `::ffff:104.16.0.1`. Without the mapped-address branch that reads as a
      direct hit, every visitor through Cloudflare gets keyed by the edge and
      the login limiter locks real users out - the outage docs/104 §3 warns of.
    */
    expect(isCloudflareIp('::ffff:104.16.0.1')).toBe(true);
    expect(isCloudflareIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('accepts the compressed and expanded spellings of one address', () => {
    expect(isCloudflareIp('2606:4700::1')).toBe(true);
    expect(isCloudflareIp('2606:4700:0:0:0:0:0:1')).toBe(true);
    expect(isCloudflareIp('2606:4700:0000:0000:0000:0000:0000:0001')).toBe(true);
  });

  it('ignores a zone index', () => {
    expect(isCloudflareIp('2606:4700::1%eth0')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCloudflareIp('2A06:98C0::1')).toBe(true);
  });
});

describe('isCloudflareIp - refuses to guess', () => {
  it('rejects empty and absent values', () => {
    expect(isCloudflareIp(null)).toBe(false);
    expect(isCloudflareIp(undefined)).toBe(false);
    expect(isCloudflareIp('')).toBe(false);
    expect(isCloudflareIp('   ')).toBe(false);
  });

  it('rejects anything that is not an address', () => {
    for (const value of [
      'cloudflare',
      '104.16.0',
      '104.16.0.1.2',
      '104.16.0.256',
      '104.16.0.-1',
      '2606:4700::g',
      '2606::4700::1', // two "::"
      '1:2:3:4:5:6:7:8:9',
      'x'.repeat(100),
    ]) {
      expect(isCloudflareIp(value), `${value} must not read as Cloudflare`).toBe(false);
    }
  });

  it('rejects a comma-joined header value', () => {
    // What `Headers.get` returns for a duplicated header - the shape a caller
    // produces by sending their own copy of an edge header.
    expect(isCloudflareIp('104.16.0.1, 8.8.8.8')).toBe(false);
    expect(isCloudflareIp('8.8.8.8, 104.16.0.1')).toBe(false);
  });

  it('rejects an address carrying a port', () => {
    // `getClientIp` strips ports before calling this; a raw value must not pass.
    expect(isCloudflareIp('104.16.0.1:443')).toBe(false);
  });
});

describe('the pinned snapshot', () => {
  it('records when it was read, so staleness is visible', () => {
    expect(CLOUDFLARE_IPS_FETCHED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('holds every prefix as a well-formed CIDR', () => {
    for (const cidr of CLOUDFLARE_IPV4_CIDRS) {
      expect(cidr, cidr).toMatch(/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/);
    }
    for (const cidr of CLOUDFLARE_IPV6_CIDRS) {
      expect(cidr, cidr).toMatch(/^[0-9a-f:]+\/\d{1,3}$/);
    }
  });

  it('is not empty, which would make every request read as a direct hit', () => {
    expect(CLOUDFLARE_IPV4_CIDRS.length).toBeGreaterThan(10);
    expect(CLOUDFLARE_IPV6_CIDRS.length).toBeGreaterThan(5);
  });
});
