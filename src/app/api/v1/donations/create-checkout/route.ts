import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { checkDonationAmount, createIntentSchema } from '@/lib/validators/donation';
import { getCurrency, isSupportedCurrency } from '@/lib/money/currencies';
import { checkRaiseCap } from '@/lib/campaign-raise-cap';
import { realRaisedMinorSql } from '@/db/real-raised';
import { stripe } from '@/lib/stripe';
import {
  SHARE_ATTRIBUTION_COOKIE,
  resolveShareLinkForCampaign,
} from '@/lib/share-links';
import { logError } from '@/lib/errors';
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
     * Refuse a campaign Stripe is not the rail for.
     *
     * This route hardcoded `currency: 'usd'` on both line-item branches while
     * the campaign had no currency at all, which was correct only for as long
     * as every campaign was USD. Once a KES campaign can exist, sending its
     * `unit_amount` to Stripe under `'usd'` would charge a donor 100 US cents
     * for every KES 1 intended - roughly 130x - and then record the result
     * against a KES ledger. There is no FX anywhere in this codebase
     * (`src/lib/validators/payout.ts`), so the mismatch would never be
     * reconciled; it would simply be wrong.
     *
     * The campaign's own currency decides the rail, and anything Stripe does
     * not collect is refused outright rather than converted. KES donations go
     * through PayHero (`/api/v1/donations/payhero/initiate`).
     */
    if (!isSupportedCurrency(campaign.currency)) {
      logError(
        new Error(
          `Campaign ${campaign.id} is denominated in unsupported currency ${campaign.currency}`,
        ),
        { requestId, route: 'donations/create-checkout#currency' },
      );
      const errorBody: ApiError = {
        ok: false,
        error: {
          code: 'CURRENCY_UNSUPPORTED',
          message:
            'We cannot take donations for this campaign right now. Nothing has been charged. ' +
            'Please email support@lastdonor.org so we can help you give.',
          requestId,
        },
      };
      return NextResponse.json(errorBody, { status: 503 });
    }

    const campaignCurrency = getCurrency(campaign.currency);

    if (campaignCurrency.gateway !== 'stripe') {
      const errorBody: ApiError = {
        ok: false,
        error: {
          code: 'WRONG_PAYMENT_RAIL',
          message:
            `Donations to this campaign are collected in ${campaignCurrency.code}, ` +
            'which is paid by mobile money rather than by card. Nothing has been charged.',
          requestId,
        },
      };
      return NextResponse.json(errorBody, { status: 400 });
    }

    /*
     * Stripe takes the currency in lowercase. Derived from the campaign rather
     * than written as a literal, so the day a second Stripe currency is
     * enabled in `CURRENCIES` this route is already correct instead of
     * silently charging dollars.
     */
    const stripeCurrency = campaignCurrency.code.toLowerCase();

    const amountError = checkDonationAmount(data.amount, campaignCurrency.code);
    if (amountError) {
      const errorBody: ApiError = {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: amountError,
          field: 'amount',
          requestId,
        },
      };
      return NextResponse.json(errorBody, { status: 400 });
    }

    /*
     * The pre-verification cap, before Stripe is asked to create a session.
     * Refusing here costs the donor nothing; refusing after the charge would
     * mean a refund. See `src/lib/campaign-raise-cap.ts`.
     */
    const capDecision = checkRaiseCap(
      {
        verificationStatus: campaign.verificationStatus,
        realRaisedMinor: Number(campaign.realRaisedMinor ?? 0),
        currency: campaignCurrency.code,
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

    // One donor-context object, used on every Stripe object we can attach it
    // to. These three copies drifted apart once already: the subscription copy
    // existed while the PaymentIntent copy did not, which is how recurring
    // charges ended up unrecorded (audit docs/29 P1-2).
    /*
     * Attribution, if this donor arrived through someone's share link.
     * Resolved against THIS campaign, so a cookie left over from a different
     * campaign cannot credit the wrong sharer. Carried on Stripe metadata
     * like every other donor fact, because that is the disaster-recovery
     * substrate (CLAUDE.md) - attribution survives anything rebuildable from
     * Stripe alone. See docs/57.
     */
    let shareLinkId: string | null = null;
    try {
      const shareToken = request.cookies?.get(SHARE_ATTRIBUTION_COOKIE)?.value ?? null;
      shareLinkId = await resolveShareLinkForCampaign(shareToken, data.campaignId);
    } catch (error) {
      /*
       * Attribution is a nice-to-have bolted onto the side of a payment. It
       * must never be able to stop one: a cookie-less request object or a
       * database hiccup here should cost the sharer their credit, not cost
       * the campaign the donation.
       */
      logError(error, { requestId, route: 'donations/create-checkout#shareAttribution' });
    }

    const donationMetadata = {
      campaignId: data.campaignId,
      /*
       * Carried so the webhook can assert the charge it is recording is in the
       * currency the campaign expects, instead of inferring it. Stripe metadata
       * is the disaster-recovery substrate (CLAUDE.md): a donation must be
       * reconstructible from Stripe alone, and an amount without its currency
       * is not a reconstructible donation.
       */
      currency: campaignCurrency.code,
      donorName: data.donorName || 'Anonymous',
      donorEmail: data.donorEmail,
      donorLocation: data.donorLocation ?? '',
      message: data.message ?? '',
      isAnonymous: String(data.isAnonymous),
      isRecurring: String(data.isRecurring),
      subscribedToUpdates: String(data.subscribedToUpdates),
      ...(shareLinkId ? { shareLinkId } : {}),
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
                  currency: stripeCurrency,
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
                  currency: stripeCurrency,
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
    /*
     * Separate "this deployment cannot take money at all" from "this one
     * payment failed", because the two need completely different responses
     * and for three weeks they were indistinguishable.
     *
     * Verified against production 2026-10-16: `STRIPE_SECRET_KEY` on Fly was
     * a placeholder (`sk_test_...0000`), so EVERY call here threw Stripe's
     * `authentication_error` and every donor saw "Failed to create checkout
     * session" - wording that reads as a transient hiccup worth retrying.
     * Nobody retried into success, because no key means no payment, ever.
     * Zero donations had been recorded on the platform.
     *
     * A misconfigured key is an operator problem, so it is logged as one and
     * the donor is told plainly that it is our fault, nothing was charged,
     * and a human can help - the same thing CheckoutStep says when the
     * publishable key is missing from the build.
     */
    const stripeAuthFailure =
      typeof error === 'object' &&
      error !== null &&
      (error as { type?: string }).type === 'StripeAuthenticationError';

    if (stripeAuthFailure) {
      console.error(
        '[POST /api/v1/donations/create-checkout] STRIPE_SECRET_KEY is not a working key. ' +
          'No donation can complete on this deployment until it is replaced.',
        { requestId },
      );
      const errorBody: ApiError = {
        ok: false,
        error: {
          code: 'PAYMENTS_UNAVAILABLE',
          message:
            'Card payments are unavailable right now. This is a problem on our side, ' +
            'not with your card, and nothing has been charged. Please email ' +
            'support@lastdonor.org so we can help you give.',
          requestId,
        },
      };
      return NextResponse.json(errorBody, { status: 503 });
    }

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
