import { NextRequest, NextResponse } from 'next/server';
import { and, eq, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { auditLogs, campaigns, palplussPaymentRequests } from '@/db/schema';
import { getCurrency, isSupportedCurrency, minorPerMajor } from '@/lib/money/currencies';
import { formatMoney } from '@/lib/money/format';
/*
  ⛔ This route is in `ALLOWED_IMPORTERS` of
  `src/lib/money/fx-display-only.ratchet.test.ts`, on purpose — the same entry
  the PayHero initiate route has and for the same reason.

  A rate decides a charge here, which that boundary exists to make impossible
  to do by accident. Doing it deliberately means saying so in the allowlist,
  and the rule that replaces "display only" is stricter: this file must
  PERSIST the quote it used (`fxRateMicro`, `fxQuotedAt`), so the conversion
  is reproducible and settlement never re-derives it. See docs/168.
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
  pointing at the wrong host — and Palpluss refuses a non-https callback
  outright, so getting it wrong here is a refusal rather than a silent miss.
*/
import { appBaseUrl } from '@/lib/unsubscribe-tokens';
import {
  TRANSACTION_DESC,
  classifyPalplussInitiationFailure,
  initiateStkPush,
  isPalplussConfigured,
  mintAccountReference,
  palplussChargeCurrency,
  toPalplussMsisdn,
} from '@/lib/palpluss';
import { checkPhoneAbuseGuard } from '@/lib/mpesa-abuse-guard';
import { SHARE_ATTRIBUTION_COOKIE, resolveShareLinkForCampaign } from '@/lib/share-links';
/*
  The body of an M-Pesa initiate request is the same question on either rail:
  a campaign, an amount in that campaign's currency, a phone number and the
  donor's context. `initiateMpesaSchema` is already named for the rail-neutral
  thing it describes and carries no PayHero-specific field and no currency
  literal, so it is imported rather than copied. A second copy would drift,
  and docs/146 is about exactly that.
*/
import { initiateMpesaSchema } from '@/lib/validators/payhero';
import { logError } from '@/lib/errors';
import type { ApiError, ApiResponse } from '@/types/api';

/**
 * POST /api/v1/donations/palpluss/initiate
 *
 * Ask Palpluss to push an M-Pesa PIN prompt to a donor's phone. See `docs/180`
 * for the probed behaviour of the rail, `docs/181` for the settlement, and
 * `docs/182` for this route.
 *
 * **A 200 from this route means a prompt was queued. It does not mean money
 * moved, and nothing is recorded as a donation here.** `docs/180` measured
 * Palpluss answering `success: true` with `resultCode: "0"` on a transaction
 * that settled FAILED twenty-nine seconds later, so even the gateway's own
 * acceptance signals are not an outcome. The outcome is settled by
 * `settlePalplussRequest`, from Palpluss's authenticated status endpoint.
 *
 * ── Order of operations, and why ──────────────────────────────────────────
 *
 * Everything that can refuse the request is checked BEFORE the push is sent,
 * because a wasted push is not free. Palpluss throttles at two pushes per
 * phone per minute and reports a refusal as `result_code: "17"` rather than
 * an HTTP error, the prepaid service wallet is debited per request, and a
 * handset full of unwanted prompts is what gets its owner blocked. A request
 * that was never going to work must not be spent.
 *
 * ── THE ROW IS INSERTED BEFORE THE API CALL ───────────────────────────────
 *
 * ⛔ This is the one place this route differs from its PayHero twin in
 * substance, and it is why `palpluss_transaction_id` had to stop being
 * `NOT NULL` (docs/182). Palpluss mints that id, so a NOT NULL column forces
 * the call to happen first — and a process that dies between the response
 * arriving and the INSERT committing loses the campaign, the donor, the
 * amount and the FX quote for a collection that may already have succeeded.
 * Nothing would remain to reconcile against.
 *
 * Inserting first inverts that: the loose end is a row that holds everything
 * except the gateway's id, which is recoverable — [VERIFIED 2026-11-24]
 * `GET /v1/transactions` answers 200 with `external_reference` on every row,
 * so our own `LD-…` reference leads back to the transaction. The window on
 * this side is a `pending` row for a push that never left, which settles
 * nothing and claims nothing.
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

  /*
    The donor-facing wording for "our side, and nothing has been charged".
    One string, because it is used by four different refusals and they must
    not drift into four slightly different promises about somebody's money.
  */
  const OUR_SIDE =
    'M-Pesa payments are unavailable right now. This is a problem on our side, not with ' +
    'your phone, and nothing has been charged. Please email support@lastdonor.org so we ' +
    'can help you give.';

  try {
    if (!isPalplussConfigured()) {
      /*
        An operator problem, told to the donor as one. `docs/72` is about the
        three weeks in which a dead Stripe key produced "Failed to create
        checkout session" — wording that invited a retry that could never
        succeed.
      */
      console.error(
        '[palpluss/initiate] PALPLUSS_API_KEY is not set. No M-Pesa donation can complete ' +
          'on this rail on this deployment.',
        { requestId },
      );
      return fail(503, 'PAYMENTS_UNAVAILABLE', OUR_SIDE);
    }

    /*
      ── Is anything actually routed to this rail? ─────────────────────────

      `palplussChargeCurrency()` reads the currency table rather than
      hardcoding KES, and returns null when no currency names
      `gateway: 'palpluss'` — which is TODAY'S STATE (docs/180 §7 leaves
      creating the LastDonor tenant and flipping a currency as owner
      actions). So this branch is live, not defensive: until it is taken,
      this route is unreachable in practice and says so honestly rather than
      throwing somewhere deeper.

      `initiateStkPush` refuses the same thing independently, so this is not
      the only guard — it is the one that produces a sensible answer instead
      of a classified exception.
    */
    const chargeCurrencyCode = palplussChargeCurrency();
    if (!chargeCurrencyCode) {
      console.error(
        '[palpluss/initiate] No currency in src/lib/money/currencies.ts names ' +
          "gateway: 'palpluss', so this rail collects nothing. Nothing was sent.",
        { requestId },
      );
      return fail(503, 'PAYMENTS_UNAVAILABLE', OUR_SIDE);
    }

    const parsed = initiateMpesaSchema.safeParse(await request.json());
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return fail(400, 'VALIDATION_ERROR', first.message, { field: first.path.join('.') });
    }
    const data = parsed.data;

    // ── The campaign decides the currency and the bounds ────────────────────
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
      /*
        The raw status pair, and this file is an ELIGIBILITY site in
        `src/db/public-campaigns.ratchet.test.ts` — it asks "may this one
        named campaign take this donation", not "should it appear in a list".
        The platform's own general fund must answer yes (docs/147), and
        `listedCampaignFilter()` here would make it uncollectable.
      */
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
        { requestId, route: 'palpluss/initiate#currency' },
      );
      return fail(
        503,
        'CURRENCY_UNSUPPORTED',
        'We cannot take donations for this campaign right now. Nothing has been charged.',
      );
    }

    /*
      ⛔ No WRONG_PAYMENT_RAIL refusal, and its absence is deliberate
      (docs/168). The campaign's currency decides what it is CREDITED in; the
      rail decides what the donor is CHARGED in. Requiring the two to match
      is what made every USD campaign uncollectable on the other rail.
    */
    const currency = getCurrency(campaign.currency);

    /* `data.amount` is the CREDIT, in the campaign's own currency. */
    const amountError = checkDonationAmount(data.amount, currency.code);
    if (amountError) return fail(400, 'VALIDATION_ERROR', amountError, { field: 'amount' });

    /*
      The pre-verification cap, decided BEFORE Palpluss is asked for anything.

      This is the last point at which refusing costs the donor nothing. Once
      the collection settles, M-Pesa has taken the money and refusing would
      mean refunding — which moves money and, on this rail, burns a prepaid
      service-wallet fee that is not returned.

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

      Decided here, before anything is asked of Palpluss, for the same reason
      the cap is. The rate is recorded on the row below and NEVER re-read at
      settlement — re-deriving it there would move the credit after the donor
      had agreed to the charge.
    */
    const quoted = await quoteCharge({
      creditMinor: data.amount,
      creditCurrency: currency.code,
      chargeCurrency: chargeCurrencyCode,
      /* Palpluss accepts WHOLE major units only — `palpluss.ts` proves the
         alignment before dividing, and refuses a fraction rather than
         rounding somebody's money silently. */
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
        { requestId, route: 'palpluss/initiate#fx' },
      );
      return fail(503, 'FX_UNAVAILABLE', quoteRefusalMessage(quoted.reason));
    }
    const quote = quoted.quote;

    /*
      The CHARGE must also satisfy the RAIL's own bounds, not just the
      campaign's. The client enforces them and THROWS, which would surface as
      a classified failure; refusing here keeps it a clean 400 that names the
      figure the donor would have paid.
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
    const msisdn = phone ? toPalplussMsisdn(phone.e164) : null;
    if (!phone || !msisdn) {
      return fail(
        400,
        'VALIDATION_ERROR',
        'Enter a Kenyan M-Pesa number, for example 0712 345 678.',
        { field: 'phone' },
      );
    }

    /*
      The guard that protects a bystander, counting BOTH M-Pesa rails — the
      handset does not care which one rang it (`src/lib/mpesa-abuse-guard.ts`).
      The rail is named rather than defaulted because it selects the cooldown,
      and Palpluss's throttle is three times stricter than PayHero's: two
      pushes per phone per minute, reported as `result_code: "17"` rather than
      an HTTP error, so a push past it looks sent and silently is not.
    */
    const verdict = await checkPhoneAbuseGuard(phone.e164, 'palpluss');
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
      payment — the same reasoning as the Stripe route (docs/57).
    */
    let shareLinkId: string | null = null;
    try {
      const token = request.cookies?.get(SHARE_ATTRIBUTION_COOKIE)?.value ?? null;
      shareLinkId = await resolveShareLinkForCampaign(token, campaign.id);
    } catch (error) {
      logError(error, { requestId, route: 'palpluss/initiate#shareAttribution' });
    }

    /*
      Our reference: `LD-` plus nine random base32 characters, because
      Palpluss documents `accountReference` as twelve characters. The `LD-`
      prefix is the isolation boundary on a tenant that may be shared with
      another product (docs/180 §3), and the client refuses to send a
      reference without it.
    */
    const accountReference = mintAccountReference();
    const callbackUrl = `${appBaseUrl()}/api/v1/donations/palpluss/callback`;

    const [row] = await db
      .insert(palplussPaymentRequests)
      .values({
        accountReference,
        /*
          ⛔ No `palplussTransactionId` yet. Palpluss mints it and we have not
          called them. See the header: the row exists first so a lost response
          leaves something to reconcile.
        */
        campaignId: campaign.id,
        /* The CHARGE — what Palpluss is asked to collect, in the rail's currency. */
        currency: quote.chargeCurrency,
        amount: quote.chargeMinor,
        /* The CREDIT — what the campaign gets, FK-bound to its own currency. */
        creditedAmountMinor: quote.creditMinor,
        creditedCurrency: quote.creditCurrency,
        /* The quote, recorded so settlement never has to re-derive it. */
        fxRateMicro: quote.rateMicro,
        fxMarginBps: quote.marginBps,
        fxQuotedAt: quote.quotedAt,
        phoneE164: phone.e164,
        msisdnSent: msisdn,
        channelId: process.env.PALPLUSS_CHANNEL_ID ?? null,
        donorName: data.donorName || 'Anonymous',
        donorEmail: data.donorEmail,
        donorLocation: data.donorLocation ?? null,
        message: data.message ?? null,
        isAnonymous: data.isAnonymous,
        subscribedToUpdates: data.subscribedToUpdates,
        shareLinkId,
      })
      .returning({ id: palplussPaymentRequests.id });

    // ── The push ────────────────────────────────────────────────────────────
    try {
      const accepted = await initiateStkPush({
        /* The CHARGE, in the rail's currency — not the campaign's. */
        amountMinor: quote.chargeMinor,
        currency: quote.chargeCurrency,
        phone: phone.e164,
        accountReference,
        /*
          Thirteen characters on the donor's own handset, so it says who is
          asking rather than a clipped campaign title.
        */
        transactionDesc: TRANSACTION_DESC,
        /*
          Built from `appBaseUrl()` rather than the request's own Origin.
          docs/57 records why: a donor-controlled header deciding where a
          provider posts a payment outcome is not something to accept, and
          behind Cloudflare the Origin is not reliably ours anyway.
        */
        callbackUrl,
      });

      /*
        ⛔ The gateway's id, written the moment it exists. Everything that can
        later establish whether this donor's money moved resolves by it, and
        the client refuses to query a non-UUID — so a row that never receives
        one is checked by hand against the ledger, not by guessing.
      */
      await db
        .update(palplussPaymentRequests)
        .set({
          palplussTransactionId: accepted.transactionId,
          providerCheckoutId: accepted.providerCheckoutId,
        })
        .where(eq(palplussPaymentRequests.id, row.id));

      const response: ApiResponse<{
        reference: string;
        status: string;
        maskedPhone: string;
      }> = {
        ok: true,
        data: {
          /*
            OUR reference is returned, never Palpluss's transaction id. That
            id is the key to `GET /transactions/{id}` on a tenant that may be
            shared with another product, so it stays server-side; a poll
            resolves this value against a row we wrote, which means a caller
            can only ever ask about its own payment. Same rule as the PayHero
            status route (`src/lib/validators/payhero.ts`).
          */
          reference: accountReference,
          status: accepted.status,
          maskedPhone: `•••• ${phone.e164.slice(-3)}`,
        },
      };
      return NextResponse.json(response);
    } catch (error) {
      const kind = classifyPalplussInitiationFailure(error);

      await db
        .update(palplussPaymentRequests)
        .set({
          status: 'failed',
          /*
            ⚠️ `unknown` is recorded as what it is. The row stays `failed`
            because a fourth enum value means a migration on a live money
            table (`docs/129`), and because nothing automatic can resolve a
            row with no transaction id. But the REASON must not claim a
            failure nobody observed — and unlike the other rail it can name a
            way forward, because the reference really does lead back to the
            transaction through the tenant ledger.
          */
          failureReason:
            kind === 'unknown'
              ? 'Initiation outcome UNKNOWN: no response from Palpluss. A collection may ' +
                'exist and no transaction id was recorded. Reconcile by matching this ' +
                "row's account_reference against external_reference in Palpluss's " +
                'transaction list.'
              : `Initiation failed (${kind}).`,
          settledAt: new Date(),
        })
        .where(eq(palplussPaymentRequests.id, row.id));

      await db.insert(auditLogs).values({
        eventType: 'donation.palpluss_initiate_failed',
        targetType: 'campaign',
        targetId: campaign.id,
        /*
          An unknown outcome on a money path is an operator's problem too: it
          is the only case where a collection may exist that we cannot see.
        */
        severity: kind === 'configuration' || kind === 'unknown' ? 'error' : 'warning',
        details: {
          accountReference,
          kind,
          amount: data.amount,
          currency: currency.code,
          // Palpluss's own message. Credentials never appear in it.
          providerMessage: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
        },
      });

      if (kind === 'configuration') {
        /*
          A permanent fault wearing retryable clothes, and on this rail that
          includes an EMPTY PREPAID WALLET (`402
          INSUFFICIENT_SERVICE_BALANCE`, docs/180 finding 5) — which no
          amount of retrying tops up. Told to the donor as our problem,
          logged as an operator one.
        */
        console.error(
          '[palpluss/initiate] Palpluss rejected the request for a configuration reason, or ' +
            'our own guards refused to send it. No M-Pesa donation can complete on this rail ' +
            'until an operator fixes it.',
          { requestId, kind },
        );
        return fail(503, 'PAYMENTS_UNAVAILABLE', OUR_SIDE);
      }

      logError(error, { requestId, route: 'palpluss/initiate#push' });

      if (kind === 'transient') {
        /*
          Palpluss ANSWERED (5xx or 429), so it had the request and did not
          act on it. "Nothing has been charged" is substantiated here.
        */
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
          we must not invite a blind retry — that is how somebody pays twice.

          `docs/121`'s rule on the way in, and `docs/158`'s on this rail: the
          unknown branch is the one where the money may actually have moved.
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
    logError(error, { requestId, route: 'palpluss/initiate' });
    return fail(
      500,
      'INTERNAL_ERROR',
      'Something went wrong starting your payment and nothing has been charged.',
    );
  }
}
