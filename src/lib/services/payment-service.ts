/**
 * Payment Processing Service
 *
 * SOLID: Single Responsibility - handles the business logic of processing
 * successful payments, separated from the HTTP webhook handler.
 *
 * The webhook route.ts is now a thin adapter that verifies Stripe signatures
 * and delegates to this service.
 */

import { db } from '@/db';
import { insertCampaignUpdate, insertCampaignMessage } from '@/lib/echo-counters';
import { campaigns, donations, users, auditLogs, fundPoolAllocations, donorCampaignSubscriptions } from '@/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { stripe } from '@/lib/stripe';
import { getCampaignPhase } from '@/lib/utils/phase';
import { revalidatePath } from 'next/cache';
import { resend } from '@/lib/resend';
import { retryWithBackoff } from '@/lib/utils/retry';
import {
  notifyAdminsDonationReceived, notifyCreatorDonationReceived,
  notifyCreatorFirstDonation, notifyCreatorCampaignCompleted,
} from '@/lib/notifications';
import { donationReceiptEmail } from '@/lib/email-templates';
import { formatDocumentRequirementsHtml } from '@/lib/document-requirements';
import { logError } from '@/lib/errors';
import { safeAsync } from '@/lib/api-handler';
import { assertSameCurrency, isSupportedCurrency, normaliseCurrencyCode } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';
import type Stripe from 'stripe';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * One settled payment, as any gateway describes it.
 *
 * This type is what lets a second gateway reuse the donation write path
 * instead of copying it. Everything below `recordGatewayCharge` is written
 * against this and knows nothing about Stripe or PayHero.
 *
 * That matters more here than it would elsewhere: `docs/41` established one
 * writer for donation accounting after four independent refund
 * implementations had drifted apart, three of them wrongly. A second gateway
 * with its own copy of the campaign-tally, completion, fund-pool,
 * echo-counter, receipt and notification logic would recreate exactly that
 * problem, in the half of the code that moves money rather than the half that
 * reports it.
 */
export interface GatewayCharge {
  /** Which gateway took the money. Decides what can later be done with it. */
  provider: 'stripe' | 'payhero';
  /**
   * The gateway's own reference, already namespaced for the provider
   * (`pi_…`, `payhero_…`). Stored in `donations.stripe_payment_id`, whose
   * unique index is the only durable replay guard on the platform.
   */
  providerRef: string;
  /** Amount in the MINOR units of `currency`. */
  amountMinor: number;
  /** ISO 4217 code. Must match the campaign's, or nothing is written. */
  currency: string;
  metadata: PaymentMetadata;
}

interface PaymentMetadata {
  campaignId: string;
  donorName: string;
  donorEmail: string;
  donorLocation: string | null;
  message: string | null;
  isAnonymous: boolean;
  isRecurring: boolean;
  subscribedToUpdates: boolean;
  /** Share link that brought this donor, if any. See docs/57. */
  shareLinkId: string | null;
}

interface TransactionResult {
  newRaised: number;
  goalAmount: number;
  justCompleted: boolean;
  /** Donor count AFTER this donation, read from the transaction's RETURNING. */
  donorCount: number;
  /** True only for the donation that moved donorCount from 0 to 1. */
  isFirstDonation: boolean;
  donationId: string;
}

// ─── Metadata Extraction (Fail Fast) ────────────────────────────────────────

function parseMetadata(meta: Stripe.Metadata): PaymentMetadata | null {
  if (!meta.campaignId || !meta.donorEmail) return null;

  return {
    campaignId: meta.campaignId,
    donorName: meta.donorName || 'Anonymous',
    donorEmail: meta.donorEmail,
    donorLocation: meta.donorLocation || null,
    message: meta.message || null,
    isAnonymous: meta.isAnonymous === 'true',
    isRecurring: meta.isRecurring === 'true',
    subscribedToUpdates: meta.subscribedToUpdates === 'true',
    /*
     * Absent on the overwhelming majority of donations, and absent on every
     * donation taken before this existed. Treated as optional for exactly
     * that reason: a missing attribution is the normal case, never an error.
     */
    shareLinkId: meta.shareLinkId || null,
  };
}

