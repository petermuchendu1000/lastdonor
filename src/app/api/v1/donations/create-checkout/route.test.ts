/**
 * Checkout metadata contract (audit docs/29 P1-2).
 *
 * Stripe forbids `payment_intent_data` in subscription mode, so a recurring
 * donation's PaymentIntents carry no metadata of their own. The donor context
 * on `subscription_data.metadata` is therefore the ONLY copy a recurring
 * charge can be recovered from, and `payment-service` resolves it via
 * invoice -> subscription. These tests pin that contract from the writing end:
 * if this route stops writing the full context there, recurring donations
 * silently stop being recorded again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';

const sessionsCreate = vi.fn();
vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: (...args: unknown[]) => sessionsCreate(...args) } } },
}));

const campaignRows: Record<string, unknown>[] = [];
vi.mock('@/db', () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(campaignRows),
  };
  return { db: { select: () => chain } };
});

const { POST } = await import('./route');

function request(body: Record<string, unknown>): NextRequest {
  return {
    json: async () => body,
    headers: new Headers({ origin: 'https://lastdonor.org' }),
  } as unknown as NextRequest;
}

const baseBody = {
  campaignId: CAMPAIGN_ID,
  amount: 2_500,
  donorName: 'Grace',
  donorEmail: 'grace@example.com',
  donorLocation: 'Austin, TX',
  isAnonymous: false,
  subscribedToUpdates: true,
};

const REQUIRED_KEYS = [
  'campaignId',
  'donorName',
  'donorEmail',
  'donorLocation',
  'message',
  'isAnonymous',
  'isRecurring',
  'subscribedToUpdates',
];

beforeEach(() => {
  vi.clearAllMocks();
  campaignRows.length = 0;
  campaignRows.push({ id: CAMPAIGN_ID, title: 'Help Maria', slug: 'help-maria', status: 'active' });
  sessionsCreate.mockResolvedValue({ client_secret: 'cs_test_secret' });
});

describe('POST /api/v1/donations/create-checkout', () => {
  it('puts the full donor context on subscription_data for a recurring donation', async () => {
    const res = await POST(request({ ...baseBody, isRecurring: true }));
    expect(res.status).toBe(200);

    const args = sessionsCreate.mock.calls[0][0];
    expect(args.mode).toBe('subscription');
    // Stripe rejects payment_intent_data in subscription mode.
    expect(args.payment_intent_data).toBeUndefined();

    expect(Object.keys(args.subscription_data.metadata).sort()).toEqual([...REQUIRED_KEYS].sort());
    expect(args.subscription_data.metadata).toMatchObject({
      campaignId: CAMPAIGN_ID,
      donorEmail: 'grace@example.com',
      isRecurring: 'true',
      subscribedToUpdates: 'true',
    });
  });

  it('keeps the session, subscription and PaymentIntent copies identical', async () => {
    await POST(request({ ...baseBody, isRecurring: true }));
    const recurring = sessionsCreate.mock.calls[0][0];
    expect(recurring.metadata).toEqual(recurring.subscription_data.metadata);

    sessionsCreate.mockClear();

    await POST(request({ ...baseBody, isRecurring: false }));
    const oneOff = sessionsCreate.mock.calls[0][0];
    expect(oneOff.mode).toBe('payment');
    expect(oneOff.subscription_data).toBeUndefined();
    expect(oneOff.payment_intent_data.metadata).toEqual(oneOff.metadata);
    expect(oneOff.payment_intent_data.metadata.isRecurring).toBe('false');
  });

  it('writes every metadata value as a string, as the Stripe API requires', async () => {
    await POST(request({ ...baseBody, isRecurring: true, message: 'thank you' }));
    const args = sessionsCreate.mock.calls[0][0];

    for (const value of Object.values(args.subscription_data.metadata)) {
      expect(typeof value).toBe('string');
    }
    expect(args.subscription_data.metadata.message).toBe('thank you');
  });

  it('rejects a campaign that is not accepting donations', async () => {
    campaignRows.length = 0;
    const res = await POST(request({ ...baseBody, isRecurring: true }));

    expect(res.status).toBe(404);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('rejects an invalid body before calling Stripe', async () => {
    const res = await POST(request({ campaignId: 'not-a-uuid', amount: 1 }));

    expect(res.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  /*
    A key Stripe refuses is not a failed payment, it is a deployment that
    cannot take money at all. Verified in production 2026-10-16: the Fly
    secret was a placeholder, every call here threw, and every donor read
    "Failed to create checkout session" - which sounds retryable and is not.
    The `type` field asserted below is the real stripe-node shape, checked
    against the live API with a deliberately invalid key, not assumed.
  */
  describe('when STRIPE_SECRET_KEY is not a working key', () => {
    function authError() {
      return Object.assign(new Error('Invalid API Key provided'), {
        type: 'StripeAuthenticationError',
        statusCode: 401,
      });
    }

    it('answers 503, not 500: this is unavailability, not a transient fault', async () => {
      sessionsCreate.mockRejectedValue(authError());
      const res = await POST(request({ ...baseBody, isRecurring: false }));

      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('PAYMENTS_UNAVAILABLE');
    });

    it('tells the donor it is our fault and that nothing was charged', async () => {
      sessionsCreate.mockRejectedValue(authError());
      const body = await (await POST(request({ ...baseBody, isRecurring: false }))).json();

      expect(body.error.message).toMatch(/problem on our side/);
      expect(body.error.message).toMatch(/nothing has been charged/);
      expect(body.error.message).toMatch(/support@lastdonor\.org/);
    });

    it('never puts the key, or anything resembling one, in the response', async () => {
      sessionsCreate.mockRejectedValue(
        Object.assign(new Error('Invalid API Key provided: sk_test_abc123'), {
          type: 'StripeAuthenticationError',
        }),
      );
      const text = await (await POST(request({ ...baseBody, isRecurring: false }))).text();

      expect(text).not.toMatch(/sk_(test|live)_/);
    });

    it('leaves every other Stripe failure as a 500', async () => {
      sessionsCreate.mockRejectedValue(
        Object.assign(new Error('card_declined'), { type: 'StripeCardError' }),
      );
      const res = await POST(request({ ...baseBody, isRecurring: false }));

      expect(res.status).toBe(500);
      expect((await res.json()).error.code).toBe('INTERNAL_ERROR');
    });
  });
});
