/**
 * The PayHero callback route.
 *
 * This route is public and unauthenticated by necessity: PayHero signs its
 * callbacks with nothing at all — no HMAC, no shared secret, no timestamp —
 * and the "API secret" it issues is not a signing key (probed 2026-10-21: it
 * is not accepted for authentication anywhere in v2). So the only safe design
 * is to treat the body as a hint and read the outcome over our own
 * authenticated call. These tests pin exactly that.
 *
 * The forgery that must not work:
 *
 *   POST /api/v1/donations/payhero/callback
 *   {"response":{"ExternalReference":"LD-…","Status":"Success","Amount":500000,
 *                "MpesaReceiptNumber":"FAKE123"}}
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const settlePayHeroRequest = vi.fn();

vi.mock('@/lib/services/payhero-settlement', () => ({
  settlePayHeroRequest: (...a: unknown[]) => settlePayHeroRequest(...a),
}));

vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));

const { POST } = await import('./route');

function callback(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** PayHero's documented callback shape, as their docs give it. */
function payheroBody(overrides: Record<string, unknown> = {}) {
  return {
    forward_url: '',
    status: true,
    response: {
      Amount: 50,
      CheckoutRequestID: 'ws_CO_14012024103543427709099876',
      ExternalReference: 'LD-22222222-2222-4222-8222-222222222222',
      MerchantRequestID: '3202-70921557-1',
      MpesaReceiptNumber: 'SAE3YULR0Y',
      Phone: '+254713572703',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      Status: 'Success',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  settlePayHeroRequest.mockResolvedValue({
    kind: 'recorded',
    amountMinor: 5_000,
    currency: 'KES',
  });
});

describe('the body is a hint, not an instruction', () => {
  it('passes only the ExternalReference to the settlement service', async () => {
    await POST(callback(payheroBody()));

    expect(settlePayHeroRequest).toHaveBeenCalledTimes(1);
    expect(settlePayHeroRequest).toHaveBeenCalledWith(
      'LD-22222222-2222-4222-8222-222222222222',
    );
  });

  /*
   * The decisive test. A forged body asserting a huge successful payment must
   * reach the settlement service as nothing more than its reference - which
   * then asks PayHero what really happened.
   */
  it('ignores Status, Amount and MpesaReceiptNumber entirely', async () => {
    await POST(
      callback(
        payheroBody({
          Status: 'Success',
          Amount: 9_999_999,
          MpesaReceiptNumber: 'FORGED123',
          ResultCode: 0,
        }),
      ),
    );

    const [arg] = settlePayHeroRequest.mock.calls[0];
    expect(arg).toBe('LD-22222222-2222-4222-8222-222222222222');
    // Nothing from the body other than the reference crossed the boundary.
    expect(settlePayHeroRequest.mock.calls[0]).toHaveLength(1);
  });

  it('believes a body that claims failure no more than one that claims success', async () => {
    // Same single argument either way: the route does not branch on the body.
    await POST(callback(payheroBody({ Status: 'Failed', ResultCode: 1032 })));

    expect(settlePayHeroRequest).toHaveBeenCalledWith(
      'LD-22222222-2222-4222-8222-222222222222',
    );
  });
});

describe('finding the reference', () => {
  it('accepts it at the top level as well as nested', async () => {
    await POST(callback({ ExternalReference: 'LD-top-level' }));
    expect(settlePayHeroRequest).toHaveBeenCalledWith('LD-top-level');
  });

  it('accepts the snake_case spelling', async () => {
    // One field the whole route depends on; a provider rename would
    // otherwise silently stop every donation settling.
    await POST(callback({ response: { external_reference: 'LD-snake' } }));
    expect(settlePayHeroRequest).toHaveBeenCalledWith('LD-snake');
  });

  it('prefers the nested value, which is where PayHero documents it', async () => {
    await POST(
      callback({
        ExternalReference: 'LD-outer',
        response: { ExternalReference: 'LD-inner' },
      }),
    );
    expect(settlePayHeroRequest).toHaveBeenCalledWith('LD-inner');
  });
});

describe('anything it chooses not to act on answers 200', () => {
  /*
   * A provider that receives a 4xx or 5xx retries, and retrying cannot turn
   * an unknown reference into a known one. Only a genuine failure on our side
   * returns 5xx, so that a retry has something to accomplish.
   */
  it('200s a body with no reference', async () => {
    const res = await POST(callback({ response: { Status: 'Success' } }));

    expect(res.status).toBe(200);
    expect((await res.json()).data.ignored).toBe('no external reference');
    expect(settlePayHeroRequest).not.toHaveBeenCalled();
  });

  it('200s an empty or unparseable body', async () => {
    expect((await POST(callback(null))).status).toBe(200);
    expect(
      (await POST({ json: async () => { throw new Error('not json'); } } as unknown as NextRequest))
        .status,
    ).toBe(200);
    expect(settlePayHeroRequest).not.toHaveBeenCalled();
  });

  it('200s a reference that is not ours, which is BETWOIN traffic or a forgery', async () => {
    settlePayHeroRequest.mockResolvedValue({ kind: 'unknown_reference' });

    const res = await POST(callback({ response: { ExternalReference: 'INV-009' } }));

    expect(res.status).toBe(200);
    expect((await res.json()).data.ignored).toBe('unknown reference');
  });

  it('200s a blank reference string', async () => {
    const res = await POST(callback({ response: { ExternalReference: '   ' } }));
    expect(res.status).toBe(200);
    expect(settlePayHeroRequest).not.toHaveBeenCalled();
  });

  it('200s each terminal outcome, naming it', async () => {
    for (const kind of ['recorded', 'already_settled', 'failed', 'still_pending']) {
      settlePayHeroRequest.mockResolvedValue({ kind, status: 'succeeded', reason: 'x' });
      const res = await POST(callback(payheroBody()));
      expect(res.status).toBe(200);
      expect((await res.json()).data.outcome).toBe(kind);
    }
  });
});

describe('failures that are worth a retry', () => {
  it('503s when PayHero credentials are missing, because the payment is real', async () => {
    const { PayHeroNotConfiguredError } = await import('@/lib/payhero');
    settlePayHeroRequest.mockRejectedValue(new PayHeroNotConfiguredError());

    const res = await POST(callback(payheroBody()));

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('PAYMENTS_UNAVAILABLE');
  });

  it('500s when the status read fails, so PayHero retries', async () => {
    // The money may well have moved; we just could not confirm it.
    settlePayHeroRequest.mockRejectedValue(new Error('socket hang up'));

    const res = await POST(callback(payheroBody()));

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL_ERROR');
  });

  it('never leaks a provider message into the donor-visible body', async () => {
    settlePayHeroRequest.mockRejectedValue(
      new Error('PayHero API error 401: Basic dGVzdDp0ZXN0 rejected'),
    );

    const text = await (await POST(callback(payheroBody()))).text();

    expect(text).not.toContain('Basic ');
    expect(text).not.toContain('dGVzdDp0ZXN0');
  });
});
