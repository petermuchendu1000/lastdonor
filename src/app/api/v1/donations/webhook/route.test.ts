/**
 * Stripe webhook acknowledgement semantics (audit docs/29 P0-3).
 *
 * The handler used to catch every error and still return 200, with the comment
 * "Still return 200 to prevent Stripe retries for application errors". Stripe
 * treats 200 as "handled", so a refund that failed to record, or a donation
 * whose transaction rolled back, was never retried and nothing reconciled it.
 *
 * An event we deliberately ignore must still be acknowledged, so the two cases
 * have to stay distinguishable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type Stripe from 'stripe';

const constructEvent = vi.fn();
const paymentIntentsRetrieve = vi.fn();

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: (...args: unknown[]) => constructEvent(...args) },
    paymentIntents: { retrieve: (...args: unknown[]) => paymentIntentsRetrieve(...args) },
  },
}));

const processPaymentSuccess = vi.fn();
const processPaymentFailed = vi.fn();
const processRefund = vi.fn();

vi.mock('@/lib/services/payment-service', () => ({
  processPaymentSuccess: (...args: unknown[]) => processPaymentSuccess(...args),
  processPaymentFailed: (...args: unknown[]) => processPaymentFailed(...args),
  processRefund: (...args: unknown[]) => processRefund(...args),
}));

const processIdentityVerificationEvent = vi.fn();
vi.mock('@/lib/services/identity-verification-service', () => ({
  processIdentityVerificationEvent: (...args: unknown[]) => processIdentityVerificationEvent(...args),
}));

const logError = vi.fn();
vi.mock('@/lib/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/errors')>();
  return { ...actual, logError: (...args: unknown[]) => logError(...args) };
});

function request(): NextRequest {
  return {
    text: async () => '{"raw":"body"}',
    headers: new Headers({ 'stripe-signature': 'sig_test' }),
  } as unknown as NextRequest;
}

function event(type: string, id = `evt_${Math.random().toString(36).slice(2)}`): Stripe.Event {
  return {
    id,
    type,
    data: { object: { id: 'pi_1', amount: 2_000, metadata: {} } },
  } as unknown as Stripe.Event;
}

/** Fresh module instance, so the in-memory dedup set starts empty. */
async function loadRoute() {
  vi.resetModules();
  return (await import('./route')).POST;
}

beforeEach(() => {
  vi.clearAllMocks();
  processPaymentSuccess.mockResolvedValue(undefined);
  processPaymentFailed.mockResolvedValue(undefined);
  processRefund.mockResolvedValue(undefined);
});

describe('POST /api/v1/donations/webhook', () => {
  it('returns 400 for a missing signature without touching any handler', async () => {
    const POST = await loadRoute();
    const res = await POST({
      text: async () => '{}',
      headers: new Headers(),
    } as unknown as NextRequest);

    expect(res.status).toBe(400);
    expect(processPaymentSuccess).not.toHaveBeenCalled();
  });

  it('returns 400 when the signature does not verify', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('Webhook signature verification failed');
    });
    const POST = await loadRoute();

    const res = await POST(request());
    expect(res.status).toBe(400);
  });

  it('returns 200 when a handler succeeds', async () => {
    constructEvent.mockReturnValue(event('payment_intent.succeeded'));
    const POST = await loadRoute();

    const res = await POST(request());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: true });
    expect(processPaymentSuccess).toHaveBeenCalledTimes(1);
  });

  it('returns 5xx when a handler throws, so Stripe retries', async () => {
    processPaymentSuccess.mockRejectedValue(new Error('CHECK constraint violated'));
    constructEvent.mockReturnValue(event('payment_intent.succeeded'));
    const POST = await loadRoute();

    const res = await POST(request());

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(logError).toHaveBeenCalled();
  });

  it('returns 5xx when a refund fails to record', async () => {
    processRefund.mockRejectedValue(new Error('rollback'));
    constructEvent.mockReturnValue(event('charge.refunded'));
    const POST = await loadRoute();

    const res = await POST(request());

    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('still returns 200 for an event type it intentionally ignores', async () => {
    constructEvent.mockReturnValue(event('customer.subscription.updated'));
    const POST = await loadRoute();

    const res = await POST(request());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: true });
    expect(processPaymentSuccess).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('re-processes a retried event after a failure instead of short-circuiting on the dedup set', async () => {
    const evt = event('payment_intent.succeeded', 'evt_retry_me');
    constructEvent.mockReturnValue(evt);
    const POST = await loadRoute();

    processPaymentSuccess.mockRejectedValueOnce(new Error('transient db error'));
    const first = await POST(request());
    expect(first.status).toBeGreaterThanOrEqual(500);

    // Stripe redelivers the SAME event id. It must not be treated as already
    // handled just because this instance saw it once.
    const second = await POST(request());
    expect(second.status).toBe(200);
    expect(processPaymentSuccess).toHaveBeenCalledTimes(2);
  });

  it('deduplicates a successfully handled event within the same instance', async () => {
    constructEvent.mockReturnValue(event('payment_intent.succeeded', 'evt_once'));
    const POST = await loadRoute();

    await POST(request());
    const second = await POST(request());

    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ deduplicated: true });
    expect(processPaymentSuccess).toHaveBeenCalledTimes(1);
  });

  it('returns 5xx when a subscription invoice cannot be processed', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_invoice',
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_1', payment_intent: 'pi_sub_1' } },
    } as unknown as Stripe.Event);
    paymentIntentsRetrieve.mockResolvedValue({ id: 'pi_sub_1', status: 'succeeded' });
    processPaymentSuccess.mockRejectedValue(new Error('no campaignId'));
    const POST = await loadRoute();

    const res = await POST(request());

    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
