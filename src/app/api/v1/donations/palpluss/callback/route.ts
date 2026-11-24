import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { PalplussNotConfiguredError } from '@/lib/palpluss';
import { callbackTransactionId, verifyPalplussSignature } from '@/lib/palpluss-webhook';
import { settlePalplussRequest } from '@/lib/services/palpluss-settlement';
import { logError } from '@/lib/errors';
import type { ApiError } from '@/types/api';

/**
 * POST /api/v1/donations/palpluss/callback
 *
 * Palpluss tells us a collection finished. See `docs/180`.
 *
 * ── The body is read for ONE id, and nothing else ─────────────────────────
 *
 * The payload carries `status`, `amount`, `mpesa_receipt` and
 * `external_reference`. None of them is read. `callbackTransactionId` returns
 * the transaction id and deliberately nothing else, because a caller handed a
 * status would use it — and `docs/180` measured Palpluss itself answering
 * `success: true` with `resultCode: "0"` on a transaction that settled FAILED
 * twenty-nine seconds later. A body that says SUCCESS is not evidence anybody
 * paid, however it arrived.
 *
 * So the outcome comes from `settlePalplussRequest`, which re-reads the
 * transaction over our own authenticated call. `docs/81`'s shape, third
 * instance in this codebase after Didit and PayHero.
 *
 * ── Why a signature is checked but not required ───────────────────────────
 *
 * Palpluss signs callbacks (Standard Webhooks), which PayHero does not. But
 * signing is configured PER DOMAIN in its console, and callbacks to an
 * unregistered domain are delivered **unsigned**. `lastdonor.org` is not
 * registered on the LastDonor tenant yet (`docs/180` §7, owner action), so
 * today every callback arrives with no signature headers at all.
 *
 * Refusing unsigned deliveries would therefore refuse all of them, and
 * refusing them *once the domain is registered* is a change in behaviour
 * triggered by a console setting nobody here can see — so it is not the gate.
 * Instead:
 *
 *   - **unsigned** is logged and processed. Safe only because the body is not
 *     believed: the worst an unsigned forgery with a real transaction id can
 *     do is make us re-read a status we are entitled to read and arrive at
 *     the same answer.
 *   - **invalid** is REFUSED outright, without a lookup. Headers present and
 *     wrong is not an unregistered domain — it is someone signing badly, or a
 *     rotated secret we have not picked up. Either way, acting on it is
 *     strictly worse than refusing.
 *
 * ⛔ The distinction matters and is not cosmetic: conflating "nobody signed
 * this" with "someone signed it wrongly" would either refuse every real
 * delivery today, or accept a bad signature forever.
 *
 * ── Why it answers 200 to almost everything ───────────────────────────────
 *
 * A provider that gets 4xx/5xx retries, and Palpluss retries five times (10s,
 * 30s, 1m, 2m) before giving up. Retrying cannot turn an unknown transaction
 * id into one of ours, so that is a 200. Only a genuine failure on our side,
 * where the payment really is settleable and is not yet, returns 5xx — so
 * that a retry has something to accomplish.
 *
 * ⚠️ The route must answer within **8 seconds** or Palpluss treats it as
 * failed and retries. One status read fits; anything slower added here would
 * turn every callback into five.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    /*
      ⛔ The RAW body text, read once, before any parsing.

      A signature is computed over the bytes as received. `await
      request.json()` then `JSON.stringify` re-orders keys and drops
      whitespace, so the digest would be taken over a different document and
      every verification would fail — with nothing to see but a steady stream
      of refusals indistinguishable from an attack.
    */
    const rawBody = await request.text().catch(() => '');

    const verdict = verifyPalplussSignature({
      webhookId: request.headers.get('webhook-id'),
      webhookTimestamp: request.headers.get('webhook-timestamp'),
      webhookSignature: request.headers.get('webhook-signature'),
      rawBody,
      secret: process.env.PALPLUSS_WEBHOOK_SECRET ?? '',
    });

    if (verdict.kind === 'invalid') {
      /*
        Headers present and wrong. Refused before any lookup.

        ⚠️ `UNAUTHORIZED`/401, where the Standard Webhooks guidance suggests
        400. Both are non-2xx and Palpluss retries them identically, so the
        choice is purely about what a log reader sees — and what happened is
        that the sender failed to authenticate itself, which is what this code
        means everywhere else in the API. The `ApiError` union is deliberately
        closed (`src/types/api.ts`), and an `INVALID_SIGNATURE` member would
        be a second word for a case it already has.
      */
      console.warn('[palpluss/callback] signature present and invalid; refusing', {
        requestId,
        reason: verdict.reason,
      });
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'The callback signature did not verify.',
            requestId,
          },
        } satisfies ApiError,
        { status: 401 },
      );
    }

    if (verdict.kind === 'unsigned') {
      /*
        Expected today: no webhook domain is registered, so Palpluss signs
        nothing. Logged at warn so that the day the domain IS registered,
        these lines stopping is visible — and so that their continuing is
        visible too.
      */
      console.warn(
        '[palpluss/callback] delivery is UNSIGNED (no webhook domain registered); ' +
          'proceeding because the body is not trusted and the outcome is re-fetched',
        { requestId },
      );
    }

    const transactionId = callbackTransactionId(rawBody);

    if (!transactionId) {
      console.warn('[palpluss/callback] no transaction id in payload', { requestId });
      return NextResponse.json({ ok: true, data: { ignored: 'no transaction id' } });
    }

    const outcome = await settlePalplussRequest(transactionId);

    /*
      `unknown_reference` is the expected answer for the other two products on
      this shared tenant (`docs/180` §3), a replay of a request we have since
      cleaned up, or a forgery. 200, because a retry will never make it ours.
    */
    if (outcome.kind === 'unknown_reference') {
      console.warn('[palpluss/callback] transaction is not one of ours; ignoring', {
        requestId,
      });
      return NextResponse.json({ ok: true, data: { ignored: 'unknown transaction' } });
    }

    /*
      Only the outcome KIND is returned. No amount, no donor, no receipt
      number: the response goes back to the gateway, and a callback
      acknowledgement is not a place to restate somebody's donation.
    */
    return NextResponse.json({
      ok: true,
      data: { outcome: outcome.kind, signed: verdict.kind === 'valid' },
    });
  } catch (error) {
    if (error instanceof PalplussNotConfiguredError) {
      /*
        We cannot ask Palpluss what happened, so we cannot settle. 503 is
        honest and invites the retry that will work once the key is set — the
        payment itself is real and still owed a donation row.
      */
      console.error(
        '[palpluss/callback] PALPLUSS_API_KEY is not set, so a real payment cannot be ' +
          'confirmed or recorded.',
        { requestId },
      );
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'PAYMENTS_UNAVAILABLE',
            message: 'Payment provider is not configured.',
            requestId,
          },
        } satisfies ApiError,
        { status: 503 },
      );
    }

    // A failed status read is worth retrying: the money may well have moved.
    logError(error, { requestId, route: 'palpluss/callback' });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not process the payment update.',
          requestId,
        },
      } satisfies ApiError,
      { status: 500 },
    );
  }
}
