/**
 * No M-Pesa path may inherit the `donations` bucket, on either rail.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * All six M-Pesa paths sit under `/api/v1/donations/`, and BOTH lookups —
 * `getLimiterTier` for the distributed limiter and `ROUTE_LIMITS` for the
 * in-memory fallback — match by prefix in order, so a narrower entry has to
 * come FIRST in each. `docs/85` established that rule for the `sms` tier and
 * pinned it by test. **The M-Pesa tiers had the identical hazard and nothing
 * pinned it at all**, and it bit: `docs/182` §7.1 found the Palpluss callback
 * shipped with no entry anywhere, so it fell through to `donations` at
 * 10/60 s keyed by IP — and every Palpluss callback arrives from Palpluss, so
 * that is ten settlements a minute across the whole platform before the
 * provider's retries start being 429'd.
 *
 * `docs/182` §7.2 then found the fallback table listed none of them against a
 * 100/60 s catch-all, so the tight 5/60 s initiate bucket was twenty times
 * LOOSER whenever Upstash was unreachable — which production has reported.
 *
 * Both of those are exactly the mistakes a test like this makes impossible to
 * ship twice.
 *
 * ⛔ The path list is DISCOVERED from the route tree, not retyped. A rule that
 * named today's six would go green against a seventh — which is how the
 * Palpluss callback got here in the first place (`docs/116` §4, `docs/134`,
 * `docs/182` §8: a rule that names its own inputs only guards them).
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextRequest } from 'next/server';
import {
  checkRateLimitAsync,
  getLimiterTier,
  PALPLUSS_CALLBACK_LIMIT,
  PALPLUSS_INITIATE_LIMIT,
  PALPLUSS_STATUS_LIMIT,
  PAYHERO_CALLBACK_LIMIT,
  PAYHERO_INITIATE_LIMIT,
  PAYHERO_STATUS_LIMIT,
} from '@/lib/rate-limit';

/** The bucket every one of these would fall into if the ordering were wrong. */
const DONATIONS_TIER_LIMIT = 10;
/** And the one the in-memory fallback gives anything it does not list. */
const FALLBACK_CATCH_ALL = 100;

const DONATIONS_DIR = resolve(__dirname, '../app/api/v1/donations');

/**
 * Every route under a rail directory, read off disk.
 *
 * A "rail" is a directory holding a `callback/route.ts`, which is what makes
 * it a gateway integration rather than a plain donations endpoint. That is
 * derived rather than listed, so a third rail is covered the day it lands.
 */
function mpesaPaths(): string[] {
  const entries = readdirSync(DONATIONS_DIR, { recursive: true, encoding: 'utf8' }).filter((p) =>
    p.endsWith('route.ts'),
  );
  const rails = new Set(
    entries
      .filter((p) => /(^|[\\/])callback[\\/]route\.ts$/.test(p))
      .map((p) => p.split(/[\\/]/)[0]),
  );
  return entries
    .filter((p) => rails.has(p.split(/[\\/]/)[0]))
    .map((p) => `/api/v1/donations/${p.replace(/[\\/]route\.ts$/, '')}`)
    .sort();
}

/** The declared ceiling for each path, so the fallback can be checked too. */
const EXPECTED: Record<string, { tier: string; max: number }> = {
  '/api/v1/donations/payhero/initiate': {
    tier: 'payhero_initiate',
    max: PAYHERO_INITIATE_LIMIT.maxRequests,
  },
  '/api/v1/donations/payhero/status': {
    tier: 'payhero_status',
    max: PAYHERO_STATUS_LIMIT.maxRequests,
  },
  '/api/v1/donations/payhero/callback': {
    tier: 'payhero_callback',
    max: PAYHERO_CALLBACK_LIMIT.maxRequests,
  },
  '/api/v1/donations/palpluss/initiate': {
    tier: 'palpluss_initiate',
    max: PALPLUSS_INITIATE_LIMIT.maxRequests,
  },
  '/api/v1/donations/palpluss/status': {
    tier: 'palpluss_status',
    max: PALPLUSS_STATUS_LIMIT.maxRequests,
  },
  '/api/v1/donations/palpluss/callback': {
    tier: 'palpluss_callback',
    max: PALPLUSS_CALLBACK_LIMIT.maxRequests,
  },
};

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

const PATHS = mpesaPaths();

