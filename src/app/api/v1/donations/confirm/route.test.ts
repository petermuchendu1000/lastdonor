/**
 * The confirm route is the only way the browser may learn that a donation
 * succeeded, so it must answer from Stripe and never from its caller.
 *
 * It is reachable without a session (`PUBLIC_API_PREFIXES`), which is correct:
 * guest donation is a core product requirement. What makes that safe is that
 * the ids it accepts are worthless unless Stripe confirms them AND the Stripe
 * metadata names the campaign the caller claims. A genuine succeeded payment
 * for campaign A must not confirm a donation on campaign B. See docs/42.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/v1/donations/confirm/route';

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';

const stripeMock = vi.hoisted(() => ({
  sessions: { retrieve: vi.fn() },
  intents: { retrieve: vi.fn() },
}));

const paymentService = vi.hoisted(() => ({ processPaymentSuccess: vi.fn() }));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { retrieve: stripeMock.sessions.retrieve } },
    paymentIntents: { retrieve: stripeMock.intents.retrieve },
  },
}));

vi.mock('@/lib/services/payment-service', () => ({
  processPaymentSuccess: paymentService.processPaymentSuccess,
}));

function post(body: unknown): Promise<Response> {
  const request = {
    json: async () => body,
  } as unknown as NextRequest;
  return POST(request) as unknown as Promise<Response>;
}

const SUCCEEDED_INTENT = {
  id: 'pi_test_ok',
  status: 'succeeded',
  amount: 2500,
  amount_received: 2500,
  metadata: { campaignId: CAMPAIGN_ID },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/donations/confirm', () => {
  it('rejects a request that does not say which campaign it is about', async () => {
    const res = await post({ sessionId: 'cs_test_ok' });
    expect(res.status).toBe(400);
    expect(stripeMock.sessions.retrieve).not.toHaveBeenCalled();
  });

  it('rejects a request with no Stripe id', async () => {
    const res = await post({ campaignId: CAMPAIGN_ID });
    expect(res.status).toBe(400);
  });

  it('confirms a succeeded payment with the amount Stripe reported', async () => {
    stripeMock.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_ok',
      payment_intent: 'pi_test_ok',
      payment_status: 'paid',
      status: 'complete',
      amount_total: 2500,
      metadata: { campaignId: CAMPAIGN_ID },
    });
    stripeMock.intents.retrieve.mockResolvedValue(SUCCEEDED_INTENT);

    const res = await post({ campaignId: CAMPAIGN_ID, sessionId: 'cs_test_ok' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, state: 'succeeded', amount: 2500 });
    expect(paymentService.processPaymentSuccess).toHaveBeenCalledWith(SUCCEEDED_INTENT);
  });

  it('refuses to confirm a succeeded payment that belongs to another campaign', async () => {
    stripeMock.sessions.retrieve.mockResolvedValue({
      id: 'cs_test_other',
      payment_intent: 'pi_test_other',
      payment_status: 'paid',
      status: 'complete',
      amount_total: 2500,
      metadata: { campaignId: OTHER_CAMPAIGN_ID },
    });
    stripeMock.intents.retrieve.mockResolvedValue({
      ...SUCCEEDED_INTENT,
      id: 'pi_test_other',
      metadata: { campaignId: OTHER_CAMPAIGN_ID },
    });

    const res = await post({ campaignId: CAMPAIGN_ID, sessionId: 'cs_test_other' });
    const json = await res.json();

    expect(json).toEqual({ ok: true, state: 'unverified', amount: null });
    expect(paymentService.processPaymentSuccess).not.toHaveBeenCalled();
  });

  it('reports a still-settling payment without an amount', async () => {
    stripeMock.intents.retrieve.mockResolvedValue({
      ...SUCCEEDED_INTENT,
      status: 'processing',
      amount_received: 0,
    });

    const res = await post({ campaignId: CAMPAIGN_ID, paymentIntentId: 'pi_test_ok' });
    const json = await res.json();

    expect(json).toEqual({ ok: true, state: 'processing', amount: null });
    expect(paymentService.processPaymentSuccess).not.toHaveBeenCalled();
  });

  it('reports a declined payment as failed', async () => {
    stripeMock.intents.retrieve.mockResolvedValue({
      ...SUCCEEDED_INTENT,
      status: 'requires_payment_method',
      amount_received: 0,
    });

    const res = await post({ campaignId: CAMPAIGN_ID, paymentIntentId: 'pi_test_ok' });
    expect(await res.json()).toEqual({ ok: true, state: 'failed', amount: null });
    expect(paymentService.processPaymentSuccess).not.toHaveBeenCalled();
  });

  it('does not confirm an id Stripe has never heard of', async () => {
    stripeMock.intents.retrieve.mockRejectedValue(
      Object.assign(new Error('No such payment_intent'), { statusCode: 404 }),
    );

    const res = await post({ campaignId: CAMPAIGN_ID, paymentIntentId: 'pi_made_up' });
    expect(await res.json()).toEqual({ ok: true, state: 'unverified', amount: null });
    expect(paymentService.processPaymentSuccess).not.toHaveBeenCalled();
  });
});
