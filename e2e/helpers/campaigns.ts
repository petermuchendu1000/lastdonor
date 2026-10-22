import { expect, type Page } from '@playwright/test';

/**
 * Shared navigation helpers for the campaign flows.
 *
 * ## Why these exist
 *
 * Five specs independently wrote this to open the first campaign:
 *
 * ```ts
 * page.getByRole('link', { name: /donate|view|learn more/i }).first()
 * ```
 *
 * On `/campaigns` exactly ONE link matches that name, and it is the
 * **navbar's "Donate"**, pointing at `/donate`. The campaign cards carry no
 * link named "Donate", "View" or "Learn more" at all - their link text is the
 * card's concatenated content ("veteransDallas, TexasE2E Fixture: Vetera…").
 * So every one of those specs navigated to the general-fund page and then
 * asserted against it, which is why they failed on `/donate` rather than on
 * anything to do with campaigns (docs/99 §3.1).
 *
 * The locator was matching site chrome, not content. Scoping to the card is
 * both correct and *stricter*: `article` is the card element, so an `<a>`
 * inside one cannot be a navbar or footer link.
 *
 * Centralised rather than copy-pasted a sixth time, because the drift
 * happened once and then spread.
 */

/** The card elements on `/campaigns`; one `<article>` per campaign. */
export function campaignCards(page: Page) {
  return page.locator('article');
}

/**
 * Open the first campaign on `/campaigns` and land on its detail page.
 *
 * Navigates to `/campaigns` itself, so a caller does not have to remember to.
 * Returns the slug, which is the part worth asserting on afterwards.
 */
export async function openFirstCampaign(page: Page): Promise<string> {
  await page.goto('/campaigns');

  const cardLink = campaignCards(page).first().locator('a[href^="/campaigns/"]').first();
  /*
    Assert the card exists rather than silently skipping. Five specs used
    `if (await link.isVisible())` and, while the fixture was broken, that
    guard made ten tests pass without asserting anything (docs/99 §3.2). A
    missing card is a failure, not a reason to do nothing.
  */
  await expect(
    cardLink,
    'no campaign card on /campaigns - the E2E fixture should have seeded three published campaigns',
  ).toBeVisible();

  const href = await cardLink.getAttribute('href');
  await cardLink.click();
  await expect(page).toHaveURL(/\/campaigns\/[^/]+$/);

  return (href ?? '').replace('/campaigns/', '');
}

/**
 * The donate entry point ON a campaign detail page.
 *
 * It is a LINK ("Donate now") to `/campaigns/<slug>/donate`, not a button -
 * the detail page has no `<button>` whose name matches /donate/i at all,
 * which is what `e2e-01` was waiting for.
 */
export function donateNowLink(page: Page) {
  return page.getByRole('link', { name: /^donate now$/i });
}

/**
 * The donation form's stable anchor, on `/donate` and on
 * `/campaigns/<slug>/donate` alike.
 *
 * Named-role rather than text: "Make a Donation" is an `<h3>` that exists
 * only on the general-fund page, so three specs asserted it on campaign
 * pages where it has never been.
 */
export function donationAmountGroup(page: Page) {
  return page.getByRole('radiogroup', { name: /donation amount/i });
}
