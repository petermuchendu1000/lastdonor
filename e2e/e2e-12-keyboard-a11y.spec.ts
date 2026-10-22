/**
 * E2E-12: Keyboard-only navigation
 * Priority: P1
 *
 * This file already earned its keep once: it is what found that the skip link
 * did not skip, because `<main>` is not focusable without `tabIndex={-1}`
 * (fixed in `src/app/layout.tsx`, recorded in `docs/99` §4). But the test that
 * found it was itself inside `if (await skipLink.isVisible())`, and a skip
 * link is deliberately invisible until focused - so it only ran at all by
 * luck of the Tab press landing first.
 *
 * All three tests are now unconditional, and the third asserts a real
 * keyboard journey instead of "something focusable exists". See `docs/99`.
 */
import { test, expect } from '@playwright/test';
import { E2E_FIXTURE_IDS } from './fixtures/seed-data';

const CAMPAIGN_SLUG = `${E2E_FIXTURE_IDS.slugPrefix}medical-appeal`;

const activeElement = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    id: document.activeElement?.id ?? null,
    role: document.activeElement?.getAttribute('role') ?? null,
  }));

test.describe('E2E-12: Keyboard Accessibility', () => {
  test('the skip link moves focus into main content', async ({ page }) => {
    await page.goto('/');

    // One Tab from a fresh document focuses the skip link: it is deliberately
    // the first thing in the tab order, and visible only while focused.
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: /skip to content/i });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await page.keyboard.press('Enter');

    /*
      Focus must land ON `#main-content`, not merely leave `<body>`.

      The original assertion was `expect(focused).not.toBe('BODY')`, which a
      broken skip link can satisfy by accident - any stray focus anywhere
      passes it. The defect this file found was precisely that focus STAYED on
      body, so the weaker form would have caught that one case and nothing
      else. Asserting the target means a regression that moves focus to the
      wrong element still fails.
    */
    const focused = await activeElement(page);
    expect(focused.id).toBe('main-content');

    // And the next Tab must continue from there, which is the behaviour the
    // whole affordance exists to provide.
    await page.keyboard.press('Tab');
    const next = await activeElement(page);
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(next.tag);
  });

  test('navigation is reachable by keyboard', async ({ page }) => {
    await page.goto('/');

    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');

    const focused = await activeElement(page);
    expect(['A', 'BUTTON', 'INPUT']).toContain(focused.tag);
  });

  test('the donation amount can be chosen with the keyboard alone', async ({ page }) => {
    await page.goto(`/campaigns/${CAMPAIGN_SLUG}/donate`);

    const group = page.getByRole('radiogroup', { name: /donation amount/i });
    await expect(group).toBeVisible();

    /*
      A real keyboard journey, replacing a 20-iteration Tab loop that broke on
      the first INPUT or BUTTON it met and then asserted
      `expect(focused.tag).toBeTruthy()` - which cannot fail, and did not care
      whether the element had anything to do with donating.

      Radio groups are ONE tab stop with arrow keys inside them (the roving
      tabindex pattern), so this is also the behaviour a keyboard donor
      actually depends on: if the presets were plain buttons, Tab would visit
      each in turn and ArrowRight would do nothing.
    */
    const first = group.getByRole('radio').first();
    await first.focus();
    await expect(first).toBeFocused();

    await page.keyboard.press('ArrowRight');
    const second = group.getByRole('radio').nth(1);
    await expect(second).toBeFocused();
    await expect(second).toBeChecked();

    // Space on a focused radio keeps the selection rather than clearing it.
    await page.keyboard.press(' ');
    await expect(second).toBeChecked();
  });
});
