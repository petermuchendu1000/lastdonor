import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  TIMESTAMP_TOLERANCE_SECONDS,
  callbackTransactionId,
  expectedSignature,
  verifyPalplussSignature,
} from './palpluss-webhook';

/*
  A real `whsec_` secret is base64 after the prefix. This is a throwaway.
*/
const SECRET = `whsec_${Buffer.from('palpluss-test-signing-key-0123456789', 'utf8').toString('base64')}`;

const BODY = JSON.stringify({
  event: 'transaction.updated',
  event_type: 'transaction.success',
  transaction: {
    id: '1cbdbaca-2a6b-4e1c-84f4-23e214794b6c',
    status: 'SUCCESS',
    amount: 1,
    currency: 'KES',
    phone_number: '254712345678',
    external_reference: 'LD-ABC123XYZ',
    mpesa_receipt: 'LGR019G3J2',
    result_code: '0',
  },
});

const NOW = 1_795_000_000;
const ID = 'msg_2abc';

/**
 * Sign the way the published spec describes, implemented INDEPENDENTLY of the
 * module under test.
 *
 * ⚠️ Calling `expectedSignature` to build the fixture would make every
 * signature test circular: any algorithm change — a different separator, hex
 * instead of base64, the un-decoded secret — would change both sides at once
 * and the suite would stay green. This repeats the algorithm on purpose.
 */
function signLikePalpluss(args: {
  id: string;
  timestamp: number;
  body: string;
  secret?: string;
  /** When true, sign with the literal post-prefix TEXT instead of decoding. */
  undecodedKey?: boolean;
}): string {
  const secret = args.secret ?? SECRET;
  const material = secret.replace(/^whsec_/, '');
  const key = args.undecodedKey ? Buffer.from(material, 'utf8') : Buffer.from(material, 'base64');
  const mac = createHmac('sha256', key)
    .update(`${args.id}.${args.timestamp}.${args.body}`, 'utf8')
    .digest('base64');
  return mac;
}

function verify(over: Partial<Parameters<typeof verifyPalplussSignature>[0]> = {}) {
  return verifyPalplussSignature({
    webhookId: ID,
    webhookTimestamp: String(NOW),
    webhookSignature: `v1,${signLikePalpluss({ id: ID, timestamp: NOW, body: BODY })}`,
    rawBody: BODY,
    secret: SECRET,
    nowSeconds: NOW,
    ...over,
  });
}

