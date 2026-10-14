/**
 * Audit P1-5 — the client IP used for rate limiting must not be forgeable.
 *
 * `docs/31` item 2.6: "a forged `X-Forwarded-For` does not reset the limit."
 *
 * The behavioural test below (`rotating a forged left-most ...`) is the one
 * that matters: it drives `checkRateLimitAsync` through more requests than the
 * limit allows while rotating the attacker-controlled part of
 * `X-Forwarded-For`. Against the pre-fix implementation (which keyed on
 * `x-forwarded-for.split(',')[0]`) every request lands in a fresh bucket and
 * no 429 is ever produced.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { getClientIp, checkRateLimitAsync, UNKNOWN_CLIENT_IP } from '@/lib/rate-limit';

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

/** Minimal stand-in: `checkRateLimitAsync` reads only `nextUrl` and `headers`. */
function request(pathname: string, headerInit: Record<string, string>): NextRequest {
  return {
    nextUrl: { pathname } as NextRequest['nextUrl'],
    headers: headers(headerInit),
  } as unknown as NextRequest;
}

const ENV_KEYS = ['CLIENT_IP_SOURCE', 'TRUSTED_PROXY_HOPS', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('getClientIp — X-Forwarded-For (default: right-most trusted hop)', () => {
  it('ignores the client-supplied left-most entry', () => {
    // The attacker sends `X-Forwarded-For: 1.2.3.4`; our proxy appends the
    // address it actually saw. Only the appended entry is evidence.
    expect(getClientIp(headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }))).toBe('198.51.100.9');
  });

  it('ignores an arbitrarily long forged prefix', () => {
    const forged = Array.from({ length: 20 }, (_, i) => `10.0.0.${i + 1}`).join(', ');
    expect(getClientIp(headers({ 'x-forwarded-for': `${forged}, 203.0.113.5` }))).toBe('203.0.113.5');
  });

  it('uses the only entry when the client forged nothing', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '203.0.113.5' }))).toBe('203.0.113.5');
  });

  it('honours TRUSTED_PROXY_HOPS for the Cloudflare -> Fly topology', () => {
    // Cloudflare appends the real client, Fly appends the Cloudflare edge.
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(
      getClientIp(headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.5, 172.16.0.1' })),
    ).toBe('203.0.113.5');
  });

  it('falls back to the default hop count on a nonsense TRUSTED_PROXY_HOPS', () => {
    process.env.TRUSTED_PROXY_HOPS = 'all-of-them';
    expect(getClientIp(headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }))).toBe('198.51.100.9');
  });

  it('clamps rather than wrapping when there are fewer entries than hops', () => {
    process.env.TRUSTED_PROXY_HOPS = '4';
    expect(getClientIp(headers({ 'x-forwarded-for': '198.51.100.9' }))).toBe('198.51.100.9');
  });
});

describe('getClientIp — trusted edge header', () => {
  it('does NOT trust CF-Connecting-IP unless the deployment declares it', () => {
    // Off Cloudflare this header is attacker-controlled, so auto-trusting it
    // would reintroduce exactly the bug being fixed.
    expect(
      getClientIp(headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9, 198.51.100.9' })),
    ).toBe('198.51.100.9');
  });

  it('prefers CF-Connecting-IP when CLIENT_IP_SOURCE=cf', () => {
    process.env.CLIENT_IP_SOURCE = 'cf';
    expect(
      getClientIp(headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 172.16.0.1' })),
    ).toBe('203.0.113.7');
  });

  it('falls back to the right-most hop (never the left-most) when the edge header is absent', () => {
    process.env.CLIENT_IP_SOURCE = 'cf';
    expect(getClientIp(headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9' }))).toBe('198.51.100.9');
  });

  it('supports an explicitly named header for other edges', () => {
    process.env.CLIENT_IP_SOURCE = 'header:fly-client-ip';
    expect(
      getClientIp(headers({ 'fly-client-ip': '203.0.113.8', 'x-forwarded-for': '1.2.3.4' })),
    ).toBe('203.0.113.8');
  });
});

describe('getClientIp — normalisation and rejection', () => {
  it('strips an IPv4 port', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '198.51.100.9:54321' }))).toBe('198.51.100.9');
  });

  it('unwraps a bracketed IPv6 address', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe('2001:db8::1');
  });

  it('rejects values that are not IP addresses', () => {
    // Otherwise a client can mint unlimited distinct rate-limit keys.
    expect(getClientIp(headers({ 'x-forwarded-for': 'not-an-ip' }))).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(headers({ 'x-forwarded-for': `${'a'.repeat(400)}` }))).toBe(UNKNOWN_CLIENT_IP);
    expect(getClientIp(headers({ 'x-forwarded-for': '999.1.1.1' }))).toBe(UNKNOWN_CLIENT_IP);
  });

  it('falls back to x-real-ip, then to a single shared bucket', () => {
    expect(getClientIp(headers({ 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9');
    expect(getClientIp(headers({}))).toBe(UNKNOWN_CLIENT_IP);
  });
});

describe('checkRateLimitAsync — forged X-Forwarded-For cannot reset the limit', () => {
  it('rotating a forged left-most entry does not grant extra requests', async () => {
    // /api/v1/newsletter -> 5 requests / 60s in the in-memory fallback config.
    // Upstash env vars are unset, so the in-memory backstop is what runs
    // (its continued operation during an Upstash outage is a hard requirement).
    const path = '/api/v1/newsletter/p15-forged';
    const responses = [];

    for (let i = 0; i < 8; i++) {
      responses.push(
        await checkRateLimitAsync(
          request(path, { 'x-forwarded-for': `10.9.9.${i}, 203.0.113.44` }),
        ),
      );
    }

    const blocked = responses.filter((r) => r !== null);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]!.status).toBe(429);
  });

  it('a different real client is still bucketed separately', async () => {
    const path = '/api/v1/newsletter/p15-separate';

    for (let i = 0; i < 8; i++) {
      await checkRateLimitAsync(request(path, { 'x-forwarded-for': `10.9.9.${i}, 203.0.113.55` }));
    }

    // Victim-neighbour check: exhausting one client must not block another.
    const other = await checkRateLimitAsync(
      request(path, { 'x-forwarded-for': '10.9.9.1, 203.0.113.56' }),
    );
    expect(other).toBeNull();
  });

  it('a forged CF-Connecting-IP cannot reset the limit when CLIENT_IP_SOURCE is unset', async () => {
    const path = '/api/v1/newsletter/p15-cf';
    const responses = [];

    for (let i = 0; i < 8; i++) {
      responses.push(
        await checkRateLimitAsync(
          request(path, { 'cf-connecting-ip': `10.8.8.${i}`, 'x-forwarded-for': '203.0.113.66' }),
        ),
      );
    }

    expect(responses.filter((r) => r !== null).length).toBeGreaterThan(0);
  });
});
