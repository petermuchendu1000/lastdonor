/**
 * Turning a PayHero outcome into a donation.
 *
 * One function, `settlePayHeroRequest`, reached from three places: the
 * callback route, the status-poll route, and (later) a reconciliation sweep.
 * All three must agree, so none of them decides anything itself — they all
 * call this.
 *
 * ── Why the callback body is never believed ───────────────────────────────
 *
 * PayHero's callback carries no signature of any kind: no HMAC, no shared
 * secret, no timestamp. The API secret PayHero issues is not a signing key
 * either (probed 2026-10-21: it is not accepted for authentication at all).
 * So a POST to our public callback URL claiming `Status: "Success"` is
 * unauthenticated input, and anyone who learns the URL can send one.
 *
 * This is the shape `docs/81` settled for Didit: **read only an identifier
 * from the body, then ask the provider what happened over an authenticated
 * call of our own.** The callback is a hint that something changed. The
 * outcome comes from `getTransactionStatus`. A forged request can therefore
 * cause at most one wasted lookup, never a donation.
 *
 * ── Why it is also isolated from BETWOIN ──────────────────────────────────
 *
 * The PayHero account is shared with BETWOIN LTD. A callback is only acted on
 * if its `ExternalReference` matches a row this platform wrote. Everything
 * else — the other product's traffic, a replay, a forgery — resolves to no
 * row and is refused before any network call.
 *
 * ── Why settling is single-shot ───────────────────────────────────────────
 *
 * The callback and the donor's own status poll routinely race. The claim is
 * an `UPDATE … WHERE status = 'pending' RETURNING`, exactly the pattern
 * `docs/41` established for refunds: of two concurrent settlements precisely
 * one gets a row back, so precisely one records a donation. `donations` has
 * its own unique index on the provider reference underneath, which is the
 * durable backstop.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLogs, payheroPaymentRequests, donations } from '@/db/schema';
import { getTransactionStatus, LASTDONOR_REFERENCE_PREFIX } from '@/lib/payhero';
import { recordGatewayCharge } from '@/lib/services/payment-service';
import { minorToMajor } from '@/lib/money/format';
import { logError } from '@/lib/errors';

/** The prefix a PayHero donation's `donations.stripe_payment_id` carries. */
export const PAYHERO_REF_PREFIX = 'payhero_';

