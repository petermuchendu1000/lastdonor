/**
 * e2e-22 — the visitor's own currency, in a REAL browser at a REAL timezone.
 *
 * docs/103 §12 recorded this as the open gap: "the detection is not verified
 * against a real foreign browser... nobody has loaded the page from Kampala."
 * This closes it. Playwright sets the browser's actual `timezoneId` and
 * `locale`, so `Intl.DateTimeFormat().resolvedOptions().timeZone` and
 * `navigator.languages` return what a device in that place returns.
 *
 * PRECONDITION, and the test fails loudly rather than skipping if it is
 * missing: a rate snapshot must be stored under `fx:usd-rates:v1` BEFORE
 * `next build`, because `campaigns/[slug]` is `revalidate = 60` with
 * `generateStaticParams`, so it is prerendered and a null snapshot gets baked
 * in - the same trap docs/99 recorded for seeding after building.
 *
 * The fixture campaign is USD with a $10,000 goal, and a USD campaign passes
 * `fallbackCurrency={null}`, so the server renders NO approximate figure at
 * all. Everything asserted below therefore arrives from browser-side
 * detection, which is exactly what is under test.
 */

import { test, expect } from '@playwright/test';

const CAMPAIGN = '/campaigns/e2e-fixture-general-fund';

/** Computed from the seeded rates: USD 1, KES 129.84786, UGX 3700, NGN 1600, TZS 2500. */
const GOAL_USD = '$10,000';

/*
  A marker unique to `ApproxMoney`, used instead of matching the word
  "about".

  `getByText('about', { exact: false })` ALSO matches the "About" navigation
  link, which on a phone sits inside the collapsed menu and is therefore not
  visible - so that assertion failed on Mobile Chrome and had been passing on
  Desktop only because `.first()` happened to land on the right node. The
  phrase below is rendered by nothing else on the page.
*/
const APPROX_MARKER = /at the \d{4}-\d{2}-\d{2} rate/;
/*
  The campaign's OWN goal figure.

  Scoped rather than page-wide because the similar-campaigns cards at the
  bottom of this page convert their goals too, so a page-wide locator for the
  approximate marker resolves to several elements.
*/
const GOAL_FIGURE = '[data-fx-figure="campaign-goal"]';
const EXPECT_UGX = 'UGX 37,000,000';
const EXPECT_KES = 'Ksh 1,298,479';
const EXPECT_NGN = 'NGN 16,000,000';
/** What a `maximize()` guess on a region-less `sw` tag would have produced. */
const MAXIMIZE_TELL_TZS = 'TZS 25,000,000';

test.describe('timezone decides, and beats the language tag', () => {
  test.use({ timezoneId: 'Africa/Kampala', locale: 'en-US' });

  test('a visitor in Kampala on an en-US browser sees Ugandan shillings', async ({ page }) => {
    await page.goto(CAMPAIGN);
    // The page itself rendered, so a later absence means absence and not a
    // broken fixture. `toContainText` on the body, not `getByText(...).first()`:
    // the latter picks an arbitrary node when several match.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('body')).toContainText(GOAL_USD);

    // The detection result. The language says America; the timezone says
    // Kampala; the timezone wins.
    await expect(page.locator(GOAL_FIGURE)).toContainText(EXPECT_UGX);
    // Marked approximate and dated, which is the component's promise.
    await expect(page.locator(GOAL_FIGURE).getByText(APPROX_MARKER)).toBeVisible();
  });

  test('the figure carries the required provider attribution', async ({ page }) => {
    await page.goto(CAMPAIGN);
    await expect(page.locator(GOAL_FIGURE)).toContainText(EXPECT_UGX);
    /*
      ONE credit on the page, and it is not inside a card's link.

      This page also lists similar campaigns, whose cards convert their own
      goals - and `CampaignCard` wraps its whole body in a single `<Link>`, so
      a per-card credit was an `<a>` inside an `<a>`. Measured live on v141
      from Nairobi: 8 nested anchors on `/campaigns`, 0 from New York as the
      control, and the card link's accessible name grew 127 -> 211 characters
      ending with the provider's name. The cards now pass `hideAttribution`
      and the credit is rendered once per surface.

      So `toHaveCount(1)` is the assertion, not `.first()`: the count is what
      catches a card reintroducing its own, and `docs/99` §8 records
      `.first()` as how these tests came to pass for the wrong reason.
    */
    const link = page.getByRole('link', { name: /ExchangeRate-API/i });
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://www.exchangerate-api.com');
    // And it must not sit inside another anchor.
    await expect(page.locator('a a[href*="exchangerate-api.com"]')).toHaveCount(0);
  });

  test('⛔ no card renders an anchor inside its own link', async ({ page }) => {
    /*
      The regression this file caught, asserted directly rather than as a
      side effect of a strict-mode violation. `a a` is invalid HTML; here it
      was created by React AFTER mount, so the parser never normalised it and
      the DOM really was nested.
    */
    await page.goto(CAMPAIGN);
    await expect(page.locator(GOAL_FIGURE)).toContainText(EXPECT_UGX);
    await expect(page.locator('a a')).toHaveCount(0);
  });
});

test.describe('a region-less language is NOT a detection', () => {
  // `sw` with no region. `Intl.Locale('sw').maximize().region` is TZ.
  test.use({ timezoneId: 'UTC', locale: 'sw' });

  test('shows NO converted figure, and specifically not the maximize() guess', async ({ page }) => {
    await page.goto(CAMPAIGN);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('body')).toContainText(GOAL_USD);

    /*
      The assertion this whole spec exists for. If `countryFromLanguageTags`
      ever reinstates `maximize()`, a Swahili speaker on a UTC clock gets
      placed in Tanzania and this becomes TZS 25,000,000 - a confident
      figure derived from nothing about the visitor.
    */
    await expect(page.locator('body')).not.toContainText(MAXIMIZE_TELL_TZS);
    // And no approximate figure of any currency - the marker is unique to it.
    await expect(page.getByText(APPROX_MARKER)).toHaveCount(0);
  });
});

test.describe('timezone in the campaign\'s own currency', () => {
  test.use({ timezoneId: 'Africa/Nairobi', locale: 'en-US' });

  test('a visitor in Nairobi sees the USD goal in shillings', async ({ page }) => {
    await page.goto(CAMPAIGN);
    await expect(page.getByText(EXPECT_KES, { exact: false })).toBeVisible();
  });
});

test.describe('explicit language region is the fallback when the zone is unknown', () => {
  // UTC maps to no country, so the en-NG region is what answers.
  test.use({ timezoneId: 'UTC', locale: 'en-NG' });

  test('a visitor whose browser states en-NG sees naira', async ({ page }) => {
    await page.goto(CAMPAIGN);
    await expect(page.getByText(EXPECT_NGN, { exact: false })).toBeVisible();
  });
});
