/**
 * E2E-10: Blog listing → read post → back → pagination works
 * Priority: P2
 */
import { test, expect } from '@playwright/test';

test.describe('E2E-10: Blog Flow', () => {
  test('blog listing page loads', async ({ page }) => {
    await page.goto('/blog');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveURL('/blog');
  });

  test('blog post page loads via slug', async ({ page }) => {
    await page.goto('/blog');

    /*
      Was `getByRole('link').filter({ hasText: /.{10,}/ }).first()`, which
      matched "Skip to content" - the first link on the page with ten or
      more characters of text, href `#main-content`. Clicking it navigates
      nowhere, so the following `toHaveURL(/\/blog\/.+/)` waited until the
      test timed out. See docs/99 §3.1.

      Scope to a post link in the listing, and assert rather than skip: the
      E2E fixture seeds exactly one published post, so a missing link is a
      failure.
    */
    const postLink = page.locator('article a[href^="/blog/"]').first();
    await expect(postLink).toBeVisible();

    await postLink.click();
    await expect(page).toHaveURL(/\/blog\/.+/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
