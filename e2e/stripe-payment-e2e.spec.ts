/**
 * E2E: Full Stripe Payment Flow
 * Tests the complete donation process using Stripe test cards.
 *
 * This test:
 * 1. Goes to a campaign or donate page
 * 2. Fills in donor details and selects an amount
 * 3. Clicks "Donate" (creates a real PaymentIntent via API)
 * 4. Fills in the Stripe PaymentElement with test card 4242 4242 4242 4242
 * 5. Confirms payment
 * 6. Verifies success state
 *
 * Requires: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY in .env.local
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * Fill Stripe PaymentElement card fields inside the single secure iframe.
 * All inputs (number, expiry, cvc) are in one iframe with title "Secure payment input frame".
 */
async function fillStripeCard(
  page: Page,
  cardNumber: string,
  expiry: string,
  cvc: string,
) {
  // The PaymentElement renders two iframes with title "Secure payment input frame"
  // but only the first (non-hidden) one contains the card inputs.
  const stripeFrame = page.frameLocator(
    'iframe[title="Secure payment input frame"]:not([aria-hidden="true"])'
  );

  // Fill card number
  const numberInput = stripeFrame.locator('#payment-numberInput');
  await numberInput.waitFor({ timeout: 15_000 });
  await numberInput.fill(cardNumber);

  // Fill expiry (MM / YY format - Stripe auto-inserts the " / ")
  const expiryInput = stripeFrame.locator('#payment-expiryInput');
  await expiryInput.fill(expiry);

  // Fill CVC
  const cvcInput = stripeFrame.locator('#payment-cvcInput');
  await cvcInput.fill(cvc);
}

test.describe('Stripe Donation E2E', () => {
  test.setTimeout(120_000);
  test.describe.configure({ mode: 'serial' });

  test('complete donation via /donate page with test card', async ({ page }) => {
    // Step 1: Navigate to donate page
    await page.goto('/donate');
    await expect(page.getByText('Make a Donation')).toBeVisible({ timeout: 15_000 });

    // Step 2: Select $25 preset amount
    await page.getByRole('radio', { name: /^\$25,/ }).click();

    // Step 3: Fill donor details
    await page.getByLabel('Your name').fill('Stripe Test Donor');
    await page.getByLabel('Email address').fill('test-donor@lastdonor.org');
    await page.getByLabel('Location').fill('San Francisco, CA');
    await page.getByLabel('Message').fill('E2E test donation');

    // Step 4: Click "Donate" - creates real PaymentIntent
    await page.getByRole('button', { name: /Donate/i }).click();

    // Step 5: Wait for payment step
    await expect(page.getByText('Complete Payment')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Donating $25.00')).toBeVisible();

    // Step 6: Fill Stripe test card 4242 4242 4242 4242
    await fillStripeCard(page, '4242424242424242', '1230', '123');

    // Step 7: Click Pay
    await page.getByRole('button', { name: /Pay \$25\.00/i }).click();

    // Step 8: Verify success
    await expect(page.getByText('Thank you for your donation!')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('$25.00')).toBeVisible();
  });

  test('complete donation via campaign page with test card', async ({ page }) => {
    // Navigate to campaigns listing
    await page.goto('/campaigns');
    await page.waitForLoadState('networkidle');

    // Click on the first available campaign
    const campaignLink = page.locator('a[href*="/campaigns/"]').first();
    await expect(campaignLink).toBeVisible({ timeout: 10_000 });
    await campaignLink.click();

    // Wait for DonationForm
    await expect(page.getByText('Make a Donation')).toBeVisible({ timeout: 15_000 });

    // Select $50
    await page.getByRole('radio', { name: /^\$50,/ }).click();

    // Fill donor details
    await page.getByLabel('Your name').fill('Campaign Test Donor');
    await page.getByLabel('Email address').fill('campaign-test@lastdonor.org');

    // Submit
    await page.getByRole('button', { name: /Donate/i }).click();
    await expect(page.getByText('Complete Payment')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Donating $50.00')).toBeVisible();

    // Fill test card
    await fillStripeCard(page, '4242424242424242', '0128', '456');

    // Confirm payment
    await page.getByRole('button', { name: /Pay \$50\.00/i }).click();

    // Verify success
    await expect(page.getByText('Thank you for your donation!')).toBeVisible({ timeout: 30_000 });
  });

  test('handles declined card gracefully', async ({ page }) => {
    await page.goto('/donate');
    await expect(page.getByText('Make a Donation')).toBeVisible({ timeout: 15_000 });

    // Fill form
    await page.getByRole('radio', { name: /^\$25,/ }).click();
    await page.getByLabel('Your name').fill('Decline Test');
    await page.getByLabel('Email address').fill('decline@test.com');

    // Donate
    await page.getByRole('button', { name: /Donate/i }).click();
    await expect(page.getByText('Complete Payment')).toBeVisible({ timeout: 15_000 });

    // Use Stripe's generic decline test card: 4000 0000 0000 0002
    await fillStripeCard(page, '4000000000000002', '1230', '123');

    // Try to pay
    await page.getByRole('button', { name: /Pay \$25\.00/i }).click();

    // Should show error message
    await expect(page.getByText(/declined|failed|error/i)).toBeVisible({ timeout: 30_000 });
    // Should NOT show success
    await expect(page.getByText('Thank you for your donation!')).not.toBeVisible();
  });

  test('back button returns to donor details with retained values', async ({ page }) => {
    await page.goto('/donate');
    await expect(page.getByText('Make a Donation')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('radio', { name: /^\$100,/ }).click();
    await page.getByLabel('Your name').fill('Back Test');
    await page.getByLabel('Email address').fill('back@test.com');

    await page.getByRole('button', { name: /Donate/i }).click();
    await expect(page.getByText('Complete Payment')).toBeVisible({ timeout: 15_000 });

    // Click Back
    await page.getByRole('button', { name: 'Back' }).click();

    // Should return to the donor details form
    await expect(page.getByText('Make a Donation')).toBeVisible();
    // Verify the form retained values
    await expect(page.getByLabel('Your name')).toHaveValue('Back Test');
  });
});
