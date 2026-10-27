import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, campaignWithdrawals, refundBatches, users } from '@/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import {
  withdrawalRequestSchema,
  PLATFORM_PAYOUT_CURRENCY,
  isSupportedPayoutCurrency,
} from '@/lib/validators/payout';
import { createTransfer } from '@/lib/stripe-connect';
import { notifyWithdrawalFailed } from '@/lib/notifications';
import { organiserWithdrawalBlockedBy } from '@/lib/institutional-payout/decide';
import { activeDesignation } from '@/lib/institutional-payout/designation.server';
import { randomUUID } from 'crypto';
import type { ApiResponse, ApiError } from '@/types/api';

/**
 * Campaign statuses a creator may withdraw from. Everything else -
 * draft, archived, paused, under_review, suspended, cancelled - is a state in
 * which the platform may be refunding donors or deciding whether to, and
 * paying out during that window pays twice (audit: fraudulent campaign
 * cancelled, refunds trickling out one donation at a time, creator empties
 * the released balance in the gap).
 */
const WITHDRAWABLE_CAMPAIGN_STATUSES = ['active', 'last_donor_zone', 'completed'] as const;

/**
 * Classifies a thrown transfer error.
 *
 * `definite` means Stripe rejected the request and no money moved, so the
 * reservation can be released. Anything else - a dropped connection, a
 * timeout, a 5xx, an idempotency conflict - is an UNKNOWN outcome: the
 * transfer may well have been created and the response lost. Releasing the
 * reservation then lets a retry pay the creator a second time, so unknown
 * outcomes must keep the row in a non-releasing state.
 *
 * The default is `unknown` on purpose: an unrecognised error must never free
 * money.
 */
function isDefiniteTransferFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  const e = err as { type?: unknown; code?: unknown };
  const type = typeof e.type === 'string' ? e.type : '';
  const code = typeof e.code === 'string' ? e.code : '';

  if (code === 'balance_insufficient') return true;

  return (
    type === 'StripeInvalidRequestError' ||
    type === 'StripeAuthenticationError' ||
    type === 'StripePermissionError'
  );
}

/**
 * POST /api/v1/user-campaigns/[id]/withdraw
 * Creator-initiated withdrawal. Validates ownership, Connect status,
 * available balance, then creates a Stripe transfer.
 */
/**
 * A failure message safe to show the organiser. Never exposes gateway
 * internals.
 *
 * Extracted so the DEFINITE-failure branch can put the same words in the
 * email it now sends. It used to be inline in the catch, which is why the
 * notification could not reuse it.
 */
