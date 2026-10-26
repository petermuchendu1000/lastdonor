/**
 * Payout settings: the second dead withdrawal caller, plus two dead ends.
 *
 * 1. This client sent `{ amount }` only, while `withdrawalRequestSchema`
 *    requires a uuid `idempotencyKey` - so every withdrawal 400'd.
 * 2. A Stripe-rejected Connect account rendered as a grey "Needs Attention"
 *    badge with no button, no explanation and nowhere to go, while the
 *    create-account API returns 409 forever once an account id exists.
 * 3. A non-USD settlement currency was only discovered at transfer time, by
 *    which point the wrong amount had been sent (the ledger is USD cents and
 *    nothing converts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PayoutSettingsClient } from '@/components/dashboard/PayoutSettingsClient';
import { withdrawalRequestSchema } from '@/lib/validators/payout';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';

const campaign = {
  id: CAMPAIGN_ID,
  title: 'Help Maria',
  slug: 'help-maria',
  status: 'active',
  // The campaign's own currency. Required, not defaulted: this component used
  // to format every figure with a hardcoded `currency: 'USD'` (`docs/92`).
  currency: 'USD',
  goalAmount: 100_000,
  raisedAmount: 80_000,
  totalReleasedAmount: 50_000,
  totalWithdrawnAmount: 0,
  availableBalance: 50_000,
};

function props(
  overrides: Partial<{
    status: string;
    payoutCurrency: string | null;
    hasAccount: boolean;
    campaignCurrency: string;
  }> = {},
) {
  return {
    connectStatus: {
      hasAccount: overrides.hasAccount ?? true,
      status: overrides.status ?? 'verified',
      onboardedAt: null,
      payoutCurrency: overrides.payoutCurrency ?? 'usd',
    },
    campaigns: [{ ...campaign, currency: overrides.campaignCurrency ?? campaign.currency }],
    withdrawals: [],
    connectAvailable: true,
  };
}

function postedBodies(): Array<Record<string, unknown>> {
  const mock = global.fetch as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, data: { withdrawalId: 'w1', status: 'processing' } }),
  }) as unknown as typeof fetch;
});

describe('PayoutSettingsClient withdrawal payload', () => {
  it('sends a body the server validator accepts', async () => {
    const user = userEvent.setup();
    render(<PayoutSettingsClient {...props()} />);

    await user.type(screen.getByLabelText(/withdrawal amount/i), '100');
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [body] = postedBodies();
    expect(withdrawalRequestSchema.safeParse(body).success).toBe(true);
    expect(body.amount).toBe(10_000);
  });

  it('reuses one idempotency key when the creator retries after a failed attempt', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, data: {} }) }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<PayoutSettingsClient {...props()} />);
    await user.type(screen.getByLabelText(/withdrawal amount/i), '100');
    const button = screen.getByRole('button', { name: /^withdraw$/i });
    await user.click(button);
    await user.click(button);

    const bodies = postedBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[0].idempotencyKey).toBe(bodies[1].idempotencyKey);
  });
});

describe('PayoutSettingsClient rejected account', () => {
  it('explains that the account cannot be used and points somewhere actionable', async () => {
    render(<PayoutSettingsClient {...props({ status: 'rejected' })} />);

    expect(screen.getByText(/this payout account cannot be used/i)).toBeInTheDocument();
    expect(screen.getByText(/stripe has declined this connected account/i)).toBeInTheDocument();

    const support = screen.getByRole('link', { name: /support@lastdonor\.org/i });
    expect(support).toHaveAttribute('href', expect.stringContaining('mailto:support@lastdonor.org'));
  });

  it('reassures the creator that released funds are not lost', () => {
    render(<PayoutSettingsClient {...props({ status: 'rejected' })} />);
    expect(screen.getByText(/are not lost/i)).toBeInTheDocument();
  });

  it('offers no onboarding button, because retrying can only fail', () => {
    render(<PayoutSettingsClient {...props({ status: 'rejected' })} />);
    expect(screen.queryByRole('button', { name: /onboarding|fix account|connect with stripe/i })).toBeNull();
  });
});

describe('PayoutSettingsClient currency mismatch', () => {
  it('warns at account level when the account settles in a non-USD currency', () => {
    render(<PayoutSettingsClient {...props({ payoutCurrency: 'mxn' })} />);
    expect(screen.getByText(/withdrawals are blocked on this account's currency/i)).toBeInTheDocument();
    expect(screen.getByText(/your payout account settles in/i)).toHaveTextContent('MXN');
    expect(screen.getAllByRole('link', { name: /support@lastdonor\.org/i })).not.toHaveLength(0);
  });

  it('hides the withdraw control so the wrong amount cannot be sent', () => {
    render(<PayoutSettingsClient {...props({ payoutCurrency: 'jpy' })} />);
    expect(screen.queryByRole('button', { name: /^withdraw$/i })).toBeNull();
  });

  it('shows no currency warning for a USD account', () => {
    render(<PayoutSettingsClient {...props({ payoutCurrency: 'usd' })} />);
    expect(screen.queryByText(/blocked on this account's currency/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^withdraw$/i })).toBeInTheDocument();
  });
});

describe('PayoutSettingsClient campaign currency', () => {
  /*
    ⛔ THE DEFECT. A local `centsToDollars` with a hardcoded
    `currency: 'USD'` formatted every figure on this screen - the SIXTH
    hand-rolled formatter in this codebase, after the five `docs/88` F4/F5
    removed from admin, on the screen where an organiser connects the account
    their money lands in. KES has the same exponent as USD, so the DIGITS were
    right and only the symbol lied, which is exactly why nothing caught it.
  */
  it('renders a KES campaign in shillings, not dollars', () => {
    render(<PayoutSettingsClient {...props({ campaignCurrency: 'KES' })} />);

    /*
      `raisedAmount: 80_000` is 80,000 MINOR units - KES 800.00, not
      KES 80,000.00. Getting that wrong in the first draft of this test is
      the whole reason amounts are never formatted by hand.
    */
    const raised = screen.getByText('Ksh 800.00');
    expect(raised).toBeInTheDocument();
    expect(raised.textContent).not.toContain('$');
  });

  it('labels the withdrawal input with the currency being withdrawn', () => {
    render(<PayoutSettingsClient {...props({ campaignCurrency: 'KES' })} />);
    expect(screen.getByLabelText(/withdrawal amount in KES/i)).toBeInTheDocument();
  });

  it('still renders a USD campaign in dollars', () => {
    render(<PayoutSettingsClient {...props({ campaignCurrency: 'USD' })} />);
    expect(screen.getByText('$800.00')).toBeInTheDocument();
  });
});
