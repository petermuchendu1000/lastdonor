import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { payheroPaymentRequests } from '@/db/schema';
import { payheroStatusQuerySchema } from '@/lib/validators/payhero';
import { settlePayHeroRequest } from '@/lib/services/payhero-settlement';
import { PROMPT_LIFETIME_MS } from '@/lib/payhero-abuse-guard';
import { PayHeroNotConfiguredError } from '@/lib/payhero';
import { logError } from '@/lib/errors';
import type { ApiError, ApiResponse } from '@/types/api';

/**
 * GET /api/v1/donations/payhero/status?reference=LD-…
 *
 * What the donor's browser polls while the PIN prompt is on their phone.
 *
 * ── Why the donor polls at all, when there is a callback ──────────────────
 *
 * The callback is the authoritative trigger, but it cannot be the only one.
 * It can be delayed, lost, or - on this deployment - arrive before the
 * donor's own tab has even re-rendered. Published M-Pesa integration guidance
 * is consistent that the front end must not assume an outcome on a timer, and
 * recommends polling the status endpoint when no callback has landed shortly
 * after initiation. So both paths call the SAME `settlePayHeroRequest`, which
 * claims the row conditionally: whichever arrives first records the donation,
 * the other is told it was already settled.
 *
 * ── What a caller is allowed to ask about ─────────────────────────────────
 *
 * Only OUR reference, resolved against a row this platform wrote. PayHero's
 * own reference is never accepted here, because handing an arbitrary caller's
 * string to PayHero's status endpoint would let anyone read any transaction on
 * an account shared with another company - and that endpoint already leaks a
 * stranger's transaction when handed a blank reference (`docs/92`).
 *
 * The response deliberately carries no donor details, no phone number and no
 * PayHero identifiers: a reference is guessable in principle, so this answers
 * only what a donor needs to see their own payment resolve.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const parsed = payheroStatusQuerySchema.safeParse({
      reference: request.nextUrl.searchParams.get('reference') ?? '',
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors[0].message,
            field: 'reference',
            requestId,
          },
        } satisfies ApiError,
        { status: 400 },
      );
    }

    const reference = parsed.data.reference;

    const [row] = await db
      .select({
        status: payheroPaymentRequests.status,
        amount: payheroPaymentRequests.amount,
        currency: payheroPaymentRequests.currency,
        createdAt: payheroPaymentRequests.createdAt,
        failureReason: payheroPaymentRequests.failureReason,
      })
      .from(payheroPaymentRequests)
      .where(eq(payheroPaymentRequests.externalReference, reference))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'NOT_FOUND', message: 'No such payment request', requestId },
        } satisfies ApiError,
        { status: 404 },
      );
    }

    type StatusPayload = {
      state: 'pending' | 'succeeded' | 'failed' | 'abandoned';
      amount: number;
      currency: string;
      /** False once there is no point polling again. */
      keepPolling: boolean;
      message: string | null;
    };

    const settled = (
      state: StatusPayload['state'],
      message: string | null,
    ): NextResponse => {
      const payload: ApiResponse<StatusPayload> = {
        ok: true,
        data: {
          state,
          amount: row.amount,
          currency: row.currency,
          keepPolling: state === 'pending',
          message,
        },
      };
      return NextResponse.json(payload);
    };

    // Already resolved: answer from our own row, no outbound call.
    if (row.status !== 'pending') {
      return settled(
        row.status,
        row.status === 'failed'
          ? 'The payment did not go through. Nothing has been charged.'
          : null,
      );
    }

    /*
      Still pending and the prompt could plausibly still be live. Ask PayHero.

      This is the only outbound call on the poll path, and it is what makes a
      lost callback survivable.
    */
    const outcome = await settlePayHeroRequest(reference);

    switch (outcome.kind) {
      case 'recorded':
        return settled('succeeded', null);

      case 'already_settled':
        return settled(
          outcome.status,
          outcome.status === 'failed'
            ? 'The payment did not go through. Nothing has been charged.'
            : null,
        );

      case 'failed':
        return settled('failed', 'The payment did not go through. Nothing has been charged.');

      case 'unverifiable':
        /*
          We cannot confirm it. Reported as failed to the donor rather than
          left spinning forever, because a donor staring at a spinner has no
          way to act - but the row stays `pending` and the critical audit row
          written by the settlement service is what gets a human to look.
        */
        logError(new Error(`PayHero payment unverifiable: ${outcome.reason}`), {
          requestId,
          route: 'payhero/status#unverifiable',
        });
        return settled(
          'failed',
          'We could not confirm this payment. If your phone says it went through, email ' +
            'support@lastdonor.org and we will sort it out.',
        );

      case 'unknown_reference':
        // The row exists but the reference failed the namespace check, which
        // should be impossible. Treated as not found rather than guessed at.
        return NextResponse.json(
          {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'No such payment request', requestId },
          } satisfies ApiError,
          { status: 404 },
        );

      case 'still_pending':
      default: {
        /*
          Stop telling the client to poll once the prompt can no longer be
          live. The row stays `pending` rather than being marked failed: a
          prompt we never heard about is not a prompt known to have failed,
          and PayHero may still settle it. `abandoned` exists for that
          distinction and is set by reconciliation, not here - a donor's poll
          timing out is not evidence about the payment.
        */
        const ageMs = Date.now() - new Date(row.createdAt).getTime();
        const expired = ageMs > PROMPT_LIFETIME_MS;

        const payload: ApiResponse<StatusPayload> = {
          ok: true,
          data: {
            state: 'pending',
            amount: row.amount,
            currency: row.currency,
            keepPolling: !expired,
            message: expired
              ? 'We have not heard back about this payment. If your phone says it went ' +
                'through, email support@lastdonor.org and we will sort it out.'
              : null,
          },
        };
        return NextResponse.json(payload);
      }
    }
  } catch (error) {
    if (error instanceof PayHeroNotConfiguredError) {
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
    logError(error, { requestId, route: 'payhero/status' });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not check the payment status.',
          requestId,
        },
      } satisfies ApiError,
      { status: 500 },
    );
  }
}
