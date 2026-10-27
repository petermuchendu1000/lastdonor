import { expect, test } from '@playwright/test';

import {
  createE2EInvite,
  E2E_EXPIRED_INVITE_TOKEN,
  E2E_FIXTURE_IDS,
  E2E_FIXTURE_PASSWORD,
  E2E_HELPER_EMAIL,
  E2E_INVITE_TOKEN,
} from './fixtures/seed-data';

/**
 * The whole collaborator journey: emailed link -> sign-in -> accept -> use it.
 *
 * ── WHY THIS SPEC EXISTS ────────────────────────────────────────────────────
 *
 * `collaborators.integration.test.ts` has 33 tests and they are good ones:
 * tokens, CHECK constraints, the accept race, revocation, the per-campaign
 * cap. Every one of them is about the DATA. Not one walks the journey, and
 * the journey is where it was broken.
 *
 * [VERIFIED 2026-10-27, walked in Chromium against a production build] a
 * person who accepted an invitation landed on `/dashboard/campaigns?joined=1`
 * and read **"You haven't created any campaigns yet. Start one now"** - while
 * their membership row was live and accepted, `GET /api/v1/user-campaigns/<id>`
 * answered 200 for the same session, and `POST .../updates` answered 201.
 * The grant was real and had no door: all three capability screens redirected
 * them to that same empty list, and a sweep of ALL TWELVE signed-in dashboard
 * routes named the campaign on none. `docs/117`.
 *
 * Nothing threw. Every piece worked and nothing joined them up - the `docs/83`
 * shape, which is why the check has to be a walk rather than another unit.
 *
 * ── THE SIGN-IN FIXTURE ─────────────────────────────────────────────────────
 *
 * `docs/99` §8 records ten specs skipped for want of one. This spec needs it,
 * so `seed-data.ts` now seeds a helper with a real peppered password hash.
 * Every symptom above is on an authenticated screen; signed out, the defect
 * is invisible.
 */

const CAMPAIGN_ID = E2E_FIXTURE_IDS.campaigns[1];

/** Sign in through the real form, the way the invitee does. */
async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', E2E_FIXTURE_PASSWORD);
  await page.click('button[type="submit"]');
  /*
    ⚠️ Wait for the URL to LEAVE /login, not for `networkidle`. Idle resolved
    early while the credentials POST was still in flight, and every later
    assertion then measured the login page - a whole walk that looked like a
    product failure and was a harness one.
  */
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

test.describe('the invitation link', () => {
  test('sends a signed-out invitee to sign in, keeping the token', async ({ page }) => {
    await page.goto(`/collaborate/accept?token=${E2E_INVITE_TOKEN}`);

    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    // The token must survive the round trip or the invitation is lost.
    expect(page.url()).toContain(encodeURIComponent(E2E_INVITE_TOKEN));
  });

  test('offers a way to register that also keeps the token', async ({ page }) => {
    // The invited address may have no account at all; that arm must not
    // dead-end at a sign-in form.
    await page.goto(`/collaborate/accept?token=${E2E_INVITE_TOKEN}`);

    const create = page.getByRole('link', { name: /create one/i });
    await expect(create).toBeVisible();
    expect(await create.getAttribute('href')).toContain(encodeURIComponent(E2E_INVITE_TOKEN));
  });

  test('⛔ names the campaign it is for', async ({ page }) => {
    const token = await createE2EInvite(CAMPAIGN_ID);
    /*
      It used to say only "You were asked to help run a campaign". Somebody
      holding two invitations could not tell which they were accepting, and
      consent to an unnamed thing is not consent.
    */
    await signIn(page, E2E_HELPER_EMAIL);
    await page.goto(`/collaborate/accept?token=${token}`);

    await expect(page.getByRole('heading', { name: /help with this fundraiser/i })).toBeVisible();
    await expect(page.getByText(/E2E Fixture: Medical Appeal/)).toBeVisible();
  });

  test('⛔ says plainly that the money is not included', async ({ page }) => {
    await signIn(page, E2E_HELPER_EMAIL);
    await page.goto(`/collaborate/accept?token=${E2E_INVITE_TOKEN}`);
    await expect(page.getByText(/will not be able to touch the money/i)).toBeVisible();
  });

  test('⛔ does not accept on load - a GET must not mutate', async ({ page }) => {
    /*
      Mail clients and link scanners fetch emailed URLs before a person sees
      them. If merely opening the page accepted, the membership would go to
      whichever machine opened the message first.
    */
    await signIn(page, E2E_HELPER_EMAIL);
    await page.goto(`/collaborate/accept?token=${E2E_INVITE_TOKEN}`);

    await expect(page.getByRole('button', { name: /accept and start helping/i })).toBeVisible();
    // Still not a member: the dashboard must not list it yet.
    await page.goto('/dashboard/campaigns');
    await expect(page.getByText('Helping')).toHaveCount(0);
  });
});

