import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { campaigns, donations, auditLogs, refundBatches, refundRecords } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { cancelCampaignSchema } from '@/lib/validators/verification';
import { notifyBulkRefundCompleted } from '@/lib/notifications';
import { campaignCancelledRefundEmail } from '@/lib/email-templates';
import { findSimilarCampaigns } from '@/lib/utils/similar-campaigns';
import { resend } from '@/lib/resend';
import { stripe } from '@/lib/stripe';
import { applyRefundInTx } from '@/lib/services/payment-service';
import { randomUUID } from 'crypto';
import { bulkOpSemaphore } from '@/lib/concurrency-limiter';
import type { ApiError } from '@/types/api';
import type { CampaignStatus, CampaignCategory, UserRole } from '@/types';

const FROM_ADDRESS = 'LastDonor.org <noreply@lastdonor.org>';

type RouteParams = { params: Promise<{ campaignId: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses that can transition to "cancelled". */
/*
  ⛔ `under_review` is deliberately NOT here.

  Refusing a campaign at review has exactly one path, and `docs/93` is what
  settled it: `POST .../suspend` with a reason of at least three characters,
  which emails the organiser the admin's own words. Cancelling reached the
  same queue and notifies NOBODY - `_processBulkRefundInner` returns early
  when the campaign has no un-refunded donations, which for a campaign that
  was never public is always, so none of its emails fire and there is no
  organiser-facing call in the route at all. It is also terminal
  (`ALLOWED_TRANSITIONS.cancelled` is empty, `RESUMABLE` excludes it, and the
  PUT route no longer takes a status), and `cancelled` is in
  `PUBLICLY_VIEWABLE_STATUSES` - so it would give a never-reviewed appeal
  about a named real person a permanent public page, silently.

  The matching UI gate is `canCancel` in `src/components/admin/CampaignDetail.tsx`.
  `docs/120`.
*/
const CANCELLABLE: CampaignStatus[] = ['active', 'last_donor_zone', 'paused', 'suspended', 'draft'];

/**
 * POST /api/v1/admin/campaigns/[campaignId]/cancel
 *
 * Cancels a campaign permanently. Optionally triggers a bulk refund of all
 * un-refunded real donations via Stripe. The refund batch runs inline
 * (one by one) to keep Stripe rate limits in check.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { campaignId } = await params;

  try {
    const session = await requireRole(['admin']);

    if (!UUID_REGEX.test(campaignId)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign ID', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = cancelCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const { reason, notes, notifyDonors, refundAll } = parsed.data;

    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        category: campaigns.category,
        location: campaigns.location,
        raisedAmount: campaigns.raisedAmount,
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

    if (!CANCELLABLE.includes(campaign.status as CampaignStatus)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Cannot cancel a campaign with status "${campaign.status}".`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Mark as cancelled + audit log atomically
    await db.transaction(async (tx) => {
      await tx.update(campaigns).set({
        status: 'cancelled',
        cancellationReason: reason,
        cancellationNotes: notes ?? null,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(campaigns.id, campaignId));

      await tx.insert(auditLogs).values({
        eventType: 'campaign.cancelled',
        actorId: session.user?.id ?? null,
        actorRole: session.user?.role as UserRole,
        targetType: 'campaign',
        targetId: campaignId,
        severity: 'critical',
        details: { title: campaign.title, previousStatus: campaign.status, reason, notes, refundAll, notifyDonors },
      });
    });

    let refundSummary: { totalDonors: number; totalAmount: number; failedCount: number } | null = null;

    // Process bulk refund if requested
    if (refundAll) {
      refundSummary = await processBulkRefund({
        campaignId,
        campaignTitle: campaign.title,
        campaignCategory: campaign.category as CampaignCategory,
        campaignLocation: campaign.location,
        adminId: session.user?.id ?? '',
        reason,
      });
    }

    revalidatePath(`/campaigns/${campaign.slug}`);
    return NextResponse.json({
      ok: true,
      data: {
        id: campaignId,
        status: 'cancelled',
        refund: refundSummary,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[POST /api/v1/admin/campaigns/[campaignId]/cancel]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel campaign', requestId } } satisfies ApiError, { status: 500 });
  }
}

// ─── Bulk Refund Engine ─────────────────────────────────────────────────────

async function processBulkRefund(p: {
  campaignId: string;
  campaignTitle: string;
  campaignCategory: CampaignCategory;
  campaignLocation: string | null;
  adminId: string;
  reason: string;
}): Promise<{ totalDonors: number; totalAmount: number; failedCount: number }> {
  const release = await bulkOpSemaphore.acquire();
  try {
    return await _processBulkRefundInner(p);
  } finally {
    release();
  }
}

async function _processBulkRefundInner(p: {
  campaignId: string;
  campaignTitle: string;
  campaignCategory: CampaignCategory;
  campaignLocation: string | null;
  adminId: string;
  reason: string;
}): Promise<{ totalDonors: number; totalAmount: number; failedCount: number }> {
  // Fetch all un-refunded real donations
  const eligibleDonations = await db
    .select({
      id: donations.id,
      amount: donations.amount,
      stripePaymentId: donations.stripePaymentId,
      provider: donations.provider,
      donorEmail: donations.donorEmail,
      donorName: donations.donorName,
    })
    .from(donations)
    .where(
      and(
        eq(donations.campaignId, p.campaignId),
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    );

  if (eligibleDonations.length === 0) {
    return { totalDonors: 0, totalAmount: 0, failedCount: 0 };
  }

  const totalAmount = eligibleDonations.reduce((sum, d) => sum + d.amount, 0);

  // Create refund batch record
  const [batch] = await db.insert(refundBatches).values({
    campaignId: p.campaignId,
    initiatedBy: p.adminId,
    reason: p.reason,
    totalDonations: eligibleDonations.length,
    totalAmount,
  }).returning({ id: refundBatches.id });

  // Phase 1: Call Stripe for all refunds OUTSIDE any DB transaction.
  // Collect results in memory first to avoid holding connections during I/O.
  const refundResults: Array<{
    donationId: string;
    amount: number;
    stripeRefundId: string | null;
    errorMessage: string | null;
    status: 'completed' | 'failed';
  }> = [];

  for (const donation of eligibleDonations) {
    let stripeRefundId: string | null = null;
    let errorMessage: string | null = null;
    let status: 'completed' | 'failed' = 'completed';

    /*
      Stripe is the only gateway that can be refunded by API.
      `stripePaymentId` holds the reference for every provider, so without
      this branch a PayHero donation's `payhero_<reference>` would be sent to
      `stripe.refunds.create`. PayHero has no refund endpoint, so those are
      marked `failed` with an explicit reason: the batch then shows a
      non-zero failed count and an admin sees that real money still has to be
      returned by hand, instead of the batch reporting success while nobody
      has been paid back.
    */
    if (donation.provider !== 'stripe') {
      errorMessage =
        `Collected by ${donation.provider}, which has no refund API. ` +
        'The ledger is corrected but the donor must be refunded manually.';
      status = 'failed';
      console.error(`[bulk-refund] Donation ${donation.id} needs a manual refund:`, errorMessage);
    } else if (donation.stripePaymentId) {
      try {
        // Idempotency key: if this batch is re-run (admin retry, or the HTTP
        // request timing out mid-loop) Stripe returns the SAME refund rather
        // than refunding the donor twice.
        const refund = await stripe.refunds.create(
          { payment_intent: donation.stripePaymentId },
          { idempotencyKey: `refund:${donation.id}` },
        );
        stripeRefundId = refund.id;
      } catch (err: unknown) {
        errorMessage = err instanceof Error ? err.message : 'Unknown Stripe error';
        status = 'failed';
        console.error(`[bulk-refund] Failed to refund donation ${donation.id}:`, errorMessage);
      }
    }

    refundResults.push({ donationId: donation.id, amount: donation.amount, stripeRefundId, errorMessage, status });
  }

  // Phase 2: Persist all results in a single transaction (no external I/O inside).
  const refundedCount = refundResults.filter((r) => r.status === 'completed').length;
  const failedCount = refundResults.filter((r) => r.status === 'failed').length;

  await db.transaction(async (tx) => {
    // Insert all refund records in batch
    await tx.insert(refundRecords).values(
      refundResults.map((r) => ({
        batchId: batch.id,
        donationId: r.donationId,
        amount: r.amount,
        stripeRefundId: r.stripeRefundId,
        status: r.status,
        errorMessage: r.errorMessage,
        processedAt: new Date(),
      })),
    );

    // Mark the successfully refunded donations as refunded AND adjust the
    // campaign ledger, one donation at a time, through the single refund
    // writer.
    //
    // This used to be `raisedAmount: 0, donorCount: 0` under an
    // `if (refundedCount > 0)` guard. Two bugs, both of them money bugs:
    //
    //   1. No `total_released_amount` clamp. On a fully-verified campaign
    //      (released == raised) zeroing raised violated the
    //      `campaigns_released_lte_raised` CHECK, which aborted this whole
    //      transaction - rolling back every refund_record and every
    //      `refunded` flag for potentially hundreds of donors whose money
    //      Stripe had ALREADY sent back.
    //   2. It zeroed the totals even on partial success. With 3 of 10 refunds
    //      through, the ledger claimed the campaign had raised nothing while
    //      7 donors' money was still held.
    //
    // Decrementing per successful donation fixes both: the sum removed is
    // exactly the sum actually refunded, and each decrement clamps released
    // in the same statement.
    for (const result of refundResults) {
      if (result.status !== 'completed') continue;
      await applyRefundInTx(tx, {
        donationId: result.donationId,
        actorId: p.adminId || null,
        actorRole: 'admin',
        auditDetails: { via: 'admin:bulk-refund', batchId: batch.id, reason: p.reason },
      });
    }

    // Update batch totals
    await tx.update(refundBatches).set({
      refundedCount,
      failedCount,
      status: failedCount === 0 ? 'completed' : 'partial_failure',
      completedAt: new Date(),
    }).where(eq(refundBatches.id, batch.id));
  });

  // Only donors whose refund actually succeeded get told their money is on its
  // way back. Passing every eligible donation told the donors whose Stripe
  // refund FAILED that they had been refunded - a false statement about their
  // money, and one that makes the failure invisible to the only person who
  // would notice it.
  const refundedDonationIds = new Set(
    refundResults.filter((r) => r.status === 'completed').map((r) => r.donationId),
  );

  // Send per-donor refund notification emails with similar campaign recommendations
  sendDonorRefundEmails({
    eligibleDonations: eligibleDonations.filter((d) => refundedDonationIds.has(d.id)),
    campaignTitle: p.campaignTitle,
    campaignCategory: p.campaignCategory,
    campaignLocation: p.campaignLocation,
    campaignId: p.campaignId,
    reason: p.reason,
  }).catch((err) => console.error('[bulk-refund] donor email error:', err));

  // Notify admins asynchronously
  notifyBulkRefundCompleted({
    campaignId: p.campaignId,
    campaignTitle: p.campaignTitle,
    totalDonors: refundedCount + failedCount,
    totalAmount,
    failedCount,
  }).catch((err) => console.error('[bulk-refund] notification error:', err));

  return { totalDonors: eligibleDonations.length, totalAmount, failedCount };
}

