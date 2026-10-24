/**
 * Client-IP trust boundary - deployment config, audit P1-5 / `docs/32` §4.
 *
 * `src/lib/rate-limit.client-ip.test.ts` covers the resolution logic; this file
 * covers the DEPLOYED values, because on 2026-10-14 the logic was correct and
 * `fly.toml` was not.
 *
 * ⚠️ REWRITTEN 2026-10-24 (`docs/105`). This file used to assert a PAIRING:
 * `xff` with 1 hop, or `cf` with 2. That rule was wrong, and asserting it
 * would have licensed the unsafe cutover it was written to prevent.
 *
 * A hop count describes ONE ingress path. Once the apex is proxied this app has
 * TWO - through Cloudflare (two appended hops) and straight to
 * `lastdonor.fly.dev` or `origin.lastdonor.org` (one) - and both stay reachable
 * for good. Declaring 2 puts the trusted index on a direct caller's own
 * `X-Forwarded-For` prefix; declaring 1 keys every proxied visitor by the
 * Cloudflare datacentre they came through and locks real users out of login.
 *
 * So `cf` no longer reads the hop count at all: it decides per request, from
 * the address the request arrived from (`src/lib/cloudflare-ips.ts`). What this
 * file guards now is that the declared hop count stays correct for the path
 * that always exists - direct to Fly, which appends exactly one hop.
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

  it('declares one of the two sources this deployment supports', () => {
    expect(['xff', 'cf']).toContain(source);
  });

  it('declares the hop count for DIRECT ingress, which is always one', () => {
    /*
      Fly's proxy appends exactly one entry to `X-Forwarded-For`, and a request
      can always reach Fly directly - `lastdonor.fly.dev` is outside the DNS
      zone and `origin.lastdonor.org` is deliberately grey-cloud (docs/104
      §3.3). So one is the right answer whether or not Cloudflare fronts the
      apex, and `cf` mode does not consult this value at all.

      ⛔ Do NOT raise this to 2 "because Cloudflare adds a hop". That is the
      change docs/105 is about: it moves the trusted index onto a value the
      caller supplies on every request that skips the edge.
    */
    expect(hops).toBe('1');
  });

  it('never claims a hop for an edge that can be bypassed', () => {
    // Stated separately so a regression names the reason rather than just
    // failing the assertion above.
    expect(Number(hops)).toBeLessThanOrEqual(1);
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
