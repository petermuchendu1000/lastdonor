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

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('the running total', () => {
  it('starts at zero, the way GoFundMe’s does, because nothing is pre-selected', () => {
    render(<DonationForm {...props} />);
    expect(amountFor('Your donation')).toBe('$0.00');
    expect(amountFor('Total charged today')).toBe('$0.00');
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
    expect(amountFor('Total charged today')).toBe('$50.00');
  });

  it('charges exactly the donation: nothing is added to the card', async () => {
    const user = userEvent.setup();
    render(<DonationForm {...props} />);
    await user.click(screen.getByRole('radio', { name: /^\$250,/ }));
    expect(amountFor('Total charged today')).toBe(amountFor('Your donation'));
  });

  it('says "monthly" rather than "today" on the recurring tab', async () => {
    const user = userEvent.setup();
    render(<DonationForm {...props} />);
    await user.click(screen.getByRole('radio', { name: 'Monthly' }));
    expect(amountFor('Total charged monthly')).toBe('$0.00');
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
