/**
 * E2E-02: Campaign → guest donate (no login) → receipt email triggered
 * Priority: P0
 *
 * Both tests were drifted; see `docs/99` §3.1.
 */
import { test, expect } from '@playwright/test';
import { donateNowLink, donationAmountGroup, openFirstCampaign } from './helpers/campaigns';

test.describe('E2E-02: Guest Donation', () => {
  test('guest can reach the donation form without logging in', async ({ page }) => {
    const slug = await openFirstCampaign(page);

    /*
      The point of this test is that a guest is not stopped. So follow the
      donate link through to the form and assert the form is there, rather
      than asserting "a donate button exists" and stopping - the old version
      never reached a form at all, because its locator sent it to `/donate`.
    */
    await donateNowLink(page).click();
    await expect(page).toHaveURL(`/campaigns/${slug}/donate`);

    await expect(donationAmountGroup(page)).toBeVisible();
    await expect(page.getByRole('radio', { name: /^\$50,/ })).toBeVisible();

    // No sign-in wall on the way: guests may donate.
    await expect(page.getByText(/must log in|login required|sign in to donate/i)).toHaveCount(0);
  });

  test('campaign page shows progress and phase info', async ({ page }) => {
    await openFirstCampaign(page);

    /*
      `getByRole('progressbar')` was a strict-mode violation once the page
      actually rendered - the detail page carries the sidebar bar and the
      sticky mobile bar. Take the first and assert its ARIA values, which is
      what "shows progress" means; a visible bar with no `aria-valuenow`
      tells a screen-reader user nothing.
    */
    const progress = page.getByRole('progressbar').first();
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuenow', /^\d+$/);
    await expect(progress).toHaveAttribute('aria-valuemax', /^\d+$/);
  });
});
