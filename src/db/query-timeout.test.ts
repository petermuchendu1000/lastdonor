/**
 * `src/db/query-timeout.ts` — the client-side query timeout.
 *
 * Guards the 2026-10-14/15 incident: a wedged pool hung every database route
 * indefinitely. These assert the bound actually fires, that a fast query is
 * untouched, and that `.values()` (drizzle's other code path) is bounded too.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  withQueryTimeout,
  resolveQueryTimeoutMs,
  QueryTimeoutError,
} from './query-timeout';

/** Client whose `unsafe` never settles, i.e. the wedged-pool case. */
function hangingClient() {
  const pending: {
    then: (onFulfilled?: unknown, onRejected?: unknown) => Promise<never>;
    values: () => typeof pending;
  } = {
    // Never resolves and never rejects — exactly the observed behaviour of the
    // wedged pool, which is what the timeout has to convert into an error.
    then: () => new Promise<never>(() => {}),
    values: () => pending,
  };
  return { begin: () => 'passthrough', unsafe: (..._a: unknown[]) => pending };
}

function fastClient(rows: unknown) {
  const make = (value: unknown) => ({
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(value).then(onFulfilled, onRejected);
    },
    values: () => make([['v']]),
  });
  return { begin: () => 'passthrough', unsafe: (..._a: unknown[]) => make(rows) };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('a wedged pool fails fast instead of hanging', () => {
  it('rejects with QueryTimeoutError once the budget elapses', async () => {
    const wrapped = withQueryTimeout(hangingClient(), 1_000);
    const started = Date.now();
    await expect(wrapped.unsafe('select 1')).rejects.toBeInstanceOf(QueryTimeoutError);
    // The point of the guard: bounded, not indefinite.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('bounds .values() too, the other drizzle path', async () => {
    const wrapped = withQueryTimeout(hangingClient(), 1_000);
    await expect(wrapped.unsafe('select 1').values()).rejects.toBeInstanceOf(QueryTimeoutError);
  });

  it('carries a machine-readable code', async () => {
    const wrapped = withQueryTimeout(hangingClient(), 1_000);
    await expect(wrapped.unsafe('select 1')).rejects.toMatchObject({ code: 'DB_QUERY_TIMEOUT' });
  });
});

describe('healthy queries are untouched', () => {
  it('passes rows through unchanged', async () => {
    const wrapped = withQueryTimeout(fastClient([{ c: 12 }]), 5_000);
    await expect(wrapped.unsafe('select count(*)')).resolves.toEqual([{ c: 12 }]);
  });

  it('does not intercept anything but unsafe', () => {
    const wrapped = withQueryTimeout(fastClient([]), 5_000);
    expect(wrapped.begin()).toBe('passthrough');
  });
});

describe('budget resolution', () => {
  it('defaults when unset', () => {
    expect(resolveQueryTimeoutMs(undefined)).toBe(15_000);
  });

  it('honours a sane override', () => {
    expect(resolveQueryTimeoutMs('30000')).toBe(30_000);
  });

  it.each(['0', '-1', '500', '999999', 'abc', ''])(
    'falls back on nonsense value %j rather than honouring it',
    (raw) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(resolveQueryTimeoutMs(raw)).toBe(15_000);
    },
  );

  it('warns when falling back, so a misconfiguration is visible', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveQueryTimeoutMs('12');
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]?.[0]).toMatch(/DB_QUERY_TIMEOUT_MS/);
  });
});
