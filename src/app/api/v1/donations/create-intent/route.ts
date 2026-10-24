import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { createIntentSchema } from '@/lib/validators/donation';
import { checkRaiseCap } from '@/lib/campaign-raise-cap';
import { realRaisedMinorSql } from '@/db/real-raised';
import { stripe } from '@/lib/stripe';
import { randomUUID } from 'crypto';
import type { ApiResponse, ApiError } from '@/types/api';

export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const body = await request.json();
    const parsed = createIntentSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0];
      const errorBody: ApiError = {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: firstError.message,
          field: firstError.path.join('.'),
          requestId,
        },
      };
      return NextResponse.json(errorBody, { status: 400 });
    }

    const data = parsed.data;

    // Verify campaign exists and is in a donatable status
    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        status: campaigns.status,
        currency: campaigns.currency,
        verificationStatus: campaigns.verificationStatus,
        // Real, un-refunded donations only - NOT the blended `raised_amount`.
        // One verified expression: see `src/db/real-raised.ts`.
        realRaisedMinor: realRaisedMinorSql,
      })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, data.campaignId),
          or(
            eq(campaigns.status, 'active'),
            eq(campaigns.status, 'last_donor_zone'),
          ),
        ),
      )
      .limit(1);

    if (!campaign) {
      const errorBody: ApiError = {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Campaign not found or not accepting donations',
          requestId,
        },
      };
      return NextResponse.json(errorBody, { status: 404 });
    }

    /*
     * The pre-verification cap (`src/lib/campaign-raise-cap.ts`).
     *
     * This route is absent from `PUBLIC_API_ROUTES` (src/middleware.ts), so
     * it is auth-gated by default-deny and no UI calls it - but a signed-in
     * caller can still reach it directly, and a money-in path that skipped
     * the cap would be a hole in it.
     */
    const capDecision = checkRaiseCap(
      {
        verificationStatus: campaign.verificationStatus,
        realRaisedMinor: Number(campaign.realRaisedMinor ?? 0),
        currency: campaign.currency,
      },
      data.amount,
    );
    if (!capDecision.allowed) {
      const capError: ApiError = {
        ok: false,
        error: {
          code: capDecision.code,
          message: capDecision.message,
          field: 'amount',
          requestId,
        },
      };
      return NextResponse.json(capError, { status: 409 });
    }

    // Create Stripe PaymentIntent
    // Generate server-side idempotency key if client omits one
    const idempotencyKey = data.idempotencyKey ?? `${data.campaignId}:${data.donorEmail}:${data.amount}:${Math.floor(Date.now() / 60_000)}`;
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: data.amount,
        currency: 'usd',
        metadata: {
          campaignId: data.campaignId,
          donorName: data.donorName || 'Anonymous',
          donorEmail: data.donorEmail,
          donorLocation: data.donorLocation ?? '',
          message: data.message ?? '',
          isAnonymous: String(data.isAnonymous),
          isRecurring: String(data.isRecurring),
          subscribedToUpdates: String(data.subscribedToUpdates),
        },
      },
      { idempotencyKey },
    );

    const response: ApiResponse<{
      clientSecret: string;
      paymentIntentId: string;
      amount: number;
      campaignTitle: string;
    }> = {
      ok: true,
      data: {
        clientSecret: paymentIntent.client_secret!,
        paymentIntentId: paymentIntent.id,
        amount: data.amount,
        campaignTitle: campaign.title,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[POST /api/v1/donations/create-intent]', error);
    const errorBody: ApiError = {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create payment intent',
        requestId,
      },
    };
    return NextResponse.json(errorBody, { status: 500 });
  }
}
