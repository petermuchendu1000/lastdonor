/**
 * Withdrawals were 100% dead end-to-end.
 *
 * `withdrawalRequestSchema` requires a non-optional uuid `idempotencyKey`, and
 * this client sent only `{ amount }`. Every withdrawal therefore 400'd with a
 * validation message and nobody could be paid. The route's own unit test
 * hand-built the request body, which is exactly why CI never noticed.
 *
 * These tests assert the payload the component actually puts on the wire
 * against the real server validator, so the two cannot drift apart again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinancesClient from '@/components/dashboard/FinancesClient';
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
  goalAmount: 100_000,
  raisedAmount: 80_000,
  totalReleasedAmount: 50_000,
  totalWithdrawnAmount: 0,
  inFlightAmount: 0,
  availableBalance: 50_000,
};

const defaultProps = {
  stripeConnectStatus: 'verified',
  hasStripeAccount: true,
  campaigns: [campaign],
  withdrawals: [],
};

/** Every JSON body passed to fetch, in call order. */
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

async function fillAndWithdraw(amount: string, clicks = 1) {
  const user = userEvent.setup();
  render(<FinancesClient {...defaultProps} />);
  await user.type(screen.getByLabelText(/withdrawal amount for Help Maria/i), amount);
  const button = screen.getByRole('button', { name: /^withdraw$/i });
  for (let i = 0; i < clicks; i++) await user.click(button);
  return user;
}

describe('FinancesClient withdrawal payload', () => {
  it('sends a body the server validator accepts', async () => {
    await fillAndWithdraw('100');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [body] = postedBodies();

    // The real validator, not a restatement of it.
    const parsed = withdrawalRequestSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.amount).toBe(10_000);
  });

  it('posts to the withdraw endpoint as JSON', async () => {
    await fillAndWithdraw('25.50');

    const [url, init] = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(url).toBe(`/api/v1/user-campaigns/${CAMPAIGN_ID}/withdraw`);
    expect((init as RequestInit).method).toBe('POST');
    expect(postedBodies()[0].amount).toBe(2_550);
  });

  it('reuses one idempotency key when the creator retries after a failed attempt, so the server dedups instead of paying twice', async () => {
    const ok = {
      ok: true,
      json: async () => ({ ok: true, data: { withdrawalId: 'w1', status: 'processing' } }),
    };
    global.fetch = vi
      .fn()
      // A lost response is the dangerous case: the transfer may well have been
      // created. The retry must carry the SAME key.
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(ok) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<FinancesClient {...defaultProps} />);
    await user.type(screen.getByLabelText(/withdrawal amount for Help Maria/i), '100');
    const button = screen.getByRole('button', { name: /^withdraw$/i });
    await user.click(button);
    await user.click(button);

    const bodies = postedBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[0].idempotencyKey).toBe(bodies[1].idempotencyKey);
    expect(withdrawalRequestSchema.safeParse(bodies[1]).success).toBe(true);
  });

  it('cannot be double-submitted while a withdrawal is in flight', async () => {
    let release: (() => void) | undefined;
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ ok: true, json: async () => ({ ok: true, data: {} }) });
        }),
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<FinancesClient {...defaultProps} />);
    await user.type(screen.getByLabelText(/withdrawal amount for Help Maria/i), '100');
    const button = screen.getByRole('button', { name: /^withdraw$/i });
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    release?.();
  });

  it('mints a fresh key for the next form-fill once a withdrawal is accepted', async () => {
    const user = await fillAndWithdraw('100');

    await user.type(screen.getByLabelText(/withdrawal amount for Help Maria/i), '200');
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));

    const bodies = postedBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].amount).toBe(20_000);
    expect(bodies[1].idempotencyKey).not.toBe(bodies[0].idempotencyKey);
  });

  it('does not call the API at all for an invalid amount', async () => {
    const user = userEvent.setup();
    render(<FinancesClient {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /^withdraw$/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
