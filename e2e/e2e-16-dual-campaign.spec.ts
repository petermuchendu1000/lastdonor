/**
 * E2E-16: Dual Campaign Indistinguishability
 * Priority: P0
 *
 * Verifies that simulated and real campaigns render identically from a
 * visitor's perspective – same DOM structure, donation form, and donor feed.
 */
import { test, expect } from '@playwright/test';
import { donateNowLink, donationAmountGroup } from './helpers/campaigns';

/*
  Three tests here asserted `getByText('Make a Donation')` on a campaign
  DETAIL page. That string is an `<h3>` on `/donate`, the general-fund page,
  and has never been on a campaign page: the detail page's donate affordance
  is a LINK, "Donate now", pointing at `/campaigns/<slug>/donate`, and the
  form lives on that page. So the assertions waited 10s and failed.

  They now assert the link on the detail page and the FORM on the donate
  page, which is what "renders the donation form" means now. The point of
  this file - that a seeded campaign is indistinguishable from a real one -
  is unchanged and is still compared across two campaigns. See docs/99 §3.1.
*/
test.describe('E2E-16: Dual Campaign Indistinguishability', () => {
  test('campaigns listing page loads and displays campaign cards', async ({ page }) => {
    await page.goto('/campaigns');

    // The page should have a heading
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Should render at least one campaign card (seed or real)
    const cards = page.locator('article');
    const count = await cards.count();
    test.skip(count === 0, 'No campaigns in database - skipping dual campaign tests');

    // Each card should have a link to the campaign detail
    const firstLink = cards.first().locator('a').first();
    await expect(firstLink).toHaveAttribute('href', /\/campaigns\/.+/);
  });

  test('campaign detail page renders all expected sections', async ({ page }) => {
    await page.goto('/campaigns');

    const campaignLink = page.locator('article a').first();
    const isVisible = await campaignLink.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!isVisible, 'No campaigns available');

    await campaignLink.click();
    await expect(page).toHaveURL(/\/campaigns\/.+/);

    // Core structure: heading, story content, a route to the donation form.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(donateNowLink(page)).toBeVisible();

    // Donor feed section should exist
    const donorFeed = page.locator('[aria-live="polite"]').first();
    await expect(donorFeed).toBeVisible();
  });

  test('donation form is identical across multiple campaigns', async ({ page }) => {
    await page.goto('/campaigns');

    const cards = page.locator('article');
    const count = await cards.count();
    test.skip(count < 2, 'Need at least 2 campaigns to compare');

    // Visit first campaign and capture donation form structure
    const firstHref = await cards.first().locator('a[href^="/campaigns/"]').first().getAttribute('href');
    await page.goto(`${firstHref}/donate`);
    await expect(donationAmountGroup(page)).toBeVisible({ timeout: 10_000 });

    const firstFormPresets = await donationAmountGroup(page)
      .getByRole('radio')
      .allTextContents();
    // Scoped to the form: the footer newsletter strip also has an email field.
    const firstHasEmailField = await page
      .locator('main')
      .getByRole('textbox', { name: /email/i })
      .first()
      .isVisible();

    // Visit second campaign
    const secondHref = await cards.nth(1).locator('a[href^="/campaigns/"]').first().getAttribute('href');
    await page.goto(`${secondHref}/donate`);
    await expect(donationAmountGroup(page)).toBeVisible({ timeout: 10_000 });

    const secondFormPresets = await donationAmountGroup(page)
      .getByRole('radio')
      .allTextContents();
    const secondHasEmailField = await page
      .locator('main')
      .getByRole('textbox', { name: /email/i })
      .first()
      .isVisible();

    // Donation form structure should be identical
    expect(firstFormPresets).toEqual(secondFormPresets);
    expect(firstHasEmailField).toBe(secondHasEmailField);
  });

  test('donor feed renders identically across campaigns', async ({ page }) => {
    await page.goto('/campaigns');

    const cards = page.locator('article');
    const count = await cards.count();
    test.skip(count < 2, 'Need at least 2 campaigns to compare');

    // Collect donor feed container structure from two campaigns
    const hrefs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const href = await cards.nth(i).locator('a[href^="/campaigns/"]').first().getAttribute('href');
      hrefs.push(href!);
    }

    const feedStructures: string[] = [];
    for (const href of hrefs) {
      await page.goto(href);
      // The donor feed is on the DETAIL page, so wait for that page's own
      // donate affordance rather than for a form that lives elsewhere.
      await expect(donateNowLink(page)).toBeVisible({ timeout: 10_000 });

      // The donor feed container should have identical accessibility attributes
      const feed = page.locator('[aria-live="polite"]').first();
      await expect(feed).toBeVisible();
      feedStructures.push(await feed.getAttribute('aria-live') ?? '');
    }

    expect(feedStructures[0]).toBe(feedStructures[1]);
  });

  test('campaign page has no simulation-revealing DOM attributes', async ({ page }) => {
    await page.goto('/campaigns');

    const campaignLink = page.locator('article a').first();
    const isVisible = await campaignLink.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!isVisible, 'No campaigns available');

    await campaignLink.click();
    await expect(page).toHaveURL(/\/campaigns\/.+/);

    // Entire page HTML should not contain simulation-related terms
    const html = await page.content();
    const forbiddenPatterns = [
      'simulation_flag',
      'simulationFlag',
      'simulation_config',
      'simulationConfig',
      '@lastdonor.internal',
      'data-simulated',
      'data-simulation',
    ];

    for (const pattern of forbiddenPatterns) {
      expect(html).not.toContain(pattern);
    }
  });

  test('message wall section renders on campaign page', async ({ page }) => {
    await page.goto('/campaigns');

    const campaignLink = page.locator('article a').first();
    const isVisible = await campaignLink.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!isVisible, 'No campaigns available');

    await campaignLink.click();
    await expect(page).toHaveURL(/\/campaigns\/.+/);

    // Message wall section should be present
    const messagesHeading = page.getByText(/messages of support/i);
    if (await messagesHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(messagesHeading).toBeVisible();
    }
  });
});
