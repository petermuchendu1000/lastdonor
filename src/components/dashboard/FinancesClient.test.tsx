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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  // The campaign's own currency; every amount below is in ITS minor units.
  // Required, not defaulted - a local `fmt()` used to print '$' over all of
  // them whatever currency the campaign held (`docs/92`).
  currency: 'USD',
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

describe('FinancesClient currency', () => {
  /*
    ⛔ THE DEFECT. Four `campaigns.reduce(…)` calls produced one total each
    and a local `fmt(cents) => '$' + cents / 100` printed them - a FIFTH
    hand-rolled formatter, on the screen an organiser uses to take money out.
    A campaign is single-currency by composite FK (`docs/92`); a PERSON is
    not, so an organiser with a KES and a USD campaign saw four figures that
    were the sum of two different kinds of money, under a dollar sign.
  */
  const kes = { ...campaign, id: '22222222-2222-2222-2222-222222222222', currency: 'KES', raisedAmount: 1_840_000, availableBalance: 0, totalReleasedAmount: 0, totalWithdrawnAmount: 0 };

  it('renders a KES campaign in shillings, not dollars', () => {
    render(<FinancesClient {...defaultProps} campaigns={[kes]} />);
    // 1_840_000 minor units of KES.
    expect(screen.getAllByText('Ksh 18,400.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('$18,400.00')).toBeNull();
  });

  it('⛔ a mixed-currency organiser gets a figure PER CURRENCY, never one sum', () => {
    render(<FinancesClient {...defaultProps} campaigns={[kes, campaign]} />);

    // Both totals appear; the blended 1_920_000 (18,400.00 + 800.00) does not.
    expect(screen.getAllByText('Ksh 18,400.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$800.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('$19,200.00')).toBeNull();
    expect(screen.queryByText('Ksh 19,200.00')).toBeNull();
  });

  /*
    ⚠️ This used to assert that a KES campaign's WITHDRAW FIELD is labelled
    "KES" rather than "$". The field was right about the label and wrong to be
    there at all: `withdraw/route.ts` refuses any campaign whose currency is
    not `PLATFORM_PAYOUT_CURRENCY`, so that form offered an action the server
    answers 400 `WRONG_PAYMENT_RAIL` to - `docs/119`'s rule, and `docs/121`
    closed it.

    So the assertion is repointed rather than deleted: a currency the rail
    cannot pay shows an explanation and NO form, a payable one still shows the
    form, and the label is still derived from the campaign rather than
    hardcoded. All three matter; the first is the fix, the second is the
    control, and the third is the tripwire the original test existed to be.
  */
  it('⛔ a currency the rail cannot pay shows no withdraw form', () => {
    render(
      <FinancesClient
        {...defaultProps}
        campaigns={[{ ...campaign, currency: 'KES', availableBalance: 500_000 }]}
      />,
    );
    expect(screen.queryByPlaceholderText(/^0\.01$|^1$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^withdraw$/i })).toBeNull();
    expect(screen.getByText(/cannot pay out KES yet/i)).toBeTruthy();
  });

  it('and a payable currency still does (the control)', () => {
    render(
      <FinancesClient
        {...defaultProps}
        campaigns={[{ ...campaign, currency: 'USD', availableBalance: 500_000 }]}
      />,
    );
    expect(screen.getAllByRole('button', { name: /^withdraw$/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/cannot pay out/i)).toBeNull();
  });

  it('⚠️ and the field is still labelled from the campaign, not a literal', () => {
    /*
      The tripwire. Only USD is payable today, so no rendered assertion can
      distinguish "derived from the campaign" from "hardcoded USD" - the
      source is the only place that difference is visible.
    */
    const src = readFileSync(
      resolve(__dirname, 'FinancesClient.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/\{campaign\.currency\}/);
    expect(src).toMatch(/minorToMajor\(1, campaign\.currency\)/);
  });
});
