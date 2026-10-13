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
