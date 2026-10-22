/**
 * Seed the E2E fixture from the command line, before the server is built.
 *
 * ## Why this exists rather than relying on `globalSetup` alone
 *
 * `globalSetup` seeds, and for a dev server that was enough: `next dev`
 * compiles and renders a route on its first request, which happens after
 * setup has run.
 *
 * A production build is different. `next build` PRE-RENDERS the routes that
 * set `revalidate`, and `/donate` is one of them. Its guard hides the
 * donation form unless the general fund row is donatable (`docs/42`), so if
 * the build runs against an empty database it bakes
 *
 *     "The general fund is not accepting donations right now"
 *
 * into the static page, and every later request is served that - which is
 * exactly what happened: eleven tests failed waiting for a form the build
 * had decided not to emit. Seeding afterwards cannot undo a prerender.
 *
 * So the data has to exist BEFORE the build, and the only way to guarantee
 * that is to seed as part of the server command, ahead of `next build`.
 *
 * ## A correction worth recording
 *
 * I previously claimed, in `docs/99` and in a commit message, that
 * `globalSetup` runs before `webServer`, "verified from run output". It was
 * not verified: the seed line appeared early in **stderr** while the build
 * wrote to **stdout**, which I had redirected away. Two streams say nothing
 * about each other's ordering. This script removes the dependency on that
 * ordering instead of asserting it.
 *
 * Idempotent, like `seedE2EData` itself, so running here and again in
 * `globalSetup` is harmless.
 */
import { seedE2EData } from './seed-data';

const started = Date.now();

seedE2EData()
  .then(() => {
    process.stderr.write(`[e2e-seed] pre-build seed done in ${Date.now() - started}ms\n`);
    process.exit(0);
  })
  .catch((error: unknown) => {
    // Exit non-zero so `&&` stops the chain: building against an empty
    // database produces a server that silently serves the wrong pages.
    process.stderr.write(
      `[e2e-seed] FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
