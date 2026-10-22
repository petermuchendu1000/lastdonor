import { defineConfig } from 'vitest/config';
import path from 'path';

/*
  Integration tests run SERIALLY, and that is not a preference.

  Every integration file calls `clearDatabase()` in `beforeEach`. There is one
  database, so when Vitest runs files in parallel — its default — one file
  truncates the tables another file is mid-way through using. The symptom is
  not a clean failure either: it is foreign-key violations like
  `campaigns_creator_id_users_id_fk` from a test whose fixture user was
  deleted underneath it by a sibling.

  Measured on 2026-10-22, the first time this suite had ever been executed
  (docs/98), against a local Postgres 16 with a freshly migrated database:

    parallel, fresh database   50 failed / 32 passed
    parallel, same database    18 failed / 64 passed
    parallel, fresh database   23 failed / 59 passed   <- same inputs as run 1
    SERIAL,   fresh database    1 failed / 81 passed
    SERIAL,   fresh database    1 failed / 81 passed   <- reproducible

  Two fresh-database runs differing by 27 tests is the whole argument: the
  suite was not merely order-dependent, it raced itself, so no result it
  produced meant anything. Serialising it turned 49 of the 50 failures into
  passes and left exactly one real finding (a stale assertion about a dropped
  CHECK constraint, fixed in the donations suite).

  The suite was WRITTEN for serial execution — `clearDatabase()` in
  `beforeEach` only makes sense that way — and was never run, so nobody found
  out that the config did not actually serialise it.

  Do not remove these two lines to make the suite faster. The whole run takes
  about 20 seconds. If parallelism is ever genuinely needed, the prerequisite
  is a database per worker (Vitest exposes `VITEST_POOL_ID`), not a shared one.
*/
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    /** One file at a time: they share one database and each truncates it. */
    fileParallelism: false,
    /** And no concurrent tests within a file, for the same reason. */
    sequence: { concurrent: false },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
