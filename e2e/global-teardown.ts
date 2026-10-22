/**
 * Playwright global teardown: remove the fixture's own rows.
 *
 * Deletes by the fixed ids in `e2e/fixtures/seed-data.ts` and never
 * truncates, so running the suite against a database that holds other data
 * leaves that data alone.
 *
 * A failure here must not fail the run. Teardown runs after the verdict is
 * already decided, and a cleanup error reported as a test failure sends the
 * next reader hunting for a product bug that does not exist. It is logged
 * loudly instead, and `seedE2EData` clears before it seeds, so a missed
 * cleanup cannot poison the following run either.
 */
import { clearE2EData } from './fixtures/seed-data';

export default async function globalTeardown(): Promise<void> {
  try {
    await clearE2EData();
    // stderr, not stdout: the `json` reporter writes its report to stdout
    // and a stray line here makes it unparseable. See `global-setup.ts`.
    process.stderr.write('[e2e-seed] fixture rows removed\n');
  } catch (error) {
    console.error(
      '[e2e-seed] teardown failed; fixture rows may remain. The next run ' +
        'clears before seeding, so this does not corrupt the next result.',
      error,
    );
  }
}
