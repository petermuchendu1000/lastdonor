import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { processPaymentSuccess, processPaymentFailed, processRefund } from '@/lib/services/payment-service';
import { processIdentityVerificationEvent } from '@/lib/services/identity-verification-service';
import { logError } from '@/lib/errors';
import type Stripe from 'stripe';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

// In-memory dedup provides fast-path idempotency within a single instance.
// The DB unique constraint on stripe_payment_id is the durable idempotency guard.
const processedEvents = new Set<string>();

export async function POST(request: NextRequest) {
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

    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (error) {
    logError(error, { route: 'webhook', requestId: 'signature-verification' });
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 },
    );
  }

  // Fast-path idempotency only. The durable guard is the unique index on
  // donations.stripe_payment_id, which is what makes a Stripe retry safe.
  if (processedEvents.has(event.id)) {
    return NextResponse.json({ received: true, deduplicated: true });
  }
  processedEvents.add(event.id);

  // Prevent memory leak: cap the set size
  if (processedEvents.size > 10000) {
    const iter = processedEvents.values();
    for (let i = 0; i < 5000; i++) {
      const val = iter.next().value;
      if (val !== undefined) processedEvents.delete(val);
    }
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await processPaymentSuccess(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await processPaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'charge.refunded':
        await processRefund(event.data.object as Stripe.Charge);
        break;

      case 'checkout.session.completed': {
        // Stripe Embedded Checkout fires this on completion.
        // The underlying payment_intent.succeeded also fires and handles
        // donation recording, but we log the session for traceability.
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_intent && typeof session.payment_intent === 'string') {
          const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
          if (pi.status === 'succeeded') {
            await processPaymentSuccess(pi);
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.payment_intent && typeof invoice.payment_intent === 'string') {
          const pi = await stripe.paymentIntents.retrieve(invoice.payment_intent);
          await processPaymentSuccess(pi);
        }
        break;
      }

      // Stripe Identity verification session events
      case 'identity.verification_session.verified':
      case 'identity.verification_session.requires_input':
      case 'identity.verification_session.canceled':
        await processIdentityVerificationEvent(
          event.data.object as Stripe.Identity.VerificationSession,
          event.type,
        );
        break;

      default:
        // Event types we do not subscribe to any behaviour for. Acknowledging
        // these with 200 is correct: there is nothing to retry.
        return NextResponse.json({ received: true, ignored: event.type });
    }
  } catch (error) {
    logError(error, { route: 'webhook', requestId: event.id });

    // Release the fast-path marker so Stripe's retry is actually processed
    // rather than short-circuited to 200 by this same instance.
    processedEvents.delete(event.id);

    // A genuine application error must NOT be acknowledged. Returning 200 here
    // told Stripe the event was handled, so a refund that failed to record, or
    // a donation whose transaction rolled back, was never retried and nothing
    // ever reconciled it (audit docs/29 P0-3).
    //
    // Retries are safe: donation inserts are idempotent on
    // donations.stripe_payment_id, and every other handler reached from here
    // is written to be replay-safe.
    return NextResponse.json(
      { error: 'Webhook handler failed', eventId: event.id },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
