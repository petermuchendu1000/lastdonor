import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, campaignWithdrawals, users } from '@/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { withdrawalRequestSchema } from '@/lib/validators/payout';
import { createTransfer } from '@/lib/stripe-connect';
import { randomUUID } from 'crypto';
import type { ApiResponse, ApiError } from '@/types/api';

/**
 * POST /api/v1/user-campaigns/[id]/withdraw
 * Creator-initiated withdrawal. Validates ownership, Connect status,
 * available balance, then creates a Stripe transfer.
 */
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
  const currency = user.payoutCurrency ?? 'usd';

  const reservation = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        totalReleasedAmount: campaigns.totalReleasedAmount,
        totalWithdrawnAmount: campaigns.totalWithdrawnAmount,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for('update')
      .limit(1);

    if (!locked) return { ok: false as const, reason: 'not_found' as const };

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

    // Mark withdrawal as failed if it was inserted
    const failureReason = err instanceof Error ? err.message : 'Transfer failed';
    await db
      .update(campaignWithdrawals)
      .set({
        status: 'failed',
        failureReason,
        processedAt: new Date(),
      })
      .where(eq(campaignWithdrawals.id, withdrawalId));

    // Surface user-safe error messages only. Never expose Stripe internals.
    let message = 'Withdrawal could not be processed right now. Please try again later or contact support.';
    if (err instanceof Error && 'type' in err) {
      const stripeErr = err as { type: string; message: string; code?: string };
      if (stripeErr.code === 'balance_insufficient' || stripeErr.message?.includes('insufficient')) {
        message = 'This withdrawal cannot be processed at the moment. Platform funds are being settled. Please try again later.';
      } else if (stripeErr.message?.includes('not currently available') || stripeErr.message?.includes('payouts_not_allowed')) {
        message = 'Your payout account is not yet ready to receive transfers. Please check your account for any pending requirements.';
      } else if (stripeErr.message?.includes('currency')) {
        message = 'There was a currency mismatch with your payout account. Please contact support.';
      }
    }

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message, requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
