/**
 * E2E-07: Organiser posts a campaign update → it appears on the campaign timeline
 * Priority: P1
 *
 * ## What this used to be
 *
 *     const campaignLink = page.getByRole('link', { name: /donate|view|learn more/i }).first();
 *     if (await campaignLink.isVisible()) {
 *       await campaignLink.click();
 *       await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
 *     }
 *
 * Three separate reasons that was worth nothing, in a file whose name is
 * about campaign updates:
 *
 * 1. `/donate|view|learn more/` matched the NAVBAR's "Donate" link first, so
 *    the click went to `/donate`, not to a campaign. Same trap `e2e-15`
 *    documents.
 * 2. The only assertion was "the page has an `h1`", which is true of every
 *    page on the site - including the one it accidentally landed on.
 * 3. The whole body sat inside `if (await ...isVisible())`, which does not
 *    wait, so on any slow render the test passed having done nothing.
 *
 * It never mentioned an update at all.
 *
 * ## Why it could not have been fixed by locators alone
 *
 * `CampaignActivity` renders `<CampaignUpdates>` only when the campaign has
 * at least one update, and the seed fixture seeded none - so there was no
 * updates section anywhere to assert. The fixture now seeds one organiser
 * update against the medical-appeal campaign, through `insertCampaignUpdate`
 * so `update_count` stays honest (docs/89). See `docs/99`.
 */
import { test, expect } from '@playwright/test';
import { E2E_FIXTURE_IDS } from './fixtures/seed-data';

/** The fixture campaign that carries the seeded update. */
const CAMPAIGN_SLUG = `${E2E_FIXTURE_IDS.slugPrefix}medical-appeal`;

test.describe('E2E-07: Campaign Updates', () => {
  test('a campaign with an update shows it on the timeline', async ({ page }) => {
    await page.goto(`/campaigns/${CAMPAIGN_SLUG}`);

    const updates = page.getByRole('heading', { name: /campaign updates/i });
    await expect(updates).toBeVisible();

    // The update's own text, not just the section heading: a heading with an
    // empty list under it is the failure this is meant to catch.
    await expect(page.getByText(/fixture update: the first week/i)).toBeVisible();
  });

  test('a campaign with no updates does not show an empty timeline', async ({ page }) => {
    /*
      The other half of the contract, and the reason the section is
      conditional: a brand-new campaign should not display a "Campaign
      Updates" heading over nothing. The fixture's newly-published row has no
      updates, which makes this assertable rather than hypothetical.
    */
    await page.goto(`/campaigns/${E2E_FIXTURE_IDS.slugPrefix}newly-published`);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /campaign updates/i })).toHaveCount(0);
  });
});
