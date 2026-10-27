import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { PLATFORM_PAYOUT_CURRENCY } from '@/lib/validators/payout';
import { users, campaigns, campaignWithdrawals } from '@/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { stripe } from '@/lib/stripe';
import { mapAccountToStatus } from '@/lib/stripe-connect';
import { notifyWithdrawalCompleted } from '@/lib/notifications';
import { logError } from '@/lib/errors';
import type Stripe from 'stripe';

const CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

// Fast-path dedup within one process only: it is empty after a restart and
// unknown to every other instance, so it can never be the idempotency guard
// (audit docs/29 P1-1). The durable guard lives in the handlers below, each of
// which advances a withdrawal's status with a conditional UPDATE and only
// touches money when that UPDATE actually matched a row.
const processedEvents = new Set<string>();

/**
 * POST /api/v1/stripe-connect/webhook
 * Handles Stripe Connect webhook events for account status changes and transfer updates.
 */
export async function POST(request: NextRequest) {
  if (!CONNECT_WEBHOOK_SECRET) {
    console.error('[Connect Webhook] STRIPE_CONNECT_WEBHOOK_SECRET is not configured');
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 500 },
    );
  }

  let event: Stripe.Event;

  try {
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 },
      );
    }

    event = stripe.webhooks.constructEvent(rawBody, signature, CONNECT_WEBHOOK_SECRET);
  } catch (error) {
    console.error('[Connect Webhook] Signature verification failed:', error);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 },
    );
  }

  // Idempotency fast path (see note on processedEvents).
  if (processedEvents.has(event.id)) {
    return NextResponse.json({ received: true, deduplicated: true });
  }
  processedEvents.add(event.id);

  // Cap set size to prevent memory leak
  if (processedEvents.size > 10000) {
    const iter = processedEvents.values();
    for (let i = 0; i < 5000; i++) {
      const val = iter.next().value;
      if (val !== undefined) processedEvents.delete(val);
    }
  }

  try {
    switch (event.type) {
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;

      case 'transfer.created':
        await handleTransferCreated(event.data.object as Stripe.Transfer);
        break;

      case 'transfer.reversed':
        await handleTransferReversed(event.data.object as Stripe.Transfer);
        break;

      default:
        // Not subscribed to: nothing to retry, so acknowledging is correct.
        return NextResponse.json({ received: true, ignored: event.type });
    }
  } catch (error) {
    logError(error, { requestId: event.id, route: 'stripe-connect/webhook', method: 'POST' });

    // Release the fast-path marker so Stripe's retry is processed rather than
    // short-circuited by this instance.
    processedEvents.delete(event.id);

    // Do not acknowledge a genuine failure. A swallowed transfer.created left
    // totalWithdrawnAmount un-incremented, which silently re-grants the
    // creator a balance they have already been paid. The handlers are
    // replay-safe, so a Stripe retry is the correct recovery.
    return NextResponse.json(
      { error: 'Webhook handler failed', eventId: event.id },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

/**
 * Syncs a Stripe Connect account status to the local user record.
 */
async function handleAccountUpdated(account: Stripe.Account) {
  const userId = account.metadata?.lastdonor_user_id;
  if (!userId) {
    console.warn('[Connect Webhook] account.updated missing lastdonor_user_id:', account.id);
    return;
  }

  const accountInfo = mapAccountToStatus(account);

  const updateFields: Record<string, unknown> = {
    stripeConnectStatus: accountInfo.status,
  };

  if (accountInfo.status === 'verified' || accountInfo.status === 'restricted') {
    // Account has been through onboarding at least once
    updateFields.stripeConnectOnboardedAt = new Date();
  }

  if (account.default_currency) {
    updateFields.payoutCurrency = account.default_currency;
  }

  await db
    .update(users)
    .set(updateFields)
    .where(eq(users.id, userId));

  logError(new Error(`account.updated processed`), { requestId: 'connect-webhook', route: 'stripe-connect/webhook', method: 'POST' }, { userId, status: accountInfo.status });
}

/**
 * Handles a completed transfer by marking the withdrawal as completed
 * and incrementing campaign's totalWithdrawnAmount.
 */
async function handleTransferCreated(transfer: Stripe.Transfer) {
  const withdrawalId = transfer.metadata?.withdrawal_id;
  const campaignId = transfer.metadata?.campaign_id;

  if (!withdrawalId || !campaignId) {
    console.warn('[Connect Webhook] transfer.paid missing metadata:', transfer.id);
    return;
  }

  // Durable idempotency: the `status <> 'completed'` guard is what makes a
  // replay (Stripe retry, duplicate delivery, process restart) harmless. If it
  // matches no row the withdrawal was already settled, so totalWithdrawnAmount
  // must not be incremented a second time and the creator must not be emailed
  // again.
  //
  // 'failed' is excluded as well, because Stripe does not guarantee event
  // ordering: a transfer.reversed can arrive before its transfer.created. The
  // reversal marks the row failed without touching the counter (nothing had
  // been added for it yet), so a late transfer.created must not then add the
  // amount to totalWithdrawnAmount for money that has already come back.
  const settled = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(campaignWithdrawals)
      .set({
        status: 'completed',
        processedAt: new Date(),
      })
      .where(and(
        eq(campaignWithdrawals.id, withdrawalId),
        ne(campaignWithdrawals.status, 'completed'),
        ne(campaignWithdrawals.status, 'failed'),
      ))
      .returning({ id: campaignWithdrawals.id });

    if (claimed.length === 0) return false;

    await tx
      .update(campaigns)
      .set({
        totalWithdrawnAmount: sql`${campaigns.totalWithdrawnAmount} + ${transfer.amount}`,
      })
      .where(eq(campaigns.id, campaignId));

    return true;
  });

  if (!settled) {
    logError(new Error('transfer.created replay ignored'), {
      requestId: transfer.id,
      route: 'stripe-connect/webhook',
      method: 'POST',
      input: { withdrawalId, campaignId },
    });
    return;
  }

  // Send notification to the campaign creator
  try {
    const [campaign] = await db
      .select({ title: campaigns.title, creatorId: campaigns.creatorId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (campaign?.creatorId) {
      const [creator] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, campaign.creatorId))
        .limit(1);

      if (creator?.email) {
        notifyWithdrawalCompleted({
          creatorId: campaign.creatorId,
          creatorEmail: creator.email,
          creatorName: creator.name ?? 'Campaigner',
          /*
            Derived from the payout rail, not written as 'USD'.
            `withdraw/route.ts` refuses any other currency with
            WRONG_PAYMENT_RAIL (`docs/121` §4), so this IS the currency of
            every transfer - and if that rail ever changes this email
            follows instead of quietly lying. `docs/125`.
          */
          currency: PLATFORM_PAYOUT_CURRENCY.toUpperCase(),
          campaignTitle: campaign.title ?? 'Campaign',
          amount: transfer.amount,
          transferId: transfer.id,
        }).catch((err) => console.error('[Connect Webhook] notification error:', err));
      }
    }
  } catch (err) {
    console.error('[Connect Webhook] Failed to send transfer.paid notification:', err);
  }

  // Logged via Sentry structured logging (no console.log in production)
}

