/**
 * E2E-14: Donor profile → Last Donor Wall → completed campaign with donor info
 * Priority: P2
 *
 * The second test was wrapped in `if (await ldwLink.isVisible())`, which does
 * not wait - so if the footer had not painted yet, the test passed without
 * clicking anything. Probed against a production build: there is exactly one
 * `href="/last-donor-wall"` on the homepage, so the link's presence is a fact
 * to assert, not a condition to check. See `docs/99`.
 */
import { test, expect } from '@playwright/test';

test.describe('E2E-14: Last Donor Wall', () => {
  test('last donor wall page loads and has heading', async ({ page }) => {
    await page.goto('/last-donor-wall');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('last donor wall is reachable from the homepage', async ({ page }) => {
    await page.goto('/');

    const ldwLink = page.getByRole('link', { name: /last donor wall/i }).first();
    /*
      Scrolled into view first. The link lives in the footer, and `.click()`
      would scroll anyway - doing it explicitly means a failure here reports
      "not visible" about the link rather than a click timeout.
    */
    await ldwLink.scrollIntoViewIfNeeded();
    await expect(ldwLink).toBeVisible();

    await ldwLink.click();
    await expect(page).toHaveURL('/last-donor-wall');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
