/**
 * Palpluss callback signature verification (Standard Webhooks).
 *
 * ⛔ A VALID SIGNATURE IS NOT AN OUTCOME. This module answers one question:
 * "did Palpluss send this body?" It does not answer "did the donor pay?" The
 * route must re-read the transaction over our own authenticated call before
 * recording anything, exactly as the Didit webhook (docs/81) and the PayHero
 * callback (docs/92) do: read one id from the body, then ask the gateway. A
 * forged callback claiming a nine-million-shilling success is then ignored
 * because nothing in it is believed, not because the signature caught it.
 *
 * That ordering is what makes the signing gap survivable. Palpluss signs
 * PER DOMAIN, configured in its console (Webhooks → Add domain), and
 * **callbacks to an unregistered domain are delivered UNSIGNED**. Until
 * `lastdonor.org` is registered in the LastDonor tenant, every callback will
 * arrive with no signature headers at all. `verifyPalplussSignature` reports
 * that as `unsigned` rather than as a failure, and the route decides — but it
 * must never decide to trust the body.
 *
 * ---------------------------------------------------------------------------
 * The scheme, from docs.palpluss.com/guides/webhook-signing (read 2026-11-24).
 * [UNVERIFIED against a real delivery: no signed callback has been received
 * yet, because no domain is registered. The algorithm below is implemented to
 * the published spec and its own sample code, and the first real delivery is
 * what confirms it. `expectedSignature` is exported so that can be checked
 * against a captured body without guessing.]
 *
 *   webhook-id:        message id, stable across the 5 retries
 *   webhook-timestamp: unix SECONDS
 *   webhook-signature: "v1,<base64>"  — space-separated list during rotation
 *
 *   signed string = `{webhook-id}.{webhook-timestamp}.{raw body}`
 *   mac           = HMAC-SHA256(key, signed string)
 *   key           = base64_decode(secret after the `whsec_` prefix)
 *   signature     = base64(mac)
 *
 * Two things here are easy to get wrong and silent when wrong:
 *
 * 1. **The key is the base64-DECODED remainder of the secret, not the secret
 *    string.** Signing with the literal `whsec_…` text, or with the text after
 *    the prefix un-decoded, produces a well-formed signature that never
 *    matches. There is no error to see — every callback simply fails
 *    verification, which looks exactly like an attacker.
 *
 * 2. **The body must be the RAW BYTES as received.** `JSON.parse` then
 *    `JSON.stringify` re-orders keys and drops whitespace, so the digest is
 *    taken over a different document. In a route handler read `await
 *    req.text()` and verify before parsing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The prefix Palpluss puts on a signing secret. */
const SECRET_PREFIX = 'whsec_';

/** The only signature version this scheme defines. */
const SIGNATURE_VERSION = 'v1';

/**
 * How far a `webhook-timestamp` may be from our clock, in seconds.
 *
 * The published sample rejects anything more than 5 minutes out, in either
 * direction. Rejecting FUTURE timestamps matters as much as old ones: a
 * signature is only replay-protected if the window is bounded at both ends.
 */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export type VerificationResult =
  /** Headers present and a signature matched. The body is from Palpluss. */
  | { readonly kind: 'valid'; readonly webhookId: string }
  /**
   * No signature headers at all — the delivery domain is not registered in
   * the Palpluss console. NOT the same as a bad signature: nobody tried to
   * forge anything, we simply have no evidence either way.
   */
  | { readonly kind: 'unsigned' }
  /** Headers present and wrong. Treat as hostile. */
  | { readonly kind: 'invalid'; readonly reason: string };

export interface SignatureInput {
  readonly webhookId: string | null;
  readonly webhookTimestamp: string | null;
  readonly webhookSignature: string | null;
  /** Exactly the bytes received. Never a re-serialised object. */
  readonly rawBody: string;
  /** The `whsec_…` secret. */
  readonly secret: string;
  /** Injected so the tolerance window is testable at both edges. */
  readonly nowSeconds?: number;
}

/**
 * The signature Palpluss should have sent for this body.
 *
 * Exported for one reason: the scheme is unverified against a real delivery,
 * and when the first signed callback arrives this is how its header gets
 * compared without re-deriving the algorithm by hand.
 */
