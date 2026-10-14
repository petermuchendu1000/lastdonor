/**
 * Client-IP trust boundary — deployment config, audit P1-5 / `docs/32` §4.
 *
 * `CLIENT_IP_SOURCE` and `TRUSTED_PROXY_HOPS` must describe the number of
 * proxies ACTUALLY in front of the app. `src/lib/rate-limit.client-ip.test.ts`
 * covers the resolution logic; this file covers the deployed values, because on
 * 2026-10-14 the logic was correct and `fly.toml` was not: it carried the
 * Cloudflare end-state values (`cf` / `2`) while Fly was serving alone, which
 * makes `cf-connecting-ip` attacker-controlled and pushes the X-Forwarded-For
 * index onto the client-supplied left-most entry.
 *
 * The pairing is what this guards. A half-flip during the Cloudflare cutover —
 * `cf` without `2`, or `2` without `cf` — is the realistic mistake, and either
 * half alone is wrong for both topologies.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

const flyToml = readFileSync(join(process.cwd(), 'fly.toml'), 'utf8');

/** Read a bare `KEY = "value"` out of fly.toml, ignoring commented lines. */
function flyEnv(key: string): string | undefined {
  for (const line of flyToml.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    const m = trimmed.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"$`));
    if (m) return m[1];
  }
  return undefined;
}

describe('P1-5: fly.toml declares a coherent client-IP trust boundary', () => {
  const source = flyEnv('CLIENT_IP_SOURCE');
  const hops = flyEnv('TRUSTED_PROXY_HOPS');

  it('sets both values, or the defaults silently apply', () => {
    // Leaving these to the code defaults (`xff` / 1) would happen to be right
    // for Fly-alone, but it would be right by accident and would stay wrong
    // through the Cloudflare cutover. Declare the boundary explicitly.
    expect(source).toBeDefined();
    expect(hops).toBeDefined();
  });

  it('pairs the source with the matching hop count', () => {
    // The only two coherent configurations for this architecture.
    const COHERENT: Record<string, string> = {
      xff: '1', // Fly alone: Fly's proxy appends exactly one hop.
      cf: '2',  // Cloudflare -> Fly: both append.
    };
    expect(Object.keys(COHERENT)).toContain(source);
    expect(hops).toBe(COHERENT[source as string]);
  });

  it('does not trust cf-connecting-ip without the Cloudflare hop count', () => {
    // The specific 2026-10-14 defect, stated as its own assertion so a
    // regression names the reason rather than just failing the pairing test:
    // `cf` tells rate-limit.ts to treat a client-settable header as
    // authoritative unless something upstream overwrites it.
    if (source === 'cf') {
      expect(hops).toBe('2');
    }
  });

  it('keeps these as [env] config, never as a Fly secret', () => {
    // Documented in docs/32 §4 "One source of truth". A secret-store copy
    // overrides nothing visibly and gave one security control two
    // contradictory values. This asserts the repo side of that: the keys are
    // present as plain `[env]` entries, which is the reviewable location.
    expect(flyToml).toMatch(/^\s*CLIENT_IP_SOURCE\s*=\s*"/m);
    expect(flyToml).toMatch(/^\s*TRUSTED_PROXY_HOPS\s*=\s*"/m);
  });
});
