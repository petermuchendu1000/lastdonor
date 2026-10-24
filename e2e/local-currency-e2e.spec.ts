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
    await expect(page.getByText(EXPECT_UGX, { exact: false })).toBeVisible();
    // Marked approximate and dated, which is the component's promise.
    await expect(page.getByText(APPROX_MARKER)).toBeVisible();
  });

  test('the figure carries the required provider attribution', async ({ page }) => {
    await page.goto(CAMPAIGN);
    await expect(page.getByText(EXPECT_UGX, { exact: false })).toBeVisible();
    const link = page.getByRole('link', { name: /ExchangeRate-API/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://www.exchangerate-api.com');
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
