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
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
