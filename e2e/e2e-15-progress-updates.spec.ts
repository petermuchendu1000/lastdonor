/**
 * E2E-15: Campaign → donate → progress bar updates (poll or Realtime)
 * Priority: P1
 */
import { test, expect } from '@playwright/test';
import { openFirstCampaign } from './helpers/campaigns';

test.describe('E2E-15: Progress Bar Updates', () => {
  test('campaign page shows progress bar with correct ARIA', async ({ page }) => {
    /*
      Was: goto('/campaigns'), then
      `getByRole('link', { name: /donate|view|learn more/i }).first()` wrapped
      in `if (await link.isVisible())`. That locator matches the NAVBAR's
      "Donate" and nothing else, so this test used to assert against
      `/donate`; and while the fixture was broken the `if` made it pass
      without asserting anything at all. See docs/99 §3.1.
    */
    await openFirstCampaign(page);

    // The detail page carries a sidebar bar and a sticky mobile bar.
    const progressBar = page.getByRole('progressbar').first();
    await expect(progressBar).toBeVisible();

    /*
      `expect(x).toBeDefined()` passed on `null`, which is what
      `getAttribute` returns for a missing attribute - so the original ARIA
      checks could not fail. Assert the values are actually numbers, and
      that `valuenow` sits inside the declared range, which is the thing a
      screen reader reads out.
    */
    await expect(progressBar).toHaveAttribute('aria-valuenow', /^\d+$/);
    await expect(progressBar).toHaveAttribute('aria-valuemin', /^\d+$/);
    await expect(progressBar).toHaveAttribute('aria-valuemax', /^\d+$/);

    const [now, min, max] = await Promise.all([
      progressBar.getAttribute('aria-valuenow'),
      progressBar.getAttribute('aria-valuemin'),
      progressBar.getAttribute('aria-valuemax'),
    ]);
    expect(Number(min)).toBeLessThanOrEqual(Number(now));
    expect(Number(now)).toBeLessThanOrEqual(Number(max));
  });
});