/**
 * Recover donor context for a recurring charge.
 *
 * Stripe forbids `payment_intent_data` in subscription mode, so a subscription
 * invoice's PaymentIntent carries no metadata of its own: the donor context
 * lives on `subscription.metadata` (written by create-checkout). Without this
 * lookup every recurring charge is taken with no donation row, no receipt and
 * no campaign credit (audit docs/29 P1-2).
 *
 * All Stripe I/O here happens *before* the database transaction opens.
 */
async function resolveSubscriptionMetadata(
  paymentIntent: Stripe.PaymentIntent,
): Promise<PaymentMetadata | null> {
  const invoiceRef = paymentIntent.invoice;
  if (!invoiceRef) return null;

  const invoice =
    typeof invoiceRef === 'string' ? await stripe.invoices.retrieve(invoiceRef) : invoiceRef;

  const subscriptionRef = invoice.subscription;
  if (!subscriptionRef) return null;

  const subscription =
    typeof subscriptionRef === 'string'
      ? await stripe.subscriptions.retrieve(subscriptionRef)
      : subscriptionRef;

  const subscriptionMeta: Stripe.Metadata = { ...(subscription.metadata ?? {}), isRecurring: 'true' };
  const parsed = parseMetadata(subscriptionMeta);
  if (!parsed) return null;

  // Stripe metadata is the disaster-recovery substrate: donations must be
  // reconstructible from Stripe alone. Copy the donor context onto the
  // PaymentIntent that actually moved the money. Best effort only - a failure
  // here must never stop the donation being recorded.
  try {
    await stripe.paymentIntents.update(paymentIntent.id, { metadata: subscriptionMeta });
  } catch (updateError) {
    logError(updateError, {
      requestId: paymentIntent.id,
      route: 'webhook/recurring-metadata-writeback',
    });
  }

  return parsed;
}

async function extractMetadata(
  paymentIntent: Stripe.PaymentIntent,
): Promise<PaymentMetadata | null> {
  const direct = parseMetadata(paymentIntent.metadata);
  if (direct) return direct;

  const fromSubscription = await resolveSubscriptionMetadata(paymentIntent);
  if (fromSubscription) return fromSubscription;

  logError(
    new Error('Missing required metadata on PaymentIntent'),
    { requestId: paymentIntent.id, route: 'webhook/payment-service' },
  );
  return null;
}

// ─── Core Transaction ───────────────────────────────────────────────────────