describe('every M-Pesa path has a tier of its own', () => {
  it('finds the rails at all, and both of them', () => {
    /*
      ⛔ ANTI-VACUITY. If discovery broke, every rule below would iterate an
      empty list and pass while protecting nothing.
    */
    expect(PATHS.length, 'no M-Pesa routes discovered').toBeGreaterThanOrEqual(6);
    expect(PATHS.some((p) => p.includes('/payhero/'))).toBe(true);
    expect(PATHS.some((p) => p.includes('/palpluss/'))).toBe(true);
  });

  it('⛔ every discovered path is declared here', () => {
    /*
      A seventh path — a refund endpoint, a second status shape, a third rail —
      fails this until somebody decides what its bucket is. That decision is
      the thing `docs/182` §7.1 found nobody had made.
    */
    const undeclared = PATHS.filter((p) => !(p in EXPECTED));
    expect(
      undeclared,
      'these M-Pesa paths have no declared rate-limit tier, so they inherit the ' +
        `donations bucket (${DONATIONS_TIER_LIMIT}/60s, keyed by IP). docs/182 §7.1.`,
    ).toEqual([]);
  });

  it.each(PATHS)('%s is not in the donations tier', (path) => {
    const tier = getLimiterTier(path, 'POST');
    expect(tier).toBe(EXPECTED[path].tier);
    expect(tier).not.toBe('donations');
  });

  it('CONTROL: a sibling donations route still IS in the donations tier', () => {
    /*
      ⛔ Without this the rules above are satisfied by a change that gives
      every donations path its own tier, or by one that renames the tier
      nothing should fall into.
    */
    expect(getLimiterTier('/api/v1/donations/create-checkout', 'POST')).toBe('donations');
    expect(getLimiterTier('/api/v1/donations/confirm', 'POST')).toBe('donations');
  });

  it('the two prompt-raising paths are the tightest, and the two polls the loosest', () => {
    /*
      Not a style preference. `initiate` makes a body-supplied number ring, so
      it is deliberately tighter than the bucket it would inherit; `status` is
      polled tens of times by ONE honest donor over a three-minute prompt, so
      it is deliberately looser (`docs/159`).
    */
    for (const p of PATHS.filter((p) => p.endsWith('/initiate'))) {
      expect(EXPECTED[p].max).toBeLessThan(DONATIONS_TIER_LIMIT);
    }
    for (const p of PATHS.filter((p) => p.endsWith('/status'))) {
      expect(EXPECTED[p].max).toBeGreaterThan(DONATIONS_TIER_LIMIT);
    }
  });
});

/*
  The in-memory path is what actually runs when Upstash is not configured,
  which is every test run and — per `docs/182` §7.2 — production whenever it
  reports `redis: error`. An entry missing there is invisible from
  `getLimiterTier`, and its catch-all is LOOSER than the tight buckets, so the
  failure direction is silent.
*/
describe('the in-memory fallback uses the same ceilings', () => {
  it.each(PATHS.filter((p) => EXPECTED[p].max < FALLBACK_CATCH_ALL))(
    '%s is bounded by its own TIGHTER ceiling, not the catch-all',
    async (path) => {
      const { max } = EXPECTED[path];
      const ip = `198.51.100.${(PATHS.indexOf(path) % 200) + 10}`;
      for (let i = 0; i < max; i += 1) {
        expect(
          await checkRateLimitAsync(request(path, ip)),
          `request ${i + 1} to ${path} should be allowed`,
        ).toBeNull();
      }
      const blocked = await checkRateLimitAsync(request(path, ip));
      expect(blocked?.status, `${path} should be 429 after ${max}`).toBe(429);
    },
  );

  /*
    ⛔ AND THE OTHER DIRECTION, which the first version of this file could not
    see. A path whose declared ceiling is ABOVE the catch-all (both status
    polls, at 120 against 100) reads as *tighter* when its fallback entry is
    missing — so exhausting the declared ceiling proves nothing, and an
    injection that deleted the entry passed. The discriminator is a request
    PAST the catch-all: it can only be allowed if the route's own entry
    matched.
  */
  it.each(PATHS.filter((p) => EXPECTED[p].max > FALLBACK_CATCH_ALL))(
    '%s is allowed past the catch-all, so its own LOOSER entry is matching',
    async (path) => {
      const ip = `198.51.100.${(PATHS.indexOf(path) % 200) + 120}`;
      for (let i = 0; i < FALLBACK_CATCH_ALL; i += 1) {
        await checkRateLimitAsync(request(path, ip, 'GET'));
      }
      expect(
        await checkRateLimitAsync(request(path, ip, 'GET')),
        `${path} was 429'd at the ${FALLBACK_CATCH_ALL} catch-all, so its own ` +
          `${EXPECTED[path].max} entry is missing from ROUTE_LIMITS. docs/182 §7.2.`,
      ).toBeNull();
    },
  );

  it('CONTROL: both directions are actually exercised', () => {
    /*
      ⛔ Each rule above iterates a filtered list, so if every M-Pesa bucket
      drifted to one side of the catch-all one of them would pass over an
      empty set and protect nothing.
    */
    expect(
      PATHS.filter((p) => EXPECTED[p].max < FALLBACK_CATCH_ALL).length,
      'no M-Pesa path is tighter than the fallback catch-all',
    ).toBeGreaterThan(0);
    expect(
      PATHS.filter((p) => EXPECTED[p].max > FALLBACK_CATCH_ALL).length,
      'no M-Pesa path is looser than the fallback catch-all',
    ).toBeGreaterThan(0);
  });
});
