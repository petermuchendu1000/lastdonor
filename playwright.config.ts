import { defineConfig, devices } from '@playwright/test';

// Some environments (notably Claude Code cloud sessions) ship a pre-built
// Chromium whose revision does not match the one @playwright/test expects.
// When PW_CHROMIUM_EXECUTABLE is set, use that browser instead of the
// revision Playwright would otherwise look for. Unset everywhere else, so
// CI and local runs keep using `npx playwright install` as before.
const chromiumExecutable = process.env.PW_CHROMIUM_EXECUTABLE;
const chromiumLaunch = chromiumExecutable
  ? { launchOptions: { executablePath: chromiumExecutable } }
  : {};

export default defineConfig({
  testDir: './e2e',
  /*
    Playwright collects ONLY `.spec.ts`. This is not cosmetic.

    Playwright's default `testMatch` is
    `**` + `/*.@(spec|test).?(c|m)[jt]s?(x)` - which matches `.test.ts` as
    well. `e2e/fixtures/seed-data.test.ts` is a VITEST file, so Playwright
    loaded it, hit `import { describe } from 'vitest'`, and aborted the
    entire run:

        Error: Vitest cannot be imported in a CommonJS module using
        require(). Please use "import" instead.
        at e2e/fixtures/seed-data.test.ts:17

    Not "that file failed" - the whole run, 0 tests collected, which the
    JSON reporter records as `expected: 0, unexpected: 0` and is easy to
    mistake for a pass. `vitest.config.ts` already draws this line from the
    other side (it excludes `.spec.ts` and includes `.test.ts`); this is the
    mirror image, and both halves are needed.

    Noted because CI would not have caught it: `e2e-tests` is skipped
    (docs/99 §5), so a change that breaks the E2E run entirely is currently
    invisible to the pipeline.
  */
  testMatch: '**/*.spec.ts',
  /*
    The suite assumes the database already lists published campaigns, and
    seeds nothing itself. Since docs/79 moved every campaign to
    `under_review`, that assumption is false even in production — which is
    why a first real run of this suite failed 29 times on locators that
    matched nothing. `globalSetup` supplies the state; `globalTeardown`
    removes exactly the rows it added. See docs/99.
  */
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  /*
    Chromium projects by default; Firefox and WebKit behind an opt-in flag.

    The config used to declare all four unconditionally, and nothing in this
    repository installs the browsers two of them need: CI runs
    `npx playwright install --with-deps chromium` and pins its matrix to
    `['Desktop Chrome', 'Mobile Chrome']`, and the sandbox has chromium
    alone. So a plain `npm run test:e2e` collected 292 tests and about 146
    of them - every Desktop Firefox and Mobile Safari leg - could only fail
    with

        browserType.launch: Executable doesn't exist at .../firefox-.../firefox

    which is not a result about this product. It is also how
    `e2e-08-mobile-donate.spec.ts` came to fail for a reason that had nothing
    to do with its subject: `devices['iPhone 14']` carries
    `defaultBrowserType: 'webkit'`, so it was launching a browser that is not
    there.

    Deleting those two projects outright would have been the tidier diff and
    the wrong call: iOS Safari is a large share of a donation site's traffic,
    and a WebKit gap that is written down can be closed, while one that was
    quietly deleted cannot. So they remain, one env var away:

        npx playwright install firefox webkit
        PW_ALL_BROWSERS=1 npm run test:e2e

    ⛔ That gap is real and currently uncovered. `docs/99` §5 carries it.
  */
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'], ...chromiumLaunch } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'], ...chromiumLaunch } },
    ...(process.env.PW_ALL_BROWSERS
      ? [
          { name: 'Desktop Firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'Mobile Safari', use: { ...devices['iPhone 14'] } },
        ]
      : []),
  ],
  /*
    E2E runs against a PRODUCTION build, not `next dev`.

    `docs/97` §8 deferred this on the grounds that changing what a never-run
    suite runs against leaves no baseline to compare. There is a baseline
    now, and it says the change is needed: of 15 remaining failures, SEVEN
    were `Test timeout` with nothing wrong at the locator. `next dev`
    compiles a route on its first visit, so the first test to touch
    `/campaigns/[slug]/donate` pays several seconds of compile inside its
    own 30s budget - and `toHaveURL` waits only 5s, which is how
    `e2e-02` failed with the URL still on the page it had just left.

    Two further reasons it is the right target regardless of speed:

    - `docs/63` found that our CSP blocks `unsafe-eval`, so NO client
      component hydrates in `next dev`; `docs/64` had to add `unsafe-eval`
      and `ws://localhost` to the DEV CSP to make React work at all. So a
      dev-server E2E run exercises a CSP that production never serves. A
      suite whose job is to catch what users hit should run what users get.
    - A production build is what `scripts/deploy.ps1` ships.

    `timeout` is raised because a build is minutes, not the 60s default;
    `reuseExistingServer` stays off in CI so a stale process cannot be
    mistaken for a ready server. That mistake cost 35 minutes of this
    session: an orphaned `next-server` held port 3000 without serving, and
    Playwright waited on it forever (docs/99 §3.3).

    ── Why the command seeds before it builds ───────────────────────────────

    `npm run e2e:seed` is not redundant with `globalSetup`. `next build`
    PRE-RENDERS every route that sets `revalidate`, and `/donate` is one:
    its guard hides the donation form unless the general fund row is
    donatable (docs/42). Building against an empty database therefore bakes
    "The general fund is not accepting donations right now" into the static
    page, and eleven tests then waited for a form the build had decided not
    to emit. Seeding afterwards cannot undo a prerender.

    This also removes a dependency on an ordering I had asserted without
    evidence. I claimed globalSetup runs before webServer, "verified from
    run output" - it was not: the seed line was on stderr and the build's
    output on stdout, which I had redirected away. Two streams say nothing
    about each other's ordering. Now the data exists before the build
    whichever order Playwright chooses.

    ── If the run dies at exactly `timeout` with 0 tests, read the env ──────

    `timeout` is 300s and a cold build measures ~131s, so a timeout here is
    almost never slowness. Playwright polls `url` until it gets a
    non-5xx; a server that STARTS and then answers 500 to everything looks
    identical to a server that never started, and the only thing reported is

        Timed out waiting 300000ms from config.webServer

    with `expected: 0, unexpected: 0` in the JSON - which reads like a pass.

    That happened here, and the cause was one missing environment variable:
    `PASSWORD_PEPPER`. `src/instrumentation.ts` validates secrets on boot and
    THROWS on a missing required one in a production build, so every route
    500s. Note that `docs/99` §6 said this validator "only throws in
    production, so the app still serves in dev" - true, and irrelevant now
    that E2E runs a production build, which is exactly what it means to run
    what users get.

    So: on a webServer timeout, read the server's own output before touching
    this number. `docs/99` §6 lists every variable the suite needs.
  */
  webServer: {
    command: 'npm run e2e:seed && npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
