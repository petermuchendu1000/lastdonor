/**
 * `/_next/image` remote-host allowlist — audit P1-14.
 *
 * `next.config.ts` set `remotePatterns: [{ protocol: "https", hostname: "**" }]`,
 * and `src/middleware.ts` matches neither `/_next/image` nor anything else
 * outside `/api` and the protected page trees. The optimiser was therefore an
 * unauthenticated, unrate-limited server-side fetcher that any anonymous caller
 * could aim at any HTTPS host.
 *
 * These tests assert against the REAL exported Next config, not a copy of the
 * list, so they cannot drift from what ships.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';

interface RemotePattern {
  protocol?: string;
  hostname: string;
  pathname?: string;
  port?: string;
}

let patterns: RemotePattern[];

beforeAll(async () => {
  const mod = await import('../../next.config');
  const cfg = mod.default as { images?: { remotePatterns?: RemotePattern[] } };
  patterns = cfg.images?.remotePatterns ?? [];
});

/**
 * Next.js `remotePatterns.hostname` glob semantics: `*` matches exactly one
 * subdomain label, `**` matches one or more. Neither matches the apex on its
 * own, which is why the config lists both `domain` and `**.domain`.
 */
function hostMatchesPattern(pattern: string, host: string): boolean {
  if (pattern === host) return true;
  if (pattern === '*' || pattern === '**') return true; // match-anything
  if (pattern.startsWith('**.')) {
    const suffix = pattern.slice(2); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    if (!host.endsWith(suffix)) return false;
    const label = host.slice(0, host.length - suffix.length);
    return label.length > 0 && !label.includes('.');
  }
  return false;
}

function isOptimisable(host: string): boolean {
  return patterns.some((p) => hostMatchesPattern(p.hostname, host));
}

describe('P1-14: the image optimiser is not a general-purpose fetcher', () => {
  it('declares remote patterns at all', () => {
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("stays within Next.js's 50-entry cap on images.remotePatterns", () => {
    // next/dist/server/config-schema.js:559 — `.max(50)`. Exceeding it makes
    // `next lint` and `next build` reject the config, so this is a build gate
    // and also the reason the news domain list cannot be exhaustive.
    expect(patterns.length).toBeLessThanOrEqual(50);
  });

  it('contains no match-anything hostname', () => {
    const wildcards = patterns.filter(
      (p) => p.hostname === '**' || p.hostname === '*' || p.hostname.trim() === '',
    );
    expect(
      wildcards,
      'A "**" hostname makes /_next/image fetch any host on the internet',
    ).toEqual([]);
  });

  it('every hostname pattern names a registrable domain', () => {
    for (const p of patterns) {
      const bare = p.hostname.replace(/^\*{1,2}\./, '');
      expect(bare, `pattern "${p.hostname}" has no domain part`).toContain('.');
      expect(bare).not.toMatch(/\*/);
      // A leading wildcard is the only position Next.js supports.
      expect(p.hostname).toMatch(/^(?:\*{1,2}\.)?[a-z0-9.-]+$/);
    }
  });

  it('only permits https', () => {
    for (const p of patterns) {
      expect(p.protocol, `pattern "${p.hostname}" must pin protocol`).toBe('https');
    }
  });
});

describe('P1-14: hosts an attacker controls are not optimisable', () => {
  const MUST_NOT_MATCH = [
    // The SSRF targets.
    '169.254.169.254',
    'metadata.google.internal',
    '127.0.0.1',
    'localhost',
    '10.0.0.1',
    // Arbitrary internet hosts — the whole point of removing "**".
    'evil.example.com',
    'attacker-controlled.xyz',
    // Multi-tenant CDN namespaces: allowing these would restore the open
    // fetcher under a longer name, because anyone can obtain a subdomain.
    'd111111abcdef8.cloudfront.net',
    'cloudfront.net',
    'my-bucket.s3.amazonaws.com',
    's3.amazonaws.com',
    'i0.wp.com',
    'anything.akamaized.net',
    'evil.pages.dev',
    'evil.vercel.app',
    'evil.blob.core.windows.net',
    'evil.storage.googleapis.com',
    'evil.r2.dev',
    'evil.ngrok.io',
    // Lookalikes of allowed domains must not match by suffix accident.
    'notbbci.co.uk',
    'npr.org.evil.com',
    'theguardian.com.evil.net',
  ];

  for (const host of MUST_NOT_MATCH) {
    it(`refuses ${host}`, () => {
      expect(isOptimisable(host)).toBe(false);
    });
  }

  it('still permits the single pinned DVIDS CloudFront distribution', () => {
    expect(isOptimisable('d1ds6k2agfrpnf.cloudfront.net')).toBe(true);
  });
});

describe('P1-14: the hosts the product actually serves still work', () => {
  const MUST_MATCH = [
    // First party.
    'ntnrcedafgmeyajmzvga.supabase.co',
    // Stock photo fallbacks — resolver tiers 3 and 4.
    'images.unsplash.com',
    'images.pexels.com',
    'cdn.pixabay.com',
    // Publisher image CDNs for feeds in src/lib/news/rss-parser.ts.
    'ichef.bbci.co.uk',
    'i.guim.co.uk',
    'static01.nyt.com',
    'media.npr.org',
    'www.twincities.com',
    'd1ds6k2agfrpnf.cloudfront.net',
    'www.dvidshub.net',
    'dims.apnews.com',
    'www.reuters.com',
    'www.gannett-cdn.com',
    'a.b.c.militarytimes.com', // nested subdomain depth, `**.` must span it
  ];

  for (const host of MUST_MATCH) {
    it(`permits ${host}`, () => {
      expect(isOptimisable(host)).toBe(true);
    });
  }

  it('spends at most one pattern slot per news domain', () => {
    // The 50-entry cap is the scarce resource. Listing both the apex and the
    // `**.` form would halve the number of publishers that fit, and publishers
    // serve images from subdomains (`www.`, `i.`, `media.`, `static01.`).
    const wildcardDomains = patterns
      .filter((p) => p.hostname.startsWith('**.'))
      .map((p) => p.hostname.slice(3));
    expect(new Set(wildcardDomains).size).toBe(wildcardDomains.length);
    for (const domain of wildcardDomains) {
      expect(patterns.filter((p) => p.hostname === domain)).toEqual([]);
    }
  });

  it('keeps the supabase pattern scoped to the public object path', () => {
    const supabase = patterns.find((p) =>
      p.hostname === 'ntnrcedafgmeyajmzvga.supabase.co',
    );
    expect(supabase?.pathname).toBe('/storage/v1/object/public/**');
  });
});
