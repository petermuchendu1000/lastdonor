/**
 * The collaborator-invite tier, pinned in BOTH lookups.
 *
 * Inviting somebody to help run a campaign sends an email from
 * `lastdonor.org`. Without its own tier the route sits in the generic
 * `default` bucket (60/60 s), which lets one signed-in account mail sixty
 * addresses a minute from our domain.
 *
 * ⚠️ There are TWO independent lookups — `getLimiterTier` for the distributed
 * limiter and `ROUTE_LIMITS`/`getConfig` for the in-memory fallback — and
 * both match by prefix, first-wins. `docs/85` records what it costs when one
 * is updated and the other is not: the behaviour is correct wherever Upstash
 * is reachable and wrong wherever it is not, which is silent. So this file
 * exercises the real limiter with Upstash deliberately UNSET, which is the
 * path the other tier's test found broken.
 *
 * The second hazard is the opposite one: a tier so tight that honest use hits
 * it. The SMS tier shipped matching every verb and 429'd a person typing a
 * code we had just texted them. Listing the team and revoking a member cost
 * us nothing, so they must not share the send budget.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  checkRateLimitAsync,
  getLimiterTier,
  isCollaboratorInvite,
  COLLAB_INVITE_LIMIT,
} from '@/lib/rate-limit';

const CAMPAIGN = '11111111-1111-4111-a111-111111111111';
const INVITE_PATH = `/api/v1/user-campaigns/${CAMPAIGN}/collaborators`;
const WITHDRAW_PATH = `/api/v1/user-campaigns/${CAMPAIGN}/withdraw`;

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

describe('the invite is its own tier', () => {
  it('does not fall into the generic default bucket', () => {
    expect(getLimiterTier(INVITE_PATH, 'POST')).toBe('collab');
    expect(getLimiterTier(INVITE_PATH, 'POST')).not.toBe('default');
  });

  it('matches on the path segment, not on the campaign id', () => {
    // The id is in the MIDDLE of the path, which is why this tier needs a
    // predicate rather than a `startsWith` key.
    for (const id of ['abc', CAMPAIGN, '00000000-0000-0000-0000-000000000000']) {
      expect(getLimiterTier(`/api/v1/user-campaigns/${id}/collaborators`, 'POST'))
        .toBe('collab');
    }
  });

  it('tolerates a trailing slash', () => {
    expect(isCollaboratorInvite(`${INVITE_PATH}/`, 'POST')).toBe(true);
  });
});

describe('⛔ it covers the send and nothing else', () => {
  it('leaves listing and revoking alone', () => {
    // The SMS lesson: a tier that catches every verb 429s honest use.
    for (const method of ['GET', 'DELETE', 'PUT', 'PATCH']) {
      expect(getLimiterTier(INVITE_PATH, method), method).not.toBe('collab');
    }
  });

  it('⛔ does NOT capture the withdrawal route', () => {
    /*
      The reason this tier is a predicate and not the prefix
      `/api/v1/user-campaigns`. Catching that prefix would put money routes
      into a five-a-minute email bucket - a denial of service on payouts,
      introduced while adding a feature about invitations.
    */
    expect(isCollaboratorInvite(WITHDRAW_PATH, 'POST')).toBe(false);
    expect(getLimiterTier(WITHDRAW_PATH, 'POST')).not.toBe('collab');
  });

  it('does not capture a path that merely contains the word', () => {
    expect(isCollaboratorInvite('/api/v1/user-campaigns/x/collaborators/y', 'POST'))
      .toBe(false);
    expect(isCollaboratorInvite('/api/v1/collaborators-elsewhere', 'POST')).toBe(false);
  });
});

describe('the in-memory fallback agrees with the distributed tier', () => {
  it('⛔ enforces the invite ceiling with Upstash unset', async () => {
    /*
      THE assertion of this file. The distributed tier and the in-memory
      table are separate code paths, and only this one runs when Upstash is
      unreachable - which is also when an abuser would most like to be
      sending mail.
    */
    const ip = '203.0.113.77';
    for (let i = 0; i < COLLAB_INVITE_LIMIT.maxRequests; i++) {
      expect(
        await checkRateLimitAsync(request(INVITE_PATH, ip)),
        `request ${i + 1} of the allowance was refused`,
      ).toBeNull();
    }
    const blocked = await checkRateLimitAsync(request(INVITE_PATH, ip));
    expect(blocked, 'the request past the ceiling was NOT refused').not.toBeNull();
    expect(blocked!.status).toBe(429);
  });

  it('does not spend the invite budget on listing the team', async () => {
    const ip = '203.0.113.78';
    for (let i = 0; i < COLLAB_INVITE_LIMIT.maxRequests + 3; i++) {
      expect(await checkRateLimitAsync(request(INVITE_PATH, ip, 'GET'))).toBeNull();
    }
    // The send budget is untouched by those.
    expect(await checkRateLimitAsync(request(INVITE_PATH, ip, 'POST'))).toBeNull();
  });

  it('⛔ does not throttle withdrawals at the invite rate', async () => {
    // The companion to the predicate test above, exercised rather than read.
    const ip = '203.0.113.79';
    for (let i = 0; i < COLLAB_INVITE_LIMIT.maxRequests + 3; i++) {
      expect(
        await checkRateLimitAsync(request(WITHDRAW_PATH, ip, 'POST')),
        `withdrawal ${i + 1} was throttled by the invite tier`,
      ).toBeNull();
    }
  });

  it('buckets by IP, so one address cannot spend another’s allowance', async () => {
    const a = '203.0.113.81';
    const b = '203.0.113.82';
    for (let i = 0; i < COLLAB_INVITE_LIMIT.maxRequests; i++) {
      await checkRateLimitAsync(request(INVITE_PATH, a));
    }
    expect(await checkRateLimitAsync(request(INVITE_PATH, a))).not.toBeNull();
    expect(await checkRateLimitAsync(request(INVITE_PATH, b))).toBeNull();
  });
});
