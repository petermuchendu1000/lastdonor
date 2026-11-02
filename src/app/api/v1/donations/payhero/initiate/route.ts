import { NextRequest, NextResponse } from 'next/server';
import { and, eq, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { auditLogs, campaigns, payheroPaymentRequests } from '@/db/schema';
import { getCurrency, isSupportedCurrency, minorPerMajor } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';
/*
  ⛔ This route is in `ALLOWED_IMPORTERS` of
  `src/lib/money/fx-display-only.ratchet.test.ts`, on purpose.

  A rate now decides a charge here, which that boundary exists to make
  impossible to do by accident. Doing it deliberately means saying so in the
  allowlist - and the rule that replaces "display only" is stricter: this
  file must PERSIST the quote it used (`fxRateMicro`, `fxQuotedAt`), so the
  conversion is reproducible and settlement never re-derives it. See
  docs/168.
*/
import { quoteCharge, quoteRefusalMessage } from '@/lib/money/fx-quote.server';
import { checkDonationAmount } from '@/lib/validators/donation';
import { checkRaiseCap } from '@/lib/campaign-raise-cap';
import { realRaisedMinorSql } from '@/db/real-raised';
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
  payHeroChargeCurrency,
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
        verificationStatus: campaigns.verificationStatus,
        // Real, un-refunded donations only - NOT the blended `raised_amount`.
        // One verified expression: see `src/db/real-raised.ts`.
        realRaisedMinor: realRaisedMinorSql,
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

    /*
      ⛔ There is no longer a WRONG_PAYMENT_RAIL refusal here, and its absence
      is the fix (docs/168).

      It used to require `currency.gateway === 'payhero'`, i.e. that the
      campaign be DENOMINATED in the rail's own currency. That conflated two
      different things and made all 8 live USD campaigns uncollectable: the
      card rail answered 503 (dead Stripe credentials) and this one answered
      400, so they had no working rail at all.

      The campaign's currency decides what it is CREDITED in. The rail decides
      what the donor is CHARGED in. `quoteCharge` below bridges them.
    */
    const currency = getCurrency(campaign.currency);

    /* `data.amount` is the CREDIT, in the campaign's own currency. */
    const amountError = checkDonationAmount(data.amount, currency.code);
    if (amountError) return fail(400, 'VALIDATION_ERROR', amountError, { field: 'amount' });

    /*
      The pre-verification cap, decided BEFORE PayHero is asked for anything.

      This is the last point at which refusing costs the donor nothing. By the
      time `settlePayHeroRequest` runs, M-Pesa has already taken the money,
      and refusing there would mean refunding - which moves money and burns
      the flat KES 8.9 collection fee the platform absorbs (docs/92).

      See `src/lib/campaign-raise-cap.ts`, including the concurrency bound
      this placement accepts.
    */
    const capDecision = checkRaiseCap(
      {
        verificationStatus: campaign.verificationStatus,
        realRaisedMinor: Number(campaign.realRaisedMinor ?? 0),
        currency: currency.code,
      },
      data.amount,
    );
    if (!capDecision.allowed) {
      return fail(409, capDecision.code, capDecision.message, { field: 'amount' });
    }

    /*
      ── THE QUOTE: credit in the campaign's currency, charge in the rail's ──

      Decided HERE, before anything is asked of PayHero, for the same reason
      the cap is: this is the last point at which refusing costs the donor
      nothing. The rate is recorded on the row below and NEVER re-read at
      settlement - re-deriving it there would move the credit after the donor
      had agreed to the charge.
    */
    const chargeCurrencyCode = payHeroChargeCurrency();
    const quoted = await quoteCharge({
      creditMinor: data.amount,
      creditCurrency: currency.code,
      chargeCurrency: chargeCurrencyCode,
      /* PayHero accepts WHOLE major units only - `payhero.ts:472`. */
      roundChargeUpToMultiple: minorPerMajor(chargeCurrencyCode),
    });
    if (!quoted.ok) {
      /*
        A stale or missing rate REFUSES the charge rather than guessing one.
        503 because it is our side and it is transient; the message claims
        nothing about the donor's money, since none has been asked for.
      */
      logError(
        new Error(`FX quote refused for campaign ${campaign.id}: ${quoted.reason}`),
        { requestId, route: 'payhero/initiate#fx' },
      );
      return fail(503, 'FX_UNAVAILABLE', quoteRefusalMessage(quoted.reason));
    }
    const quote = quoted.quote;

    /*
      The CHARGE must also satisfy the RAIL's own bounds, not just the
      campaign's. `initiateStkPush` enforces them and THROWS, which would
      surface as an unknown outcome; refusing here keeps it a clean 400.

      In practice the binding one is the M-Pesa ceiling: KES 250,000 is the
      real per-transaction limit (docs/92), so a donation above roughly
      US$1,886 cannot be collected in a single push.
    */
    const chargeError = checkDonationAmount(quote.chargeMinor, quote.chargeCurrency);
    if (chargeError) {
      return fail(
        400,
        'VALIDATION_ERROR',
        `That works out to ${formatMoney(quote.chargeMinor, quote.chargeCurrency, 'exact')} ` +
          `on M-Pesa, which is outside what a single M-Pesa payment allows. ${chargeError} ` +
          'Nothing has been charged.',
        { field: 'amount' },
      );
    }

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
        /* The CHARGE - what PayHero is asked to collect, in the rail's currency. */
        currency: quote.chargeCurrency,
        amount: quote.chargeMinor,
        /* The CREDIT - what the campaign gets, FK-bound to its own currency. */
        creditedAmountMinor: quote.creditMinor,
        creditedCurrency: quote.creditCurrency,
        /* The quote, recorded so settlement never has to re-derive it. */
        fxRateMicro: quote.rateMicro,
        fxMarginBps: quote.marginBps,
        fxQuotedAt: quote.quotedAt,
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
        /* The CHARGE, in the rail's currency - not the campaign's. */
        amountMinor: quote.chargeMinor,
        currency: quote.chargeCurrency,
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
          /*
            ⚠️ `unknown` is recorded as what it is. The row still carries
            `status: 'failed'` because nothing can resolve it either way - no
            PayHero reference was ever recorded, so `settlePayHeroRequest`
            answers `unverifiable` by its own design - and changing the enum
            on a live money table buys nothing today (`docs/129`'s reasoning).
            But the REASON must not claim a failure nobody observed.
          */
          failureReason:
            kind === 'unknown'
              ? 'Initiation outcome UNKNOWN: no response from PayHero. A collection may exist ' +
                'and cannot be verified - no PayHero reference was recorded.'
              : `Initiation failed (${kind}).`,
          settledAt: new Date(),
        })
        .where(eq(payheroPaymentRequests.id, row.id));

      await db.insert(auditLogs).values({
        eventType: 'donation.payhero_initiate_failed',
        targetType: 'campaign',
        targetId: campaign.id,
        // An unknown outcome on a money path is an operator's problem too: it
        // is the only case where a collection may exist that we cannot see.
        severity: kind === 'configuration' || kind === 'unknown' ? 'error' : 'warning',
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
        // PayHero ANSWERED (5xx or 429), so it had the request and did not act
        // on it. "Nothing has been charged" is substantiated here.
        return fail(
          503,
          'PAYMENTS_UNAVAILABLE',
          'We could not reach M-Pesa just now and nothing has been charged. Please try again ' +
            'in a moment.',
        );
      }

      if (kind === 'unknown') {
        /*
          NO response arrived. The push reaches Safaricom synchronously and we
          gave up after 20s, so the request may have got there and raised a
          prompt we never heard about. We must not say nothing was charged, and
          we must not invite a blind retry - that is how somebody pays twice.

          `docs/121`'s rule, on the way in: the unknown branch is the one where
          the money may actually have moved.
        */
        return fail(
          503,
          'PAYMENT_OUTCOME_UNKNOWN',
          'We lost contact with M-Pesa while starting your payment, so we cannot tell you ' +
            'whether it went through. Check your M-Pesa messages first. If you were charged, ' +
            'email support@lastdonor.org and we will sort it out. Please do not send it again ' +
            'until you have checked.',
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
