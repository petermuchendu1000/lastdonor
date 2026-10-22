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
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'], ...chromiumLaunch } },
    { name: 'Desktop Firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 14'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 7'], ...chromiumLaunch } },
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
  */
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