test.describe('accepting', () => {
  test('⛔ lands somewhere that says what just happened, and lists the campaign', async ({ page }) => {
    const token = await createE2EInvite(CAMPAIGN_ID);
    await signIn(page, E2E_HELPER_EMAIL);
    await page.goto(`/collaborate/accept?token=${token}`);
    await page.getByRole('button', { name: /accept and start helping/i }).click();

    await page.waitForURL(/\/dashboard\/campaigns/, { timeout: 30_000 });

    // The confirmation. `?joined=1` was read by nothing at all before this.
    await expect(page.getByRole('status')).toContainText(/now helping with a fundraiser/i);
    // And the campaign itself, marked so they know why it is on their list.
    await expect(page.getByText('Helping').first()).toBeVisible();
    await expect(page.getByText(/You haven't created any campaigns yet/i)).toHaveCount(0);
  });

  test('⛔ the helper can reach the two things they were granted', async ({ page }) => {
    const token = await createE2EInvite(CAMPAIGN_ID);
    await signIn(page, E2E_HELPER_EMAIL);
    await page.goto(`/collaborate/accept?token=${token}`);
    await page.getByRole('button', { name: /accept and start helping/i }).click();
    await page.waitForURL(/\/dashboard\/campaigns/, { timeout: 30_000 });

    // Both screens previously redirected a collaborator to the empty list.
    for (const path of [
      `/dashboard/campaigns/${CAMPAIGN_ID}`,
      `/dashboard/campaigns/${CAMPAIGN_ID}/updates`,
    ]) {
      await page.goto(path);
      await expect(page, `${path} bounced a collaborator`).toHaveURL(new RegExp(path.replace(/\//g, '\\/')));
    }
  });

  test('⛔ and is shown NO control over money, identity or the team', async ({ page }) => {
    const token = await createE2EInvite(CAMPAIGN_ID);
    /*
      The half that matters more than the half above. Admitting a helper to
      the campaign screen without gating it would show them the invite panel,
      the verification link and the payout destination - all of which are in
      NEVER_DELEGATED and all of which answer 403. A control that can only
      fail is worse than no control.
    */
    await signIn(page, E2E_HELPER_EMAIL);
    await page.goto(`/collaborate/accept?token=${token}`);
    await page.getByRole('button', { name: /accept and start helping/i }).click();
    await page.waitForURL(/\/dashboard\/campaigns/, { timeout: 30_000 });

    await page.goto(`/dashboard/campaigns/${CAMPAIGN_ID}`);
    await expect(page.getByRole('link', { name: /verification/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /donors/i })).toHaveCount(0);
    await expect(page.getByText(/invite|add a helper|team/i)).toHaveCount(0);

    await page.goto('/dashboard/campaigns');
    await expect(page.getByRole('link', { name: /where the money goes/i })).toHaveCount(0);
  });

  test('accepting twice is success, not an error', async ({ page }) => {
    await signIn(page, E2E_HELPER_EMAIL);
    for (let i = 0; i < 2; i++) {
      await page.goto(`/collaborate/accept?token=${E2E_INVITE_TOKEN}`);
      const button = page.getByRole('button', { name: /accept and start helping/i });
      if (await button.count()) {
        await button.click();
        await page.waitForURL(/\/dashboard\/campaigns/, { timeout: 30_000 });
      }
    }
    await page.goto('/dashboard/campaigns');
    // Exactly one row, not two.
    await expect(page.getByText('Helping')).toHaveCount(1);
  });
});

test.describe('invitations that cannot be used', () => {
  test('⛔ an expired one is refused, in the same words as every other failure', async ({ page }) => {
    await signIn(page, E2E_HELPER_EMAIL);
    await page.goto(`/collaborate/accept?token=${E2E_EXPIRED_INVITE_TOKEN}`);
    await expect(page.getByText(/no longer valid/i)).toBeVisible();
    // No button: there is nothing to accept.
    await expect(page.getByRole('button', { name: /accept and start helping/i })).toHaveCount(0);
  });

  test('⛔ an unknown token says exactly the same thing', async ({ page }) => {
    /*
      Distinct messages for "expired", "already taken" and "no such token"
      would each tell the holder of a guessed token which tokens exist. The
      reason lives in the audit row instead.
    */
    await signIn(page, E2E_HELPER_EMAIL);
    await page.goto(`/collaborate/accept?token=${'z'.repeat(44)}`);
    await expect(page.getByText(/no longer valid/i)).toBeVisible();
  });

  test('a link with no token at all explains itself', async ({ page }) => {
    await signIn(page, E2E_HELPER_EMAIL);
    await page.goto('/collaborate/accept');
    await expect(page.getByRole('heading', { name: /this link is incomplete/i })).toBeVisible();
  });
});

test.describe('the organiser keeps what is theirs', () => {
  test('sees the team panel and every money control on their own campaign', async ({ page }) => {
    /*
      The control for the gating above. Without this, hiding those sections
      from EVERYBODY would pass the collaborator assertions - the classic
      check that cannot fail.
    */
    await signIn(page, 'e2e-fixture-organiser@example.invalid');
    await page.goto(`/dashboard/campaigns/${CAMPAIGN_ID}`);

    await expect(page.getByRole('link', { name: /verification/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /donors/i }).first()).toBeVisible();

    await page.goto('/dashboard/campaigns');
    await expect(page.getByRole('link', { name: /where the money goes/i }).first()).toBeVisible();
    // And no "Helping" badge on a campaign they started.
    await expect(page.getByText('Helping')).toHaveCount(0);
  });
});
