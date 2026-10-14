/**
 * Build-phase database fail-soft.
 *
 * `next build` pre-renders 24 routes that query Postgres (`export const
 * revalidate` plus a `@/db` read), so the build has a hard dependency on the
 * database. On a first deploy that dependency cannot be satisfied: the schema
 * is created by Fly's `release_command`, which only runs **after** a successful
 * image build. Verified 2026-10-14 — the first deploy failed with:
 *
 *     relation "blog_posts" does not exist      (42P01)
 *     Export encountered an error on /blog/sitemap.xml/route, exiting the build.
 *
 * `docs/35` §3a had assumed an empty database would simply pre-render empty
 * pages. That conflated *empty of rows* with *empty of tables*; only the second
 * was true, and a missing relation throws rather than returning no rows.
 *
 * This module makes a failed read during the production build resolve to zero
 * rows instead of throwing, which is the same end state as an empty table: the
 * route pre-renders empty and fills in on first request, because every one of
 * these routes sets `revalidate`.
 *
 * **It is inert outside the build.** The guard is keyed on Next's own
 * `NEXT_PHASE=phase-production-build`, which Next sets only while building. At
 * runtime a database error propagates exactly as it did before — a serving
 * instance that cannot reach Postgres must fail loudly, not serve a silently
 * empty page. That asymmetry is the whole point, and it is why this lives here
 * rather than in `src/db/index.ts`'s client options.
 *
 * It also makes the build hermetic, which `docs/35` §3a wanted independently:
 * CI can build without a reachable database.
 */

/** Next sets this only during `next build`. */
export const IS_PRODUCTION_BUILD =
  process.env.NEXT_PHASE === 'phase-production-build';

/** One warning per distinct message, so the build log stays readable. */
const warned = new Set<string>();

function warnOnce(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(
    `[build] database read failed, pre-rendering as empty; the route will ` +
      `render on demand once the schema exists: ${message}`,
  );
}

/**
 * The subset of `postgres`'s PendingQuery that drizzle's postgres-js session
 * uses: it awaits the result, and chains `.values()` on some paths
 * (`drizzle-orm/postgres-js/session.js:39,91`).
 */
interface PendingLike<T> extends PromiseLike<T> {
  values: () => PendingLike<unknown>;
}

function failSoft<T>(pending: PendingLike<T>, empty: T): PendingLike<T> {
  return {
    then(onFulfilled, onRejected) {
      return Promise.resolve(pending)
        .catch((err: unknown) => {
          warnOnce(err);
          return empty;
        })
        .then(onFulfilled, onRejected);
    },
    values() {
      return failSoft(pending.values(), [] as unknown[]);
    },
  };
}

/**
 * Wrap a `postgres` client so that, **during the production build only**, a
 * failed query resolves to zero rows.
 *
 * Only `unsafe` is intercepted, because every drizzle query path goes through
 * it (`drizzle-orm/postgres-js/session.js` lines 31, 39, 59, 91, 94). Anything
 * else — `begin`, `end`, the tagged-template call itself — passes straight
 * through untouched, so a transaction still fails loudly even at build time.
 */
export function withBuildPhaseFailSoft<C extends object>(client: C): C {
  if (!IS_PRODUCTION_BUILD) return client;

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'unsafe' || typeof value !== 'function') return value;
      return (...args: unknown[]) =>
        failSoft(
          (value as (...a: unknown[]) => PendingLike<unknown[]>).apply(target, args),
          [] as unknown[],
        );
    },
  });
}
