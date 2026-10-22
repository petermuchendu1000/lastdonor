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

    /*
      Asserts the LINK, not `article:has(...)`, and takes `.first()`.

      The first version of this test was `expect(article:has(a[href=...]))
      .toBeVisible()`, which flaked ONCE in CI - on the Mobile Chrome leg of
      run 8, passing on retry:

          strict mode violation: locator('article:has(a[href="/campaigns/
          e2e-fixture-veteran-housing"])') resolved to 2 elements
            1) <article ...> aka ...filter({ hasText: 'veteransDallas, TexasE2E' })
            2) <article ...> aka locator('article').nth(4)

      So at that moment the page held at least FIVE articles and two of them
      contained a link to this campaign, where the fixture seeds four
      campaigns. ⛔ I could not explain or reproduce it:

      - Six consecutive loads at the same `devices['Pixel 7']` viewport,
        sampled at `domcontentloaded` AND `networkidle`, gave 4 articles and
        exactly 1 match every time.
      - The server-rendered HTML holds exactly 4 `<article>` tags and one
        link per fixture campaign.
      - `CampaignGrid.loadMore` dedupes by id before appending
        (`seen = new Set(prev.map(c => c.id))`), so an extra card for a
        campaign already shown cannot come from "Load More".

      The test now asserts what its name claims - the campaign is listed and
      its link is clickable - which does not depend on how many wrappers the
      listing renders. It is NOT scoped to a single match to hide a defect:
      whether a campaign can appear twice in the listing belongs to
      `e2e-16`, which is about card rendering. See `docs/99` §8.6, which
      keeps the raw error for whoever meets it again.
    */
    const ldzLink = page.locator(`a[href="/campaigns/${LDZ_SLUG}"]`).first();
    await expect(ldzLink).toBeVisible();

    // In a card, not a bare link in some sidebar: the listing renders cards.
    await expect(
      page.locator(`article:has(a[href="/campaigns/${LDZ_SLUG}"])`).first(),
    ).toBeVisible();
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