export function expectedSignature(args: {
  readonly webhookId: string;
  readonly webhookTimestamp: string;
  readonly rawBody: string;
  readonly secret: string;
}): string {
  const key = signingKey(args.secret);
  return createHmac('sha256', key)
    .update(`${args.webhookId}.${args.webhookTimestamp}.${args.rawBody}`, 'utf8')
    .digest('base64');
}

/**
 * Decode a `whsec_…` secret into the HMAC key.
 *
 * See hazard 1 in the header. The prefix is stripped and the remainder is
 * base64-decoded; a secret with no prefix is accepted and decoded as-is, since
 * the prefix is a label rather than part of the key material.
 */
function signingKey(secret: string): Buffer {
  const material = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  return Buffer.from(material, 'base64');
}

/** Constant-time compare of two base64 signatures. */
function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  /*
    `timingSafeEqual` THROWS on a length mismatch, so the lengths must be
    compared first — and that comparison leaks only the length, which is fixed
    for a SHA-256 digest anyway.
  */
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify a Palpluss callback.
 *
 * ⛔ A `valid` result means the body is authentic, NOT that the payment
 * succeeded. Re-read the transaction before recording anything.
 */
export function verifyPalplussSignature(input: SignatureInput): VerificationResult {
  const { webhookId, webhookTimestamp, webhookSignature, rawBody, secret } = input;

  // Absent headers mean an unregistered delivery domain, not an attack.
  if (!webhookId && !webhookTimestamp && !webhookSignature) {
    return { kind: 'unsigned' };
  }

  // A partial set is not an unsigned delivery — something is wrong.
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { kind: 'invalid', reason: 'signature headers are incomplete' };
  }

  if (!secret) {
    return { kind: 'invalid', reason: 'no signing secret is configured' };
  }

  const timestamp = Number(webhookTimestamp);
  if (!Number.isInteger(timestamp)) {
    return { kind: 'invalid', reason: 'webhook-timestamp is not an integer' };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const drift = Math.abs(now - timestamp);
  if (drift > TIMESTAMP_TOLERANCE_SECONDS) {
    // Bounded in both directions on purpose: see TIMESTAMP_TOLERANCE_SECONDS.
    return {
      kind: 'invalid',
      reason: `webhook-timestamp is ${drift}s from now, outside the ${TIMESTAMP_TOLERANCE_SECONDS}s window`,
    };
  }

  const expected = expectedSignature({ webhookId, webhookTimestamp, rawBody, secret });

  /*
    The header carries a space-separated list of `v<version>,<signature>`
    pairs. During a secret rotation Palpluss sends signatures from BOTH
    secrets for 24 hours, so a single-signature reader would reject half of
    every rotation's traffic. Any one match is enough.
  */
  const offered = webhookSignature
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean);

  if (offered.length === 0) {
    return { kind: 'invalid', reason: 'webhook-signature is empty' };
  }

  let sawVersion = false;
  for (const entry of offered) {
    const comma = entry.indexOf(',');
    if (comma === -1) continue;
    const version = entry.slice(0, comma);
    const candidate = entry.slice(comma + 1);
    if (version !== SIGNATURE_VERSION) continue;
    sawVersion = true;
    if (signaturesMatch(candidate, expected)) {
      return { kind: 'valid', webhookId };
    }
  }

  return {
    kind: 'invalid',
    reason: sawVersion ? 'no offered signature matched' : `no ${SIGNATURE_VERSION} signature was offered`,
  };
}

/**
 * The transaction id from a callback body, and nothing else.
 *
 * Deliberately narrow. The body also carries `status`, `amount` and
 * `mpesa_receipt`, and none of them is read here, because a caller handed a
 * status would use it. The id is the one field whose misuse is harmless: it
 * selects which transaction to go and ask about.
 */
export function callbackTransactionId(rawBody: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const tx = (parsed as { transaction?: unknown }).transaction;
  if (!tx || typeof tx !== 'object') return null;
  const t = tx as Record<string, unknown>;
  const id = t.id ?? t.transaction_id ?? t.transactionId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
