import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { donations, campaigns } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { notifyDonationRefund } from '@/lib/notifications';
import { stripe } from '@/lib/stripe';
import { applyRefund } from '@/lib/services/payment-service';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import type { UserRole } from '@/types';

type RouteParams = { params: Promise<{ id: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/admin/donations/[id] - Get donation detail
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    await requireRole(['admin']);

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid donation ID', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const [donation] = await db
      .select({
        id: donations.id,
        amount: donations.amount,
        donorName: donations.donorName,
        donorEmail: donations.donorEmail,
        donorLocation: donations.donorLocation,
        message: donations.message,
        isAnonymous: donations.isAnonymous,
        isRecurring: donations.isRecurring,
        phaseAtTime: donations.phaseAtTime,
        source: donations.source,
        refunded: donations.refunded,
        stripePaymentId: donations.stripePaymentId,
        createdAt: donations.createdAt,
        campaignId: donations.campaignId,
        campaignTitle: campaigns.title,
        campaignSlug: campaigns.slug,
        userId: donations.userId,
      })
      .from(donations)
      .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
      .where(eq(donations.id, id))
      .limit(1);

    if (!donation) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Donation not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: donation });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[GET /api/v1/admin/donations/[id]]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch donation', requestId } } satisfies ApiError, { status: 500 });
  }
}

/**
 * PATCH /api/v1/admin/donations/[id] - Mark donation as refunded
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    const session = await requireRole(['admin']);

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid donation ID', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    let body: { refunded?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    if (typeof body.refunded !== 'boolean') {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: '"refunded" must be a boolean', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Refunds are irreversible - Stripe cannot un-refund money
    if (body.refunded === false) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Refunds cannot be reversed', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const [donation] = await db
      .select({
        id: donations.id,
        amount: donations.amount,
        donorEmail: donations.donorEmail,
        donorName: donations.donorName,
        refunded: donations.refunded,
        campaignId: donations.campaignId,
        source: donations.source,
        stripePaymentId: donations.stripePaymentId,
        provider: donations.provider,
      })
      .from(donations)
      .where(eq(donations.id, id))
      .limit(1);

    if (!donation) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Donation not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    if (donation.refunded === body.refunded) {
      return NextResponse.json({ ok: true, data: { id, refunded: body.refunded, changed: false } });
    }

    /*
      Only a Stripe donation can be refunded from here.

      `stripePaymentId` is the provider-reference column for every gateway, so
      a PayHero donation's `payhero_<reference>` would otherwise be handed to
      `stripe.refunds.create` — which fails, but only after the admin has been
      told the refund is being issued. Worse, if it had happened to succeed
      against some unrelated object the ledger would have been corrected for a
      refund that never reached the donor.

      PayHero exposes no refund API, so an M-Pesa donation has to be returned
      by hand. The ledger is still corrected (that is what `applyRefund` is
      for) and the response says plainly that the money movement is manual, so
      nobody believes the donor has been paid back automatically.
    */
    if (body.refunded && donation.provider !== 'stripe') {
      const applied = await applyRefund({
        donationId: id,
        actorId: session.user?.id ?? null,
        actorRole: session.user?.role as UserRole,
        auditDetails: {
          via: 'admin:donation-patch',
          provider: donation.provider,
          gatewayRefund: 'NOT ISSUED - this gateway has no refund API',
          manualRefundRequired: true,
        },
      });

      return NextResponse.json({
        ok: true,
        data: {
          id,
          refunded: Boolean(applied),
          changed: Boolean(applied),
          manualRefundRequired: true,
          message:
            `This donation was collected by ${donation.provider}, which has no refund API. ` +
            'The ledger has been corrected, but the money must be returned to the donor manually.',
        },
      });
    }

    // Issue actual Stripe refund when marking as refunded
    if (body.refunded && donation.stripePaymentId) {
      try {
        // Idempotency key: on a retry (the admin clicking twice, or a retry
        // after the ledger write failed) Stripe returns the SAME refund
        // instead of creating a second one or answering
        // `charge_already_refunded`.
        await stripe.refunds.create(
          { payment_intent: donation.stripePaymentId },
          { idempotencyKey: `refund:${donation.id}` },
        );
      } catch (stripeErr: unknown) {
        const msg = stripeErr instanceof Error ? stripeErr.message : 'Unknown Stripe error';
        console.error('[admin/donations] Stripe refund failed:', msg);
        return NextResponse.json(
          { ok: false, error: { code: 'INTERNAL_ERROR', message: `Stripe refund failed: ${msg}`, requestId } } satisfies ApiError,
          { status: 502 },
        );
      }
    }

    // Single writer of donations.refunded. It claims the row conditionally and
    // clamps total_released_amount in the same UPDATE that lowers
    // raised_amount. The previous inline version lowered raised_amount only:
    // on a fully-verified campaign (released == raised) that violated the
    // `campaigns_released_lte_raised` CHECK, the transaction rolled back AFTER
    // Stripe had refunded the donor, and the retry got
    // `charge_already_refunded`.
    const applied = await applyRefund({
      donationId: id,
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      auditDetails: { via: 'admin:donation-patch' },
    });

    if (!applied) {
      // Another writer (the charge.refunded webhook, or a concurrent admin)
      // already claimed it. The Stripe refund above was idempotent, so there
      // is nothing left to do and nothing was double-counted.
      return NextResponse.json({ ok: true, data: { id, refunded: true, changed: false } });
    }

    // Notify the donor (fire-and-forget - never block the admin response)
    const [cam] = await db
      .select({ title: campaigns.title, slug: campaigns.slug, status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, donation.campaignId))
      .limit(1);

    if (cam) {
      notifyDonationRefund({
        donationId: id,
        donorEmail: donation.donorEmail,
        donorName: donation.donorName,
        amount: donation.amount,
        campaignTitle: cam.title,
        campaignSlug: cam.slug,
        campaignStatus: cam.status,
        refunded: body.refunded,
      }).catch((err) => console.error('[admin/donations] notification error:', err));
    }

    return NextResponse.json({ ok: true, data: { id, refunded: body.refunded, changed: true } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[PATCH /api/v1/admin/donations/[id]]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update donation', requestId } } satisfies ApiError, { status: 500 });
  }
}
