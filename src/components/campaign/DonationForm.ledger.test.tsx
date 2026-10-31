/**
 * The donate form's running total, suggested preset and protection block.
 *
 * Each of these came out of measuring GoFundMe's donate page against ours at
 * 390px on 2026-10-16 (docs/72). They are the parts that make a claim to the
 * donor, so each one is pinned here: a fee line that silently stopped saying
 * $0.00, a badge that quietly became a pre-selection, or a refund promise
 * that grew a time window would all be worse than not shipping them.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  ⛔ These tests drive the DETAILS FORM, and `DonationForm` only renders it
  when a publishable key was built in - without one the card rail cannot
  mount embedded checkout, so the component shows the unavailable notice
  instead (`docs/161`). Production has no key, which is exactly the condition
  being modelled elsewhere, so the key is stubbed HERE and deliberately NOT in
  `test/setup.ts`: a global stub would make every test in the suite render a
  form production never shows, which is how the defect hid.

  `vi.hoisted` because the key is read at MODULE SCOPE, before any beforeEach.
*/
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fixtureKeyNotReal';
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DonationForm } from '@/components/campaign/DonationForm';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const props = {
  campaignId: '550e8400-e29b-41d4-a716-446655440000',
  campaignTitle: 'Help the Johnson Family',
};

/** The ledger is the only <dl> in the form. */
function ledger() {
  const dl = document.querySelector('dl');
  if (!dl) throw new Error('no ledger rendered');
  return dl as HTMLElement;
}

/** The amount paired with a given ledger label. */
function amountFor(label: string) {
  const dt = within(ledger())
    .getAllByRole('term')
    .find((t) => t.textContent?.trim() === label);
  if (!dt) throw new Error(`no ledger row labelled "${label}"`);
  return dt.nextElementSibling?.textContent?.trim();
}

/**
 * The total row, found STRUCTURALLY.
 *
 * ⚠️ `docs/161`. These tests used to name the total row by its exact label,
 * so rewording it - even to something equally honest - failed four of them.
 * A test that pins today's copy stops the copy being improved and proves
 * nothing about the property that matters. The row is the one whose label
 * starts "Total"; whether a label may say "charged" is asserted separately,
 * as a property, at the bottom of this file.
 */
