import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { PayHeroNotConfiguredError } from '@/lib/payhero';
import { settlePayHeroRequest } from '@/lib/services/payhero-settlement';
import { logError } from '@/lib/errors';
import type { ApiError } from '@/types/api';

/**
 * POST /api/v1/donations/payhero/callback
 *
 * PayHero tells us a collection finished. See `docs/92`.
 *
 * ── Why this route needs no shared secret, and has none ───────────────────
 *
 * PayHero's callback carries no signature: no HMAC, no shared secret, no
 * timestamp, nothing. The "API secret" PayHero issues alongside the username
 * and password is not a signing key either - probed 2026-10-21, it is not
 * accepted for authentication anywhere in the v2 API. There is therefore
 * nothing to verify a body against, and a design that trusted the body would
 * let anyone who learns this URL assert a donation by POSTing
 * `{"response":{"Status":"Success","Amount":500000,...}}`.
 *
 * So the body is not trusted. This route reads ONE value out of it - the
 * `ExternalReference` we minted ourselves - and then
 * `settlePayHeroRequest` asks PayHero over our own authenticated call what
 * actually happened. Exactly the shape `docs/81` settled for the Didit
 * webhook, and for the same reason.
 *
 * What that buys:
 *   - no secret to configure, rotate or leave unset, so the failure mode
 *     where an unset secret silently disables payments cannot happen;
 *   - a forged request cannot assert an outcome. The worst it can do with a
 *     real reference is make us re-read a status we are entitled to read and
 *     arrive at the same answer;
 *   - a reference that is not ours changes nothing. That is also the
 *     isolation boundary: this PayHero account is shared with BETWOIN LTD,
 *     and their callbacks would arrive here if their config ever pointed at
 *     us. They resolve to no row and are ignored.
 *
 * What it costs: one outbound call per callback.
 *
 * ── Why it answers 200 to almost everything ───────────────────────────────
 *
 * A provider that gets a 4xx or 5xx retries, and retrying cannot turn an
 * unknown reference into a known one. Only a genuine failure on our side -
 * where the payment may really be settleable and is not yet - returns 5xx, so
 * that a retry has something to accomplish.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    /*
      PayHero's documented callback shape is
        { forward_url, status, response: { ExternalReference, Status, ... } }
      The reference is accepted from either the nested object or the top
      level, and in either casing, because this is the one field the whole
      route depends on and a provider rename would silently stop every
      donation settling. Everything else in the body is ignored outright.
    */
    const nested = (body?.response ?? null) as Record<string, unknown> | null;
    const candidates = [
      nested?.ExternalReference,
      nested?.external_reference,
      body?.ExternalReference,
      body?.external_reference,
    ];
    const externalReference = candidates.find((v): v is string => typeof v === 'string' && v.trim() !== '');

    if (!externalReference) {
      console.warn('[payhero/callback] no ExternalReference in payload', { requestId });
      return NextResponse.json({ ok: true, data: { ignored: 'no external reference' } });
    }

    const outcome = await settlePayHeroRequest(externalReference);

    /*
      `unknown_reference` is the expected answer for BETWOIN's traffic, a
      replay of a request we have since cleaned up, or a forgery. 200, because
      a retry will never make it ours.
    */
    if (outcome.kind === 'unknown_reference') {
      console.warn('[payhero/callback] reference is not one of ours; ignoring', { requestId });
      return NextResponse.json({ ok: true, data: { ignored: 'unknown reference' } });
    }

    return NextResponse.json({ ok: true, data: { outcome: outcome.kind } });
  } catch (error) {
    if (error instanceof PayHeroNotConfiguredError) {
      /*
        We cannot ask PayHero what happened, so we cannot settle. 503 is
        honest and invites the retry that will work once credentials are set -
        the payment itself is real and still owed a donation row.
      */
      console.error(
        '[payhero/callback] PayHero credentials are not set, so a real payment cannot be ' +
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
    logError(error, { requestId, route: 'payhero/callback' });
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