describe('verifyPalplussSignature', () => {
  it('accepts a correctly signed callback', () => {
    expect(verify()).toEqual({ kind: 'valid', webhookId: ID });
  });

  it('agrees with an independent implementation of the published algorithm', () => {
    // If this fails, the module and the spec have diverged — not the fixture.
    expect(expectedSignature({ webhookId: ID, webhookTimestamp: String(NOW), rawBody: BODY, secret: SECRET })).toBe(
      signLikePalpluss({ id: ID, timestamp: NOW, body: BODY }),
    );
  });

  /*
    Hazard 1 in the module header. Signing with the post-prefix text rather
    than its base64 DECODING yields a perfectly well-formed signature that
    never matches, with nothing to see in any log. Without this test the
    mistake is invisible.
  */
  it('derives the key by base64-decoding the secret, not from its text', () => {
    const undecoded = signLikePalpluss({ id: ID, timestamp: NOW, body: BODY, undecodedKey: true });
    expect(undecoded).not.toBe(signLikePalpluss({ id: ID, timestamp: NOW, body: BODY }));
    expect(verify({ webhookSignature: `v1,${undecoded}` })).toMatchObject({ kind: 'invalid' });
  });

  it('reports a callback with no signature headers as unsigned, not invalid', () => {
    // Palpluss signs per registered domain and sends UNSIGNED to any other.
    // Conflating that with a forgery would make a correct delivery look hostile.
    expect(
      verify({ webhookId: null, webhookTimestamp: null, webhookSignature: null }),
    ).toEqual({ kind: 'unsigned' });
  });

  it('rejects an incomplete header set rather than calling it unsigned', () => {
    expect(verify({ webhookSignature: null })).toMatchObject({ kind: 'invalid' });
    expect(verify({ webhookId: null })).toMatchObject({ kind: 'invalid' });
    expect(verify({ webhookTimestamp: null })).toMatchObject({ kind: 'invalid' });
  });

  it('rejects a tampered body', () => {
    const tampered = BODY.replace('"amount":1', '"amount":9000000');
    expect(verify({ rawBody: tampered })).toMatchObject({ kind: 'invalid' });
  });

  it('rejects a body signed under a different secret', () => {
    const other = `whsec_${Buffer.from('a-different-key-entirely', 'utf8').toString('base64')}`;
    expect(
      verify({ webhookSignature: `v1,${signLikePalpluss({ id: ID, timestamp: NOW, body: BODY, secret: other })}` }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('rejects a replayed callback older than the tolerance', () => {
    const old = NOW - TIMESTAMP_TOLERANCE_SECONDS - 1;
    expect(
      verify({
        webhookTimestamp: String(old),
        webhookSignature: `v1,${signLikePalpluss({ id: ID, timestamp: old, body: BODY })}`,
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  /*
    Bounded at BOTH ends. A window that only rejects old timestamps is not a
    replay window: a far-future timestamp would stay valid indefinitely.
  */
  it('rejects a future-dated callback beyond the tolerance', () => {
    const future = NOW + TIMESTAMP_TOLERANCE_SECONDS + 1;
    expect(
      verify({
        webhookTimestamp: String(future),
        webhookSignature: `v1,${signLikePalpluss({ id: ID, timestamp: future, body: BODY })}`,
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('accepts timestamps exactly on the tolerance boundary, both directions', () => {
    for (const ts of [NOW - TIMESTAMP_TOLERANCE_SECONDS, NOW + TIMESTAMP_TOLERANCE_SECONDS]) {
      expect(
        verify({
          webhookTimestamp: String(ts),
          webhookSignature: `v1,${signLikePalpluss({ id: ID, timestamp: ts, body: BODY })}`,
        }),
      ).toEqual({ kind: 'valid', webhookId: ID });
    }
  });

  it('rejects a non-integer timestamp', () => {
    expect(verify({ webhookTimestamp: 'not-a-number' })).toMatchObject({ kind: 'invalid' });
  });

  /*
    During a rotation Palpluss sends signatures from BOTH secrets for 24h.
    A reader that only checks the first entry rejects half that traffic.
  */
  it('accepts a match in any entry of a rotated signature list', () => {
    const good = signLikePalpluss({ id: ID, timestamp: NOW, body: BODY });
    const stale = signLikePalpluss({
      id: ID,
      timestamp: NOW,
      body: BODY,
      secret: `whsec_${Buffer.from('previous-secret', 'utf8').toString('base64')}`,
    });
    expect(verify({ webhookSignature: `v1,${stale} v1,${good}` })).toEqual({ kind: 'valid', webhookId: ID });
    expect(verify({ webhookSignature: `v1,${good} v1,${stale}` })).toEqual({ kind: 'valid', webhookId: ID });
  });

  it('ignores signature versions it does not implement', () => {
    const good = signLikePalpluss({ id: ID, timestamp: NOW, body: BODY });
    expect(verify({ webhookSignature: `v2,${good}` })).toMatchObject({ kind: 'invalid' });
  });

  it('rejects an empty or malformed signature header', () => {
    expect(verify({ webhookSignature: '   ' })).toMatchObject({ kind: 'invalid' });
    expect(verify({ webhookSignature: 'no-comma-here' })).toMatchObject({ kind: 'invalid' });
  });

  it('rejects when no signing secret is configured', () => {
    expect(verify({ secret: '' })).toMatchObject({ kind: 'invalid' });
  });

  /*
    `timingSafeEqual` throws on a length mismatch, so a short signature must be
    rejected rather than crash the route into a 500.
  */
  it('rejects a short signature without throwing', () => {
    expect(() => verify({ webhookSignature: 'v1,abc' })).not.toThrow();
    expect(verify({ webhookSignature: 'v1,abc' })).toMatchObject({ kind: 'invalid' });
  });
});

/*
  A timing side-channel is invisible to every functional test, and that is not
  a hypothesis: an injection replacing `timingSafeEqual(left, right)` with
  `a === b` passed all 71 tests in this file and its sibling. The comparison
  stays functionally correct — it matches when it should and not when it
  should not — so no assertion about RESULTS can ever see the difference.

  So the property is asserted structurally instead, the way docs/91 reads call
  sites as text when the type system has nothing to complain about. This is the
  mirror of docs/162 §5.1: there, text could not see which way a branch pointed
  and the fix was to execute a pure function; here, execution cannot see the
  property at all and the fix is to read the text.
*/
describe('signature comparison is constant-time (structural)', () => {
  // `__dirname`, matching auth.enumeration.test.ts. `import.meta.url` is not a
  // file: URL under this vitest config and throws during COLLECTION, which
  // prints "Tests no tests" with no failure line — docs/124 §5.1's trap.
  const source = readFileSync(path.resolve(__dirname, 'palpluss-webhook.ts'), 'utf8');
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('compares signatures with timingSafeEqual', () => {
    expect(withoutComments).toMatch(/timingSafeEqual\s*\(/);
    expect(withoutComments).toMatch(/from 'node:crypto'/);
  });

  it('guards the length before comparing, because timingSafeEqual throws on a mismatch', () => {
    expect(withoutComments).toMatch(/\.length\s*!==\s*\w+\.length/);
  });

  it('never compares a candidate signature with === or includes()', () => {
    // The two shapes an "obvious simplification" would reach for.
    expect(withoutComments).not.toMatch(/candidate\s*===/);
    expect(withoutComments).not.toMatch(/expected\s*===/);
    expect(withoutComments).not.toMatch(/\.includes\(\s*expected\s*\)/);
  });

  it('anti-vacuity: the comment stripper leaves the implementation behind', () => {
    // Without this, a stripper that ate the whole file would satisfy every
    // not.toMatch rule above (docs/163 §5.1).
    expect(withoutComments).toMatch(/function signaturesMatch/);
    expect(withoutComments.length).toBeGreaterThan(1_000);
    expect(withoutComments.length).toBeLessThan(source.length);
  });
});

describe('callbackTransactionId', () => {
  it('reads the transaction id', () => {
    expect(callbackTransactionId(BODY)).toBe('1cbdbaca-2a6b-4e1c-84f4-23e214794b6c');
  });

  it('accepts either spelling of the id field', () => {
    expect(callbackTransactionId(JSON.stringify({ transaction: { transaction_id: 'x1' } }))).toBe('x1');
    expect(callbackTransactionId(JSON.stringify({ transaction: { transactionId: 'x2' } }))).toBe('x2');
  });

  it('returns null for a body it cannot read', () => {
    expect(callbackTransactionId('not json')).toBeNull();
    expect(callbackTransactionId('{}')).toBeNull();
    expect(callbackTransactionId(JSON.stringify({ transaction: {} }))).toBeNull();
    expect(callbackTransactionId(JSON.stringify({ transaction: null }))).toBeNull();
  });

  /*
    The point of this helper is what it does NOT return. A caller handed a
    status would use it, and a callback body is not evidence of an outcome
    (docs/81, docs/92) — the id is the one field whose misuse is harmless.
  */
  it('exposes only the id, never an outcome the caller could believe', () => {
    const parsed = callbackTransactionId(BODY);
    expect(typeof parsed).toBe('string');
    const source = String(callbackTransactionId);
    expect(source).not.toMatch(/\bstatus\b/);
    expect(source).not.toMatch(/mpesa_receipt|amount/);
  });
});
