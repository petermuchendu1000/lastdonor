import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbExecute = vi.fn();
const balanceRetrieve = vi.fn();
const pingRedis = vi.fn();

vi.mock('@/db', () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }));
vi.mock('@/lib/stripe', () => ({
  stripe: { balance: { retrieve: () => balanceRetrieve() } },
}));
vi.mock('@/lib/locks', () => ({ pingRedis: () => pingRedis() }));

const { GET } = await import('./route');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dbExecute.mockReset().mockResolvedValue(undefined);
  balanceRetrieve.mockReset().mockResolvedValue({});
  pingRedis.mockReset().mockResolvedValue({ configured: true, ok: true });
});

describe('GET /api/v1/health (deep readiness, NOT the Fly probe)', () => {
  it('checks Redis alongside the database and Stripe', async () => {
    const body = await (await GET()).json();

    // Redis was previously never checked at all, while being load-bearing for
    // distributed rate limiting and (as of P1-11) cron overlap locks.
    expect(Object.keys(body.checks).sort()).toEqual(['database', 'redis', 'stripe']);
    expect(pingRedis).toHaveBeenCalledTimes(1);
  });

  it('is healthy and 200 when all three dependencies answer', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('healthy');
    expect(body.checks.redis.status).toBe('ok');
    expect(typeof body.checks.redis.latencyMs).toBe('number');
  });

  it('degrades to 503 when only Redis is unreachable', async () => {
    pingRedis.mockResolvedValue({ configured: true, ok: false, error: 'ETIMEDOUT' });

    const response = await GET();
    // A Redis outage must be visible here - this is the endpoint a human or an
    // uptime monitor reads. It is only safe because nothing restarts on it.
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.redis.status).toBe('error');
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.stripe.status).toBe('ok');
  });

  it('distinguishes an unconfigured Redis from an unreachable one', async () => {
    pingRedis.mockResolvedValue({ configured: false, ok: false, error: 'not configured' });
    const body = await (await GET()).json();
    // A deploy mistake and an Upstash incident need different responses.
    expect(body.checks.redis.error).toMatch(/not configured/i);

    pingRedis.mockResolvedValue({ configured: true, ok: false, error: 'ETIMEDOUT' });
    const body2 = await (await GET()).json();
    expect(body2.checks.redis.error).toMatch(/unreachable/i);
  });

  it('survives pingRedis throwing rather than resolving', async () => {
    pingRedis.mockImplementation(() => {
      throw new Error('boom');
    });

    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).checks.redis.status).toBe('error');
  });

  it('still reports every other check when Stripe fails', async () => {
    balanceRetrieve.mockRejectedValue(new Error('stripe down'));

    const body = await (await GET()).json();
    expect(body.checks.stripe.status).toBe('error');
    expect(body.checks.redis.status).toBe('ok');
    expect(body.checks.database.status).toBe('ok');
  });

  it('leaks no dependency error detail to the caller', async () => {
    dbExecute.mockRejectedValue(new Error('password authentication failed for user "postgres"'));
    const raw = JSON.stringify(await (await GET()).json());
    expect(raw).not.toContain('password');
  });
});