function totalRow() {
  const dt = within(ledger())
    .getAllByRole('term')
    .find((t) => /^Total\b/.test(t.textContent?.trim() ?? ''));
  if (!dt) throw new Error('no ledger row labelled "Total…"');
  return {
    label: dt.textContent?.trim() ?? '',
    amount: dt.nextElementSibling?.textContent?.trim(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('the running total', () => {
  it('starts at zero, the way GoFundMe’s does, because nothing is pre-selected', () => {
    render(<DonationForm {...props} />);
    expect(amountFor('Your donation')).toBe('$0.00');
    expect(totalRow().amount).toBe('$0.00');
  });

  it('always states the platform fee as zero', () => {
    render(<DonationForm {...props} />);
    expect(amountFor('LastDonor platform fee')).toBe('$0.00');
  });

  it('follows the chosen preset', async () => {
    const user = userEvent.setup();
    render(<DonationForm {...props} />);
    await user.click(screen.getByRole('radio', { name: /^\$50,/ }));
    expect(amountFor('Your donation')).toBe('$50.00');
    expect(totalRow().amount).toBe('$50.00');
  });

  it('charges exactly the donation: nothing is added to the card', async () => {
    const user = userEvent.setup();
    render(<DonationForm {...props} />);
    await user.click(screen.getByRole('radio', { name: /^\$250,/ }));
    expect(totalRow().amount).toBe(amountFor('Your donation'));
  });

  it('says "monthly" rather than "today" on the recurring tab', async () => {
    const user = userEvent.setup();
    render(<DonationForm {...props} />);
    await user.click(screen.getByRole('radio', { name: 'Monthly' }));
    expect(totalRow().amount).toBe('$0.00');
  });

  it('reads zero for an amount the form would refuse, not the typed figure', async () => {
    const user = userEvent.setup();
    render(<DonationForm {...props} />);
    // Above MAX_DONATION_CENTS. The button already says so; the ledger must
    // not meanwhile quote a total this form will never charge.
    await user.type(screen.getByLabelText(/custom amount/i), '999999999');
    expect(amountFor('Your donation')).toBe('$0.00');
  });

  /*
    ⛔ REPLACED 2026-10-26, `docs/116` §5. This test asserted
    `/2\.9% \+ \$0\.30/` and "comes out of the payout, not your card", so it
    was HOLDING THE DEFECT IN PLACE - the same shape as
    `instant-live-architecture.test.ts` in `docs/109`.

    All three parts of that claim were false and each is checkable:
      1. Stripe cannot take a payment here - `STRIPE_SECRET_KEY` on Fly is the
         placeholder (`docs/72`) - and every donation ever collected came over
         M-Pesa (`docs/92`).
      2. 2.9% + $0.30 has never been charged to anybody on this platform.
      3. Nothing deducts a processing fee from a payout at all:
         `create-checkout` adds no `application_fee`, `payment-service.ts`
         credits `raisedAmount + amount`, and `withdraw/route.ts` computes
         `released - withdrawn - pending`.

    What is pinned now is the property the file header asks for - a fee line
    that cannot silently stop saying $0.00 - plus the absence of any rate.
  */
  it('states that the processing fee is not taken out of the donation', () => {
    render(<DonationForm {...props} />);
    expect(ledger().textContent).toMatch(/fee is paid by us, not taken out of your\s+donation/);
  });

  it('⛔ quotes no processing rate, and names no processor', () => {
    render(<DonationForm {...props} />);
    const text = ledger().textContent ?? '';
    expect(text).not.toMatch(/\d(?:\.\d+)?\s*%/);
    expect(text).not.toMatch(/\bStripe\b/);
    expect(text).not.toMatch(/30\s*(?:cents|c)\b/);
  });
});

describe('the suggested preset', () => {
  it('badges exactly one amount', () => {
    render(<DonationForm {...props} />);
    expect(screen.getAllByText('Suggested')).toHaveLength(1);
  });

  it('badges $100 and announces it to screen readers', () => {
    render(<DonationForm {...props} />);
    const tile = screen.getByRole('radio', { name: /^\$100,/ });
    expect(within(tile).getByText('Suggested')).toBeInTheDocument();
    expect(tile.getAttribute('aria-label')).toMatch(/suggested$/);
  });

  /*
    Measured live when the badge first shipped: the badged tile pushed its
    whole row from 77px to 97px, so the two rows of amounts rendered at
    visibly different heights. jsdom cannot measure layout, so the mechanism
    is pinned instead: the badge is out of flow and every tile reserves the
    same room for it.
  */
  it('cannot change its tile’s height: out of flow, with room reserved on all six', () => {
    render(<DonationForm {...props} />);
    const tiles = screen
      .getAllByRole('radio')
      .filter((t) => /^\$/.test(t.getAttribute('aria-label') ?? ''));

    expect(tiles).toHaveLength(6);
    for (const tile of tiles) {
      expect(tile.className).toMatch(/\brelative\b/);
      expect(tile.className).toMatch(/\bpb-5\b/);
    }
    expect(screen.getByText('Suggested').className).toMatch(/\babsolute\b/);
  });

  it('is a recommendation, NOT a pre-selection: no amount is chosen on arrival', () => {
    render(<DonationForm {...props} />);
    for (const tile of screen.getAllByRole('radio')) {
      if (/^\$/.test(tile.getAttribute('aria-label') ?? '')) {
        expect(tile).toHaveAttribute('aria-checked', 'false');
      }
    }
    expect(screen.getByRole('button', { name: /select an amount to donate/i })).toBeDisabled();
  });
});

describe('the protection block', () => {
  it('states the three situations the refund policy actually commits to', () => {
    render(<DonationForm {...props} />);
    const block = screen.getByText('Your donation is protected').parentElement!;
    expect(block.textContent).toMatch(/unauthorised/);
    expect(block.textContent).toMatch(/removed before funds are released/);
    expect(block.textContent).toMatch(/fails\s+verification/);
  });

  it('promises no time window, because /refund-policy sets none', () => {
    render(<DonationForm {...props} />);
    const block = screen.getByText('Your donation is protected').parentElement!;
    expect(block.textContent).not.toMatch(/up to a year|within \d+ days|guarantee/i);
  });

  it('links to the policy the claim comes from', () => {
    render(<DonationForm {...props} />);
    const block = screen.getByText('Your donation is protected').parentElement!;
    expect(within(block).getByRole('link', { name: 'Refund Policy' })).toHaveAttribute(
      'href',
      '/refund-policy',
    );
  });
});

describe('the ledger does not claim a charge has happened', () => {
  /*
    `docs/161`. `submitError` renders DIRECTLY beneath this box, so after any
    refusal - the dead card rail's 503 or the docs/101 raise cap - the donor
    read "Total charged today $25.00" 95px above "nothing has been charged".
    Measured in a browser on both paths.

    ⛔ This asserts the PROPERTY, not the wording: the rows above pin today's
    labels so they can find a row at all, and a reword would quietly satisfy
    them. The box is a projection - its own comment says "the figures are the
    donor's own arithmetic, not a claim" - so no row may use the past tense of
    a charge.
  */
  const PAST_TENSE_CHARGE = /\bcharged\b/i;

  it('no ledger row says money has been charged', async () => {
    const user = userEvent.setup();
    render(<DonationForm {...props} />);
    // A payable amount, so the ledger is showing real figures.
    await user.click(screen.getAllByRole('radio')[5]);
    const labels = within(ledger())
      .getAllByRole('term')
      .map((t) => t.textContent?.trim() ?? '');
    expect(labels.length).toBeGreaterThan(1);
    for (const l of labels) {
      expect(PAST_TENSE_CHARGE.test(l), `ledger row "${l}" asserts a charge`).toBe(false);
    }
  });

  it('ANTI-VACUITY: the matcher really does catch the wording it replaced', () => {
    // Without this, a typo in the regex would make the rule above pass
    // against the defect it exists to prevent.
    expect(PAST_TENSE_CHARGE.test('Total charged today')).toBe(true);
    expect(PAST_TENSE_CHARGE.test('Total to pay today')).toBe(false);
  });
});
