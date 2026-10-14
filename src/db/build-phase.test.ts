/**
 * `src/db/build-phase.ts` — the build-phase fail-soft guard.
 *
 * The guard's entire safety argument is that it is INERT AT RUNTIME: a serving
 * instance that cannot reach Postgres must still fail loudly, and only
 * `next build` gets zero rows instead of an exception. That is asserted in the
 * module's doc comment, so it is asserted here too — a comment cannot fail CI.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const ORIGINAL_PHASE = process.env.NEXT_PHASE;

/** Re-import the module with NEXT_PHASE set, since it reads it at module load. */
async function loadWithPhase(phase: string | undefined) {
  vi.resetModules();
  if (phase === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = phase;
  return import('./build-phase');
}

/** A minimal stand-in for a `postgres` client: only `unsafe` is intercepted. */
function fakeClient(behaviour: 'reject' | 'resolve') {
  const calls: unknown[][] = [];
  const client = {
    calls,
    begin: () => 'begin-passthrough',
    unsafe(...args: unknown[]) {
      calls.push(args);
      const settle = <T,>(empty: T): PromiseLike<T> => ({
        then(onFulfilled, onRejected) {
          const p =
            behaviour === 'reject'
              ? Promise.reject(new Error('relation "blog_posts" does not exist'))
              : Promise.resolve(empty);
          return p.then(onFulfilled, onRejected);
        },
      });
      return Object.assign(settle([{ slug: 'real-row' }]), {
        values: () => settle([['real-row']]),
      });
    },
  };
  return client;
}

afterEach(() => {
  if (ORIGINAL_PHASE === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = ORIGINAL_PHASE;
  vi.restoreAllMocks();
});

describe('outside the production build — must stay loud', () => {
  it('returns the client untouched, so errors propagate', async () => {
    const { withBuildPhaseFailSoft, IS_PRODUCTION_BUILD } = await loadWithPhase(undefined);
    expect(IS_PRODUCTION_BUILD).toBe(false);

    const client = fakeClient('reject');
    const wrapped = withBuildPhaseFailSoft(client);
    // Identity, not a proxy: nothing is intercepted at runtime at all.
    expect(wrapped).toBe(client);
    await expect(wrapped.unsafe('select 1')).rejects.toThrow(/does not exist/);
  });

  it('is also inert during the dev server phase', async () => {
    const { IS_PRODUCTION_BUILD } = await loadWithPhase('phase-development-server');
    expect(IS_PRODUCTION_BUILD).toBe(false);
  });

  it('is inert during the production SERVER phase, not just dev', async () => {
    // The dangerous near-miss: `phase-production-server` is what runs in
    // production. If the guard keyed on a prefix it would swallow real outages.
    const { IS_PRODUCTION_BUILD } = await loadWithPhase('phase-production-server');
    expect(IS_PRODUCTION_BUILD).toBe(false);
  });
});

describe('during the production build — fails soft', () => {
  it('resolves a failed read to zero rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { withBuildPhaseFailSoft, IS_PRODUCTION_BUILD } =
      await loadWithPhase('phase-production-build');
    expect(IS_PRODUCTION_BUILD).toBe(true);

    const wrapped = withBuildPhaseFailSoft(fakeClient('reject'));
    await expect(wrapped.unsafe('select * from blog_posts')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/pre-rendering as empty/);
  });

  it('fails soft through .values(), the other drizzle code path', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { withBuildPhaseFailSoft } = await loadWithPhase('phase-production-build');
    const wrapped = withBuildPhaseFailSoft(fakeClient('reject'));
    // drizzle-orm/postgres-js/session.js:39,91 chain .values() on the result.
    await expect(wrapped.unsafe('select 1').values()).resolves.toEqual([]);
  });

  it('passes a SUCCESSFUL read through unchanged', async () => {
    const { withBuildPhaseFailSoft } = await loadWithPhase('phase-production-build');
    const wrapped = withBuildPhaseFailSoft(fakeClient('resolve'));
    await expect(wrapped.unsafe('select 1')).resolves.toEqual([{ slug: 'real-row' }]);
  });

  it('warns once per distinct message, not once per query', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { withBuildPhaseFailSoft } = await loadWithPhase('phase-production-build');
    const wrapped = withBuildPhaseFailSoft(fakeClient('reject'));
    await wrapped.unsafe('q1');
    await wrapped.unsafe('q2');
    await wrapped.unsafe('q3');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not intercept anything but unsafe', async () => {
    const { withBuildPhaseFailSoft } = await loadWithPhase('phase-production-build');
    const client = fakeClient('reject');
    const wrapped = withBuildPhaseFailSoft(client);
    // `begin` must pass straight through: a transaction should still fail
    // loudly even at build time.
    expect(wrapped.begin()).toBe('begin-passthrough');
  });
});
