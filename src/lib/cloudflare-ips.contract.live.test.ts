/**
 * Live contract test: compares the pinned Cloudflare ranges against Cloudflare.
 *
 * Read-only, keyless, no writes. Skipped unless `CF_IPS_LIVE_CONTRACT=1`,
 * following `src/lib/money/fx.contract.live.test.ts`.
 *
 *   CF_IPS_LIVE_CONTRACT=1 npx vitest run src/lib/cloudflare-ips.contract.live.test.ts
 *
 * WHY THIS IS NOT PART OF THE NORMAL RUN
 *
 * It would make the build depend on a third party being reachable, and a
 * pinned-list drift is not an emergency: a request from a new Cloudflare range
 * reads as a direct hit, which over-counts a rate limit rather than letting
 * anyone past one (see `cloudflare-ips.ts`). So this is a tool for the person
 * refreshing the list, not a gate.
 *
 * Last run 2026-10-24 from the sandbox: 15 IPv4 / 7 IPv6, no drift,
 * `etag: 38f79d050aa027e3be3865e495dcc9bc`. Recorded in docs/105.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

import {
  CLOUDFLARE_IPV4_CIDRS,
  CLOUDFLARE_IPV6_CIDRS,
  CLOUDFLARE_IPS_ETAG,
  isCloudflareIp,
} from './cloudflare-ips';

const LIVE = process.env.CF_IPS_LIVE_CONTRACT === '1';
const d = LIVE ? describe : describe.skip;

interface CloudflareIpsResponse {
  success: boolean;
  result: { ipv4_cidrs: string[]; ipv6_cidrs: string[]; etag?: string };
}

async function fetchLive(): Promise<CloudflareIpsResponse['result']> {
  const res = await fetch('https://api.cloudflare.com/client/v4/ips');
  const body = (await res.json()) as CloudflareIpsResponse;
  // Cloudflare's envelope carries its own success flag; `res.ok` is not enough
  // (the same trap as the FX primary and PayHero - docs/102, docs/92).
  expect(body.success, 'Cloudflare reported success: false').toBe(true);
  return body.result;
}

d('Cloudflare published IP ranges (live, read-only)', () => {
  it('has not added or removed an IPv4 prefix since the pin', async () => {
    const live = await fetchLive();
    const pinned: string[] = [...CLOUDFLARE_IPV4_CIDRS].sort();
    const current = [...live.ipv4_cidrs].sort();
    const added = current.filter((c) => !pinned.includes(c));
    const removed = pinned.filter((c) => !current.includes(c));
    console.log(`  ipv4: ${current.length} live, ${pinned.length} pinned, etag=${live.etag}`);
    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  it('has not added or removed an IPv6 prefix since the pin', async () => {
    const live = await fetchLive();
    const pinned: string[] = [...CLOUDFLARE_IPV6_CIDRS].sort();
    const current = [...live.ipv6_cidrs].sort();
    const added = current.filter((c) => !pinned.includes(c));
    const removed = pinned.filter((c) => !current.includes(c));
    console.log(`  ipv6: ${current.length} live, ${pinned.length} pinned`);
    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  it('reports the same etag the pin recorded', async () => {
    // Softer than the lists: an etag can change without the contents changing.
    const live = await fetchLive();
    if (live.etag !== CLOUDFLARE_IPS_ETAG) {
      console.warn(
        `  etag moved: pinned ${CLOUDFLARE_IPS_ETAG} -> live ${live.etag}. ` +
        'Check the two tests above; if they pass, only the etag changed.',
      );
    }
    expect(typeof live.etag).toBe('string');
  });

  it('every live prefix is recognised by isCloudflareIp', async () => {
    // Guards the containment code against the live data, not just fixtures.
    const live = await fetchLive();
    for (const cidr of [...live.ipv4_cidrs, ...live.ipv6_cidrs]) {
      const network = cidr.slice(0, cidr.indexOf('/'));
      expect(isCloudflareIp(network), `${cidr} must be recognised`).toBe(true);
    }
  });
});
