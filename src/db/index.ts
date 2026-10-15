import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { withBuildPhaseFailSoft } from './build-phase';
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