/**
 * Handles a reversed transfer by decrementing the campaign's totalWithdrawnAmount
 * and marking the withdrawal as failed.
 */
async function handleTransferReversed(transfer: Stripe.Transfer) {
  const withdrawalId = transfer.metadata?.withdrawal_id;
  const campaignId = transfer.metadata?.campaign_id;

  if (!withdrawalId || !campaignId) {
    console.warn('[Connect Webhook] transfer.reversed missing metadata:', transfer.id);
    return;
  }

  // Only a withdrawal that reached 'completed' has had its amount ADDED to
  // campaigns.total_withdrawn_amount (handleTransferCreated is the only writer
  // of that counter), so only a 'completed' row may debit it.
  //
  // The previous guard was `status <> 'failed'`, which also matched a row still
  // in 'processing'. Stripe does not guarantee event ordering, so a
  // transfer.reversed can arrive before its transfer.created: that guard then
  // flipped a 'processing' row and decremented a counter nothing had ever
  // incremented, freeing balance for money that had in fact been paid out.
  //
  // So: debit only on a completed -> failed transition. Any other ordering
  // still marks the withdrawal failed (it is terminal, and the funds stay
  // released rather than reserved) but leaves the counter alone.
  await db.transaction(async (tx) => {
    const reversedAfterCompletion = await tx
      .update(campaignWithdrawals)
      .set({
        status: 'failed',
        failureReason: 'Transfer reversed',
        processedAt: new Date(),
      })
      .where(and(eq(campaignWithdrawals.id, withdrawalId), eq(campaignWithdrawals.status, 'completed')))
      .returning({ id: campaignWithdrawals.id });

    if (reversedAfterCompletion.length > 0) {
      await tx
        .update(campaigns)
        .set({
          totalWithdrawnAmount: sql`GREATEST(0, ${campaigns.totalWithdrawnAmount} - ${transfer.amount})`,
        })
        .where(eq(campaigns.id, campaignId));
      return;
    }

    // Reversal-first (or an already-failed row): record the terminal state
    // WITHOUT touching the money counter.
    await tx
      .update(campaignWithdrawals)
      .set({
        status: 'failed',
        failureReason: 'Transfer reversed',
        processedAt: new Date(),
      })
      .where(and(eq(campaignWithdrawals.id, withdrawalId), ne(campaignWithdrawals.status, 'failed')));
  });

  // Logged via Sentry structured logging (no console.log in production)
}
