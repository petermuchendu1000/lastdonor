/**
 * E2E-09: Dark mode toggle → verify key pages render correctly
 * Priority: P2
 *
 * Rewritten 2026-10-22. Both tests were drifted in the same two ways, and
 * between them they found a real product bug. See `docs/99`.
 *
 * ## 1. The locator stopped matching after the first click
 *
 * The toggle was found with
 *
 *     getByRole('switch', { name: /dark|theme/i })
 *       .or(getByRole('button', { name: /dark|theme/i }))
 *
 * On a desktop viewport the only toggle in the page is the footer one, whose
 * `aria-label` is "Switch to dark mode" while the page is light and
 * "Switch to **light** mode" once it is dark. So the regex matched before the
 * first click and matched NOTHING after it, and `toggle.click()` on line 27
 * waited the full 30s for an element that was still on screen under a
 * different name. A label that describes the action is correct
 * accessibility - a locator that only matches one of its two states is the
 * defect.
 *
 * The regex now covers both states. The `switch` role half is dropped: this
 * control is a plain button and always has been, so an `.or()` against a role
 * nothing renders only widened the blast radius of a strict-mode violation.
 *
 * ## 2. Neither test could fail
 *
 * Both bodies were wrapped in `if (await toggle.isVisible())`. A toggle that
 * disappeared entirely would have made both tests PASS, silently - the same
 * class of vacuous assertion found in ten other specs this session. The
 * toggle's presence is now asserted, not assumed.
 *
 * ## 3. What that uncovered
 *
 * Fixing the locator surfaced a genuine bug: the navbar toggle and the footer
 * toggle each held their own copy of the theme, so using one made the other's
 * next press a no-op. Fixed in `src/hooks/useDarkMode.ts`; the cross-component
 * regression is pinned by `src/hooks/useDarkMode.test.tsx`, because a
 * per-component test passed throughout.
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * Matches the toggle in BOTH label states.
 *
 * `Toggle dark mode` is the navbar control (inside the mobile sheet, so it is
 * absent on a desktop viewport); `Switch to dark mode` / `Switch to light
 * mode` is the footer control. `.first()` keeps this honest on a viewport
 * where both are present rather than throwing a strict-mode violation.
 */
function themeToggle(page: Page) {
  return page
    .getByRole('button', { name: /(toggle|switch to) (dark|light) mode/i })
    .first();
}

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'));

test.describe('E2E-09: Dark Mode', () => {
  test('dark mode toggle changes theme', async ({ page }) => {
    await page.goto('/');

    const toggle = themeToggle(page);
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect.poll(() => isDark(page)).toBe(true);

    /*
      Re-resolved deliberately rather than reusing `toggle`: the whole point
      of this test is that the control is still operable under its new name.
      Asserting it visible first means a regression here reports "not
      visible" in 5s instead of timing out the test in 30.
    */
    const backToLight = themeToggle(page);
    await expect(backToLight).toBeVisible();
    await backToLight.click();
    await expect.poll(() => isDark(page)).toBe(false);
  });

  test('dark mode persists across navigation', async ({ page }) => {
    await page.goto('/');

    const toggle = themeToggle(page);
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect.poll(() => isDark(page)).toBe(true);

    await page.goto('/campaigns');

    /*
      This is the assertion that matters, and it is about the pre-paint
      script in `layout.tsx` rather than about React: the class has to be on
      `<html>` before first paint, or the visitor sees a white flash of the
      light theme on every navigation. A post-hydration check would pass even
      if that script were deleted, so read it as early as the harness allows
      and keep the window short.
    */
    await expect.poll(() => isDark(page), { timeout: 5_000 }).toBe(true);
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
