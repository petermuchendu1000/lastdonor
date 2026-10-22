/**
 * E2E-18: Admin pages are closed to anyone who is not an admin
 * Priority: P1
 *
 * ## What this used to assert
 *
 * Seven tests, of which four were `if (page.url().includes('/admin/...'))`
 * bodies that never ran (the suite is unauthenticated, so every one of those
 * URLs is a redirect to `/login`), and three were
 *
 *     await expect(page).toHaveURL(/\/(admin|login)/);
 *
 * which passes for `/admin/simulation` AND for `/login?callbackUrl=/admin` -
 * that is, it passes whether the page is protected or wide open. For a
 * security boundary that is the one assertion you must not write: it cannot
 * distinguish the safe outcome from the dangerous one.
 *
 * ## What is asserted now
 *
 * That an anonymous visitor is redirected to the login page, that the
 * `callbackUrl` brings them back to the page they asked for, and that no
 * admin internals appear in what they are served. The "when authenticated"
 * half is declared skipped, with a reason, rather than conditionally absent.
 *
 * ## A finding this uncovered
 *
 * The callback assertion only holds because of an environment variable.
 * `src/middleware.ts` builds `callbackUrl` from the full pathname and query
 * (with a comment explaining why), but without `AUTH_TRUST_HOST=true` every
 * `auth()` call off Vercel fails with `UntrustedHost` (docs/26), the
 * middleware stops redirecting, and the request falls through to
 * `src/app/admin/layout.tsx`, whose redirect hardcodes `callbackUrl=/admin`.
 * The observable symptom is small - an operator sent to the wrong page after
 * signing in - but the cause is that the entire middleware auth layer was
 * inert. Measured here on 2026-10-22: without the variable,
 * `/admin/simulation` redirected to `callbackUrl=/admin`; with it, to
 * `callbackUrl=%2Fadmin%2Fsimulation`. `docs/99` §6 now lists it.
 *
 * That makes this test a canary for middleware auth being alive at all,
 * which is worth more than what it literally reads.
 */
import { test, expect } from '@playwright/test';

/**
 * Admin screens need an admin session, and the suite has no sign-in fixture
 * (`playwright.config.ts` sets no `storageState`). `docs/99` §5.
 */
const NEEDS_ADMIN_SESSION =
  'Needs an authenticated admin session; no sign-in fixture exists yet (docs/99 §5).';

/** Paths that must never be served to someone who is not an admin. */
const ADMIN_PATHS = [
  '/admin',
  '/admin/simulation',
  '/admin/simulation/fund-pool',
  '/admin/simulation/analytics',
];

test.describe('E2E-18: Admin Simulation Controls', () => {
  for (const path of ADMIN_PATHS) {
    test(`${path} redirects an anonymous visitor to login`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL(
        `/login?callbackUrl=${encodeURIComponent(path)}`,
      );
      // The login form, so this is a real login page and not an admin screen
      // that happens to sit at a /login URL.
      await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible();
    });
  }

  test('nothing an anonymous visitor is served leaks simulation internals', async ({ page }) => {
    await page.goto('/admin/simulation');
    await expect(page).toHaveURL(/\/login/);

    const html = await page.content();
    for (const marker of [
      'simulationConfig',
      'simulation_flag',
      'EMAIL_DOMAINS',
      'generateRealisticPaymentId',
    ]) {
      expect(html, `login page leaks admin internal "${marker}"`).not.toContain(marker);
    }
  });

  test.skip('admin simulation page has correct heading when authenticated', async () => {
    test.info().annotations.push({ type: 'blocked', description: NEEDS_ADMIN_SESSION });
  });

  test.skip('fund pool page has correct heading when authenticated', async () => {
    test.info().annotations.push({ type: 'blocked', description: NEEDS_ADMIN_SESSION });
  });

  test.skip('admin navigation includes simulation links', async () => {
    test.info().annotations.push({ type: 'blocked', description: NEEDS_ADMIN_SESSION });
  });
});
