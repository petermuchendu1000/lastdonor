import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { palplussPaymentRequests } from '@/db/schema';
import { palplussStatusQuerySchema } from '@/lib/validators/palpluss';
import { settlePalplussRequest } from '@/lib/services/palpluss-settlement';
import {
  COLLECTED_UNRECORDED_MESSAGE,
  PROMPT_LIFETIME_MS,
  claimForSettledCollection,
  type SettledCollectionClaim,
} from '@/lib/mpesa-prompt';
import { PalplussNotConfiguredError } from '@/lib/palpluss';
import { logError } from '@/lib/errors';
import type { ApiError, ApiResponse } from '@/types/api';

/**
 * GET /api/v1/donations/palpluss/status?reference=LD-XXXXXXXXX
 *
 * What the donor's browser polls while the PIN prompt is on their phone, on
 * the second M-Pesa rail. The twin of `payhero/status`, and deliberately so:
 * `docs/158`, `docs/159`, `docs/160` and `docs/162` were each paid for by a
 * defect on that route, and re-deriving any of them here would be re-paying.
 *
 * ── Why the donor polls at all, when there is a callback ──────────────────
 *
 * Palpluss does post callbacks — unlike PayHero, whose posting has never been
 * proven (`docs/92`) — but a callback still cannot be the only trigger: it can
 * be delayed, lost, or arrive before the donor's tab has re-rendered. ⛔ And
 * on this rail it is additionally unsigned until `lastdonor.org` is registered
 * as a webhook domain (`docs/180` §7), so it is an accelerator, not a
 * guarantee.
 *
 * More to the point, [VERIFIED] **nothing sweeps `palpluss_payment_requests`**.
 * So this route is the ONLY path by which a late settlement is ever
 * discovered, which is why `docs/159` refused a server-side age guard that
 * would stop re-checking an old pending row.
 *
 * Both paths call the SAME `settlePalplussRequest`, which claims the row
 * conditionally: whichever arrives first records the donation, the other is
 * told it was already settled.
 *
 * ── What a caller is allowed to ask about ─────────────────────────────────
 *
 * Only OUR `LD-` reference, resolved against a row this platform wrote, and
 * only in the exact shape `mintAccountReference()` produces. Palpluss's own
 * transaction id is **never** accepted: it is the key to
 * `GET /v1/transactions/{id}` on a tenant that may be shared with another
 * product, and a blank or traversing id reads that whole ledger with HTTP 200
 * (`docs/180` finding 1). The gateway id is read out of our own row, never
 * from the caller.
 *
 * The response carries no donor details, no phone number, no gateway
 * identifier and **no `failure_reason`**. That column is an operator field: on
 * this table it holds, among other things, *"Reconcile by matching this row's
 * account_reference against external_reference in Palpluss's transaction
 * list"* (`docs/182` §3). It is not selected here at all — which also avoids
 * the dead select `docs/159` found on the PayHero twin, where it is read zero
 * times.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  const notFound = (): NextResponse =>
    NextResponse.json(
      {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'No such payment request', requestId },
      } satisfies ApiError,
      { status: 404 },
    );

  try {
    const parsed = palplussStatusQuerySchema.safeParse({
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
        status: palplussPaymentRequests.status,
        /*
          The CHARGE — what the donor's phone was asked for, in the rail's
          currency. Not `credited_amount_minor`, which is what the campaign
          receives in its own currency (`docs/168`): a donor watching their
          own prompt resolve needs the figure that left their account.
        */
        amount: palplussPaymentRequests.amount,
        currency: palplussPaymentRequests.currency,
        createdAt: palplussPaymentRequests.createdAt,
        /*
          The discriminator `docs/162` turns on. A `succeeded` row with no
          donation means the gateway collected the money and nothing was
          booked — indistinguishable from a real donation if you read only
          `status`, which is what every branch of the PayHero twin used to do.
        */
        donationId: palplussPaymentRequests.donationId,
        /*
          Nullable on purpose (`docs/182` §2): the initiate route writes the
          row BEFORE calling Palpluss, so a lost response leaves one with no
          gateway id. This route is the first caller that can reach that state
          — the callback cannot, because it arrives carrying the very id a
          row without one does not have.
        */
        palplussTransactionId: palplussPaymentRequests.palplussTransactionId,
      })
      .from(palplussPaymentRequests)
      .where(eq(palplussPaymentRequests.accountReference, reference))
      .limit(1);

    if (!row) return notFound();

    type StatusPayload = {
      state:
        | 'pending'
        | 'succeeded'
        | 'failed'
        | 'reversed'
        | 'collected_unrecorded';
      amount: number;
      currency: string;
      /** False once there is no point polling again. */
      keepPolling: boolean;
      message: string | null;
    };

    const settled = (
      state: StatusPayload['state'],
      message: string | null,
      /*
        ⛔ Pass this explicitly only for a state that is TRUE of the row but
        must not be asked about again. `pending` normally means keep asking;
        an unverifiable outcome is pending-and-unaskable, and defaulting it to
        `true` there would reinstate the endless poll `docs/159` fixed.
      */
      keepPolling: boolean = state === 'pending',
    ): NextResponse => {
      const payload: ApiResponse<StatusPayload> = {
        ok: true,
        data: {
          state,
          amount: row.amount,
          currency: row.currency,
          keepPolling,
          message,
        },
      };
      return NextResponse.json(payload);
    };

    /** The one donor-facing sentence for a collection that did not happen. */
    const FAILED_MESSAGE = 'The payment did not go through. Nothing has been charged.';

    /*
      ONE decider for "may success be claimed?", shared with the other rail.
      `docs/146`'s rule: three branches here can answer for a settled
      collection — the terminal-row early return, `case 'recorded'` and
      `case 'already_settled'` — and on the PayHero twin all three read
      `status` alone, so all three claimed a donation that may not exist
      (`docs/162`).

      A lookup rather than a ternary, and that is not style. `docs/162` §5.1:
      an injection that INVERTED the condition passed every structural rule,
      because text cannot see which way a branch points. Keyed by the claim
      there is no condition left to invert, and a swap of the two entries
      makes the KEY disagree with the state it answers, which a test can see.
    */
    const ANSWER: Record<SettledCollectionClaim, () => NextResponse> = {
      collected_unrecorded: () =>
        settled('collected_unrecorded', COLLECTED_UNRECORDED_MESSAGE, false),
      succeeded: () => settled('succeeded', null),
    };

    const succeededOrUnrecorded = (donationId: string | null): NextResponse =>
      ANSWER[claimForSettledCollection(donationId)]();

    // Already resolved: answer from our own row, with no outbound call.
    if (row.status !== 'pending') {
      if (row.status === 'succeeded') return succeededOrUnrecorded(row.donationId);
      /*
        ⚠️ A terminal `failed` row cannot be told apart from a REVERSED one
        here, and that limit is recorded rather than worked around
        (`docs/183` §4). The discriminator exists only in `failure_reason`,
        which is operator text this route deliberately never reads, and
        `palpluss_request_status` has three values by design — a fourth means
        a migration on a live money table for a path never observed on this
        tenant (`docs/129`'s reasoning, `docs/180`'s ledger).
      */
      return settled('failed', FAILED_MESSAGE);
    }

    /*
      ⛔ A row with no gateway id cannot be checked, and this is the state
      `docs/182` §2 created deliberately by making that column nullable: the
      initiate route inserts the row BEFORE calling Palpluss, so a response
      lost in that window leaves everything about the donation except the one
      key the gateway's status endpoint accepts.

      ⚠️ `pending` with `keepPolling: false`, NOT `failed`. `docs/159` §6
      corrected the PayHero settlement for saying "nothing was charged" about
      a reference-less row: a push may well have been sent, and this platform
      does not know. Nothing has been written, so `pending` is the row's
      actual state — and it is recoverable by hand, because
      [VERIFIED 2026-11-24] `GET /v1/transactions` returns `external_reference`
      on every row, so our own reference leads back to the transaction
      (`docs/182` §2.2).
    */
    if (!row.palplussTransactionId) {
      logError(
        new Error(`Palpluss request ${reference} has no transaction id; cannot be checked`),
        { requestId, route: 'palpluss/status#no-transaction-id' },
      );
      return settled(
        'pending',
        'We could not reach M-Pesa to check this payment. Check your M-Pesa messages.',
        false,
      );
    }

    /*
      Still pending, so ask Palpluss. This is the only outbound call on the
      poll path, and it is what makes a lost or unsigned callback survivable.
    */
    const outcome = await settlePalplussRequest(row.palplussTransactionId);

    switch (outcome.kind) {
      case 'recorded':
        /*
          Routed through the same decider as the other two branches even
          though `recorded` carries a non-null id by construction. The point
          is that ONE place answers a thank-you and it always answers from a
          donation link — a second site that answers it directly is how the
          PayHero branches drifted apart (`docs/162`).
        */
        return succeededOrUnrecorded(outcome.donationId);

      case 'collected_unrecorded':
        /*
          Palpluss took the money and nothing was booked. The settlement
          service has already written the critical audit row; all this does is
          refuse to call it a donation.
        */
        logError(new Error(`Palpluss collected but not recorded: ${outcome.reason}`), {
          requestId,
          route: 'palpluss/status#collected-unrecorded',
        });
        return settled('collected_unrecorded', COLLECTED_UNRECORDED_MESSAGE, false);

      case 'already_settled':
        if (outcome.status === 'succeeded') return succeededOrUnrecorded(outcome.donationId);
        return settled('failed', FAILED_MESSAGE);

      case 'failed':
        return settled('failed', FAILED_MESSAGE);

      case 'reversed':
        /*
          ⛔ Money moved and came BACK, and this must not be reported as a
          failure. `failed` means no money ever moved — the client's failed
          screen says so and then appends, unconditionally, three ordinary
          causes ("the prompt was cancelled, it timed out, there was not
          enough in the balance"), none of which is true of a reversal. That
          is `docs/160`'s defect exactly, which was about routing an outcome
          we DO understand through a screen that invents reasons.

          Nor is it `collected_unrecorded`, whose sentence opens "Your payment
          went through" — for a reversal that is false.

          ⚠️ [UNVERIFIED by execution] no REVERSED has been observed on this
          tenant (`docs/180`: 50 ledger rows, SUCCESS and FAILED only), and on
          this path it additionally requires the reversal to land before we
          ever settled. It is handled because it is in Palpluss's published
          status enum, not because it has happened.
        */
        logError(new Error(`Palpluss reversal seen on poll: ${reference}`), {
          requestId,
          route: 'palpluss/status#reversed',
        });
        return settled(
          'reversed',
          'The money left your account and was sent back. No donation was recorded.',
          false,
        );

      case 'unverifiable':
        /*
          We cannot confirm it, so we say so and claim nothing.

          ⛔ `pending`, never `failed`. `docs/160` is the whole story: the
          client's `failed` screen heads "Your donation was not completed" and
          appends three invented causes, and on the amount-mismatch path this
          platform's OWN audit row reads "Money moved but no donation row was
          written" — so that sentence would be addressed to somebody whose
          balance had just been debited.

          `pending` is not a softer word for failed: it is the row's ACTUAL
          state. Both `unverifiable` returns in the settlement happen BEFORE
          the claim, so nothing has been written and Palpluss may still settle
          it. With `keepPolling: false` the client renders this as the
          `unresolved` screen, which claims nothing, warns that paying again
          pays twice, and offers "Check again".
        */
        logError(new Error(`Palpluss payment unverifiable: ${outcome.reason}`), {
          requestId,
          route: 'palpluss/status#unverifiable',
        });
        /*
          ⚠️ The message must not restate the heading. That screen already
          says "We could not confirm this payment" above it, and the PayHero
          twin's string used to open with that same sentence — so the donor
          read it twice and learned nothing from the one slot that could have
          told them something (`docs/112`'s og:description rule).
        */
        return settled(
          'pending',
          'We heard back about this payment but could not match it to your donation.',
          false,
        );

      case 'unknown_reference':
        /*
          The row we just read no longer resolves by its gateway id. Treated
          as not found rather than guessed at.
        */
        return notFound();

      case 'still_pending':
      default: {
        /*
          Stop telling the client to poll once the prompt can no longer be
          live. The row stays `pending` rather than being marked failed: a
          prompt we never heard about is not a prompt known to have failed,
          and Palpluss may still settle it. A donor's poll timing out is not
          evidence about the payment.
        */
        const ageMs = Date.now() - new Date(row.createdAt).getTime();
        const expired = ageMs > PROMPT_LIFETIME_MS;

        return settled(
          'pending',
          expired
            ? 'We have not heard back about this payment. If your phone says it went ' +
                'through, email support@lastdonor.org and we will sort it out.'
            : null,
          !expired,
        );
      }
    }
  } catch (error) {
    if (error instanceof PalplussNotConfiguredError) {
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
    logError(error, { requestId, route: 'palpluss/status' });
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
