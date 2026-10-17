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
  cancelOnTimeout,
} from './query-timeout';

/** Client whose `unsafe` never settles, i.e. the wedged-pool case. */
function hangingClient() {
  const pending: {
    then: (onFulfilled?: unknown, onRejected?: unknown) => Promise<never>;
    values: () => typeof pending;
    cancel: () => void;
    cancelled: number;
  } = {
    // Never resolves and never rejects — exactly the observed behaviour of the
    // wedged pool, which is what the timeout has to convert into an error.
    then: () => new Promise<never>(() => {}),
    values: () => pending,
    cancel: () => { pending.cancelled += 1; },
    cancelled: 0,
  };
  return {
    begin: () => 'passthrough',
    unsafe: (..._a: unknown[]) => pending,
    pending,
  };
}

/** A query that settles well inside its budget, and counts cancel() calls. */
function settlingClient() {
  let cancelled = 0;
  const make = (value: unknown) => ({
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(value).then(onFulfilled, onRejected);
    },
    values: () => make([['v']]),
    cancel: () => { cancelled += 1; },
  });
  return {
    begin: () => 'passthrough',
    unsafe: (..._a: unknown[]) => make([{ ok: true }]),
    cancelled: () => cancelled,
  };
}

/** A pending query whose `cancel` throws, e.g. not yet on the wire. */
function hostileCancelClient() {
  const pending = {
    then: () => new Promise<never>(() => {}),
    values: () => pending,
    cancel: () => { throw new Error('not connected'); },
  };
  return { begin: () => 'passthrough', unsafe: (..._a: unknown[]) => pending };
}

/** A pending query with no `cancel` at all. */
function noCancelClient() {
  const pending: { then: () => Promise<never>; values: () => typeof pending } = {
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

  /*
   * Regression guard for the 2026-10-16 outage (docs/52). Rejecting the
   * caller without cancelling leaves the query holding its pool connection;
   * with `max: 5`, five timeouts exhaust the pool permanently and the wedge
   * survives a restart. Cancelling is what returns the connection.
   */
  it('cancels the underlying query on timeout, so the pool slot is released', async () => {
    const client = hangingClient();
    const wrapped = withQueryTimeout(client, 1_000);
    await expect(wrapped.unsafe('select 1')).rejects.toBeInstanceOf(QueryTimeoutError);
    expect(client.pending.cancelled).toBe(1);
  });

  it('does not cancel a query that settles inside its budget', async () => {
    const client = settlingClient();
    const wrapped = withQueryTimeout(client, 1_000);
    await expect(wrapped.unsafe('select 1')).resolves.toEqual([{ ok: true }]);
    expect(client.cancelled()).toBe(0);
  });

  it('still reports the timeout when cancel() itself throws', async () => {
    const wrapped = withQueryTimeout(hostileCancelClient(), 1_000);
    await expect(wrapped.unsafe('select 1')).rejects.toBeInstanceOf(QueryTimeoutError);
  });

  it('tolerates a pending query with no cancel()', async () => {
    const wrapped = withQueryTimeout(noCancelClient(), 1_000);
    await expect(wrapped.unsafe('select 1')).rejects.toBeInstanceOf(QueryTimeoutError);
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

/*
  The DB_CANCEL_ON_TIMEOUT experiment (docs/87 amendment 2). The default
  must stay ON: the whole point is that turning the experiment off is an
  explicit act, so an unset or malformed value cannot silently undo
  docs/52's fix.
*/
describe('the cancel-on-timeout experiment flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, '', '1', 'true', 'false', 'no', ' 0 '])(
    'leaves cancelling ON for %p',
    (value) => {
      if (value === undefined) vi.stubEnv('DB_CANCEL_ON_TIMEOUT', '');
      else vi.stubEnv('DB_CANCEL_ON_TIMEOUT', value);
      if (value === undefined) {
        // An unset variable must behave like any other non-"0" value.
        expect(cancelOnTimeout()).toBe(true);
      } else {
        expect(cancelOnTimeout()).toBe(value !== '0');
      }
    },
  );

  it('turns cancelling off only for the exact string "0"', () => {
    vi.stubEnv('DB_CANCEL_ON_TIMEOUT', '0');
    expect(cancelOnTimeout()).toBe(false);
  });

  it('does not send a CancelRequest when the experiment is off', async () => {
    vi.stubEnv('DB_CANCEL_ON_TIMEOUT', '0');
    const cancel = vi.fn();
    const never: Record<string, unknown> = {
      then: () => {},
      values: () => never,
      cancel,
    };
    await expect(
      withQueryTimeout(never as never, 20),
    ).rejects.toBeInstanceOf(QueryTimeoutError);
    expect(cancel).not.toHaveBeenCalled();
  });
});