async function processPaymentTransaction(
  charge: GatewayCharge,
  campaign: typeof campaigns.$inferSelect,
  userId: string | null,
): Promise<TransactionResult | null> {
  const meta = charge.metadata;
  const { campaignId, donorName, donorLocation, message, isAnonymous, isRecurring } = meta;
  const amount = charge.amountMinor;
  const currency = normaliseCurrencyCode(charge.currency);

  /*
    The arithmetic below adds `amount` to `campaign.raisedAmount` and compares
    the result against `campaign.goalAmount`. That is only meaningful if all
    three are in the same currency. The composite foreign key on
    (campaign_id, currency) would reject the INSERT anyway, but by then the
    transaction has opened and the error arrives as a constraint violation
    rather than as the thing that is actually wrong. Checked here so the
    failure names itself.
  */
  assertSameCurrency(currency, campaign.currency, `donation on campaign ${campaignId}`);

  // Compute phase from post-increment value to avoid stale reads under concurrency
  const phase = getCampaignPhase(campaign.raisedAmount + amount, campaign.goalAmount);

  return db.transaction(async (tx) => {
    // Insert donation - unique constraint on stripe_payment_id prevents duplicates
    const insertResult = await tx.insert(donations).values({
      campaignId,
      userId,
      stripePaymentId: charge.providerRef,
      provider: charge.provider,
      currency,
      amount,
      donorName,
      donorEmail: meta.donorEmail,
      donorLocation,
      message,
      isAnonymous,
      isRecurring,
      phaseAtTime: phase,
      source: 'real',
      /*
       * Written in the same INSERT as the donation, inside the same
       * transaction, so attribution cannot drift from the row it describes.
       * docs/41 established one writer for donation accounting; this does
       * not add a second.
       */
      shareLinkId: meta.shareLinkId,
    }).onConflictDoNothing({ target: donations.stripePaymentId }).returning({ id: donations.id });

    if (insertResult.length === 0) return null; // Duplicate webhook

    const donationId = insertResult[0].id;

    // Update campaign tallies atomically
    const newRaisedResult = await tx
      .update(campaigns)
      .set({
        raisedAmount: sql`${campaigns.raisedAmount} + ${amount}`,
        donorCount: sql`${campaigns.donorCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaignId))
      .returning({
        raisedAmount: campaigns.raisedAmount,
        goalAmount: campaigns.goalAmount,
        donorCount: campaigns.donorCount,
        status: campaigns.status,
      });

    const newRaised = newRaisedResult[0]?.raisedAmount ?? campaign.raisedAmount + amount;
    const goalAmount = newRaisedResult[0]?.goalAmount ?? campaign.goalAmount;
    // Post-increment counters, read from this transaction's own RETURNING.
    // Never from the pre-transaction snapshot in `campaign`, which two
    // concurrent donors would both see as stale (audit docs/29 P1-3).
    const newDonorCount = newRaisedResult[0]?.donorCount ?? campaign.donorCount + 1;
    const currentStatus = newRaisedResult[0]?.status ?? campaign.status;
    const isFirstDonation = newDonorCount === 1;

    let justCompleted = false;

    // Check if campaign is now completed.
    if (newRaised >= goalAmount) {
      // The `status <> 'completed'` guard is what makes completion single-shot:
      // of two donors crossing the goal concurrently, the second one's UPDATE
      // matches no row and returns nothing, so it raises no duplicate
      // completion email, no duplicate celebration post and no second payout
      // eligibility.
      const completionResult = await tx.update(campaigns).set({
        status: 'completed',
        completedAt: new Date(),
        lastDonorName: isAnonymous ? 'Anonymous' : donorName,
        lastDonorAmount: amount,
        ...(userId ? { lastDonorId: userId } : {}),
      })
        .where(and(eq(campaigns.id, campaignId), ne(campaigns.status, 'completed')))
        .returning({ id: campaigns.id });

      if (completionResult.length > 0) {
        justCompleted = true;

        if (userId) {
          await tx.update(users).set({
            lastDonorCount: sql`${users.lastDonorCount} + 1`,
          }).where(eq(users.id, userId));
        }

        // Celebration update
        const lastDonorDisplay = isAnonymous ? 'An anonymous donor' : donorName;
        await insertCampaignUpdate({
          campaignId,
          title: 'Campaign Goal Reached!',
          /*
            Formatted through the currency registry, not with a `$` and a
            division by 100. This string is published on the campaign page, so
            a KES campaign used to announce its own completion in dollars -
            and a zero-decimal currency would have been understated 100x.
          */
          bodyHtml: `<p><strong>${lastDonorDisplay}</strong> just made the final donation of ${formatMoney(amount, currency, 'exact')}, pushing this campaign past its goal of ${formatMoney(goalAmount, currency, 'exact')}!</p><p>Thank you to every single donor who made this possible. This campaign has now been fully funded.</p>`,
          updateType: 'celebration',
        }, tx);
      }
    } else if (newRaised >= goalAmount * 0.9 && currentStatus === 'active') {
      await tx.update(campaigns).set({ status: 'last_donor_zone' }).where(eq(campaigns.id, campaignId));
    }

    // Update user stats
    if (userId) {
      await tx.update(users).set({
        totalDonated: sql`${users.totalDonated} + ${amount}`,
        campaignsSupported: sql`${users.campaignsSupported} + 1`,
        lastDonationAt: new Date(),
      }).where(eq(users.id, userId));
    }

    // Audit log
    await tx.insert(auditLogs).values({
      eventType: 'donation.recorded',
      actorId: userId,
      targetType: 'donation',
      targetId: campaignId,
      details: {
        amount,
        currency,
        provider: charge.provider,
        campaignId,
        providerRef: charge.providerRef,
        // Kept under the old key as well: queries and dashboards written
        // against `stripePaymentId` predate there being a second gateway.
        stripePaymentId: charge.providerRef,
        phase,
        isAnonymous,
      },
      severity: 'info',
    });

    // Fund pool tracking for simulated campaigns
    if (campaign.simulationFlag) {
      await tx.insert(fundPoolAllocations).values({
        donationId,
        sourceCampaignId: campaignId,
        amount,
        status: 'pending',
      });

      await tx.insert(auditLogs).values({
        eventType: 'fund_pool.donation_received',
        targetType: 'donation',
        targetId: donationId,
        severity: 'info',
        details: { amount, currency, provider: charge.provider, campaignId, providerRef: charge.providerRef },
      });
    }

    // Insert campaign message if donor left one
    if (message) {
      await insertCampaignMessage({
        campaignId,
        userId,
        donorName: isAnonymous ? 'Anonymous' : donorName,
        donorLocation: isAnonymous ? null : donorLocation,
        message,
        isAnonymous,
        donationId,
      }, tx);
    }

    return { newRaised, goalAmount, justCompleted, donorCount: newDonorCount, isFirstDonation, donationId };
  });
}

// ─── Post-Transaction Side Effects ──────────────────────────────────────────

async function handlePostPaymentEffects(
  charge: GatewayCharge,
  campaign: typeof campaigns.$inferSelect,
  userId: string | null,
  txResult: TransactionResult,
) {
  const meta = charge.metadata;
  const { campaignId, donorName, donorEmail, isAnonymous, message: _message, subscribedToUpdates } = meta;
  const amount = charge.amountMinor;
  const currency = normaliseCurrencyCode(charge.currency);
  const { newRaised: _newRaised, goalAmount, justCompleted, donorCount, isFirstDonation } = txResult;
  const requestCtx = { requestId: charge.providerRef, userId: userId ?? undefined };

  // Campaign subscription (fire-and-forget)
  if (subscribedToUpdates && donorEmail) {
    safeAsync(
      db.insert(donorCampaignSubscriptions).values({
        donorEmail, userId, campaignId, subscribed: true,
      }).onConflictDoNothing(),
      'webhook/campaign-subscription', requestCtx,
    );
  }

  // ISR revalidation
  revalidatePath(`/campaigns/${campaign.slug}`);
  revalidatePath('/campaigns');

  // Receipt email (fire-and-forget)
  safeAsync(
    sendDonationReceipt({ charge, campaign, userId }),
    'webhook/receipt-email', requestCtx,
  );

  // Admin + creator notifications (fire-and-forget)
  safeAsync(
    sendDonationNotifications({ meta, campaign, amount, currency }),
    'webhook/donation-notifications', requestCtx,
  );

  // Pre-fetch creator for completion notifications
  const creator = campaign.creatorId ? await fetchCreator(campaign.creatorId) : null;

  // First donation notification. `isFirstDonation` comes from the
  // transaction's own RETURNING (donorCount === 1 after the increment), so of
  // two concurrent first donors exactly one sends this email. Reading
  // `campaign.donorCount === 0` from the pre-transaction snapshot sent it
  // twice (audit docs/29 P1-3).
  if (isFirstDonation && creator) {
    safeAsync(
      notifyCreatorFirstDonation({
        creatorId: creator.id,
        creatorEmail: creator.email,
        creatorName: creator.name || 'Campaigner',
        campaignTitle: campaign.title,
        campaignSlug: campaign.slug,
        campaignPublishedAt: campaign.publishedAt,
        donorName, amount, currency, isAnonymous,
      }),
      'webhook/first-donation', requestCtx,
    );
  }

  // Campaign completion notification
  if (justCompleted && creator) {
    safeAsync(
      notifyCreatorCampaignCompleted({
        creatorId: creator.id,
        creatorEmail: creator.email,
        creatorName: creator.name || 'Campaigner',
        campaignTitle: campaign.title,
        campaignSlug: campaign.slug,
        goalAmount,
        currency,
        donorCount,
        documentRequirementsHtml: formatDocumentRequirementsHtml(
          campaign.category,
          campaign.beneficiaryRelation ?? 'other',
        ),
      }),
      'webhook/completion', requestCtx,
    );
  }

}

// ─── Helper Functions ───────────────────────────────────────────────────────

async function fetchCreator(creatorId: string) {
  const [creator] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, creatorId))
    .limit(1);
  return creator ?? null;
}

/**
 * Send the donor receipt.
 *
 * Exported for direct testing: the production call site wraps this in
 * `safeAsync`, which both captures to Sentry and feeds the degradation
 * counter, so this function reports the failure and then rethrows.
 */
export async function sendDonationReceipt({
  charge, campaign, userId,
}: {
  charge: GatewayCharge;
  campaign: typeof campaigns.$inferSelect;
  userId: string | null;
}) {
  const meta = charge.metadata;
  // Check user email preferences
  if (userId) {
    const [userData] = await db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const prefs = userData?.preferences as Record<string, unknown> | null;
    if (prefs?.emailDonationReceipts === false) return;
  }

  if (!meta.donorEmail) return;
  const amount = charge.amountMinor;

  // The Resend SDK never throws: it resolves `{ data: null, error }` for every
  // non-2xx AND from inside its own catch, so without `isFailure` this loop
  // made exactly one attempt and the error was discarded (audit docs/29 P0-4).
  const sendResult = await retryWithBackoff(
    /*
      The receipt renders through the shared shell like every other template
      (`donationReceiptEmail`). It used to be an inline `<div>` right here,
      which made it one of only two sends in the codebase that bypassed
      docs/67 - and the one that interpolated `donorName`, a free-text field
      the donor types into the checkout form and which travels here through
      Stripe metadata, into HTML UNESCAPED. The template escapes every
      interpolated value, which is what the rest of `email-templates.ts`
      already did. See docs/74.
    */
    () => resend.emails.send({
      from: 'LastDonor.org <receipts@lastdonor.org>',
      to: meta.donorEmail,
      ...donationReceiptEmail({
        campaignTitle: campaign.title,
        donorName: meta.donorName,
        isAnonymous: meta.isAnonymous,
        amount,
        /*
          A receipt is a factual statement about money. Without the currency
          it rendered every amount with a `$`, so a KES 50 gift would have
          been receipted as "$50.00" - not a formatting slip but a wrong
          figure, off by the exchange rate, in the one document a donor keeps.
        */
        currency: normaliseCurrencyCode(charge.currency),
        transactionId: charge.providerRef,
      }),
    }),
    {
      maxRetries: 2,
      baseDelayMs: 500,
      isFailure: (result) => Boolean(result?.error),
    },
  );

  if (sendResult?.error) {
    const { name, message } = sendResult.error;
    const failure = new Error(
      `Donation receipt delivery failed for donation on campaign ${campaign.id}: ${name ?? 'unknown'}: ${message ?? 'no message'}`,
    );

    // Explicit Sentry capture at the failure site. Until `donations` carries a
    // receipt-state column (blocked on the migration repair - docs/29 §2) this
    // report is the only record that a donor never got their receipt.
    logError(failure, {
      requestId: charge.providerRef,
      route: 'webhook/receipt-email',
      userId: userId ?? undefined,
      input: {
        campaignId: campaign.id,
        stripePaymentId: charge.providerRef,
        donorEmail: meta.donorEmail,
        resendErrorName: name ?? 'unknown',
        attempts: 3,
      },
    });

    // Rethrow so the caller's safeAsync degradation counter also sees it.
    throw failure;
  }
}

async function sendDonationNotifications({
  meta, campaign, amount, currency,
}: {
  meta: PaymentMetadata;
  campaign: typeof campaigns.$inferSelect;
  amount: number;
  currency: string;
}) {
  await notifyAdminsDonationReceived({
    campaignId: meta.campaignId,
    campaignSlug: campaign.slug,
    campaignPublishedAt: campaign.publishedAt,
    campaignTitle: campaign.title,
    donorName: meta.donorName,
    amount,
    currency,
    isAnonymous: meta.isAnonymous,
    message: meta.message,
    excludeUserId: campaign.creatorId ?? undefined,
  });

  if (campaign.creatorId) {
    await notifyCreatorDonationReceived({
      creatorId: campaign.creatorId,
      campaignId: meta.campaignId,
      campaignTitle: campaign.title,
      campaignSlug: campaign.slug,
      campaignPublishedAt: campaign.publishedAt,
      donorName: meta.donorName,
      amount,
      currency,
      isAnonymous: meta.isAnonymous,
      message: meta.message,
    });
  }
}

// ─── Refund Accounting (single writer) ──────────────────────────────────────

/** The transaction handle `db.transaction` hands its callback. */
export type RefundTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AppliedRefund {
  donationId: string;
  campaignId: string;
  amount: number;
  source: 'real' | 'seed';
  stripePaymentId: string | null;
  donorEmail: string;
  /** Null when the campaign ledger was deliberately not adjusted (seed money). */
  raisedAmountAfter: number | null;
  totalReleasedAmountAfter: number | null;
  /** Released funds clawed back below what was already paid out: a cash shortfall. */
  releasedBelowWithdrawn: boolean;
}

export interface ApplyRefundParams {
  donationId: string;
  actorId?: string | null;
  actorRole?: (typeof auditLogs.$inferInsert)['actorRole'];
  /** Extra audit detail; merged over the computed ledger details. */
  auditDetails?: Record<string, unknown>;
  /**
   * Force the campaign-ledger adjustment on or off. Default: adjust for every
   * source except `seed`, which never contributed real money.
   */
  adjustCampaign?: boolean;
}

/**
 * Claim one donation for refund and correct the campaign ledger, in the
 * caller's transaction.
 *
 * This is the SOLE writer of `donations.refunded`. Four independent
 * implementations of refund accounting had drifted apart (admin single refund,
 * bulk cancel, batch retry, the `charge.refunded` webhook); three of them moved
 * money at Stripe and then either violated the
 * `campaigns_released_lte_raised` CHECK or never touched `campaigns` at all.
 *
 * Two invariants are enforced here and nowhere else:
 *
 * 1. **The claim is the first statement.** `WHERE refunded = false` plus
 *    `RETURNING` makes the flip atomic: of two concurrent webhook deliveries
 *    (Stripe retries; the in-process `processedEvents` set is per-instance)
 *    exactly one gets a row back and so exactly one decrements the campaign.
 *    Reading `refunded` outside the transaction and then writing it
 *    unconditionally let a $5 refund remove $10 and two donors. Modelled on
 *    `stripe-connect/webhook/route.ts`'s withdrawal claim.
 * 2. **`total_released_amount` is clamped in the same UPDATE** that lowers
 *    `raised_amount`. Both SET expressions read the pre-UPDATE
 *    `raised_amount`, which is what makes the clamp exact: released is pulled
 *    down only as far as the new raised figure, never below zero and never
 *    further than necessary. Without it the CHECK aborts the transaction
 *    *after* Stripe has already paid the donor back (audit docs/29 P0-3).
 *
 * @returns the applied refund, or `null` if the donation was already refunded
 *          (in which case nothing was written).
 */
export async function applyRefundInTx(
  tx: RefundTx,
  params: ApplyRefundParams,
): Promise<AppliedRefund | null> {
  // 1. Claim the row. This MUST be the first statement of the transaction.
  const claimed = await tx
    .update(donations)
    .set({ refunded: true })
    .where(and(eq(donations.id, params.donationId), eq(donations.refunded, false)))
    .returning({
      id: donations.id,
      campaignId: donations.campaignId,
      amount: donations.amount,
      source: donations.source,
      stripePaymentId: donations.stripePaymentId,
      donorEmail: donations.donorEmail,
    });

  if (claimed.length === 0) return null; // Already refunded - replay, no-op.

  const row = claimed[0];
  const adjustCampaign = params.adjustCampaign ?? row.source !== 'seed';

  let raisedAmountAfter: number | null = null;
  let totalReleasedAmountAfter: number | null = null;
  let releasedBelowWithdrawn = false;

  if (adjustCampaign) {
    // 2. Lower raised_amount and clamp released in the SAME statement.
    const newRaisedAmount = sql`GREATEST(${campaigns.raisedAmount} - ${row.amount}, 0)`;

    const [totals] = await tx
      .update(campaigns)
      .set({
        raisedAmount: newRaisedAmount,
        totalReleasedAmount: sql`LEAST(${campaigns.totalReleasedAmount}, ${newRaisedAmount})`,
        donorCount: sql`GREATEST(${campaigns.donorCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, row.campaignId))
      .returning({
        raisedAmount: campaigns.raisedAmount,
        totalReleasedAmount: campaigns.totalReleasedAmount,
        totalWithdrawnAmount: campaigns.totalWithdrawnAmount,
      });

    raisedAmountAfter = totals?.raisedAmount ?? null;
    totalReleasedAmountAfter = totals?.totalReleasedAmount ?? null;
    releasedBelowWithdrawn =
      totals != null && totals.totalReleasedAmount < totals.totalWithdrawnAmount;
  }

  await tx.insert(auditLogs).values({
    eventType: 'donation.refunded',
    actorId: params.actorId ?? null,
    ...(params.actorRole ? { actorRole: params.actorRole } : {}),
    targetType: 'donation',
    targetId: row.id,
    severity: 'warning',
    details: {
      amount: row.amount,
      campaignId: row.campaignId,
      donorEmail: row.donorEmail,
      source: row.source,
      stripePaymentId: row.stripePaymentId,
      campaignAdjusted: adjustCampaign,
      raisedAmountAfter,
      totalReleasedAmountAfter,
      // Released funds clawed back below what has already been paid out to the
      // creator leave a real cash shortfall. Recorded so reconciliation can
      // find it; nothing here can undo a completed transfer.
      releasedBelowWithdrawn,
      ...(params.auditDetails ?? {}),
    },
  });

  return {
    donationId: row.id,
    campaignId: row.campaignId,
    amount: row.amount,
    source: row.source,
    stripePaymentId: row.stripePaymentId,
    donorEmail: row.donorEmail,
    raisedAmountAfter,
    totalReleasedAmountAfter,
    releasedBelowWithdrawn,
  };
}

/** `applyRefundInTx` in a transaction of its own. */
export async function applyRefund(params: ApplyRefundParams): Promise<AppliedRefund | null> {
  return db.transaction((tx) => applyRefundInTx(tx, params));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Record one settled payment, whichever gateway took it.
 *
 * The provider-neutral entry point. `processPaymentSuccess` below is the
 * Stripe adapter onto it; the PayHero callback route is the other caller.
 * Everything that makes a donation a donation — the campaign tally, the
 * single-shot completion, user stats, the audit row, fund-pool allocation,
 * the echo counters, the receipt and the notifications — happens here once,
 * for both rails.
 */
export async function recordGatewayCharge(charge: GatewayCharge) {
  const meta = charge.metadata;

  // Fetch campaign
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, meta.campaignId))
    .limit(1);

  if (!campaign) {
    logError(
      new Error(`Campaign not found: ${meta.campaignId}`),
      { requestId: charge.providerRef, route: 'webhook/payment-service' },
    );
    return;
  }

  /*
    A charge in a currency the campaign does not raise in must never be
    recorded. The composite FK on (campaign_id, currency) would reject the
    INSERT, but refusing here means the money is flagged for a human instead
    of surfacing as a constraint violation in a log nobody reads - and the
    money HAS already moved by the time we are called.
  */
  /*
    Both conditions, not just the mismatch.

    Checking only that the two agree leaves a hole: if the gateway reports no
    currency at all and the campaign row is also blank, `'' === ''` passes and
    the write proceeds with a currency nothing can format. The first thing to
    fail was then `formatMoney` inside the transaction, *after* the donation
    row had been inserted — so a legitimate donation was lost to a rollback
    whose error message was about string formatting. Found by an existing test
    whose fixtures carried no currency, which is exactly the shape of a
    gateway that stops sending one.
  */
  if (
    !isSupportedCurrency(charge.currency) ||
    !isSupportedCurrency(campaign.currency) ||
    normaliseCurrencyCode(charge.currency) !== normaliseCurrencyCode(campaign.currency)
  ) {
    logError(
      new Error(
        `Currency mismatch: ${charge.provider} charged ${charge.currency} ` +
          `on campaign ${campaign.id}, which raises ${campaign.currency}. Donation NOT recorded.`,
      ),
      { requestId: charge.providerRef, route: 'webhook/payment-service#currency' },
    );
    await db.insert(auditLogs).values({
      eventType: 'donation.currency_mismatch',
      targetType: 'donation',
      targetId: campaign.id,
      severity: 'critical',
      details: {
        provider: charge.provider,
        providerRef: charge.providerRef,
        chargedCurrency: charge.currency,
        campaignCurrency: campaign.currency,
        chargeCurrencySupported: isSupportedCurrency(charge.currency),
        campaignCurrencySupported: isSupportedCurrency(campaign.currency),
        amount: charge.amountMinor,
        note: 'Money moved but no donation row was written. Needs manual reconciliation.',
      },
    });
    return;
  }

  // Reject donations on completed campaigns
  if (campaign.status === 'completed') {
    logError(
      new Error(`Donation on completed campaign - refunding: ${meta.campaignId}`),
      { requestId: charge.providerRef, route: 'webhook/payment-service' },
    );

    /*
      Only Stripe can be refunded from here. PayHero exposes no refund API
      (its only outbound endpoint is a withdrawal to a separate beneficiary),
      so an M-Pesa gift that lands after a campaign completes cannot be sent
      back automatically.

      Returning silently would be the worst option: the donor's money is in
      the platform's wallet with no donation row and no record that anyone
      owes it back. So it is written down at `critical` severity for a human
      to act on. The initiation route narrows the window by refusing a
      completed campaign before the prompt is sent, but the window is real -
      it is as long as the donor takes to enter a PIN.
    */
    if (charge.provider === 'stripe') {
      try {
        // Idempotency key: a retried delivery of the same PaymentIntent must
        // not create a second refund object at Stripe.
        await stripe.refunds.create(
          { payment_intent: charge.providerRef },
          { idempotencyKey: `refund:auto:${charge.providerRef}` },
        );
      } catch (refundError) {
        logError(refundError, { requestId: charge.providerRef, route: 'webhook/auto-refund' });
      }
    } else {
      await db.insert(auditLogs).values({
        eventType: 'donation.manual_refund_required',
        targetType: 'donation',
        targetId: campaign.id,
        severity: 'critical',
        details: {
          provider: charge.provider,
          providerRef: charge.providerRef,
          amount: charge.amountMinor,
          currency: charge.currency,
          donorEmail: meta.donorEmail,
          reason: 'Payment settled on an already-completed campaign and this gateway has no refund API.',
        },
      });
    }
    return;
  }

  // Look up registered user
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, meta.donorEmail)).limit(1);
  const userId = user?.id ?? null;

  // Core transaction
  const txResult = await processPaymentTransaction(charge, campaign, userId);
  if (!txResult) return; // Duplicate webhook

  // Side effects (non-blocking where possible)
  await handlePostPaymentEffects(charge, campaign, userId, txResult);
}

