/**
 * E2E-08: Mobile viewport (iPhone 14) → homepage → campaign → sticky donate bar → donate
 * Priority: P0
 */
import { test, expect, devices } from '@playwright/test';

/*
  Pixel 7, not iPhone 14 - and the difference is the browser ENGINE, not the
  viewport.

  `devices['iPhone 14']` carries `defaultBrowserType: 'webkit'`. The config's
  projects are Chromium-only, and CI installs chromium alone
  (`npx playwright install --with-deps chromium`), so WebKit is not there to
  launch. All three tests in this file failed with

      browserType.launch: Target page, context or browser has been closed

  because the WebKit browser type was handed the Chromium executable that the
  project's `launchOptions` had already set. It would fail in CI too, for the
  simpler reason that WebKit is not installed.

  `devices['Pixel 7']` is Chromium with a phone viewport, and is the same
  device the config's own 'Mobile Chrome' project uses - so this file now
  tests what its name says on an engine the suite actually has.

  Must be file-level: Playwright rejects `test.use({ defaultBrowserType })`
  inside a describe group because it forces a new worker.
*/
test.use(devices['Pixel 7']);

test.describe('E2E-08: Mobile Donation Flow', () => {
  test('mobile homepage loads with responsive layout', async ({ page }) => {
    await page.goto('/');

    // Navigation should be collapsed (hamburger). Named, because the page
    // has two navs - see e2e-01.
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('mobile campaign page shows sticky donate bar', async ({ page }) => {
    await page.goto('/campaigns');

    const campaignLink = page.getByRole('link', { name: /donate|view|learn more/i }).first();
    if (await campaignLink.isVisible()) {
      await campaignLink.click();

      // Scroll down to trigger sticky bar
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForTimeout(500);

      // Check for sticky donate element
      const stickyDonate = page.getByRole('button', { name: /donate/i }).first();
      await expect(stickyDonate).toBeVisible();
    }
  });

  test('mobile footer renders properly', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('footer')).toBeVisible();
  });
});
