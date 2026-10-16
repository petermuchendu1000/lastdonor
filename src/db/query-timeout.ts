/**
 * Client-side query timeout for the Postgres pool.
 *
 * WHY THIS EXISTS — incident 2026-10-14/15.
 *
 * Verified sequence: `/api/v1/health` reported `database ok, 45ms` at 18:18Z.
 * By 00:04Z every route touching Postgres hung indefinitely (35s+, no response,
 * nothing logged), while `/api/v1/live` — the only DB-free route — answered in
 * 0.5s. The database itself was fine throughout: a query run from inside the
 * same machine with the same driver returned `count(campaigns)` in 15ms, and
 * the Supabase project read `ACTIVE_HEALTHY`. Only the app's pool was broken,
 * and a machine restart cleared it instantly.
 *
 * The trigger was transient pooler instability: an earlier probe saw
 * `57014 canceling statement due to statement timeout` returned in **74ms**,
 * when the session's `statement_timeout` was `2min`. That cancel did not come
 * from the database, and the connections never recovered from it.
 *
 * The amplifier is that `postgres.js` has **no client-side query timeout and no
 * pool-queue timeout**. With `max: 5`, five unrecoverable connections exhaust
 * the pool and every later request waits forever. A silent, total outage of
 * every dynamic page, with a passing Fly health check — because the probe is
 * (correctly) the shallow one.
 *
 * WHAT WAS TRIED AND DOES NOT WORK. Passing
 * `connection: { statement_timeout, idle_in_transaction_session_timeout }` to
 * `postgres()` — the obvious fix — is **silently ignored by Supabase's
 * Supavisor pooler in transaction mode**. Verified against the production
 * pooler on port 6543: the settings read back as `2min` and `0`, unchanged, and
 * `pg_sleep(45)` ran to completion with a 30s timeout configured. Not rejected,
 * *ignored*, so it would have looked like protection while providing none. Do
 * not re-add it believing otherwise; see `docs/37`.
 *
 * WHAT THIS DOES. Bounds every query client-side, in the one place all of them
 * pass through (`client.unsafe`, per `drizzle-orm/postgres-js/session.js`
 * lines 31, 39, 59, 91, 94). A wedged pool now produces a fast, loud error
 * instead of an unbounded hang, so the deep health endpoint reports `degraded`
 * within a second and external monitoring can see it.
 *
 * ON TIMEOUT IT CANCELS (added 2026-10-16, after the guard's first real
 * outage). The original version raced a timeout and nothing else, which freed
 * the caller but left the query holding its pool connection. With `max: 5`
 * that turned a transient stall into a permanent one: five timeouts exhausted
 * the pool, every later request queued and timed out, and the wedge re-formed
 * within a single page load after a restart. `pending.cancel()` sends a
 * CancelRequest so the driver settles the query and the pool gets its
 * connection back. See `docs/52`.
 *
 * A role-level `statement_timeout` is still the only thing that bounds a
 * server-side query the client has already walked away from, and that remains
 * an owner decision because migrations run as the same role. See `docs/37` §4.
 */

/** Wall-clock budget for a single query. */
const DEFAULT_QUERY_TIMEOUT_MS = 15_000;

export class QueryTimeoutError extends Error {
  readonly code = 'DB_QUERY_TIMEOUT';
  constructor(ms: number) {
    super(
      `Database query exceeded ${ms}ms. The connection pool may be wedged; ` +
        `see src/db/query-timeout.ts and docs/37.`,
    );
    this.name = 'QueryTimeoutError';
  }
}

export function resolveQueryTimeoutMs(
  raw: string | undefined = process.env.DB_QUERY_TIMEOUT_MS,
): number {
  if (!raw) return DEFAULT_QUERY_TIMEOUT_MS;
  const parsed = Number(raw);
  // A 0 or negative budget would disable the guard; a tiny one would break
  // legitimate queries. Both fall back rather than being honoured silently.
  if (!Number.isFinite(parsed) || parsed < 1_000 || parsed > 120_000) {
    console.error(
      `[db] DB_QUERY_TIMEOUT_MS="${raw}" is not an integer in 1000..120000; ` +
        `using ${DEFAULT_QUERY_TIMEOUT_MS}ms.`,
    );
    return DEFAULT_QUERY_TIMEOUT_MS;
  }
  return parsed;
}

/** The slice of `postgres`'s PendingQuery that drizzle's session uses. */
interface PendingLike<T> extends PromiseLike<T> {
  values: () => PendingLike<unknown>;
  /**
   * `postgres`'s Query.cancel (`postgres/src/query.js`), which sends a
   * CancelRequest on a second socket. Optional because the wrapper is also
   * handed plain thenables by its own tests.
   */
  cancel?: () => void;
}

function bound<T>(pending: PendingLike<T>, ms: number): PendingLike<T> {
  return {
    then(onFulfilled, onRejected) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          /*
           * Cancel before rejecting. Racing a timeout only frees the CALLER;
           * the query keeps its pool connection, and with `max: 5` five
           * timed-out queries exhaust the pool permanently, so every later
           * request queues and times out too. That is a self-reinforcing
           * wedge that a restart does not survive under traffic: it took one
           * page load to re-form in the 2026-10-16 outage, where five
           * backends sat in `ClientRead` while the same pool config answered
           * eight concurrent queries in 72ms from the same container.
           *
           * `cancel()` sends a real CancelRequest, so the server stops and
           * the driver settles the query (57014), which is what actually
           * returns the connection to the pool. Best-effort: a query that has
           * not reached the wire yet has nothing to cancel, and the throw
           * must not mask the timeout.
           */
          try {
            pending.cancel?.();
          } catch {
            // Deliberately swallowed: the timeout below is the real outcome.
          }
          reject(new QueryTimeoutError(ms));
        }, ms);
      });
      return Promise.race([Promise.resolve(pending), timeout])
        .finally(() => {
          if (timer) clearTimeout(timer);
        })
        .then(onFulfilled as never, onRejected);
    },
    values() {
      return bound(pending.values(), ms);
    },
  };
}

/**
 * Wrap a `postgres` client so every query rejects rather than hanging.
 *
 * Only `unsafe` is intercepted; `begin`, `end` and the tagged-template call
 * pass straight through, so transaction semantics are untouched.
 */
export function withQueryTimeout<C extends object>(
  client: C,
  ms: number = resolveQueryTimeoutMs(),
): C {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'unsafe' || typeof value !== 'function') return value;
      return (...args: unknown[]) =>
        bound(
          (value as (...a: unknown[]) => PendingLike<unknown>).apply(target, args),
          ms,
        );
    },
  });
}
