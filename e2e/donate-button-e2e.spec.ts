/**
 * E2E: Donate Button End-to-End Flow
 * Tests the donation form UI on the /donate page (General Fund).
 *
 *  1. Select a preset amount / enter custom amount
 *  2. Fill donor details (name, email, location, message)
 *  3. Toggle anonymous / recurring options
 *  4. Submit → verify transition to payment step or error toasts
 *  5. Validate form validation (empty fields, min amount)
 *  6. Campaign detail page donation form
 */
import { test, expect, type Page } from '@playwright/test';
import { donationAmountGroup, openFirstCampaign } from './helpers/campaigns';

/*
  This file was written against an older donate form and never ran (docs/50),
  so it had drifted wholesale. What the form actually has, probed 2026-10-22
  against a production build:

    - radiogroup "Donation frequency": "Give Once" / "Monthly"
    - radiogroup "Donation amount": $1,000 / $500 / $250 / $100 / $50 / $25
    - spinbutton "Custom amount"
    - textbox "Email address"   <- and NO name field, and NO location field
    - a disclosure, "Add a message or dedicate your gift", which hides the
      message textarea, its 0/500 counter AND the "Donate anonymously" switch
    - a submit button that reads "Select an amount to donate" and is disabled
      until an amount is chosen, then becomes "Donate $50.00"

  Validation copy, also probed: a sub-minimum amount shows "Minimum donation
  is $5.00"; submitting with an empty email shows "Enter a valid email".
*/

// Navigate to the /donate page and wait for the form
async function goToDonate(page: Page) {
  await page.goto('/donate');
  await expect(page.getByText('Make a Donation')).toBeVisible({ timeout: 15_000 });
}

// Mock the create-intent API to return a fake clientSecret
async function mockCreateIntent(page: Page) {
  await page.route('**/api/v1/donations/create-intent', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          clientSecret: 'pi_test_secret_mock',
          paymentIntentId: 'pi_test_123',
          amount: 5000,
          campaignTitle: 'General Fund',
        },
      }),
    });
  });
}

