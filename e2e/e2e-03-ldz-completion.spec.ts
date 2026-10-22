/**
 * E2E-03: Last Donor Zone campaigns are browsable and donatable
 * Priority: P0
 *
 * ## What this test used to be
 *
 *     const ldzBadge = page.locator('text=Last Donor Zone').first();
 *     if (await ldzBadge.isVisible()) {
 *       await expect(ldzBadge).toBeVisible();
 *     }
 *
 * A tautology inside a guard that could not hold: assert a thing is visible,
 * but only if it is already visible. It passed on every run and tested
 * nothing, and `isVisible()` does not even wait, so the body was almost
 * certainly never entered.
 *
 * ## And the badge does not exist on any public page
 *
 * Probed against a production build with an LDZ campaign seeded and
 * verifiably listed, 2026-10-22: the string "Last Donor Zone" appears
 * **zero** times on `/campaigns` and zero times on the LDZ campaign's own
 * detail page. Both components that render that label -
 * `CampaignStatusBadge` and `PhaseBadge` - are imported only by admin and
 * dashboard screens. The only "Last Donor" text a visitor sees is the brand
 * and the Last Donor Wall nav link.
 *
 * So the original spec described a feature that has never shipped. Whether a
 * visitor SHOULD see the phase on a public card is a product decision, not a
 * defect, so nothing was invented here to make the old assertion pass; it is
 * recorded as an open question in `docs/99` §5 instead.
 *
 * ## What is asserted now
 *
 * The invariant that genuinely holds and genuinely matters: `last_donor_zone`
 * is a FULLY ACTIVE status. `browse-params.ts` counts it in `ACTIVE_STATUSES`,
 * `/campaigns` lists it, and the detail page's `isDonatable` includes it. If
 * anyone narrowed one of those lists to `'active'` alone - an easy and
 * plausible edit - every campaign in the phase this product is named after
 * would silently vanish from the listing and stop taking money, with no error
 * anywhere. That is worth a P0.
 */
import { test, expect } from '@playwright/test';
import { E2E_FIXTURE_IDS } from './fixtures/seed-data';

/** The fixture's `last_donor_zone` campaign (`seed-data.ts`, 95% funded). */
const LDZ_SLUG = `${E2E_FIXTURE_IDS.slugPrefix}veteran-housing`;

test.describe('E2E-03: Last Donor Zone Completion', () => {
  test('a last-donor-zone campaign is listed alongside active ones', async ({ page }) => {
    await page.goto('/campaigns');

    const ldzCard = page.locator(`article:has(a[href="/campaigns/${LDZ_SLUG}"])`);
    await expect(ldzCard).toBeVisible();

    // Listed, not merely present in the payload: the link has to be clickable.
    await expect(ldzCard.locator(`a[href="/campaigns/${LDZ_SLUG}"]`).first()).toBeVisible();
  });

  test('a last-donor-zone campaign can still be donated to', async ({ page }) => {
    await page.goto(`/campaigns/${LDZ_SLUG}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    /*
      The detail page's own donate route must resolve. A campaign in this
      phase that 404s on `/donate` is the failure mode this guards: it is 95%
      funded, so it is the single most valuable campaign on the site to keep
      payable.
    */
    const donate = page.getByRole('link', { name: /^donate now$/i }).first();
    await expect(donate).toBeVisible();
    await expect(donate).toHaveAttribute('href', `/campaigns/${LDZ_SLUG}/donate`);

    await donate.click();
    await expect(page).toHaveURL(`/campaigns/${LDZ_SLUG}/donate`);
    await expect(page.getByRole('radiogroup', { name: /donation amount/i })).toBeVisible();
  });

  test('last donor wall page loads', async ({ page }) => {
    await page.goto('/last-donor-wall');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveURL('/last-donor-wall');
  });
});
