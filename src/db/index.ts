import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { IS_PRODUCTION_BUILD, withBuildPhaseFailSoft } from './build-phase';
import { withQueryTimeout } from './query-timeout';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// prepare: false is required for Supabase connection pooling (PgBouncer transaction mode)
const client = postgres(connectionString, {
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
  max: 5,
  max_lifetime: 60 * 30, // 30 min max connection lifetime

  /*
    Build only: one connection per worker, overriding the `max: 5` above.

    `next build` pre-renders 24+ database-backed routes across SEVERAL
    worker processes, and each worker imports this module and opens its
    own pool. `scripts/deploy.sh --prerender` passes a SESSION-mode URL
    (port 5432), where Supabase caps the whole project at
    `pool_size: 15`. Workers x 5 exceeds that, and the build log says so
    in as many words:

      (EMAXCONNSESSION) max clients reached in session mode
      - max clients are limited to pool_size: 15

    `withBuildPhaseFailSoft` below then swallows the error by design, so
    those routes pre-render EMPTY and the build still succeeds. Observed
    2026-10-19: `/sitemap.xml` shipped with 42 URLs and not one
    `/campaigns/<slug>`, while the database held 13 active campaigns.
    With `revalidate = 3600` that empty sitemap is then served for up to
    an hour after every deploy - so the only pages that can accept money
    were missing from the sitemap Google fetches.

    docs/46 recorded that symptom and blamed static generation; adding
    `revalidate` bounded the damage to an hour instead of forever but
    left the cause in place. The cause is this pool, at build time.

    One connection per worker is plenty: a pre-render reads a handful of
    rows once. The runtime value is untouched, which is what the
    `max: 5` assertion in `pool-fanout.ratchet.test.ts` and the
    three-query cap in docs/87 are about.
  */
  ...(IS_PRODUCTION_BUILD ? { max: 1 } : {}),
});

// Two wrappers, both intercepting only `client.unsafe`:
//   - `withQueryTimeout` bounds every query client-side. Added after the
//     2026-10-14/15 incident, where a wedged pool hung every DB route
//     indefinitely while the database itself answered in 15ms. postgres.js has
//     no query or pool-queue timeout of its own, and Supavisor silently ignores
//     `connection: { statement_timeout }`. See `./query-timeout.ts`, `docs/37`.
//   - `withBuildPhaseFailSoft` is inert at runtime and fails soft only during
//     `next build`, where the schema may not exist yet on a first deploy.
export const db = drizzle(
  withBuildPhaseFailSoft(withQueryTimeout(client)),
  { schema },
);
