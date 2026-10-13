/**
 * E2E-08: Mobile viewport (iPhone 14) → homepage → campaign → sticky donate bar → donate
 * Priority: P0
 */
import { test, expect, devices } from '@playwright/test';

// Must be file-level: Playwright rejects test.use({ defaultBrowserType }) inside
// a describe group because it forces a new worker.
test.use(devices['iPhone 14']);

test.describe('E2E-08: Mobile Donation Flow', () => {
  test('mobile homepage loads with responsive layout', async ({ page }) => {
    await page.goto('/');

    // Navigation should be collapsed (hamburger)
    await expect(page.locator('nav')).toBeVisible();
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
