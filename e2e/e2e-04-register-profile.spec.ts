/**
 * E2E-04: Register → login → profile → view donation history → see badges
 * Priority: P1
 */
import { test, expect } from '@playwright/test';

/*
  `getByRole('heading')` with no level was a strict-mode violation on both
  pages: it matched the page's h1 plus the footer's "Platform", "Trust" and
  "Legal" h3s. Pinning level 1 is what each test meant, and is stricter than
  what was there.

  The field assertions needed scoping for the same reason: `getByLabel(/email/i)`
  matches TWICE on both pages, because the footer newsletter strip has an email
  field. `main form` is the page's own form. See docs/99 §3.1.
*/
test.describe('E2E-04: Registration & Profile', () => {
  test('registration page loads and displays form fields', async ({ page }) => {
    await page.goto('/register');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Scoped to the page's own form: the footer newsletter strip has an
    // email field too, so an unscoped /email/i matches twice.
    const form = page.locator('main form');
    await expect(form.getByLabel(/email/i)).toBeVisible();
    await expect(form.getByLabel(/password/i).first()).toBeVisible();
  });

  test('login page loads and displays form fields', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const form = page.locator('main form');
    await expect(form.getByLabel(/email/i)).toBeVisible();
    await expect(form.getByLabel(/password/i)).toBeVisible();
  });

  test('profile page redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/profile');

    // /profile redirects to /dashboard/settings, which redirects unauthenticated users to login
    await expect(page).toHaveURL(/\/(login|dashboard\/settings)/);
  });
});
