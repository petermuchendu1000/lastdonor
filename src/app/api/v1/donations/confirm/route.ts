import { NextRequest, NextResponse } from 'next/server';
import { verifyDonationReturn } from '@/lib/donations/verify-return';
import type { DonationReturnState } from '@/lib/donations/verify-return';
import { processPaymentSuccess } from '@/lib/services/payment-service';
import { logError } from '@/lib/errors';
import { randomUUID } from 'crypto';

/**
 * POST /api/v1/donations/confirm
 *
 * Client-initiated donation confirmation. Called after Stripe Checkout
 * completes so the donation is recorded without waiting for the async Stripe
 * webhook. The webhook remains the durable backup; both paths are idempotent
 * (unique index on stripe_payment_id + onConflictDoNothing).
 *
 * It is also the only way the client is allowed to learn that a donation
 * succeeded. The caller sends ids and the campaign the page belongs to; the
 * server retrieves the Checkout Session / PaymentIntent from Stripe,
 * checks the Stripe metadata names THIS campaign, and answers with Stripe's
 * status and Stripe's amount. Nothing the caller sends is echoed back, so no
 * request can talk this route into reporting a payment that did not happen.
 *
 * Route is public by design (`PUBLIC_API_PREFIXES`): guest donation is a core
 * product requirement. The ids are the capability, and they are worthless
 * unless Stripe confirms them.
 */

interface ConfirmResponse {
  ok: true;
  state: DonationReturnState;
  /** Cents, from Stripe. Null unless the payment is verified as succeeded. */
  amount: number | null;
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const body = await request.json().catch(() => null);
    const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : undefined;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
    const paymentIntentId =
      typeof body?.paymentIntentId === 'string' ? body.paymentIntentId : undefined;

    if (!campaignId) {
      return NextResponse.json(
        { ok: false, error: 'campaignId is required' },
        { status: 400 },
      );
    }

    if (!sessionId && !paymentIntentId) {
      return NextResponse.json(
        { ok: false, error: 'Missing sessionId or paymentIntentId' },
        { status: 400 },
      );
    }

    const verified = await verifyDonationReturn({ campaignId, sessionId, paymentIntentId });

    // Record the donation now rather than waiting on the webhook. Idempotent:
    // a duplicate insert is dropped by the unique stripe_payment_id index.
    if (verified.state === 'succeeded' && verified.paymentIntent) {
      await processPaymentSuccess(verified.paymentIntent);
    }

    const response: ConfirmResponse = {
      ok: true,
      state: verified.state,
      amount: verified.state === 'succeeded' ? verified.amountCents : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    logError(error, { requestId, route: 'POST /api/v1/donations/confirm' });
    return NextResponse.json(
      { ok: false, error: 'Failed to confirm donation' },
      { status: 500 },
    );
  }
}
