import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { createIntentSchema } from '@/lib/validators/donation';
import { stripe } from '@/lib/stripe';
import { randomUUID } from 'crypto';
import type { ApiResponse, ApiError } from '@/types/api';

/**
 * Create a Stripe Checkout Session in embedded mode.
 *
 * The client mounts this via stripe.initEmbeddedCheckout({ clientSecret }).
 * Stripe renders the entire payment form (card, bank, wallets, submit button).
 * On completion, the checkout.session.completed webhook fires and the
 * underlying PaymentIntent triggers payment_intent.succeeded as before.
 */
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
        slug: campaigns.slug,
        status: campaigns.status,
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

    // One donor-context object, used on every Stripe object we can attach it
    // to. These three copies drifted apart once already: the subscription copy
    // existed while the PaymentIntent copy did not, which is how recurring
    // charges ended up unrecorded (audit docs/29 P1-2).
    const donationMetadata = {
      campaignId: data.campaignId,
      donorName: data.donorName || 'Anonymous',
      donorEmail: data.donorEmail,
      donorLocation: data.donorLocation ?? '',
      message: data.message ?? '',
      isAnonymous: String(data.isAnonymous),
      isRecurring: String(data.isRecurring),
      subscribedToUpdates: String(data.subscribedToUpdates),
    };

    const origin = request.headers.get('origin') || 'https://lastdonor.org';
    // No `amount` here. The page decides the amount from Stripe, so an amount
    // in the URL is at best ignored and at worst a forged receipt (docs/42).
    const returnPath = `/campaigns/${campaign.slug}/donate?donation=success&session_id={CHECKOUT_SESSION_ID}`;

    const session = await stripe.checkout.sessions.create({
      mode: data.isRecurring ? 'subscription' : 'payment',
      ui_mode: 'embedded',
      return_url: `${origin}${returnPath}`,
      customer_email: data.donorEmail,
      ...(data.isRecurring
        ? {
            line_items: [
              {
                price_data: {
                  currency: 'usd',
                  recurring: { interval: 'month' },
                  product_data: {
                    name: 'Monthly donation',
                  },
                  unit_amount: data.amount,
                },
                quantity: 1,
              },
            ],
          }
        : {
            line_items: [
              {
                price_data: {
                  currency: 'usd',
                  product_data: {
                    name: 'Donation',
                  },
                  unit_amount: data.amount,
                },
                quantity: 1,
              },
            ],
          }),
      // Stripe rejects payment_intent_data in subscription mode, so a recurring
      // donation's PaymentIntents carry no metadata at creation time. The
      // subscription copy below is the authoritative one for those charges:
      // payment-service resolves invoice -> subscription -> metadata and then
      // writes it back onto the PaymentIntent, which keeps Stripe metadata
      // usable as the disaster-recovery substrate for recurring donations too.
      payment_intent_data: data.isRecurring
        ? undefined
        : { metadata: donationMetadata },
      ...(data.isRecurring
        ? { subscription_data: { metadata: donationMetadata } }
        : {}),
      metadata: donationMetadata,
    });

    // The session id goes back with the client secret (which embeds it
    // anyway) so the client can ask POST /donations/confirm what Stripe says
    // about this payment. No receipt is rendered without that answer.
    const response: ApiResponse<{ clientSecret: string; sessionId: string }> = {
      ok: true,
      data: {
        clientSecret: session.client_secret!,
        sessionId: session.id,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[POST /api/v1/donations/create-checkout]', error);
    const errorBody: ApiError = {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create checkout session',
        requestId,
      },
    };
    return NextResponse.json(errorBody, { status: 500 });
  }
}
