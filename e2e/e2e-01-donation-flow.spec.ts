/**
 * E2E-01: Homepage → campaigns → campaign → read story → donate
 * Priority: P0
 *
 * Both tests here were drifted; see `docs/99` §3.1.
 */
import { test, expect } from '@playwright/test';
import { donateNowLink, openFirstCampaign } from './helpers/campaigns';
import { assertPrimaryNav, goToCampaignsFromHomepage } from './helpers/nav';

test.describe('E2E-01: Donation Flow', () => {
  test('navigates from homepage to campaign and initiates donation', async ({ page }) => {
    await page.goto('/');

    /*
      Was `getByRole('link', { name: /campaigns/i }).first()`. The navbar's
      first campaigns-ish link is "Search" (href `/campaigns`), whose name
      does not match, so `.first()` picked whatever did - and on the way in
      the suite then clicked the navbar's "Donate" and ended up on
      `/donate`. Navigate by the nav link's real accessible name.

      Then it addressed the desktop nav directly, which was a SECOND bug
      hidden by the first: that nav is `hidden md:flex`, so at 412px it is
      not in the accessibility tree and this click waited out the whole 30s
      test budget. It only passed because the Mobile Chrome project was not
      running. The helper takes the hamburger route below `md`. See
      `docs/99` §8.
    */
    await goToCampaignsFromHomepage(page);

    // Scoped to the card, not to any link whose text happens to say "donate".
    const slug = await openFirstCampaign(page);
    expect(slug).not.toHaveLength(0);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    /*
      Was `getByRole('button', { name: /donate/i })`. A campaign detail page
      has NO button matching that - the donate affordance is a LINK,
      "Donate now", pointing at `/campaigns/<slug>/donate`. Asserting the
      link and that it points at this campaign's donate page is both
      accurate and stronger than "some donate-ish control is visible".
    */
    const donate = donateNowLink(page);
    await expect(donate).toBeVisible();
    await expect(donate).toHaveAttribute('href', `/campaigns/${slug}/donate`);
  });

  test('homepage renders its nav, h1 and footer', async ({ page }) => {
    await page.goto('/');

    /*
      Renamed. It claimed "hero, trust bar, and impact counter" and asserted
      none of them - it checked an h1, a nav and a footer. The name now says
      what it does; inventing assertions for three sections I had not
      measured would have been worse than a narrow test.

      `locator('nav')` was also a strict-mode violation: the page has two
      navs, "Main navigation" and the footer's "LastDonor on social media"
      (docs/91). Naming the one meant is stricter, not looser.

      But naming the DESKTOP one unconditionally was wrong on a phone, where
      it is `display: none` and so absent from the accessibility tree. The
      helper asserts the nav that belongs to this viewport AND that the other
      one is absent, so it is stricter than the original on both legs rather
      than a "whichever exists" fallback.
    */
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await assertPrimaryNav(page);
    await expect(page.locator('footer')).toBeVisible();
  });
});
