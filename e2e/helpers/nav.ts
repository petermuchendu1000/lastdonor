import { expect, type Page } from '@playwright/test';

/**
 * Tailwind's `md` breakpoint, which is where the navbar swaps.
 *
 * The desktop nav is `hidden items-center gap-0.5 md:flex`, so below this
 * width it is `display: none` - and Playwright's role queries exclude
 * display-none elements from the accessibility tree, so
 * `getByRole('navigation', { name: 'Main navigation' })` matches NOTHING on a
 * phone. Above it, the hamburger is the one that is absent.
 */
const MD_BREAKPOINT = 768;

function isDesktopViewport(page: Page): boolean {
  /*
    Decided from the viewport rather than by probing for the element.

    A `count() > 0` check would read more cleanly and would be wrong: it is a
    snapshot, so a slow first paint silently sends the test down the mobile
    path on a desktop viewport, and then it passes for the wrong reason. The
    viewport is known up front and cannot race.
  */
  return (page.viewportSize()?.width ?? MD_BREAKPOINT) >= MD_BREAKPOINT;
}

/**
 * Assert that this viewport gets exactly the navigation it should, and not
 * the other one. Changes nothing on the page.
 *
 * Both branches assert both ways, so a regression that loses the desktop nav
 * at desktop width still fails - this is not a "whichever is there"
 * fallback, which would be no test at all.
 */
export async function assertPrimaryNav(page: Page): Promise<void> {
  if (isDesktopViewport(page)) {
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
    return;
  }

  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
}

/**
 * Open (if needed) and return the navigation for this viewport.
 *
 * Separate from `assertPrimaryNav` because on a phone this one CLICKS the
 * hamburger, and a test whose subject is "the homepage renders" should not
 * have to open a menu to say so.
 */
export async function primaryNav(page: Page) {
  await assertPrimaryNav(page);

  if (isDesktopViewport(page)) {
    return page.getByRole('navigation', { name: 'Main navigation' });
  }

  await page.getByRole('button', { name: 'Open menu' }).click();
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav).toBeVisible();
  return nav;
}

/**
 * Walk from the homepage to `/campaigns` the way a visitor would, on either
 * viewport.
 *
 * Both navs carry a "Search" link to `/campaigns` - the label is "Search",
 * not "Campaigns", which is the drift that sent an earlier version of
 * `e2e-01` to `/donate` via the navbar's Donate button.
 *
 * ## Why this helper exists at all
 *
 * `e2e-01` navigated through `getByRole('navigation', { name: 'Main
 * navigation' })` unconditionally. That was correct when only the Desktop
 * Chrome project ran, and it broke the moment Mobile Chrome was added
 * (`docs/99` §8): one test timed out for 30s waiting to click a link inside a
 * nav that does not exist at 412px, and another failed asserting that nav
 * visible. It is the same mistake `e2e-08` documents, made in the fix for a
 * different one - which is the argument for putting the viewport logic in one
 * place instead of in each spec.
 */
export async function goToCampaignsFromHomepage(page: Page): Promise<void> {
  const nav = await primaryNav(page);
  await nav.getByRole('link', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/campaigns/);
}