/**
 * Stripe adapter onto `recordGatewayCharge`.
 *
 * Signature deliberately unchanged, so the webhook route, the confirm route
 * and their tests are untouched by the multi-gateway work.
 */
export async function processPaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const meta = await extractMetadata(paymentIntent);
  if (!meta) return;

  await recordGatewayCharge({
    provider: 'stripe',
    providerRef: paymentIntent.id,
    amountMinor: paymentIntent.amount,
    /*
      Read from the PaymentIntent, which is what Stripe actually charged, not
      from our own metadata copy - the two could disagree and only one of them
      debited a card. Stripe reports lowercase; the registry is uppercase.
    */
    currency: normaliseCurrencyCode(paymentIntent.currency),
    metadata: meta,
  });
}

export async function processPaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  await db.insert(auditLogs).values({
    eventType: 'donation.failed',
    targetType: 'donation',
    details: {
      stripePaymentId: paymentIntent.id,
      campaignId: paymentIntent.metadata.campaignId,
      reason: paymentIntent.last_payment_error?.message ?? 'Unknown',
    },
    severity: 'warning',
  });
}

export async function processRefund(charge: Stripe.Charge) {
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (!paymentIntentId) return;

  const [donation] = await db
    .select({ id: donations.id, campaignId: donations.campaignId })
    .from(donations)
    .where(eq(donations.stripePaymentId, paymentIntentId))
    .limit(1);

  if (!donation) return;

  // Deliberately NO pre-flight `refunded` check here. Reading the flag outside
  // the transaction and then writing it unconditionally is a race: Stripe
  // retries `charge.refunded`, and the in-process `processedEvents` set that
  // guards the webhook route is explicitly per-instance, so two deliveries
  // both passed the read and both decremented the campaign. The conditional
  // claim inside `applyRefund` is the only durable dedup.
  const applied = await applyRefund({
    donationId: donation.id,
    auditDetails: { via: 'webhook:charge.refunded' },
  });

  if (!applied) return; // Replay: another delivery already claimed this donation.

  const [campaign] = await db.select({ slug: campaigns.slug }).from(campaigns).where(eq(campaigns.id, donation.campaignId)).limit(1);
  if (campaign) {
    revalidatePath(`/campaigns/${campaign.slug}`);
    revalidatePath('/campaigns');
  }
}
