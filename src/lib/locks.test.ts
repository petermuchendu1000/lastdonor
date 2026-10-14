import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

// ─── Upstash mock ──────────────────────────────────────────────────────────
// A single shared spy set, re-created per test, standing in for the Redis REST
// client. `set` returns 'OK' when the lock is free and null when NX fails,
// matching @upstash/redis' documented contract.

const redisMock = {
  set: vi.fn(),
  eval: vi.fn(),
  ping: vi.fn(),
};

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => redisMock),
}));

const ORIGINAL_ENV = { ...process.env };

async function loadLocks() {
  vi.resetModules();
  const mod = await import('./locks');
  mod.__resetLockBackendForTests();
  return mod;
}

beforeEach(() => {
  redisMock.set.mockReset().mockResolvedValue('OK');
  redisMock.eval.mockReset().mockResolvedValue(1);
  redisMock.ping.mockReset().mockResolvedValue('PONG');
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('acquireLock', () => {
  it('acquires with SET NX EX, not a plain SET', async () => {
    const { acquireLock } = await loadLocks();

    const result = await acquireLock({
      name: 'demo',
      ttlSeconds: 150,
      onBackendUnavailable: 'skip',
    });

    expect(result.ok).toBe(true);
    expect(redisMock.set).toHaveBeenCalledTimes(1);

    const [key, token, opts] = redisMock.set.mock.calls[0];
    expect(key).toBe('lock:lastdonor:cron:demo');
    // A random token, not a constant - it is what makes release owner-checked.
    expect(typeof token).toBe('string');
    expect((token as string).length).toBeGreaterThan(8);
    // NX is the mutual exclusion; EX is the only thing that frees a lock held
    // by a machine killed mid-run.
    expect(opts).toEqual({ nx: true, ex: 150 });
  });

  it('reports the lock as held when SET NX returns null', async () => {
    const { acquireLock } = await loadLocks();
    redisMock.set.mockResolvedValue(null);

    const result = await acquireLock({
      name: 'demo',
      ttlSeconds: 150,
      onBackendUnavailable: 'run',
    });

    // 'held' is not configurable: even a fail-open job must not overlap.
    expect(result).toEqual({ ok: false, reason: 'held' });
  });

  it('releases only if still the owner (compare-then-delete)', async () => {
    const { acquireLock } = await loadLocks();

    const result = await acquireLock({
      name: 'demo',
      ttlSeconds: 150,
      onBackendUnavailable: 'skip',
    });
    if (!result.ok) throw new Error('expected lock');

    const token = redisMock.set.mock.calls[0][1];
    await result.lock.release();

    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    const [script, keys, args] = redisMock.eval.mock.calls[0];
    // An unconditional DEL would let an overrun run delete the *next* run's
    // lock. The script must read the token back and compare before deleting.
    expect(script).toContain('redis.call("get", KEYS[1])');
    expect(script).toContain('ARGV[1]');
    expect(script).toContain('del');
    expect(keys).toEqual(['lock:lastdonor:cron:demo']);
    expect(args).toEqual([token]);
  });

  it('never throws out of release when Upstash fails', async () => {
    const { acquireLock } = await loadLocks();
    redisMock.eval.mockRejectedValue(new Error('upstash down'));

    const result = await acquireLock({
      name: 'demo',
      ttlSeconds: 150,
      onBackendUnavailable: 'skip',
    });
    if (!result.ok) throw new Error('expected lock');

    await expect(result.lock.release()).resolves.toBeUndefined();
  });

  it('uses distinct tokens per acquisition', async () => {
    const { acquireLock } = await loadLocks();

    await acquireLock({ name: 'a', ttlSeconds: 10, onBackendUnavailable: 'skip' });
    await acquireLock({ name: 'a', ttlSeconds: 10, onBackendUnavailable: 'skip' });

    expect(redisMock.set.mock.calls[0][1]).not.toBe(redisMock.set.mock.calls[1][1]);
  });

  it('floors and clamps a nonsensical TTL instead of sending it', async () => {
    const { acquireLock } = await loadLocks();

    await acquireLock({ name: 'a', ttlSeconds: 0, onBackendUnavailable: 'skip' });
    expect(redisMock.set.mock.calls[0][2]).toEqual({ nx: true, ex: 1 });
  });
});

describe('acquireLock degradation', () => {
  it("skips when credentials are missing and the policy is 'skip'", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { acquireLock } = await loadLocks();

    const result = await acquireLock({
      name: 'demo',
      ttlSeconds: 150,
      onBackendUnavailable: 'skip',
    });

    expect(result).toEqual({ ok: false, reason: 'backend-unavailable' });
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("runs degraded when credentials are missing and the policy is 'run'", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { acquireLock } = await loadLocks();

    const result = await acquireLock({
      name: 'demo',
      ttlSeconds: 150,
      onBackendUnavailable: 'run',
    });

    if (!result.ok) throw new Error('expected a degraded run');
    // Honest about holding nothing, so callers can log it.
    expect(result.degraded).toBe(true);
    expect(result.lock.distributed).toBe(false);
    await expect(result.lock.release()).resolves.toBeUndefined();
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it('treats a thrown SET as backend-unavailable, not as a free lock', async () => {
    const { acquireLock } = await loadLocks();
    redisMock.set.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const skip = await acquireLock({
      name: 'demo',
      ttlSeconds: 150,
      onBackendUnavailable: 'skip',
    });
    expect(skip).toEqual({ ok: false, reason: 'backend-unavailable' });

    const run = await acquireLock({
      name: 'demo',
      ttlSeconds: 150,
      onBackendUnavailable: 'run',
    });
    expect(run.ok).toBe(true);
  });
});

describe('pingRedis', () => {
  it('reports ok when the backend answers', async () => {
    const { pingRedis } = await loadLocks();
    await expect(pingRedis()).resolves.toEqual({ configured: true, ok: true });
  });

  it('distinguishes unconfigured from unreachable', async () => {
    const { pingRedis } = await loadLocks();
    redisMock.ping.mockRejectedValue(new Error('timeout'));
    const unreachable = await pingRedis();
    expect(unreachable).toMatchObject({ configured: true, ok: false });

    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { pingRedis: pingAgain } = await loadLocks();
    const unconfigured = await pingAgain();
    expect(unconfigured).toMatchObject({ configured: false, ok: false });
  });
});

describe('CRON_LOCKS registry', () => {
  const cronDir = path.resolve(__dirname, '../app/api/v1/cron');

  const routeDirs = readdirSync(cronDir).filter((entry) =>
    statSync(path.join(cronDir, entry)).isDirectory(),
  );

  it('covers every cron route on disk, so a new job cannot ship unlocked', async () => {
    const { CRON_LOCKS } = await loadLocks();
    expect(routeDirs.length).toBeGreaterThanOrEqual(10);
    expect([...routeDirs].sort()).toEqual(Object.keys(CRON_LOCKS).sort());
  });

  it('gives every TTL headroom above the route maxDuration', async () => {
    const { CRON_LOCKS } = await loadLocks();
    for (const spec of Object.values(CRON_LOCKS)) {
      // A TTL at or below maxDuration lets a slow run lose its own lock
      // mid-flight, which is worse than no lock: it reads as "free".
      expect(spec.ttlSeconds).toBeGreaterThan(spec.maxDurationSeconds);
    }
  });

  it("records each job's maxDuration as the route actually declares it", async () => {
    const { CRON_LOCKS } = await loadLocks();
    for (const [job, spec] of Object.entries(CRON_LOCKS)) {
      const source = readFileSync(path.join(cronDir, job, 'route.ts'), 'utf8');
      const declared = source.match(/export const maxDuration = (\d+)/);
      expect(declared, `${job} declares maxDuration`).not.toBeNull();
      expect(Number(declared![1]), `${job} maxDuration`).toBe(spec.maxDurationSeconds);
    }
  });

  it('documents a rationale for every fail-open/fail-closed choice', async () => {
    const { CRON_LOCKS } = await loadLocks();
    for (const spec of Object.values(CRON_LOCKS)) {
      expect(['run', 'skip']).toContain(spec.onBackendUnavailable);
      expect(spec.rationale.length).toBeGreaterThan(40);
    }
  });

  it('fails closed everywhere except the convergent reconcile job', async () => {
    const { CRON_LOCKS } = await loadLocks();
    const failOpen = Object.values(CRON_LOCKS)
      .filter((s) => s.onBackendUnavailable === 'run')
      .map((s) => s.name);
    // Fail-open is only defensible for a job that converges. Adding another
    // one is a decision that should break this test and be argued for.
    expect(failOpen).toEqual(['reconcile']);
  });

  it('every cron route acquires its lock and releases it in a finally', () => {
    for (const job of routeDirs) {
      const source = readFileSync(path.join(cronDir, job, 'route.ts'), 'utf8');
      expect(source, `${job} acquires a lock`).toContain('acquireCronLock');
      expect(source, `${job} uses its own registry entry`).toContain(`CRON_LOCKS['${job}']`);
      expect(source, `${job} exits early when held`).toContain('lockSkipPayload');
      // Without a finally the lock is held for its whole TTL after any throw,
      // which turns one failure into a blocked schedule.
      expect(source, `${job} releases in a finally`).toMatch(
        /finally\s*\{\s*await lock\.lock\.release\(\);/,
      );
    }
  });
});