// ─── Per-Donor Refund Email Sender ──────────────────────────────────────────

const CANCELLATION_REASON_MESSAGES: Record<string, string> = {
  identity_fraud: 'After a careful review, our team was unable to verify the identity of the campaigner.',
  fabricated_story: 'After a careful review, our team was unable to confirm the campaign details with supporting documents.',
  document_forgery: 'After a careful review, our team found concerns with the submitted documents.',
  campaigner_non_responsive: 'The campaigner did not respond to our requests for additional information within the given timeframe.',
  duplicate_campaign: 'This campaign was found to be a duplicate of an existing campaign on the platform.',
  legal_compliance: 'This campaign was removed following a routine compliance review.',
  campaigner_requested: 'The campaign organizer requested the removal of this campaign.',
  terms_violation: 'This campaign was removed because it did not meet our community guidelines.',
};

async function sendDonorRefundEmails(p: {
  eligibleDonations: Array<{ id: string; amount: number; donorEmail: string; donorName: string }>;
  campaignTitle: string;
  campaignCategory: CampaignCategory;
  campaignLocation: string | null;
  campaignId: string;
  reason: string;
}) {
  // Fetch similar campaigns once for all emails
  const similarCampaigns = await findSimilarCampaigns({
    excludeId: p.campaignId,
    category: p.campaignCategory,
    location: p.campaignLocation,
    limit: 3,
  });

  const reasonMessage = CANCELLATION_REASON_MESSAGES[p.reason] ?? p.reason;

  // Deduplicate by email - send one email per unique donor email
  const seen = new Set<string>();
  for (const donation of p.eligibleDonations) {
    if (seen.has(donation.donorEmail)) continue;
    seen.add(donation.donorEmail);

    const { subject, html } = campaignCancelledRefundEmail({
      donorName: donation.donorName || 'Donor',
      campaignTitle: p.campaignTitle,
      donationAmount: donation.amount,
      cancellationReason: reasonMessage,
      similarCampaigns: similarCampaigns.map((c) => ({
        title: c.title,
        slug: c.slug,
        raised: c.raised,
        goal: c.goal,
      })),
    });

    try {
      await resend.emails.send({
        from: FROM_ADDRESS,
        to: donation.donorEmail,
        subject,
        html,
      });
    } catch (err) {
      console.error(`[bulk-refund] Failed to email ${donation.donorEmail}:`, err);
    }
  }
}
