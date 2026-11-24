/**
 * The Palpluss callback route.
 *
 * Palpluss DOES sign its callbacks, which PayHero does not — so unlike the
 * PayHero route there is something to verify here. These tests pin the two
 * things that follow from that, and they pull in opposite directions:
 *
 *   1. A signature is checked, and a BAD one is refused without a lookup.
 *   2. A GOOD one still does not settle anything by itself. The outcome comes
 *      from re-reading the transaction, because `docs/180` measured Palpluss
 *      answering `success: true` with `resultCode: "0"` on a transaction that
 *      settled FAILED twenty-nine seconds later. A verified body is a claim
 *      about who sent it, not about whether a donor paid.
 *
 * The forgery that must not work, signed or otherwise:
 *
 *   POST /api/v1/donations/palpluss/callback
 *   {"event":"transaction.updated","event_type":"transaction.success",
 *    "transaction":{"id":"…","status":"SUCCESS","amount":9000000,
 *                   "mpesa_receipt":"FAKE123"}}
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

const settlePalplussRequest = vi.fn();

vi.mock('@/lib/services/palpluss-settlement', () => ({
  settlePalplussRequest: (...a: unknown[]) => settlePalplussRequest(...a),
}));

vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));

const { POST } = await import('./route');
const { PalplussNotConfiguredError } = await import('@/lib/palpluss');

const SECRET = `whsec_${Buffer.from('palpluss-route-test-key-00000000', 'utf8').toString('base64')}`;
const TX = '1cbdbaca-2a6b-4e1c-84f4-23e214794b6c';
const ID = 'msg_route_1';

/** Palpluss's documented callback shape. */
function palplussBody(over: Record<string, unknown> = {}) {
  return {
    event: 'transaction.updated',
    event_type: 'transaction.success',
    transaction: {
      id: TX,
      tenant_id: '69ce89de-1483-4722-bbe0-f679bacfa5cd',
      type: 'STK',
      status: 'SUCCESS',
      amount: 50,
      currency: 'KES',
      phone_number: '254712345678',
      external_reference: 'LD-000001',
      provider: 'm-pesa',
      mpesa_receipt: 'UK2JG0GO0Z',
      result_code: '0',
      ...over,
    },
  };
}

/**
 * Sign the way the published spec describes, implemented independently of the
 * verifier so the route test is not circular.
 */