export type SettlementOutcome =
  | {
      kind: 'recorded';
      amountMinor: number;
      currency: string;
      /**
       * The donation this collection produced. Non-null by construction: the
       * absence of a row is `collected_unrecorded`, not `recorded`. Carried
       * so the status route has ONE place that answers a thank-you, and that
       * place always decides from a donation link (`docs/162`).
       */
      donationId: string;
    }
  /**
   * PayHero collected the money and `recordGatewayCharge` declined to book
   * it, so there is no donation row. `docs/162`.
   *
   * ⛔ This is NOT `recorded` and must never be folded back into it. The
   * status route turns `recorded` into `state: 'succeeded'`, which the donor
   * reads as "Thank you - your donation is in"; on this path that sentence is
   * false, no receipt is sent (`payment-service.ts:881` returns above
   * `handlePostPaymentEffects`), and the platform's own audit row says a
   * person must return the money by hand.
   *
   * ⛔ Nor is it `unverifiable`, which means we cannot establish what
   * happened. Here we can: the payment succeeded and we did not book it.
   */
  | { kind: 'collected_unrecorded'; reason: string }
  | {
      kind: 'already_settled';
      status: 'succeeded' | 'failed' | 'abandoned';
      /**
       * Null when no donation was booked. Carried because a caller cannot
       * tell a settled-and-recorded row from a settled-and-unrecorded one
       * from the status alone - which is the whole of `docs/162`.
       */
      donationId: string | null;
    }
  | { kind: 'still_pending' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unknown_reference' }
  | { kind: 'unverifiable'; reason: string };

/**
 * Re-read a row whose settlement race we lost.
 *
 * The `request` read at the top of `settlePayHeroRequest` is stale by then:
 * another caller has just written the terminal state and, on the success
 * path, may have written the donation link too. Reporting `donationId: null`
 * from the stale copy would say "collected but not recorded" about a donation
 * that exists.
 */
async function alreadySettled(id: string): Promise<SettlementOutcome> {
  const [row] = await db
    .select({
      status: payheroPaymentRequests.status,
      donationId: payheroPaymentRequests.donationId,
    })
    .from(payheroPaymentRequests)
    .where(eq(payheroPaymentRequests.id, id))
    .limit(1);

  // The row cannot vanish - we just updated it - but guessing a state is how
  // a false claim gets made, so an absent row is reported as unknowable.
  if (!row || row.status === 'pending') {
    return {
      kind: 'unverifiable',
      reason: 'The payment request could not be re-read after a settlement race.',
    };
  }
  return { kind: 'already_settled', status: row.status, donationId: row.donationId };
}

/**
 * Ask PayHero what happened to one collection request, and act on it.
 *
 * @param externalReference our own `LD-…` reference. The only thing a caller
 *        is trusted with; everything else is read from our own row or from
 *        PayHero over an authenticated call.
 */
export async function settlePayHeroRequest(
  externalReference: string,
): Promise<SettlementOutcome> {
  const ref = (externalReference ?? '').trim();

  /*
    Cheap rejection before touching the database. A reference without our
    prefix cannot be ours, so it is BETWOIN's traffic or a forgery.
  */
  if (!ref || !ref.startsWith(LASTDONOR_REFERENCE_PREFIX)) {
    return { kind: 'unknown_reference' };
  }

  const [request] = await db
    .select()
    .from(payheroPaymentRequests)
    .where(eq(payheroPaymentRequests.externalReference, ref))
    .limit(1);

  // The isolation boundary. No row of ours, nothing to settle.
  if (!request) return { kind: 'unknown_reference' };

  if (request.status !== 'pending') {
    return {
      kind: 'already_settled',
      status: request.status,
      donationId: request.donationId,
    };
  }

  /*
    Without PayHero's own reference the payment cannot be checked at all: our
    external_reference returns 404 from their status endpoint (probed
    2026-10-21). This means initiation failed between the insert and the API
    answering.

    ⛔ It does NOT mean nothing was charged, and this comment said so until
    `docs/159`. `docs/158` had shipped the day before: a reference-less row is
    exactly the row a LOST RESPONSE leaves behind, and the push reaches
    Safaricom synchronously, so a prompt may have been raised while we were
    giving up on the response. `unverifiable` is the honest kind precisely
    because the outcome is unknown - the caller must not read it as
    reassurance, and `initiate/route.ts` no longer does.
  */
  if (!request.payheroReference) {
    return {
      kind: 'unverifiable',
      reason: 'No PayHero reference was ever recorded for this request.',
    };
  }

  const status = await getTransactionStatus(request.payheroReference);

  await db
    .update(payheroPaymentRequests)
    .set({ lastCheckedAt: new Date() })
    .where(eq(payheroPaymentRequests.id, request.id));

  if (status.status === 'QUEUED') return { kind: 'still_pending' };

  /*
    An undocumented status is not money. PayHero documents QUEUED, SUCCESS and
    FAILED; anything else maps to UNKNOWN in the client rather than being
    guessed at. Left pending so a later check can resolve it, and recorded so
    somebody finds out PayHero's vocabulary grew.
  */
  if (status.status === 'UNKNOWN') {
    logError(
      new Error(
        `PayHero returned an unrecognised status for ${ref}: ` +
          `${JSON.stringify(status.raw.status ?? null)}`,
      ),
      { requestId: ref, route: 'payhero/settlement#unknown-status' },
    );
    return { kind: 'still_pending' };
  }

  if (status.status === 'FAILED') {
    /*
      Claimed conditionally, so the callback and a concurrent poll cannot both
      write the failure and both notify.

      PayHero does not distinguish a cancelled prompt from an expired one or
      from insufficient funds - all three arrive as FAILED - so neither does
      this. Inventing a reason we cannot observe would be worse than saying
      the payment did not go through.
    */
    const claimed = await db
      .update(payheroPaymentRequests)
      .set({
        status: 'failed',
        failureReason: 'PayHero reported the payment as FAILED.',
        settledAt: new Date(),
      })
      .where(
        and(
          eq(payheroPaymentRequests.id, request.id),
          eq(payheroPaymentRequests.status, 'pending'),
        ),
      )
      .returning({ id: payheroPaymentRequests.id });

    if (claimed.length === 0) {
      return alreadySettled(request.id);
    }

    await db.insert(auditLogs).values({
      eventType: 'donation.payhero_failed',
      targetType: 'campaign',
      targetId: request.campaignId,
      severity: 'info',
      details: {
        externalReference: ref,
        payheroReference: request.payheroReference,
        amount: request.amount,
        currency: request.currency,
      },
    });

    return { kind: 'failed', reason: 'The payment did not go through.' };
  }

  // ── SUCCESS ───────────────────────────────────────────────────────────────

  /*
    Assert the money matches what we asked for, BEFORE recording it.

    PayHero reports the amount in major units. Our row holds minor units. If
    they disagree, something is wrong that we must not paper over by trusting
    either number: on a shared account, an amount mismatch is also how a
    BETWOIN transaction would look if a reference ever collided.

    Recorded as `critical` and NOT booked, because the alternative is crediting
    a campaign with an amount nobody paid.
  */
  const expectedMajor = minorToMajor(request.amount, request.currency);
  if (status.amountMajor !== null && status.amountMajor !== expectedMajor) {
    logError(
      new Error(
        `PayHero amount mismatch on ${ref}: expected ${expectedMajor} ${request.currency}, ` +
          `PayHero reports ${status.amountMajor}. Donation NOT recorded.`,
      ),
      { requestId: ref, route: 'payhero/settlement#amount' },
    );
    await db.insert(auditLogs).values({
      eventType: 'donation.payhero_amount_mismatch',
      targetType: 'campaign',
      targetId: request.campaignId,
      severity: 'critical',
      details: {
        externalReference: ref,
        payheroReference: request.payheroReference,
        expectedMajor,
        reportedMajor: status.amountMajor,
        currency: request.currency,
        merchant: status.merchant,
        note: 'Money moved but no donation row was written. Needs manual reconciliation.',
      },
    });
    return {
      kind: 'unverifiable',
      reason: 'The amount PayHero settled does not match the amount requested.',
    };
  }

  // Claim the request. Exactly one caller proceeds past here.
  const claimed = await db
    .update(payheroPaymentRequests)
    .set({
      status: 'succeeded',
      providerReference: status.providerReference,
      settledAt: new Date(),
    })
    .where(
      and(
        eq(payheroPaymentRequests.id, request.id),
        eq(payheroPaymentRequests.status, 'pending'),
      ),
    )
    .returning({ id: payheroPaymentRequests.id });

  if (claimed.length === 0) {
    return alreadySettled(request.id);
  }

  /*
    The provider reference is namespaced so two gateways can never collide in
    `donations.stripe_payment_id`, whose unique index is the platform's only
    durable replay guard. Falls back to our own reference when PayHero sends
    no M-Pesa code, because a donation with no reference could be inserted
    twice.
  */
  const providerRef = `${PAYHERO_REF_PREFIX}${status.providerReference ?? ref}`;

  await recordGatewayCharge({
    provider: 'payhero',
    providerRef,
    amountMinor: request.amount,
    currency: request.currency,
    metadata: {
      campaignId: request.campaignId,
      donorName: request.donorName,
      donorEmail: request.donorEmail,
      donorLocation: request.donorLocation,
      message: request.message,
      isAnonymous: request.isAnonymous,
      // M-Pesa STK is a one-off push; there is no mandate behind it.
      isRecurring: false,
      subscribedToUpdates: request.subscribedToUpdates,
      shareLinkId: request.shareLinkId,
    },
  });

  /*
    Link the donation back to the request that produced it. Looked up rather
    than returned, because `recordGatewayCharge` deliberately does not hand
    back an id: it may legitimately write nothing (a replay), and a caller
    that expected an id would have to guess what a null meant.
  */
  const [donation] = await db
    .select({ id: donations.id })
    .from(donations)
    .where(eq(donations.stripePaymentId, providerRef))
    .limit(1);

  /*
    ⛔ The answer to this lookup DECIDES the outcome; it used to be read and
    then thrown away, and `return { kind: 'recorded' }` followed whether or
    not anything had been recorded. `docs/162`.

    `recordGatewayCharge` has early returns that book nothing - the live one
    being a campaign that reached its goal while the donor was entering a PIN
    (`payment-service.ts:835`, whose own comment names that window). On that
    path it writes `donation.manual_refund_required` at CRITICAL severity and
    returns above both the donation transaction and the receipt, so the money
    is in the platform's wallet with nothing owed to any campaign - while the
    donor was being told "Thank you - your donation is in" and promised a
    receipt by email.
  */
  if (!donation) {
    const reason =
      'PayHero settled this collection and no donation row was written. ' +
      'The money is in the platform wallet and needs manual reconciliation.';

    logError(new Error(`PayHero collected but not recorded: ${ref}. ${reason}`), {
      requestId: ref,
      route: 'payhero/settlement#collected-unrecorded',
    });

    /*
      Written onto the row so the durable record is honest too. The request
      stays `succeeded` - the COLLECTION did succeed, and a new enum value
      means a migration on a live money table for a path that has never fired
      (`docs/129`'s reasoning). What makes the row readable is `donation_id`
      being null beside it, which is the discriminator the status route uses.
    */
    await db
      .update(payheroPaymentRequests)
      .set({ failureReason: reason })
      .where(eq(payheroPaymentRequests.id, request.id));

    return { kind: 'collected_unrecorded', reason };
  }

  await db
    .update(payheroPaymentRequests)
    .set({ donationId: donation.id })
    .where(eq(payheroPaymentRequests.id, request.id));

  return {
    kind: 'recorded',
    amountMinor: request.amount,
    currency: request.currency,
    donationId: donation.id,
  };
}
