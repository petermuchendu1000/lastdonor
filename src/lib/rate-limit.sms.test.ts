/**
 * `/api/v1/users/phone` must not inherit the `/api/v1/users` bucket.
 *
 * It sits under that prefix and every accepted request bills us for a
 * message delivered to somebody's handset, so 30/60 s is the wrong
 * ceiling. Both the distributed tier lookup and the in-memory fallback
 * match by prefix in order, so the narrower entry has to come FIRST in
 * each — this pins both, because getting it right in one and wrong in the
 * other is silent. See `docs/85`.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { checkRateLimitAsync, getLimiterTier, SMS_LIMIT, SMS_PATH_PREFIX } from '@/lib/rate-limit';

/** The bucket the SMS path would fall into if the ordering were wrong. */
const USERS_TIER_LIMIT = 30;

function request(pathname: string, ip: string, method = 'POST'): NextRequest {
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

describe('the SMS tier', () => {
  it('is its own tier, not the general users tier', () => {
    expect(getLimiterTier(SMS_PATH_PREFIX, 'POST')).toBe('sms');
    expect(getLimiterTier(SMS_PATH_PREFIX, 'POST')).not.toBe('users');
  });

  it('covers every verb on the path, including the read', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH']) {
      expect(getLimiterTier(SMS_PATH_PREFIX, method)).toBe('sms');
    }
  });

  it('leaves the rest of /api/v1/users alone', () => {
    expect(getLimiterTier('/api/v1/users/settings', 'PUT')).toBe('users');
    expect(getLimiterTier('/api/v1/users/me', 'GET')).toBe('users');
    expect(getLimiterTier('/api/v1/users/avatar', 'POST')).toBe('users');
  });

  it('is tighter than the bucket it would otherwise have had', () => {
    expect(SMS_LIMIT.maxRequests).toBeLessThan(USERS_TIER_LIMIT);
  });
});

/*
  The in-memory path is the one that actually runs when Upstash is not
  configured, which is every test run and any deploy missing the Redis
  credentials. An ordering mistake there is invisible from getLimiterTier.
*/
describe('the in-memory fallback uses the same ceiling', () => {
  it('429s after SMS_LIMIT requests, not after 30', async () => {
    const ip = '203.0.113.77';
    for (let i = 0; i < SMS_LIMIT.maxRequests; i++) {
      const allowed = await checkRateLimitAsync(request(SMS_PATH_PREFIX, ip));
      expect(allowed, `request ${i + 1} should be allowed`).toBeNull();
    }
    const blocked = await checkRateLimitAsync(request(SMS_PATH_PREFIX, ip));
    expect(blocked?.status).toBe(429);
  });

  it('does not tighten a sibling users route to the SMS ceiling', async () => {
    const ip = '203.0.113.78';
    for (let i = 0; i < SMS_LIMIT.maxRequests + 1; i++) {
      await checkRateLimitAsync(request('/api/v1/users/settings', ip, 'PUT'));
    }
    // Still inside the 30/60 s users bucket.
    expect(await checkRateLimitAsync(request('/api/v1/users/settings', ip, 'PUT'))).toBeNull();
  });
});
