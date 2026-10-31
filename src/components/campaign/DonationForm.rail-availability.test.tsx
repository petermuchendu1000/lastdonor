/**
 * A form may not collect payment details on a rail that cannot take them.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * `docs/161`. `DonationForm` has always carried an honest notice for the case
 * where no publishable key was built in - embedded checkout cannot mount, so
 * the donation cannot complete. It rendered that notice only inside
 * `CheckoutStep`, which is reached at `step === 'payment'`, which is reached
 * only after `create-checkout` returns a client secret.
 *
 * In production that route answers **503** (`StripeAuthenticationError`: the
 * secret key is dead too), so the step is never reached and the notice was
 * unreachable. Measured in a browser: the donor picked $25, typed an email,
 * pressed "Donate $25.00", and only then saw a refusal - which was the
 * ROUTE's message, not this component's.
 *
 * ⛔ The implication is ONE-DIRECTIONAL, and that is what makes this safe:
 *   - no publishable key  => the rail cannot work  (refuse, always correct)
 *   - a publishable key   => proves NOTHING, because the secret key may still
 *                            be dead; the server's 503 still covers that.
 * So this gate can refuse too rarely. It can never refuse wrongly.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const props = {
  campaignId: '550e8400-e29b-41d4-a716-446655440000',
  campaignTitle: 'Help the Johnson Family',
};

/**
 * The key is read at MODULE SCOPE (`DonationForm.tsx:20`), so the module must
 * be evaluated afresh for each condition. `vi.resetModules()` + a dynamic
 * import is the only way to drive both directions in one file.
 */
async function renderWithKey(key: string | undefined) {
  cleanup();
  vi.resetModules();
  if (key === undefined) delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = key;
  const mod = await import('@/components/campaign/DonationForm');
  render(<mod.DonationForm {...props} />);
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
});

describe('the card form refuses before collecting details', () => {
  it('⛔ with no publishable key it says so instead of showing the form', async () => {
    await renderWithKey(undefined);

    /*
      ⚠️ Identified STRUCTURALLY, not by its headline. `docs/161`: pinning the
      sentence made an equally-honest reword fail this test, which stops the
      copy being improved and proves nothing. What must hold is that a notice
      is announced and the form is gone; what it must SAY is asserted as a
      property below.
    */
    const notice = screen.getByRole('alert');
    expect(notice, 'the donor must be told before typing anything').toBeTruthy();

    // The details form must not be there to fill in.
    expect(document.querySelector('#donor-email'), 'email field must be absent').toBeNull();
    expect(document.querySelector('#custom-amount'), 'amount field must be absent').toBeNull();
    expect(document.querySelector('dl'), 'the ledger must be absent').toBeNull();
    expect(screen.queryByRole('button', { name: /^Donate \$|Select an amount/ })).toBeNull();
  });

  it('⚠️ ANTI-VACUITY CONTROL: with a key the form still renders', async () => {
    /*
      Without this the fix is satisfied by a component that never renders the
      form at all - which would block every donor the day the rail works.
    */
    await renderWithKey('pk_test_fixtureKeyNotReal');

    expect(document.querySelector('#donor-email'), 'email field must be present').not.toBeNull();
    expect(document.querySelector('#custom-amount'), 'amount field must be present').not.toBeNull();
    // No refusal notice is rendered when the rail can work.
    expect(screen.queryAllByRole('alert').length).toBe(0);
  });

  it('the refusal claims nothing it cannot substantiate', async () => {
    await renderWithKey(undefined);
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');

    // Nothing was attempted, so this reassurance IS substantiated (docs/158).
    expect(/nothing has been charged/i.test(text)).toBe(true);
    // And it must not blame the donor for our own missing configuration.
    expect(/your card (was )?(declined|rejected)/i.test(text)).toBe(false);
    expect(/insufficient/i.test(text)).toBe(false);
    // It must still offer a human.
    expect(/support@lastdonor\.org/i.test(text)).toBe(true);
  });
});
