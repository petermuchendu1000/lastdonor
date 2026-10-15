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

    // Try to submit without filling name/email
    await page.getByRole('button', { name: /Donate/i }).click();

    // Validation errors should appear
    await expect(page.getByText(/name is required/i)).toBeVisible();
    await expect(page.getByText(/valid email/i)).toBeVisible();
  });

  test('submit button is disabled when amount is below $5', async ({ page }) => {
    await goToDonate(page);

    // Without selecting any amount, button should just say "Donate" and be disabled
    const submitButton = page.getByRole('button', { name: /^Donate$/i });
    await expect(submitButton).toBeDisabled();

    // Enter an amount below $5
    const customInput = page.getByLabel(/custom amount/i);
    await customInput.fill('3');
    await expect(page.getByRole('button', { name: /^Donate$/ })).toBeDisabled();

    // Enter $5 - should enable
    await customInput.fill('5');
    await expect(page.getByRole('button', { name: /\$5\.00/ })).toBeEnabled();
  });

  test('full donation flow transitions to payment step', async ({ page }) => {
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

    // Toggle anonymous
    const anonymousSwitch = page.getByLabel(/donate anonymously/i);
    await anonymousSwitch.click();

    // Toggle recurring
    const recurringSwitch = page.getByLabel(/monthly donation/i);
    await recurringSwitch.click();

    // Both toggles should be checked
    await expect(anonymousSwitch).toBeChecked();
    await expect(recurringSwitch).toBeChecked();

    // Can toggle back
    await anonymousSwitch.click();
    await expect(anonymousSwitch).not.toBeChecked();
  });

  test('API error shows error toast', async ({ page }) => {
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

  test('network error shows error toast', async ({ page }) => {
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

    // Should start at 0/500
    await expect(page.getByText('0/500')).toBeVisible();

    await page.getByLabel(/message/i).fill('Hello world');
    await expect(page.getByText('11/500')).toBeVisible();
  });
});

test.describe('Campaign Donate Button', () => {
  test('donation form is accessible from campaign detail page', async ({ page }) => {
    // Navigate to a campaign if one exists
    await page.goto('/campaigns');
    const campaignCard = page.locator('article a').first();

    // Skip if no campaigns are in the database
    const cardVisible = await campaignCard.isVisible({ timeout: 5000 }).catch(() => false);
    test.skip(!cardVisible, 'No campaigns in database - skipping campaign-specific test');

    await campaignCard.click();
    await expect(page).toHaveURL(/\/campaigns\/.+/, { timeout: 10000 });

    // Donation form should render on campaign detail page
    await expect(page.getByText('Make a Donation')).toBeVisible({ timeout: 10000 });

    // Preset buttons should work
    await page.getByRole('radio', { name: /^\$50,/ }).click();
    await expect(page.getByRole('button', { name: /\$50\.00/ })).toBeVisible();
  });
});
