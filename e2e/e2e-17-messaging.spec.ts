/**
 * E2E-17: Campaign Messaging
 * Priority: P1
 *
 * Verifies the message wall renders on campaign pages and that a guest is
 * offered sign-in rather than the posting form.
 *
 * ## Rewritten 2026-10-22 (docs/99)
 *
 * ### `isVisible()` does not wait, and three tests were built on it
 *
 * `message form requires authentication` read
 *
 *     const formVisible   = await messageForm.isVisible({ timeout: 3000 })...
 *     const promptVisible = await signInPrompt.isVisible({ timeout: 3000 })...
 *     expect(formVisible || promptVisible).toBe(true);
 *
 * and failed with `expected true, received false`. Nothing was wrong with
 * the page. `locator.isVisible()` resolves IMMEDIATELY - the `timeout`
 * option does not make it poll - so both probes ran in the instant after
 * `toHaveURL` resolved, before the client had read the session. `MessageForm`
 * renders `null` while `useAuthState()` is `unknown` (deliberately, per
 * docs/44: telling a signed-in user to sign in is the defect that rule
 * exists to prevent), so at that moment the page correctly showed neither
 * branch. `expect(...).toBeVisible()` waits; `isVisible()` is a snapshot.
 *
 * ### The assertion was also a tautology
 *
 * "either the form or a sign-in prompt" cannot distinguish a working page
 * from a broken one - and the sign-in half was matched with
 * `getByText(/sign in|log in/i).first()`, which takes the first match in DOM
 * ORDER anywhere on the page. The navbar's own sign-in link would have
 * satisfied it with the message wall entirely absent.
 *
 * This suite runs with no stored credentials, so the guest branch is the
 * deterministic one and is now asserted directly, scoped to the message
 * wall: the prompt is there, its link carries the `callbackUrl` the login
 * page actually reads, and the posting form is NOT present.
 *
 * ### Two tests needed a session this suite has no fixture for
 *
 * `message form has expected fields` and `empty message submission is
 * prevented` both guarded on `isVisible()` and so skipped on every run while
 * appearing to be real coverage. They are declared skipped with a named
 * reason instead, because a silent runtime skip that depends on a racing
 * probe is indistinguishable from a pass. `MessageForm.test.tsx` covers both
 * at the unit level with a session stubbed in.
 */
import { test, expect } from '@playwright/test';

/**
 * Why two tests here are skipped rather than conditionally green.
 *
 * Posting a message needs an authenticated session, and the suite has no
 * sign-in fixture: `playwright.config.ts` sets no `storageState`, and the
 * seed fixture deliberately creates no password for its organiser
 * (`e2e/fixtures/seed-data.ts`). Building one is `docs/99` §5 work.
 */
const NEEDS_AUTHENTICATED_SESSION =
  'Needs an authenticated session; no sign-in fixture exists yet (docs/99 §5). ' +
  'Covered at unit level by src/components/campaign/MessageForm.test.tsx.';

test.describe('E2E-17: Campaign Messaging', () => {
  test('campaign page displays message wall section', async ({ page }) => {
    await page.goto('/campaigns');

    const campaignLink = page.locator('article a').first();
    await expect(campaignLink).toBeVisible();

    await campaignLink.click();
    await expect(page).toHaveURL(/\/campaigns\/.+/);

    // The wall renders either messages or its empty state; both are the
    // section being present.
    await expect(
      page.getByRole('heading', { name: /messages of support/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('a guest is offered sign-in instead of the message form', async ({ page }) => {
    await page.goto('/campaigns');

    const campaignLink = page.locator('article a').first();
    await expect(campaignLink).toBeVisible();

    await campaignLink.click();
    await expect(page).toHaveURL(/\/campaigns\/.+/);
    const slug = new URL(page.url()).pathname.split('/').pop()!;

    /*
      Scoped to the prompt's own sentence, not to "sign in" anywhere on the
      page - the navbar has a sign-in link of its own, and matching that
      would let this test pass with no message wall at all. `toBeVisible`
      waits, which is what the session read needs.
    */
    const prompt = page.getByText(/sign in to leave a message of support/i);
    await expect(prompt).toBeVisible({ timeout: 10_000 });

    /*
      `callbackUrl` is the only query parameter the login page reads, and it
      must come back to THIS campaign - a prompt that returns the visitor to
      the homepage loses the message they came to leave.
    */
    await expect(prompt.getByRole('link', { name: /^sign in$/i })).toHaveAttribute(
      'href',
      `/login?callbackUrl=${encodeURIComponent(`/campaigns/${slug}`)}`,
    );

    // The actual claim in this test's name: no posting surface for a guest.
    await expect(page.getByLabel(/support message/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /post message/i })).toHaveCount(0);
  });

  test.skip('message form has expected fields and submit button', async () => {
    test.info().annotations.push({ type: 'blocked', description: NEEDS_AUTHENTICATED_SESSION });
  });

  test.skip('empty message submission is prevented', async () => {
    test.info().annotations.push({ type: 'blocked', description: NEEDS_AUTHENTICATED_SESSION });
  });

  test('message wall does not expose simulation data in DOM', async ({ page }) => {
    await page.goto('/campaigns');

    const campaignLink = page.locator('article a').first();
    await expect(campaignLink).toBeVisible();

    await campaignLink.click();
    await expect(page).toHaveURL(/\/campaigns\/.+/);

    /*
      Wait for the wall before reading `content()`. The old version snapshot
      the HTML as soon as the URL changed, so on a slow render it was
      asserting that an INCOMPLETE page contained no simulation markers -
      which it trivially did not. A leak check has to run against the page a
      visitor actually ends up with.
    */
    await expect(
      page.getByRole('heading', { name: /messages of support/i }),
    ).toBeVisible({ timeout: 10_000 });

    const html = await page.content();
    for (const marker of [
      'simulationFlag',
      'simulation_flag',
      '@lastdonor.internal',
      'data-simulated',
    ]) {
      expect(html, `rendered HTML leaks "${marker}"`).not.toContain(marker);
    }
  });
});