function sign(rawBody: string, timestamp: number, id = ID, secret = SECRET): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`, 'utf8').digest('base64');
}

/**
 * A request whose `text()` returns EXACTLY the bytes given.
 *
 * ⛔ `text()`, not `json()`. The route must verify over the raw bytes: a
 * parse-then-restringify re-orders keys and drops whitespace, so the digest
 * would cover a different document and every verification would fail.
 */
function callback(
  rawBody: string,
  headers: Record<string, string | null> = {},
): NextRequest {
  return {
    text: async () => rawBody,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as NextRequest;
}

function signedCallback(rawBody: string, over: Record<string, string | null> = {}) {
  const ts = Math.floor(Date.now() / 1000);
  return callback(rawBody, {
    'webhook-id': ID,
    'webhook-timestamp': String(ts),
    'webhook-signature': `v1,${sign(rawBody, ts)}`,
    ...over,
  });
}

beforeEach(() => {
  settlePalplussRequest.mockReset();
  settlePalplussRequest.mockResolvedValue({ kind: 'still_pending' });
  vi.stubEnv('PALPLUSS_WEBHOOK_SECRET', SECRET);
});

describe('POST /api/v1/donations/palpluss/callback', () => {
  // ── The body is read for one id and nothing else ────────────────────────

  it('passes ONLY the transaction id to settlement', async () => {
    const raw = JSON.stringify(palplussBody());
    const res = await POST(signedCallback(raw));

    expect(res.status).toBe(200);
    expect(settlePalplussRequest).toHaveBeenCalledTimes(1);
    // One argument, and it is the id. Not the status, not the amount.
    expect(settlePalplussRequest.mock.calls[0]).toEqual([TX]);
  });

  /*
    ⛔ The forgery. A body claiming a nine-million-shilling success, correctly
    signed, still produces nothing but a lookup — because the route does not
    read `status`, `amount` or `mpesa_receipt` at all. The settlement decides,
    and it asks Palpluss.
  */
  it('a signed body claiming a huge success is still only a lookup', async () => {
    settlePalplussRequest.mockResolvedValue({ kind: 'failed', reason: 'no' });
    const raw = JSON.stringify(
      palplussBody({ status: 'SUCCESS', amount: 9_000_000, mpesa_receipt: 'FAKE123' }),
    );

    const res = await POST(signedCallback(raw));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(settlePalplussRequest.mock.calls[0]).toEqual([TX]);
    // The route reports what settlement decided, not what the body claimed.
    expect(json.data.outcome).toBe('failed');
  });

  it('returns only the outcome kind, never the donor or the money', async () => {
    settlePalplussRequest.mockResolvedValue({
      kind: 'recorded',
      amountMinor: 5_000,
      currency: 'KES',
      donationId: 'd-1',
    });
    const res = await POST(signedCallback(JSON.stringify(palplussBody())));
    const json = await res.json();

    expect(json.data.outcome).toBe('recorded');
    const serialised = JSON.stringify(json);
    expect(serialised).not.toContain('5000');
    expect(serialised).not.toContain('d-1');
  });

  // ── Signature handling ───────────────────────────────────────────────────

  it('accepts a correctly signed delivery and reports it as signed', async () => {
    const res = await POST(signedCallback(JSON.stringify(palplussBody())));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.signed).toBe(true);
  });

  /*
    Today's real case: no webhook domain is registered on the tenant, so
    Palpluss signs nothing. Refusing unsigned deliveries would refuse all of
    them, and it is survivable only because the body is not trusted.
  */
  it('processes an UNSIGNED delivery, and says it was unsigned', async () => {
    const res = await POST(callback(JSON.stringify(palplussBody())));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.signed).toBe(false);
    expect(settlePalplussRequest).toHaveBeenCalledWith(TX);
  });

  /*
    ⛔ And the distinction that is not cosmetic: headers PRESENT and WRONG is
    not an unregistered domain. It is refused outright, and before any lookup.
  */
  it('REFUSES a bad signature with 401 and never calls settlement', async () => {
    const raw = JSON.stringify(palplussBody());
    const ts = Math.floor(Date.now() / 1000);
    const res = await POST(
      callback(raw, {
        'webhook-id': ID,
        'webhook-timestamp': String(ts),
        'webhook-signature': `v1,${sign(raw, ts, ID, `whsec_${Buffer.from('a-different-secret').toString('base64')}`)}`,
      }),
    );

    expect(res.status).toBe(401);
    expect(settlePalplussRequest).not.toHaveBeenCalled();
  });

  it('REFUSES a body tampered with after signing', async () => {
    const raw = JSON.stringify(palplussBody());
    const ts = Math.floor(Date.now() / 1000);
    const signature = sign(raw, ts);
    const tampered = JSON.stringify(palplussBody({ amount: 9_000_000 }));

    const res = await POST(
      callback(tampered, {
        'webhook-id': ID,
        'webhook-timestamp': String(ts),
        'webhook-signature': `v1,${signature}`,
      }),
    );

    expect(res.status).toBe(401);
    expect(settlePalplussRequest).not.toHaveBeenCalled();
  });

  it('REFUSES a replayed delivery whose timestamp is outside the window', async () => {
    const raw = JSON.stringify(palplussBody());
    const old = Math.floor(Date.now() / 1000) - 10_000;
    const res = await POST(
      callback(raw, {
        'webhook-id': ID,
        'webhook-timestamp': String(old),
        'webhook-signature': `v1,${sign(raw, old)}`,
      }),
    );

    expect(res.status).toBe(401);
    expect(settlePalplussRequest).not.toHaveBeenCalled();
  });

  /*
    The raw body is what gets verified. This is the test that would fail if
    somebody replaced `request.text()` with `request.json()` and
    re-serialised: the signature here covers a document whose key order and
    spacing differ from what `JSON.stringify(JSON.parse(x))` produces.
  */
  it('verifies over the RAW bytes, not a re-serialised object', async () => {
    const raw = `{\n  "transaction" : {"id":"${TX}","status":"SUCCESS"},\n  "event":"transaction.updated"\n}`;
    // Proof the fixture discriminates: a round-trip changes the bytes.
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);

    const res = await POST(signedCallback(raw));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.signed).toBe(true);
  });

  // ── Bodies and references we cannot act on ───────────────────────────────

  it('ignores a payload with no transaction id, with 200', async () => {
    const res = await POST(signedCallback(JSON.stringify({ event: 'webhook.test' })));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.ignored).toBe('no transaction id');
    expect(settlePalplussRequest).not.toHaveBeenCalled();
  });

  it('ignores an unparseable body, with 200', async () => {
    const res = await POST(signedCallback('not json at all'));
    expect(res.status).toBe(200);
    expect(settlePalplussRequest).not.toHaveBeenCalled();
  });

  /*
    The isolation boundary. The tenant is shared with two other products, so a
    transaction id that is not ours is the EXPECTED case, not an error — and
    200, because no retry will ever make it ours.
  */
  it('answers 200 to a transaction that is not ours, so Palpluss stops retrying', async () => {
    settlePalplussRequest.mockResolvedValue({ kind: 'unknown_reference' });
    const res = await POST(signedCallback(JSON.stringify(palplussBody())));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.ignored).toBe('unknown transaction');
  });

  // ── Failures worth retrying ──────────────────────────────────────────────

  it('answers 503 when the API key is unset, so a real payment is retried', async () => {
    settlePalplussRequest.mockRejectedValue(new PalplussNotConfiguredError());
    const res = await POST(signedCallback(JSON.stringify(palplussBody())));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error.code).toBe('PAYMENTS_UNAVAILABLE');
  });

  it('answers 500 when the status read fails, so a real payment is retried', async () => {
    settlePalplussRequest.mockRejectedValue(new Error('palpluss unreachable'));
    const res = await POST(signedCallback(JSON.stringify(palplussBody())));

    expect(res.status).toBe(500);
  });

  /*
    ANTI-VACUITY. Every refusal test above asserts a non-200; none would
    notice a route that refused everything. This pins that the happy path
    really does reach settlement.
  */
  it('CONTROL: the ordinary signed delivery settles and answers 200', async () => {
    settlePalplussRequest.mockResolvedValue({
      kind: 'recorded',
      amountMinor: 5_000,
      currency: 'KES',
      donationId: 'd-1',
    });
    const res = await POST(signedCallback(JSON.stringify(palplussBody())));
    expect(res.status).toBe(200);
    expect(settlePalplussRequest).toHaveBeenCalledTimes(1);
  });
});
