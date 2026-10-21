import { NextRequest, NextResponse } from 'next/server';
import { and, eq, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { auditLogs, campaigns, payheroPaymentRequests } from '@/db/schema';
import { getCurrency, isSupportedCurrency } from '@/lib/money/currencies';
import { checkDonationAmount } from '@/lib/validators/donation';
import { normalisePhone } from '@/lib/phone';
/*
  `appBaseUrl` lives in `unsubscribe-tokens` because that is where it was
  first needed (docs/40). Imported from there rather than copied: a second
  implementation of "what is our public origin" is how a callback ends up
  pointing at the wrong host.
*/
import { appBaseUrl } from '@/lib/unsubscribe-tokens';
import {
  LASTDONOR_REFERENCE_PREFIX,
  classifyInitiationFailure,
  initiateStkPush,
  isPayHeroConfigured,
  configuredChannelId,
  toPayHeroMsisdn,
} from '@/lib/payhero';
import { checkPhoneAbuseGuard } from '@/lib/payhero-abuse-guard';
import { SHARE_ATTRIBUTION_COOKIE, resolveShareLinkForCampaign } from '@/lib/share-links';
import { initiateMpesaSchema } from '@/lib/validators/payhero';
import { logError } from '@/lib/errors';
import type { ApiError, ApiResponse } from '@/types/api';

/**
 * POST /api/v1/donations/payhero/initiate
 *
 * Ask PayHero to push an M-Pesa PIN prompt to a donor's phone. See `docs/92`.
 *
 * **A 200 from this route means a prompt was queued. It does not mean money
 * moved, and nothing is recorded as a donation here.** The outcome is settled
 * by `settlePayHeroRequest`, from PayHero's authenticated status endpoint.
 *
 * ── Order of operations, and why ──────────────────────────────────────────
 *
 * Everything that can refuse the request is checked BEFORE the push is sent,
 * because a wasted push is not free: PayHero blocks a phone number for 24
 * hours after 10 successive failed or cancelled requests, and restricts the
 * whole account after 50 failures in 6 hours. A request that was never going
 * to work must not be spent.
 *
 * The row is inserted BEFORE the API call, then updated with PayHero's
 * reference. That ordering is deliberate: if the process dies between the
 * call and the write, a row with no `payhero_reference` is a visible
 * loose end that reconciliation can find. The other order - call first, write
 * after - loses the reference entirely on the same crash, and the reference
 * is the only key PayHero's status endpoint accepts (our own
 * `external_reference` returns 404). A payment nobody can look up is strictly
 * worse than a row nobody has finished.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  const fail = (
    status: number,
    code: ApiError['error']['code'],
    message: string,
    extra: Record<string, unknown> = {},
  ) =>
    NextResponse.json(
      { ok: false, error: { code, message, requestId, ...extra } } satisfies ApiError,
      { status },
    );

  try {
    if (!isPayHeroConfigured()) {
      /*
        An operator problem, told to the donor as one. `docs/72` is about the
        three weeks in which a dead Stripe key produced "Failed to create
        checkout session" - wording that invited a retry that could never
        succeed.
      */
      console.error(
        '[payhero/initiate] PAYHERO_API_USERNAME / PAYHERO_API_PASSWORD / PAYHERO_CHANNEL_ID ' +
          'are not all set. No M-Pesa donation can complete on this deployment.',
        { requestId },
      );
      return fail(
        503,
        'PAYMENTS_UNAVAILABLE',
        'M-Pesa payments are unavailable right now. This is a problem on our side, not with ' +
          'your phone, and nothing has been charged. Please email support@lastdonor.org so we ' +
          'can help you give.',
      );
    }

    const parsed = initiateMpesaSchema.safeParse(await request.json());
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return fail(400, 'VALIDATION_ERROR', first.message, { field: first.path.join('.') });
    }
    const data = parsed.data;

    // ── The campaign decides the currency, the rail and the bounds ──────────
    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        currency: campaigns.currency,
      })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, data.campaignId),
          or(eq(campaigns.status, 'active'), eq(campaigns.status, 'last_donor_zone')),
        ),
      )
      .limit(1);

    if (!campaign) {
      return fail(404, 'NOT_FOUND', 'Campaign not found or not accepting donations');
    }

    if (!isSupportedCurrency(campaign.currency)) {
      logError(
        new Error(`Campaign ${campaign.id} has unsupported currency ${campaign.currency}`),
        { requestId, route: 'payhero/initiate#currency' },
      );
      return fail(
        503,
        'CURRENCY_UNSUPPORTED',
        'We cannot take donations for this campaign right now. Nothing has been charged.',
      );
    }

    const currency = getCurrency(campaign.currency);
    if (currency.gateway !== 'payhero') {
      return fail(
        400,
        'WRONG_PAYMENT_RAIL',
        `Donations to this campaign are collected in ${currency.code}, which is paid by card ` +
          'rather than by M-Pesa. Nothing has been charged.',
      );
    }

    const amountError = checkDonationAmount(data.amount, currency.code);
    if (amountError) return fail(400, 'VALIDATION_ERROR', amountError, { field: 'amount' });

    // ── The phone, normalised against OUR region before anything else ───────
    const phone = normalisePhone(data.phone);
    const msisdn = phone ? toPayHeroMsisdn(phone.e164) : null;
    if (!phone || !msisdn) {
      return fail(
        400,
        'VALIDATION_ERROR',
        'Enter a Kenyan M-Pesa number, for example 0712 345 678.',
        { field: 'phone' },
      );
    }

    /*
      The guard that protects a bystander. An attacker posting a stranger's
      number repeatedly fills their handset with prompts and, after 10 of
      them, gets that number blocked by PayHero for 24 hours. An IP rate limit
      does not address that, because the protected party is the number. See
      `src/lib/payhero-abuse-guard.ts`.
    */
    const verdict = await checkPhoneAbuseGuard(phone.e164);
    if (!verdict.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'RATE_LIMITED', message: verdict.message, requestId },
        } satisfies ApiError,
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
      );
    }

    /*
      Attribution, resolved against THIS campaign so a cookie left from
      another cannot credit the wrong sharer. Never allowed to stop a
      payment - the same reasoning as the Stripe route (docs/57).
    */
    let shareLinkId: string | null = null;
    try {
      const token = request.cookies?.get(SHARE_ATTRIBUTION_COOKIE)?.value ?? null;
      shareLinkId = await resolveShareLinkForCampaign(token, campaign.id);
    } catch (error) {
      logError(error, { requestId, route: 'payhero/initiate#shareAttribution' });
    }

    const channelId = configuredChannelId()!;
    const externalReference = `${LASTDONOR_REFERENCE_PREFIX}${randomUUID()}`;

    const [row] = await db
      .insert(payheroPaymentRequests)
      .values({
        externalReference,
        campaignId: campaign.id,
        currency: currency.code,
        amount: data.amount,
        phoneE164: phone.e164,
        msisdnSent: msisdn,
        channelId,
        donorName: data.donorName || 'Anonymous',
        donorEmail: data.donorEmail,
        donorLocation: data.donorLocation ?? null,
        message: data.message ?? null,
        isAnonymous: data.isAnonymous,
        subscribedToUpdates: data.subscribedToUpdates,
        shareLinkId,
      })
      .returning({ id: payheroPaymentRequests.id });

    // ── The push ────────────────────────────────────────────────────────────
    try {
      const accepted = await initiateStkPush({
        amountMinor: data.amount,
        currency: currency.code,
        phone: phone.e164,
        externalReference,
        /*
          Built from `appBaseUrl()` rather than the request's own Origin.
          docs/57 records why: a donor-controlled header deciding where a
          provider posts a payment outcome is not something to accept, and
          behind Cloudflare the Origin is not reliably ours anyway.
        */
        callbackUrl: `${appBaseUrl()}/api/v1/donations/payhero/callback`,
        customerName: data.isAnonymous ? null : data.donorName || null,
      });

      await db
        .update(payheroPaymentRequests)
        .set({
          payheroReference: accepted.reference,
          checkoutRequestId: accepted.checkoutRequestId || null,
        })
        .where(eq(payheroPaymentRequests.id, row.id));

      const response: ApiResponse<{
        reference: string;
        status: string;
        maskedPhone: string;
      }> = {
        ok: true,
        data: {
          /*
            OUR reference is returned, never PayHero's. The client polls with
            this, and the poll route resolves it against a row we wrote - so a
            caller can only ever ask about its own payment.
          */
          reference: externalReference,
          status: accepted.status,
          maskedPhone: `•••• ${phone.e164.slice(-3)}`,
        },
      };
      return NextResponse.json(response);
    } catch (error) {
      const kind = classifyInitiationFailure(error);

      await db
        .update(payheroPaymentRequests)
        .set({
          status: 'failed',
          failureReason: `Initiation failed (${kind}).`,
          settledAt: new Date(),
        })
        .where(eq(payheroPaymentRequests.id, row.id));

      await db.insert(auditLogs).values({
        eventType: 'donation.payhero_initiate_failed',
        targetType: 'campaign',
        targetId: campaign.id,
        severity: kind === 'configuration' ? 'error' : 'warning',
        details: {
          externalReference,
          kind,
          amount: data.amount,
          currency: currency.code,
          // PayHero's own message. Credentials never appear in it.
          providerMessage: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
        },
      });

      if (kind === 'configuration') {
        /*
          A permanent fault wearing retryable clothes. An unregistered
          channel answers "Failed to perform request. Please try again" -
          and trying again cannot create a payment channel. Told to the
          donor as our problem, logged as an operator one.
        */
        console.error(
          '[payhero/initiate] PayHero rejected the request for a configuration reason. ' +
            'No M-Pesa donation can complete until an operator fixes it.',
          { requestId, kind },
        );
        return fail(
          503,
          'PAYMENTS_UNAVAILABLE',
          'M-Pesa payments are unavailable right now. This is a problem on our side, not with ' +
            'your phone, and nothing has been charged. Please email support@lastdonor.org so we ' +
            'can help you give.',
        );
      }

      logError(error, { requestId, route: 'payhero/initiate#push' });

      if (kind === 'transient') {
        return fail(
          503,
          'PAYMENTS_UNAVAILABLE',
          'We could not reach M-Pesa just now and nothing has been charged. Please try again ' +
            'in a moment.',
        );
      }

      return fail(
        400,
        'VALIDATION_ERROR',
        'M-Pesa would not accept that payment request. Nothing has been charged. Check the ' +
          'number and the amount, then try again.',
      );
    }
  } catch (error) {
    logError(error, { requestId, route: 'payhero/initiate' });
    return fail(
      500,
      'INTERNAL_ERROR',
      'Something went wrong starting your payment and nothing has been charged.',
    );
  }
}