test.describe('Donate Button E2E', () => {
  test('preset amount selection updates the submit button label', async ({ page }) => {
    await goToDonate(page);

    // Click the $50 preset
    const fiftyButton = page.getByRole('radio', { name: /^\$50,/ });
    await fiftyButton.click();
    await expect(fiftyButton).toHaveAttribute('aria-checked', 'true');

    // Submit button should show the amount
    await expect(page.getByRole('button', { name: /\$50\.00/ })).toBeVisible();

    // Switch to $25
    const twentyFiveButton = page.getByRole('radio', { name: /^\$25,/ });
    await twentyFiveButton.click();
    await expect(twentyFiveButton).toHaveAttribute('aria-checked', 'true');
    await expect(fiftyButton).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('button', { name: /\$25\.00/ })).toBeVisible();
  });

  test('custom amount input works and clears preset selection', async ({ page }) => {
    await goToDonate(page);

    // First select a preset
    await page.getByRole('radio', { name: /^\$100,/ }).click();
    await expect(page.getByRole('button', { name: /\$100\.00/ })).toBeVisible();

    // Now type a custom amount - should deselect preset
    const customInput = page.getByLabel(/custom amount/i);
    await customInput.fill('75');

    await expect(page.getByRole('button', { name: /\$75\.00/ })).toBeVisible();
    // Preset should be deselected
    await expect(page.getByRole('radio', { name: /^\$100,/ })).toHaveAttribute('aria-checked', 'false');
  });

  test('form validation shows errors for empty required fields', async ({ page }) => {
    await goToDonate(page);

    // Select amount so submit is enabled
    await page.getByRole('radio', { name: /^\$25,/ }).click();

    // Submit with the email empty.
    await page.getByRole('button', { name: /^Donate \$25\.00$/ }).click();

    /*
      Was also asserting /name is required/. There is no name field on this
      form, so that error can never appear - the email is the only required
      text input, and "Enter a valid email" is the actual copy.
    */
    await expect(page.getByText(/enter a valid email/i).first()).toBeVisible();
  });

  test('submit button is disabled when amount is below $5', async ({ page }) => {
    await goToDonate(page);

    /*
      The submit button is not labelled "Donate" when nothing is chosen - it
      reads "Select an amount to donate", which is why `/^Donate$/i` matched
      nothing and the assertion failed on a missing element rather than on
      the disabled state it was checking.
    */
    const submit = page.getByRole('button', { name: /donate|select an amount/i }).first();
    await expect(submit).toHaveText(/select an amount to donate/i);
    await expect(submit).toBeDisabled();

    // Below the minimum: still disabled, and the reason is stated.
    const customInput = page.getByRole('spinbutton', { name: /custom amount/i });
    await customInput.fill('3');
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/minimum donation is \$5\.00/i)).toBeVisible();

    // At the minimum: enabled, and the button names the amount.
    await customInput.fill('5');
    await expect(page.getByRole('button', { name: /^Donate \$5\.00$/ })).toBeEnabled();
  });

  /*
    ── The three tests below exercise the CARD rail, which is unavailable ──

    Probed 2026-10-22 against a production build: submitting a valid form
    ($50 + a good email) does NOT call `create-intent` at all. The request
    never fires - a route interceptor recorded `null` - and the form instead
    shows

        "Card payments are unavailable right now. This is a problem on our
         side, not with your card."

    That is correct behaviour, not a bug. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
    is empty (docs/72 records it empty in production too), so the form refuses
    to present a payment step it cannot complete - the same principle as
    docs/42's "do not show a payment form that cannot complete".

    So these cannot be fixed by correcting locators: there is no card flow to
    drive. They are skipped with the reason attached rather than rewritten,
    because rewriting them to assert the unavailable-notice would quietly
    change what they test and leave the suite claiming card coverage it does
    not have. One test below DOES pin the unavailable notice, deliberately
    and under its own name.

    To enable: set a real `pk_test_...` publishable key in the E2E env. The
    assertions also need updating - `Complete Payment` appears nowhere in
    `src/`, so that one was asserting text the product has never had.
  */
  const CARD_RAIL_UNAVAILABLE =
    'card rail unavailable: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is empty, so the ' +
    'form never calls create-intent (docs/72, docs/99 §3.4)';

  test('the form says so when the card rail is unavailable', async ({ page }) => {
    /*
      The behaviour that IS reachable, and worth pinning: a donor who
      submits a valid form on a deployment with no publishable key is told
      plainly, rather than being dropped into a payment step that cannot
      finish. This encodes docs/42's decision.
    */
    await goToDonate(page);

    await page.getByRole('radio', { name: /^\$50,/ }).click();
    await page.getByRole('textbox', { name: /email address/i }).first().fill('e2e@example.invalid');
    await page.getByRole('button', { name: /^Donate \$50\.00$/ }).click();

    await expect(
      page.getByText(/card payments are unavailable right now/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test.skip('full donation flow transitions to payment step', async ({ page }) => {
    test.info().annotations.push({ type: 'skip', description: CARD_RAIL_UNAVAILABLE });
    await mockCreateIntent(page);
    await goToDonate(page);

    // 1. Select $50 preset
    await page.getByRole('radio', { name: /^\$50,/ }).click();

    // 2. Fill donor details
    await page.getByLabel(/your name/i).fill('Jane Doe');
    await page.getByLabel(/email address/i).fill('jane@example.com');
    await page.getByLabel(/location/i).fill('Austin, TX');
    await page.getByLabel(/message/i).fill('Wishing you the best!');

    // 3. Submit - should transition to payment step
    await page.getByRole('button', { name: /Donate/i }).click();

    // 4. Payment step should appear (even with mocked API, Stripe Elements will try to load)
    await expect(page.getByText('Complete Payment')).toBeVisible({ timeout: 10_000 });
  });

  test('anonymous and recurring toggles work', async ({ page }) => {
    await goToDonate(page);

    /*
      "Donate anonymously" lives INSIDE the "Add a message or dedicate your
      gift" disclosure, so it does not exist until that is opened - which is
      why this test used to hang on a hidden control rather than fail.

      Recurring is not a switch at all: it is the "Donation frequency"
      radiogroup, "Give Once" / "Monthly".
    */
    await page.getByRole('button', { name: /add a message or dedicate/i }).click();

    const anonymous = page.getByLabel(/donate anonymously/i);
    await expect(anonymous).toBeVisible();
    await anonymous.click();
    await expect(anonymous).toBeChecked();

    const monthly = page.getByRole('radio', { name: /^monthly$/i });
    await monthly.click();
    await expect(monthly).toBeChecked();
    await expect(page.getByRole('radio', { name: /^give once$/i })).not.toBeChecked();

    // And back again.
    await anonymous.click();
    await expect(anonymous).not.toBeChecked();
  });

  test.skip('API error shows error toast', async ({ page }) => {
    test.info().annotations.push({ type: 'skip', description: CARD_RAIL_UNAVAILABLE });
    // Mock API to return error
    await page.route('**/api/v1/donations/create-intent', (route) => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Campaign not accepting donations' },
        }),
      });
    });

    await goToDonate(page);

    await page.getByRole('radio', { name: /^\$50,/ }).click();
    await page.getByLabel(/your name/i).fill('Test User');
    await page.getByLabel(/email address/i).fill('test@example.com');
    await page.getByRole('button', { name: /Donate/i }).click();

    // Error toast should appear
    await expect(page.getByText(/Campaign not accepting donations/i)).toBeVisible({ timeout: 5000 });
  });

  test.skip('network error shows error toast', async ({ page }) => {
    test.info().annotations.push({ type: 'skip', description: CARD_RAIL_UNAVAILABLE });
    await page.route('**/api/v1/donations/create-intent', (route) => {
      route.abort('connectionrefused');
    });

    await goToDonate(page);

    await page.getByRole('radio', { name: /^\$25,/ }).click();
    await page.getByLabel(/your name/i).fill('Test');
    await page.getByLabel(/email address/i).fill('test@test.com');
    await page.getByRole('button', { name: /Donate/i }).click();

    await expect(page.getByText(/network error/i)).toBeVisible({ timeout: 5000 });
  });

  test('message character counter updates', async ({ page }) => {
    await goToDonate(page);

    /*
      The counter is behind the "Add a message" disclosure, so it is not on
      the page until that is opened. The old version waited for 0/500 on a
      collapsed form.
    */
    await page.getByRole('button', { name: /add a message or dedicate/i }).click();

    await expect(page.getByText('0/500')).toBeVisible();
    await page.getByLabel(/message/i).fill('Hello world');
    await expect(page.getByText('11/500')).toBeVisible();
  });
});

test.describe('Campaign Donate Button', () => {
  test('donation form is reachable from a campaign page', async ({ page }) => {
    /*
      Two drifts here. The `test.skip(!cardVisible, ...)` guard made this
      pass without asserting anything while the fixture was broken, and
      "Make a Donation" is an <h3> on `/donate` only - a campaign DETAIL
      page has no donation form at all now; the form lives at
      `/campaigns/<slug>/donate`, reached by the "Donate now" link.

      So this follows the real route and asserts the real form. The fixture
      seeds campaigns, so a missing card is a failure, not a skip.
    */
    const slug = await openFirstCampaign(page);

    await page.getByRole('link', { name: /^donate now$/i }).click();
    await expect(page).toHaveURL(`/campaigns/${slug}/donate`);

    await expect(donationAmountGroup(page)).toBeVisible();

    // Presets drive the submit label here too.
    await page.getByRole('radio', { name: /^\$50,/ }).click();
    await expect(page.getByRole('button', { name: /^Donate \$50\.00$/ })).toBeVisible();
  });
});
