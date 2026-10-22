/**
 * Playwright global setup: put the database into the state the specs assume.
 *
 * Runs once, before the browsers and before `webServer` is considered ready.
 * The specs themselves are left untouched — they keep clicking "the first
 * campaign link" on `/campaigns`, and this is what makes such a link exist.
 *
 * See `e2e/fixtures/seed-data.ts` for what is seeded and why, and `docs/99`
 * for how the suite came to depend on state nobody provided.
 */
import { seedE2EData } from './fixtures/seed-data';

export default async function globalSetup(): Promise<void> {
  const started = Date.now();
  await seedE2EData();
  /*
    stderr, NOT stdout. Playwright's `json` reporter writes the report to
    STDOUT, so a `console.log` here lands inside it and the result is not
    valid JSON:

        [e2e-seed] fixture ready in 50ms
        [e2e-seed] fixture rows removed
        { "config": { ...

    which fails to parse at line 1 column 2. Diagnostics belong on stderr
    precisely so they cannot corrupt a machine-readable stream on stdout.
  */
  process.stderr.write(`[e2e-seed] fixture ready in ${Date.now() - started}ms\n`);
}
