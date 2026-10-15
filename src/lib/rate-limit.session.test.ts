/**
 * docs/44 - `GET /api/auth/session` must not be limited at the sign-in
 * threshold.
 *
 * The production defect: `getLimiterTier` matched the `/api/auth` prefix, so
 * the session read shared the `auth` tier (10 requests / 60 s / IP) with
 * password sign-in. Five page views exhausted it, the limiter answered 429,
 * `fetchData` in next-auth turned that into `null`, and the header rendered
 * "Sign in" to a user holding a valid cookie.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import {
  checkRateLimitAsync,
  getLimiterTier,
  isSessionReadRequest,
  SESSION_READ_LIMIT,
  SESSION_READ_PATH,
} from '@/lib/rate-limit';

/** The bucket the session read used to share. See `initDistributedLimiters`. */
const OLD_AUTH_TIER_LIMIT = 10;

function request(pathname: string, ip: string, method = 'GET'): NextRequest {
  return {
    nextUrl: { pathname } as NextRequest['nextUrl'],
    method,
    headers: new Headers({ 'x-forwarded-for': ip }),
  } as unknown as NextRequest;
}

const ENV_KEYS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;
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

describe('session read tier', () => {
  it('is its own tier, not the sign-in tier', () => {
    expect(getLimiterTier(SESSION_READ_PATH, 'GET')).toBe('session');
    expect(getLimiterTier(SESSION_READ_PATH, 'GET')).not.toBe('auth');
    expect(getLimiterTier(SESSION_READ_PATH, 'HEAD')).toBe('session');
  });

  it('leaves every other /api/auth path in the sign-in tier', () => {
    expect(getLimiterTier('/api/auth/callback/credentials', 'POST')).toBe('auth');
    expect(getLimiterTier('/api/auth/csrf', 'GET')).toBe('auth');
    expect(getLimiterTier('/api/auth/signout', 'POST')).toBe('auth');
    expect(getLimiterTier('/api/v1/auth/forgot-password', 'POST')).toBe('auth');
  });

  it('does not widen the write side: POST /api/auth/session stays in the sign-in tier', () => {
    // POST is next-auth's `update()`, which re-mints the token.
    expect(isSessionReadRequest(SESSION_READ_PATH, 'POST')).toBe(false);
    expect(getLimiterTier(SESSION_READ_PATH, 'POST')).toBe('auth');
  });

  it('matches the session path exactly, not as a prefix', () => {
    expect(isSessionReadRequest('/api/auth/session', 'GET')).toBe(true);
    expect(isSessionReadRequest('/api/auth/session/anything', 'GET')).toBe(false);
    expect(isSessionReadRequest('/api/auth/sessionx', 'GET')).toBe(false);
    expect(getLimiterTier('/api/auth/session/anything', 'GET')).toBe('auth');
  });

  it('leaves money and mail limits untouched', () => {
    expect(getLimiterTier('/api/v1/donations/create-checkout', 'POST')).toBe('donations');
    expect(getLimiterTier('/api/v1/newsletter/subscribe', 'POST')).toBe('newsletter');
  });
});

describe('session read is not limited at the old threshold', () => {
  it('serves far more session reads than the sign-in tier allowed', async () => {
    const ip = '203.0.113.41';
    // Comfortably past the old 10/60s bucket: the reproduction logged out on
    // the 5th page view, which was the 11th session read.
    for (let i = 0; i < OLD_AUTH_TIER_LIMIT * 4; i += 1) {
      const response = await checkRateLimitAsync(request(SESSION_READ_PATH, ip));
      expect(response, `request ${i + 1} was rate limited`).toBeNull();
    }
  });

  it('still has a ceiling, so a stale cookie cannot be replayed without bound', async () => {
    const ip = '203.0.113.42';
    for (let i = 0; i < SESSION_READ_LIMIT.maxRequests; i += 1) {
      expect(await checkRateLimitAsync(request(SESSION_READ_PATH, ip))).toBeNull();
    }
    const overflow = await checkRateLimitAsync(request(SESSION_READ_PATH, ip));
    expect(overflow?.status).toBe(429);
  });

  it('control: a sign-in path is still limited at 10 per window', async () => {
    const ip = '203.0.113.43';
    for (let i = 0; i < OLD_AUTH_TIER_LIMIT; i += 1) {
      expect(
        await checkRateLimitAsync(request('/api/v1/auth/forgot-password', ip, 'POST')),
      ).toBeNull();
    }
    const overflow = await checkRateLimitAsync(
      request('/api/v1/auth/forgot-password', ip, 'POST'),
    );
    expect(overflow?.status).toBe(429);
  });
});