function safeFailureMessage(err: unknown): string {
  const e = err as { type?: string; message?: string; code?: string };
  if (e?.code === 'balance_insufficient' || e?.message?.includes('insufficient')) {
    return 'This withdrawal cannot be processed at the moment. Platform funds are being settled. Please try again later.';
  }
  if (e?.message?.includes('not currently available') || e?.message?.includes('payouts_not_allowed')) {
    return 'Your payout account is not yet ready to receive transfers. Please check your account for any pending requirements.';
  }
  if (e?.message?.includes('currency')) {
    return 'There was a currency mismatch with your payout account. Please contact support.';
  }
  return 'Withdrawal could not be processed right now. Please try again later or contact support.';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id: campaignId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated', requestId } } satisfies ApiError,
      { status: 401 },
    );
  }

  // Validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body', requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  const parsed = withdrawalRequestSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: firstError.message, field: firstError.path.join('.'), requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  const { amount, idempotencyKey } = parsed.data;
  const userId = session.user.id;

  // Cheap pre-check for a replayed request. This is a fast path only - the
  // authoritative dedup happens inside the reservation transaction below,
  // where it is serialised against concurrent callers.
  const [existing] = await db
    .select({ id: campaignWithdrawals.id, status: campaignWithdrawals.status })
    .from(campaignWithdrawals)
    .where(
      and(
        eq(campaignWithdrawals.campaignId, campaignId),
        eq(campaignWithdrawals.requestedBy, session.user.id),
        eq(campaignWithdrawals.notes, `idem:${idempotencyKey}`),
      ),
    )
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { ok: true, data: { withdrawalId: existing.id, status: existing.status, deduplicated: true } },
      { status: 200 },
    );
  }

  // Fetch campaign and verify ownership
  const [campaign] = await db
    .select({
      id: campaigns.id,
      creatorId: campaigns.creatorId,
      title: campaigns.title,
      currency: campaigns.currency,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
      { status: 404 },
    );
  }

  if (campaign.creatorId !== session.user.id) {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'You do not own this campaign', requestId } } satisfies ApiError,
      { status: 403 },
    );
  }

  // Verify the user has a verified Stripe Connect account
  const [user] = await db
    .select({
      stripeConnectAccountId: users.stripeConnectAccountId,
      stripeConnectStatus: users.stripeConnectStatus,
      payoutCurrency: users.payoutCurrency,
      // For the failure notification below. Two more columns on a query that
      // already runs - no extra round trip (docs/87's three-query cap).
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user?.stripeConnectAccountId || user.stripeConnectStatus !== 'verified') {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Complete Stripe Connect setup before withdrawing', requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  // ── Currency guard ────────────────────────────────────────────────────────
  //
  // Every inbound charge is created in USD, so `amount` here is USD cents and
  // so is the whole ledger (totalReleasedAmount / totalWithdrawnAmount).
  // Transferring that integer under any other currency code reinterprets it:
  // 100000 with currency 'mxn' pays MX$1,000 (~US$55) for a US$1,000 balance,
  // and the webhook then debits totalWithdrawnAmount by the MXN figure. For a
  // zero-decimal currency such as JPY the factor is 100x in the other
  // direction. There is no FX conversion anywhere in this codebase, so the
  // only safe answer is to refuse rather than guess.
  /*
    ── The campaign's own currency, which the guard below did not check ──────
    //
    The guard that follows compares the CONNECTED ACCOUNT's settlement
    currency against the platform payout currency. That was complete while
    every campaign was USD, because then the ledger integer and the transfer
    currency could not disagree.

    Once a campaign can raise KES, they can. A Kenyan campaign whose creator
    happens to hold a USD-settling Connect account passes the account check
    and then hands `amount` - KES minor units - to `transfers.create` under
    'usd'. KES 100,000 raised (10,000,000 minor units) would pay out
    US$100,000, roughly 130x the money that exists, from a platform balance
    that does not hold it.

    There is still no FX anywhere in this codebase, and Stripe Connect cannot
    settle KES to a Kenyan account in any case. So a non-USD campaign is
    refused here and paid out by another route when one exists. Recorded as a
    known gap in docs/92: a KES campaign can be funded but not yet withdrawn.
  */
  const campaignCurrency = (campaign.currency ?? '').toUpperCase();
  if (campaignCurrency !== PLATFORM_PAYOUT_CURRENCY.toUpperCase()) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'WRONG_PAYMENT_RAIL',
          message:
            `This campaign raises funds in ${campaignCurrency || 'an unknown currency'}, and ` +
            `withdrawals can currently only be paid in ${PLATFORM_PAYOUT_CURRENCY.toUpperCase()}. ` +
            'Please contact support@lastdonor.org so we can arrange your payout - no funds have been moved.',
          requestId,
        },
      } satisfies ApiError,
      { status: 400 },
    );
  }

  const payoutCurrency = (user.payoutCurrency ?? PLATFORM_PAYOUT_CURRENCY).toLowerCase();
  if (!isSupportedPayoutCurrency(payoutCurrency)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Your payout account settles in ${payoutCurrency.toUpperCase()}, and withdrawals can currently only be paid in ${PLATFORM_PAYOUT_CURRENCY.toUpperCase()}. Please contact support@lastdonor.org so we can arrange your payout - no funds have been moved.`,
          requestId,
        },
      } satisfies ApiError,
      { status: 400 },
    );
  }

  // ── Atomic check-and-reserve ──────────────────────────────────────────────
  //
  // totalWithdrawnAmount is only written later, by the Connect webhook on
  // transfer.created. So a balance check that reads released - withdrawn sees
  // nothing of a withdrawal already in flight: two concurrent POSTs both
  // passed it and both created real Stripe transfers (audit docs/29 P1-1).
  //
  // The fix: do the check and the reservation in one transaction that begins
  // by taking a row lock on the campaign. A second caller blocks on that lock,
  // and because READ COMMITTED gives each statement a fresh snapshot, once it
  // acquires the lock it sees the first caller's committed withdrawal row in
  // the pending sum and fails the check.
  //
  // The inserted 'processing' row IS the reservation. It is counted as pending
  // here and by user/balance, and stops being counted when it is marked
  // 'failed' below, so a failed transfer releases the funds again.
  const PENDING_STATUSES = ['requested', 'approved', 'processing'] as const;
  const withdrawalId = randomUUID();
  const currency = payoutCurrency;

  const reservation = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        status: campaigns.status,
        verificationStatus: campaigns.verificationStatus,
        totalReleasedAmount: campaigns.totalReleasedAmount,
        totalWithdrawnAmount: campaigns.totalWithdrawnAmount,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for('update')
      .limit(1);

    if (!locked) return { ok: false as const, reason: 'not_found' as const };

    // Campaign state is re-read UNDER THE LOCK, not from the unlocked
    // ownership read above: an admin cancelling or suspending a campaign (and
    // a bulk refund that takes minutes to walk the donations) must win the
    // race against a creator draining the released balance.
    if (!(WITHDRAWABLE_CAMPAIGN_STATUSES as readonly string[]).includes(String(locked.status))) {
      return { ok: false as const, reason: 'campaign_state' as const, status: String(locked.status) };
    }

    // Release is gated on full verification, so withdrawal must be too -
    // verification can be downgraded (rejected/suspended) after funds were
    // released, and the handler had no re-check at all before this.
    if (locked.verificationStatus !== 'fully_verified') {
      return { ok: false as const, reason: 'not_verified' as const };
    }

    /*
      ⛔ THE INVARIANT THE DONOR-FACING CLAIM RESTS ON. See `docs/113` §11.

      When a campaign is designated to an institution, its page tells donors
      *"It does not pass through the family's own account."* The destination
      in this handler is the CALLER's Connect account (resolved above with
      `eq(users.id, session.user.id)`), so without this check an organiser
      could designate a hospital, collect on that promise, and then withdraw
      the money to themselves - making a published claim false in the one
      direction that costs a family their money.

      Read UNDER THE LOCK, with the campaign row, for the same reason the
      status re-read is: a designation created while a withdrawal is in
      flight must win the race. It is a sequential query inside the existing
      transaction, so the `docs/87` three-concurrent-query cap is untouched.
    */
    const designation = await activeDesignation(tx, campaignId);

    if (organiserWithdrawalBlockedBy(designation)) {
      return { ok: false as const, reason: 'designated_to_institution' as const };
    }

    // An in-progress refund batch means donors are being paid back from the
    // same pot. Paying the creator concurrently pays the money out twice.
    const [openRefund] = await tx
      .select({ id: refundBatches.id })
      .from(refundBatches)
      .where(
        and(
          eq(refundBatches.campaignId, campaignId),
          eq(refundBatches.status, 'processing'),
        ),
      )
      .limit(1);

    if (openRefund) return { ok: false as const, reason: 'refunds_open' as const };

    // Re-check idempotency under the lock so two replays of the same key
    // cannot both reserve.
    const [replay] = await tx
      .select({ id: campaignWithdrawals.id, status: campaignWithdrawals.status })
      .from(campaignWithdrawals)
      .where(
        and(
          eq(campaignWithdrawals.campaignId, campaignId),
          eq(campaignWithdrawals.requestedBy, userId),
          eq(campaignWithdrawals.notes, `idem:${idempotencyKey}`),
        ),
      )
      .limit(1);

    if (replay) return { ok: false as const, reason: 'replay' as const, replay };

    const [pendingRow] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${campaignWithdrawals.amount}), 0)::int` })
      .from(campaignWithdrawals)
      .where(
        and(
          eq(campaignWithdrawals.campaignId, campaignId),
          inArray(campaignWithdrawals.status, [...PENDING_STATUSES]),
        ),
      );

    const availableBalance =
      (locked.totalReleasedAmount ?? 0)
      - (locked.totalWithdrawnAmount ?? 0)
      - (pendingRow?.total ?? 0);

    if (amount > availableBalance) {
      return { ok: false as const, reason: 'insufficient' as const, availableBalance };
    }

    await tx.insert(campaignWithdrawals).values({
      id: withdrawalId,
      campaignId: campaign.id,
      requestedBy: userId,
      amount,
      status: 'processing',
      stripeConnectAccount: user.stripeConnectAccountId,
      notes: `idem:${idempotencyKey}`,
    });

    return { ok: true as const };
  });

  if (!reservation.ok) {
    if (reservation.reason === 'replay') {
      return NextResponse.json(
        { ok: true, data: { withdrawalId: reservation.replay.id, status: reservation.replay.status, deduplicated: true } },
        { status: 200 },
      );
    }

    if (reservation.reason === 'not_found') {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    if (reservation.reason === 'campaign_state') {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'CONFLICT',
            message: `This campaign is ${reservation.status.replace(/_/g, ' ')} and withdrawals are on hold. Contact support@lastdonor.org if you believe this is a mistake.`,
            requestId,
          },
        } satisfies ApiError,
        { status: 409 },
      );
    }

    if (reservation.reason === 'not_verified') {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'CONFLICT',
            message: 'This campaign is not fully verified, so withdrawals are on hold. Complete verification to withdraw.',
            requestId,
          },
        } satisfies ApiError,
        { status: 409 },
      );
    }

    if (reservation.reason === 'designated_to_institution') {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'CONFLICT',
            message:
              'This campaign pays the institution you chose, not your own account. Donors were told their money does not pass through your account. Contact support@lastdonor.org if this is wrong.',
            requestId,
          },
        } satisfies ApiError,
        { status: 409 },
      );
    }

    if (reservation.reason === 'refunds_open') {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'CONFLICT',
            message: 'Donations on this campaign are currently being refunded, so withdrawals are paused. Contact support@lastdonor.org for details.',
            requestId,
          },
        } satisfies ApiError,
        { status: 409 },
      );
    }

    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: `Insufficient balance. Available: ${reservation.availableBalance} cents`, requestId } } satisfies ApiError,
      { status: 400 },
    );
  }

  try {
    // Execute Stripe transfer. Deliberately outside the transaction: no
    // external I/O inside a DB transaction.
    const transferResult = await createTransfer(
      amount,
      currency,
      user.stripeConnectAccountId,
      {
        campaign_id: campaign.id,
        campaign_title: campaign.title ?? '',
        withdrawal_id: withdrawalId,
        user_id: session.user.id,
      },
      idempotencyKey,
    );

    // Update withdrawal with transfer ID
    await db
      .update(campaignWithdrawals)
      .set({ stripeTransferId: transferResult.transferId })
      .where(eq(campaignWithdrawals.id, withdrawalId));

    const data = {
      withdrawalId,
      amount,
      currency,
      transferId: transferResult.transferId,
      status: 'processing' as const,
    };

    const response: ApiResponse<typeof data> = { ok: true, data };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error('[POST /api/v1/user-campaigns/[id]/withdraw]', err);

    const rawReason = err instanceof Error ? err.message : 'Transfer failed';

    // ── The reservation may only be released on a DEFINITE failure ──────────
    //
    // Marking the row 'failed' removes it from PENDING_STATUSES, which frees
    // the reserved balance for another withdrawal. That is correct only when
    // we know Stripe never created the transfer. A thrown connection error,
    // timeout or 5xx is an UNKNOWN outcome: transfers.create may have
    // succeeded and only the response was lost, in which case freeing the
    // balance lets the next request pay the creator twice.
    //
    // So unknown outcomes stay 'processing' - still counted as pending, so
    // the money stays reserved - with the reason recorded for operators. The
    // row is resolved by the transfer.created / transfer.reversed webhook, or
    // by hand. `notes` is NOT touched: it carries `idem:<key>`, which is the
    // replay guard, and the same idempotency key is what makes an operator
    // retry safe at Stripe's end too.
    if (isDefiniteTransferFailure(err)) {
      await db
        .update(campaignWithdrawals)
        .set({
          status: 'failed',
          failureReason: rawReason,
          processedAt: new Date(),
        })
        .where(eq(campaignWithdrawals.id, withdrawalId));

      /*
        Tell the organiser. `notifyWithdrawalFailed` and its email template
        both existed and had ZERO callers, so a definite failure released the
        reservation and said nothing at all - the organiser's money came back
        and the only way to learn why was to reload the payouts screen and
        read a raw gateway string.

        ⛔ ONLY on the definite branch. The `else` below is the UNKNOWN
        outcome, where we do not know whether the transfer went through -
        emailing "your withdrawal failed" there would be a claim the platform
        cannot substantiate, and it is the one case where the money may
        actually have moved.

        The reason sent is the LAUNDERED message, not `rawReason`: this goes
        in an email, and `safeFailureMessage` is what the HTTP response has
        always used. Fire-and-forget - a mail failure must not change the
        money outcome. `docs/121`.
      */
      if (user?.email) {
        notifyWithdrawalFailed({
          creatorId: session.user.id,
          creatorEmail: user.email,
          creatorName: user.name ?? 'Campaigner',
          campaignTitle: campaign.title,
          amount: parsed.data.amount,
          reason: safeFailureMessage(err),
        }).catch((e) => console.error('[withdraw] failure notification error:', e));
      }
    } else {
      await db
        .update(campaignWithdrawals)
        .set({
          status: 'processing',
          failureReason: `UNKNOWN_OUTCOME: ${rawReason}`,
        })
        .where(eq(campaignWithdrawals.id, withdrawalId));

      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message:
              'We could not confirm whether this withdrawal went through, so it is being held for review and the amount stays reserved. Please do not retry - contact support@lastdonor.org if it has not resolved within one business day.',
            requestId,
          },
        } satisfies ApiError,
        { status: 502 },
      );
    }

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: safeFailureMessage(err), requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
