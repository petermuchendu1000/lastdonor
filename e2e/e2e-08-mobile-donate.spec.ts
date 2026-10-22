/**
 * E2E-08: Mobile viewport (iPhone 14) → homepage → campaign → sticky donate bar → donate
 * Priority: P0
 */
import { test, expect, devices } from '@playwright/test';
import { donateNowLink, openFirstCampaign } from './helpers/campaigns';

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

    /*
      "Collapsed" is the actual claim, so assert it both ways.

      My first pass at this copied e2e-01's fix - assert the nav named "Main
      navigation" - and that was wrong HERE: that nav is
      `hidden ... md:flex`, so on a phone it does not exist in the
      accessibility tree at all. Asserting it visible on a mobile viewport
      tested the opposite of what the test is named for.

      On mobile the primary nav is the hamburger, `aria-label="Open menu"`.
      So: the hamburger IS there and the desktop nav is NOT.
    */
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('mobile campaign page shows sticky donate bar', async ({ page }) => {
    await openFirstCampaign(page);

    // Scroll down to trigger the sticky bar.
    await page.evaluate(() => window.scrollTo(0, 500));

    /*
      Was `getByRole('button', { name: /donate/i })`, which finds nothing:
      the campaign page's donate affordance is a LINK, not a button - the
      same drift e2e-01 had. Assert the link and that it points at this
      campaign's donate page, which is what a donate bar is FOR.
    */
    const stickyDonate = donateNowLink(page);
    await expect(stickyDonate).toBeVisible();
    await expect(stickyDonate).toHaveAttribute('href', /\/campaigns\/[^/]+\/donate$/);
  });

  test('mobile footer renders properly', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('footer')).toBeVisible();
  });
});
