import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { logError } from '@/lib/errors';

/**
 * Server-side verification of a donor's return from Stripe Checkout.
 *
 * Why this exists
 * ---------------
 * The donate page used to decide "the payment succeeded" from the query
 * string: `?donation=success&amount=<cents>` rendered a full "Thank you, your
 * $X donation is on its way" receipt, share buttons included, with no Stripe
 * call and no database read. Anyone could mint a shareable six-figure receipt
 * on the real domain, naming a real beneficiary, by typing a URL.
 *
 * Nothing the browser sends can establish that money moved. Only Stripe can.
 * Every receipt the platform renders now comes from this function, and the
 * displayed amount comes from Stripe's own response.
 *
 * The campaign check matters as much as the status check: a genuine succeeded
 * PaymentIntent for campaign A must not render a receipt on campaign B's page.
 * `create-checkout` writes `campaignId` into the Checkout Session metadata and
 * (for one-off donations) onto the PaymentIntent, so that is what we compare
 * against. Recurring donations carry it on the session and the subscription
 * only, because Stripe rejects `payment_intent_data` in subscription mode.
 */

export type DonationReturnState =
  /** Stripe says the money moved. Safe to render a receipt. */
  | 'succeeded'
  /** Stripe has the payment but it has not settled. Render "confirming", not a receipt. */
  | 'processing'
  /** Stripe says this payment was declined, cancelled or abandoned. */
  | 'failed'
  /**
   * Nothing could be verified: no id in the URL, an id Stripe does not know,
   * an id that belongs to a different campaign, or Stripe being unreachable.
   * Renders the same honest "confirming" state. Never a receipt.
   */
  | 'unverified';

export interface DonationReturnResult {
  state: DonationReturnState;
  /**
   * Amount in cents, taken from Stripe and from nowhere else. Null whenever
   * Stripe did not report one.
   */
  amountCents: number | null;
  /** The PaymentIntent Stripe returned, for callers that need to record the donation. */
  paymentIntent: Stripe.PaymentIntent | null;
}

const UNVERIFIED: DonationReturnResult = {
  state: 'unverified',
  amountCents: null,
  paymentIntent: null,
};

function positiveIntOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function resolvePaymentIntentId(
  session: Stripe.Checkout.Session | null,
  fallbackId: string | undefined,
): string | undefined {
  const ref = session?.payment_intent;
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object' && ref.id) return ref.id;
  return fallbackId;
}

function stateFromPaymentIntent(status: Stripe.PaymentIntent.Status): DonationReturnState {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'processing':
    case 'requires_action':
    case 'requires_capture':
    case 'requires_confirmation':
      return 'processing';
    case 'canceled':
    case 'requires_payment_method':
      // Checkout resets a declined or abandoned intent to
      // requires_payment_method, so this is the "your card was declined or you
      // left before paying" case, not an in-flight one.
      return 'failed';
    default:
      return 'unverified';
  }
}

function stateFromSession(session: Stripe.Checkout.Session): DonationReturnState {
  if (session.payment_status === 'paid') return 'succeeded';
  if (session.status === 'expired') return 'failed';
  return 'processing';
}

/**
 * Ask Stripe what actually happened.
 *
 * Takes only ids (which are safe to receive from the browser, because they are
 * useless without Stripe confirming them) plus the campaign the page belongs
 * to. Never throws: an unreachable Stripe or an unknown id resolves to
 * `unverified`, which renders a pending state rather than a receipt.
 */
export async function verifyDonationReturn({
  campaignId,
  sessionId,
  paymentIntentId,
}: {
  campaignId: string;
  sessionId?: string;
  paymentIntentId?: string;
}): Promise<DonationReturnResult> {
  if (!sessionId && !paymentIntentId) return UNVERIFIED;

  try {
    const session = sessionId
      ? await stripe.checkout.sessions.retrieve(sessionId)
      : null;

    const resolvedIntentId = resolvePaymentIntentId(session, paymentIntentId);
    const paymentIntent = resolvedIntentId
      ? await stripe.paymentIntents.retrieve(resolvedIntentId)
      : null;

    if (!session && !paymentIntent) return UNVERIFIED;

    // Ownership: the payment must carry this campaign's id in Stripe metadata.
    const metadataCampaignId =
      session?.metadata?.campaignId || paymentIntent?.metadata?.campaignId || null;
    if (metadataCampaignId !== campaignId) return UNVERIFIED;

    const state = paymentIntent
      ? stateFromPaymentIntent(paymentIntent.status)
      : stateFromSession(session!);

    const amountCents =
      positiveIntOrNull(paymentIntent?.amount_received) ??
      positiveIntOrNull(paymentIntent?.amount) ??
      positiveIntOrNull(session?.amount_total);

    return { state, amountCents, paymentIntent };
  } catch (error) {
    // An unknown id is the common case here: Stripe answers 404 for an id it
    // never issued, and someone pasting junk into the URL must not fill the
    // error tracker. A 404 is logged locally; anything else (an outage, a bad
    // key, a rate limit) is a real fault and is reported.
    const statusCode = (error as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 404) {
      console.warn('[donations/verify-return] Stripe does not know this id');
    } else {
      logError(error, {
        requestId: sessionId ?? paymentIntentId ?? 'unknown',
        route: 'donations/verify-return',
        input: { campaignId },
      });
    }
    return UNVERIFIED;
  }
}
