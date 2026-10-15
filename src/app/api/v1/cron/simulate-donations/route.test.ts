/**
 * `simulate-donations` must refuse structurally, not just by default setting.
 *
 * docs/33 §3 records an engineering refusal to run fabricated donations
 * indistinguishably from real ones in public campaign totals, over an owner
 * instruction to do it. What actually enforced that refusal was
 * `SETTING_DEFAULTS['simulation.enabled'] === false` plus the absence of a
 * scheduler — one admin-UI checkbox and one deploy target. `vercel.json`
 * shipped a quarter-hourly entry for this very route, so a Vercel deploy (or a
 * copy of that file) supplied the missing scheduler and the checkbox was all
 * that remained.
 *
 * These tests pin the refusal to the deployment environment instead: nothing
 * reachable from the admin UI or an API call can start it.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

const mockVerifyCronAuth = vi.fn().mockReturnValue(true);
vi.mock('@/lib/cron-auth', () => ({
  verifyCronAuth: (...a: unknown[]) => mockVerifyCronAuth(...a),
}));

const mockRelease = vi.fn().mockResolvedValue(undefined);
const mockAcquireCronLock = vi.fn().mockResolvedValue({
  ok: true,
  degraded: false,
  lock: { key: 'k', distributed: true, release: mockRelease },
});
vi.mock('@/lib/locks', () => ({
  acquireCronLock: (...a: unknown[]) => mockAcquireCronLock(...a),
  CRON_LOCKS: { 'simulate-donations': { name: 'simulate-donations', ttlSeconds: 150 } },
  lockSkipPayload: () => ({ ok: true, data: { skipped: true, reason: 'locked' } }),
}));

const mockInsertValues = vi.fn().mockResolvedValue(undefined);
vi.mock('@/db', () => ({
  db: { insert: () => ({ values: mockInsertValues }) },
}));
vi.mock('@/db/schema', () => ({ auditLogs: {} }));

const mockGetSetting = vi.fn();
vi.mock('@/lib/settings.server', () => ({
  getSetting: (...a: unknown[]) => mockGetSetting(...a),
}));

vi.mock('@/lib/seed/phase-out', () => ({
  calculateAutoVolume: vi.fn().mockResolvedValue(-1),
}));

// Only `runSimulation` is replaced: the opt-in gate under test stays real.
const mockRunSimulation = vi.fn().mockResolvedValue({
  campaignsProcessed: 0,
  donationsCreated: 0,
  phaseTransitions: 0,
  completions: 0,
  errors: [],
});
vi.mock('@/lib/seed/simulation-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seed/simulation-engine')>();
  return { ...actual, runSimulation: (...a: unknown[]) => mockRunSimulation(...a) };
});

const { GET } = await import('./route');
const { SEED_DONATIONS_OPT_IN_ENV, SEED_DONATIONS_OPT_IN_SENTINEL } = await import(
  '@/lib/seed/simulation-engine'
);

function request() {
  return { headers: { get: () => 'Bearer whatever' } } as never;
}

describe('GET /api/v1/cron/simulate-donations', () => {
  const original = process.env[SEED_DONATIONS_OPT_IN_ENV];

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCronAuth.mockReturnValue(true);
    mockAcquireCronLock.mockResolvedValue({
      ok: true,
      degraded: false,
      lock: { key: 'k', distributed: true, release: mockRelease },
    });
    mockRunSimulation.mockResolvedValue({
      campaignsProcessed: 0,
      donationsCreated: 0,
      phaseTransitions: 0,
      completions: 0,
      errors: [],
    });
    // Everything an admin can toggle says "yes, simulate".
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'simulation.enabled') return true;
      if (key === 'simulation.pause_all') return false;
      if (key === 'simulation.volume_multiplier') return 1;
      return undefined;
    });
    delete process.env[SEED_DONATIONS_OPT_IN_ENV];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[SEED_DONATIONS_OPT_IN_ENV];
    else process.env[SEED_DONATIONS_OPT_IN_ENV] = original;
  });

  it('refuses with 403 when the deployment has not opted in', async () => {
    const res = await GET(request());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('refuses even when simulation.enabled is true', async () => {
    // The whole point: an admin UI toggle is not sufficient authority.
    const res = await GET(request());

    expect(res.status).toBe(403);
    expect(mockRunSimulation).not.toHaveBeenCalled();
  });

  it('refuses before acquiring the lock or reading any setting', async () => {
    await GET(request());

    expect(mockAcquireCronLock).not.toHaveBeenCalled();
    expect(mockGetSetting).not.toHaveBeenCalled();
  });

  it('is not satisfied by SEED_DONATIONS_OPT_IN=true', async () => {
    // `=true` is the value someone copies in by reflex from the other flags.
    process.env[SEED_DONATIONS_OPT_IN_ENV] = 'true';

    const res = await GET(request());

    expect(res.status).toBe(403);
    expect(mockRunSimulation).not.toHaveBeenCalled();
  });

  it('names the override in the refusal, so the gate is discoverable', async () => {
    const res = await GET(request());
    const body = await res.json();

    expect(body.error.message).toContain(SEED_DONATIONS_OPT_IN_ENV);
    expect(body.error.message).toContain('docs/33');
  });

  it('still refuses unauthorised callers with 401 ahead of the gate', async () => {
    mockVerifyCronAuth.mockReturnValue(false);

    const res = await GET(request());

    expect(res.status).toBe(401);
  });

  it('runs when the deployment has explicitly opted in', async () => {
    process.env[SEED_DONATIONS_OPT_IN_ENV] = SEED_DONATIONS_OPT_IN_SENTINEL;

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(mockRunSimulation).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalled();
  });

  it('opted in, still honours the simulation.enabled setting', async () => {
    process.env[SEED_DONATIONS_OPT_IN_ENV] = SEED_DONATIONS_OPT_IN_SENTINEL;
    mockGetSetting.mockImplementation(async (key: string) =>
      key === 'simulation.enabled' ? false : undefined,
    );

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.skipped).toBe(true);
    expect(mockRunSimulation).not.toHaveBeenCalled();
  });
});

// ── Deployment config ───────────────────────────────────────────────────────

describe('vercel.json cron schedule', () => {
  const vercelJsonPath = path.resolve(__dirname, '../../../../../../vercel.json');

  it('does not schedule simulate-donations', () => {
    // docs/26 §119 says this file is inert on Fly, but it is the only cron
    // config in the repo and therefore the one the next person copies. Shipping
    // a schedule for this job means a single `vercel deploy` starts writing
    // fabricated donations — see docs/33 §2 and the route gate above.
    if (!existsSync(vercelJsonPath)) return;

    const config = JSON.parse(readFileSync(vercelJsonPath, 'utf8')) as {
      crons?: { path: string }[];
    };

    const paths = (config.crons ?? []).map((c) => c.path);
    expect(paths).not.toContain('/api/v1/cron/simulate-donations');
  });
});
