/**
 * E2E-11: Campaign page → check OG meta tags present in HTML
 * Priority: P2
 *
 * All three tests were weaker than they looked (`docs/99`):
 *
 * - The campaign test used `/donate|view|learn more/`, which matches the
 *   NAVBAR's Donate link first, so it read OG tags off `/donate` and called
 *   them "campaign-specific". It then nested the work inside
 *   `if (await ...isVisible())` AND `if (href)`, either of which passing
 *   silently skipped everything.
 * - `expect(ogTitle).toBeTruthy()` cannot tell a campaign's title from the
 *   site default, which is the only thing a sharing test is for: a campaign
 *   shared to Facebook showing "LastDonor - Reviewed Crowdfunding" instead of
 *   the appeal's own title is the bug.
 * - "canonical may or may not exist, just verify it's present if used" is not
 *   an assertion. `layout.tsx` sets `alternates.canonical`, and a probe
 *   against a production build confirms `<link rel="canonical">` is emitted,
 *   so it is required and asserted.
 */
import { test, expect } from '@playwright/test';
import { E2E_FIXTURE_IDS } from './fixtures/seed-data';

const CAMPAIGN_SLUG = `${E2E_FIXTURE_IDS.slugPrefix}medical-appeal`;
const CAMPAIGN_TITLE = 'E2E Fixture: Medical Appeal';

test.describe('E2E-11: OG Meta Tags', () => {
  test('homepage has required OG meta tags', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      /\S/,
    );
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
      'content',
      /\S/,
    );
    // An OG card with no image is the one that renders as a bare grey box.
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /\S/,
    );
  });

  test('a campaign page carries its OWN title in the OG tags', async ({ page }) => {
    await page.goto(`/campaigns/${CAMPAIGN_SLUG}`);

    /*
      The campaign's title, not merely a non-empty string. This is the whole
      point of per-page metadata: `generateMetadata` on the campaign route has
      to win over the root layout's default, and "truthy" could never tell
      the difference.
    */
    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveAttribute('content', new RegExp(CAMPAIGN_TITLE, 'i'));

    // And the canonical must point at this campaign, or every share dilutes
    // into the homepage's ranking.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`/campaigns/${CAMPAIGN_SLUG}$`),
    );
  });

  test('the homepage has a canonical URL', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /^https:\/\/lastdonor\.org/,
    );
  });
});
