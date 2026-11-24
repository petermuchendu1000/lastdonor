/**
 * Turning a Palpluss outcome into a donation.
 *
 * One function, `settlePalplussRequest`, reached from the callback route and
 * (once it exists) the donor's status poll. Both must agree, so neither
 * decides anything itself — they call this. The sibling for the other M-Pesa
 * rail is `payhero-settlement.ts`, and this is deliberately its twin: the
 * shapes `docs/92`, `docs/158`, `docs/159`, `docs/160` and `docs/162` arrived
 * at were each paid for by a defect, and re-deriving them here would be
 * re-paying.
 *
 * ── Why the callback body is never believed, even though it is signed ──────
 *
 * Palpluss DOES sign callbacks (Standard Webhooks; see
 * `palpluss-webhook.ts`), which is more than PayHero offers. It still is not
 * trusted, for two reasons:
 *
 *   1. **Signing is per domain.** It is configured in the Palpluss console
 *      per registered domain, and callbacks to an unregistered domain arrive
 *      UNSIGNED. `lastdonor.org` is not registered on the LastDonor tenant
 *      yet (`docs/180` §7, owner action), so today every callback has no
 *      signature at all.
 *   2. **A signature authenticates the SENDER, not the OUTCOME.** Even a
 *      perfectly verified body is a claim. `docs/180` measured Palpluss
 *      answering `success: true` with `resultCode: "0"` on a transaction that
 *      settled FAILED twenty-nine seconds later — so a body that says SUCCESS
 *      is not evidence a donor paid, whoever sent it.
 *
 * So this reads ONE identifier and re-asks Palpluss over our own
 * authenticated call. `docs/81`'s shape, for the third time in this codebase.
 * A forged callback costs at most one wasted lookup.
 *
 * ── Why the lookup key is THEIRS and not ours ─────────────────────────────
 *
 * PayHero's settlement resolves by our own `LD-…` reference. This one cannot:
 * [VERIFIED 2026-11-24] `GET /v1/transactions/{id}` accepts only Palpluss's
 * own UUID, and our `accountReference` is not a lookup key there. So the row
 * is found by `palpluss_transaction_id`, which is also the isolation
 * boundary — the tenant is shared with two other products (`docs/180` §3),
 * and one of their transaction ids matches no row of ours.
 *
 * ⛔ That boundary is why `getTransactionStatus` must never be called with an
 * id we did not store: a blank id collapses onto the LIST endpoint and
 * answers HTTP 200 with twenty of the shared tenant's rows. The client
 * refuses a non-UUID before building a URL, and this module only ever passes
 * it a value read back out of our own table.
 *
 * ── Why settling is single-shot ───────────────────────────────────────────
 *
 * The callback and the donor's poll race by design. The claim is an
 * `UPDATE … WHERE status = 'pending' RETURNING`, so of two concurrent
 * settlements exactly one gets a row and exactly one books a donation.
 * `donations.stripe_payment_id`'s unique index is the durable backstop
 * underneath.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLogs, palplussPaymentRequests, donations } from '@/db/schema';
import { getTransactionStatus, classifyPalplussStatus } from '@/lib/palpluss';
import { recordGatewayCharge } from '@/lib/services/payment-service';
import { minorToMajor } from '@/lib/money/format';
import { logError } from '@/lib/errors';

/**
 * The prefix a Palpluss donation's `donations.stripe_payment_id` carries.
 *
 * ⛔ Namespaced so two gateways can never collide in that unique index, which
 * is the platform's only durable replay guard. `payhero_` and `pi_` are the
 * others; a bare M-Pesa receipt number could in principle be issued to both
 * rails, since both ultimately settle through Safaricom.
 */
export const PALPLUSS_REF_PREFIX = 'palpluss_';

export type PalplussSettlementOutcome =
  | {
      kind: 'recorded';
      amountMinor: number;
      currency: string;
      /**
       * The donation this collection produced. Non-null by construction: the
       * absence of a row is `collected_unrecorded`, never `recorded`. Carried
       * so there is ONE place that can answer a thank-you and it always
       * decides from a donation link (`docs/162`).
       */
      donationId: string;
    }
  /**
   * Palpluss collected the money and `recordGatewayCharge` declined to book
   * it, so there is no donation row. `docs/162`.
   *
   * ⛔ NOT `recorded`, and it must never be folded back in: a caller turns
   * `recorded` into "Thank you — your donation is in", which on this path is
   * false, sends no receipt, and sits beside the platform's own audit row
   * saying a person must return the money by hand.
   *
   * ⛔ Nor `unverifiable`, which means we cannot establish what happened.
   * Here we can: the payment succeeded and we did not book it.
   */
  | { kind: 'collected_unrecorded'; reason: string }
  | {
      kind: 'already_settled';
      status: 'succeeded' | 'failed';
      /**
       * Null when no donation was booked. A caller cannot tell a
       * settled-and-recorded row from a settled-and-unrecorded one from the
       * status alone — which is the whole of `docs/162`.
       */
      donationId: string | null;
    }
  | { kind: 'still_pending' }
  | { kind: 'failed'; reason: string }
  /**
   * Palpluss took the money and returned it.
   *
   * ⛔ Separate from `failed` on purpose. `failed` means no money ever moved;
   * this means it moved both ways. No donation is booked either way, so the
   * donor-visible difference is nil — but the RECORD differs, and a reversal
   * against a collection we had already booked is a refund nobody asked us
   * for. See `classifyPalplussStatus`.
   */
  | { kind: 'reversed'; reason: string }
  | { kind: 'unknown_reference' }
  | { kind: 'unverifiable'; reason: string };

/**
 * Re-read a row whose settlement race we lost.
 *
 * The copy read at the top of `settlePalplussRequest` is stale by now:
 * another caller has written the terminal state and, on the success path, may
 * have written the donation link too. Reporting `donationId: null` from the
 * stale copy would say "collected but not recorded" about a donation that
 * exists (`docs/162`).
 */
async function alreadySettled(id: string): Promise<PalplussSettlementOutcome> {
  const [row] = await db
    .select({
      status: palplussPaymentRequests.status,
      donationId: palplussPaymentRequests.donationId,
    })
    .from(palplussPaymentRequests)
    .where(eq(palplussPaymentRequests.id, id))
    .limit(1);

  // The row cannot vanish — we just updated it — but guessing a state is how a
  // false claim gets made, so an absent or still-pending row is unknowable.
  if (!row || row.status === 'pending') {
    return {
      kind: 'unverifiable',
      reason: 'The payment request could not be re-read after a settlement race.',
    };
  }
  return { kind: 'already_settled', status: row.status, donationId: row.donationId };
}

/**
 * Claim a request for a terminal non-success outcome.
 *
 * Conditional on `status = 'pending'`, so a callback and a concurrent poll
 * cannot both write the outcome and both notify.
 */
async function claimTerminal(
  requestId: string,
  failureReason: string,
): Promise<boolean> {
  const claimed = await db
    .update(palplussPaymentRequests)
    .set({ status: 'failed', failureReason, settledAt: new Date() })
    .where(
      and(
        eq(palplussPaymentRequests.id, requestId),
        eq(palplussPaymentRequests.status, 'pending'),
      ),
    )
    .returning({ id: palplussPaymentRequests.id });

  return claimed.length > 0;
}

/**
 * Ask Palpluss what happened to one collection, and act on it.
 *
 * @param palplussTransactionId Palpluss's own UUID. The only thing a caller is
 *        trusted with, and even that is used solely to find OUR row;
 *        everything acted upon is read from that row or from Palpluss over an
 *        authenticated call.
 */
export async function settlePalplussRequest(
  palplussTransactionId: string,
): Promise<PalplussSettlementOutcome> {
  const txId = (palplussTransactionId ?? '').trim();

  if (!txId) return { kind: 'unknown_reference' };

  const [request] = await db
    .select()
    .from(palplussPaymentRequests)
    .where(eq(palplussPaymentRequests.palplussTransactionId, txId))
    .limit(1);

  /*
    The isolation boundary. No row of ours, nothing to settle — and nothing
    asked of Palpluss, so a forged callback bearing another tenant's
    transaction id cannot even make us look it up.
  */
  if (!request) return { kind: 'unknown_reference' };

  if (request.status !== 'pending') {
    return {
      kind: 'already_settled',
      status: request.status,
      donationId: request.donationId,
    };
  }

  const status = await getTransactionStatus(request.palplussTransactionId);

  await db
    .update(palplussPaymentRequests)
    .set({ lastCheckedAt: new Date() })
    .where(eq(palplussPaymentRequests.id, request.id));

  /*
    ⛔ The RAW status, classified by a pure function. `status.status` is
    narrowed for display and cannot represent "a value we do not recognise" —
    it falls back to PENDING — so branching on it would read an unknown status
    as a genuine pending one. `docs/162` §5.1: text cannot see which way a
    branch points, so the judgement is a function a test can execute.
  */
  const outcome = classifyPalplussStatus(status.rawStatus);

  if (outcome === 'pending') return { kind: 'still_pending' };

  /*
    An unrecognised status is not money. Left pending so a later read can
    resolve it, and recorded so somebody finds out Palpluss's vocabulary grew
    rather than it being silently read as a failure.
  */
  if (outcome === 'unrecognised') {
    logError(
      new Error(
        `Palpluss returned an unrecognised status for ${txId}: ` +
          `${JSON.stringify(status.rawStatus)}`,
      ),
      { requestId: txId, route: 'palpluss/settlement#unknown-status' },
    );
    return { kind: 'still_pending' };
  }

  if (outcome === 'reversed') {
    /*
      Money moved and came back. Nothing is booked — but unlike a plain
      failure this is a movement on the service account, and if it ever
      arrives for a collection already booked it is an unrequested refund.
      Recorded at `error` rather than `info` for that reason, and the
      request's own `failure_reason` says reversal rather than
      "did not go through".
    */
    const reason =
      'Palpluss reported this collection as REVERSED: the money was taken and returned.';

    if (!(await claimTerminal(request.id, reason))) {
      return alreadySettled(request.id);
    }

    logError(new Error(`Palpluss reversal on ${txId}. ${reason}`), {
      requestId: txId,
      route: 'palpluss/settlement#reversed',
    });

    await db.insert(auditLogs).values({
      eventType: 'donation.palpluss_reversed',
      targetType: 'campaign',
      targetId: request.campaignId,
      severity: 'error',
      details: {
        palplussTransactionId: txId,
        accountReference: request.accountReference,
        amount: request.amount,
        currency: request.currency,
        resultCode: status.resultCode,
        resultDescription: status.resultDescription,
        note: 'No donation was recorded. If one already existed, this needs reconciliation.',
      },
    });

    return { kind: 'reversed', reason: 'The payment was reversed.' };
  }

  if (outcome === 'failed') {
    /*
      FAILED, CANCELLED and EXPIRED all land here. The donor-facing sentence
      does not try to say which: Safaricom's own result codes do distinguish
      them (`1032` cancelled, `1037` unreachable, `1038` no response, `1` short
      balance — all observed in `docs/180`), and `result_description` is
      recorded, but inventing a cause on a screen from a code we have not
      verified the meaning of is what `docs/160` was about.
    */
    const reason = status.resultDescription
      ? `Palpluss reported the payment as ${status.rawStatus}: ${status.resultDescription}`
      : `Palpluss reported the payment as ${status.rawStatus}.`;

    if (!(await claimTerminal(request.id, reason))) {
      return alreadySettled(request.id);
    }

    await db.insert(auditLogs).values({
      eventType: 'donation.palpluss_failed',
      targetType: 'campaign',
      targetId: request.campaignId,
      severity: 'info',
      details: {
        palplussTransactionId: txId,
        accountReference: request.accountReference,
        amount: request.amount,
        currency: request.currency,
        resultCode: status.resultCode,
        resultDescription: status.resultDescription,
      },
    });

    return { kind: 'failed', reason: 'The payment did not go through.' };
  }

  // ── SUCCESS ───────────────────────────────────────────────────────────────

  /*
    Assert the money matches what we asked for, BEFORE recording it.

    Palpluss reports `amount` in MAJOR units (KES); our row holds minor units.
    Compared charge against charge, which is why `docs/168`'s presentment
    split needed no change to this guard.

    On a shared tenant an amount mismatch is also what a foreign transaction
    would look like if a transaction id ever collided. Recorded `critical` and
    NOT booked, because the alternative is crediting a campaign with an amount
    nobody paid.
  */
  const expectedMajor = minorToMajor(request.amount, request.currency);
  if (status.amountMajor !== null && status.amountMajor !== expectedMajor) {
    logError(
      new Error(
        `Palpluss amount mismatch on ${txId}: expected ${expectedMajor} ${request.currency}, ` +
          `Palpluss reports ${status.amountMajor}. Donation NOT recorded.`,
      ),
      { requestId: txId, route: 'palpluss/settlement#amount' },
    );
    await db.insert(auditLogs).values({
      eventType: 'donation.palpluss_amount_mismatch',
      targetType: 'campaign',
      targetId: request.campaignId,
      severity: 'critical',
      details: {
        palplussTransactionId: txId,
        accountReference: request.accountReference,
        expectedMajor,
        reportedMajor: status.amountMajor,
        currency: request.currency,
        note: 'Money moved but no donation row was written. Needs manual reconciliation.',
      },
    });
    return {
      kind: 'unverifiable',
      reason: 'The amount Palpluss settled does not match the amount requested.',
    };
  }

  // Claim the request. Exactly one caller proceeds past here.
  const claimed = await db
    .update(palplussPaymentRequests)
    .set({
      status: 'succeeded',
      providerReference: status.mpesaReceipt,
      settledAt: new Date(),
    })
    .where(
      and(
        eq(palplussPaymentRequests.id, request.id),
        eq(palplussPaymentRequests.status, 'pending'),
      ),
    )
    .returning({ id: palplussPaymentRequests.id });

  if (claimed.length === 0) {
    return alreadySettled(request.id);
  }

  /*
    Namespaced, and falling back to Palpluss's transaction id when no M-Pesa
    receipt came back — a donation with no reference at all could be inserted
    twice, since the unique index is what stops a replay.
  */
  const providerRef = `${PALPLUSS_REF_PREFIX}${status.mpesaReceipt ?? txId}`;

  /*
    ⛔ The CREDIT, not the charge (docs/168).

    `request.amount`/`request.currency` are what Palpluss collected — KES,
    because that is all this rail can charge. What gets BOOKED is what the
    campaign is credited, in the campaign's own currency, and
    `recordGatewayCharge` refuses anything else: its guard compares this
    currency against `campaigns.currency` and writes a `critical`
    `donation.currency_mismatch` on a mismatch.

    The conversion is NOT recomputed here. It was quoted and recorded at
    initiation, and re-reading the rate at settlement would move the credit
    after the donor had agreed to the charge — which is why
    `payment-service.ts` still may not import an FX module at all.
  */
  await recordGatewayCharge({
    provider: 'palpluss',
    providerRef,
    amountMinor: request.creditedAmountMinor,
    currency: request.creditedCurrency,
    metadata: {
      campaignId: request.campaignId,
      donorName: request.donorName,
      donorEmail: request.donorEmail,
      donorLocation: request.donorLocation,
      message: request.message,
      isAnonymous: request.isAnonymous,
      // An STK push is a single authorised debit, not a mandate.
      isRecurring: false,
      subscribedToUpdates: request.subscribedToUpdates,
      shareLinkId: request.shareLinkId,
    },
  });

  /*
    Looked up rather than returned, because `recordGatewayCharge` deliberately
    hands back no id: it may legitimately write nothing (a replay), and a
    caller expecting an id would have to guess what a null meant.
  */
  const [donation] = await db
    .select({ id: donations.id })
    .from(donations)
    .where(eq(donations.stripePaymentId, providerRef))
    .limit(1);

  /*
    ⛔ The answer to this lookup DECIDES the outcome. In the PayHero twin it
    was read and then thrown away, and `return { kind: 'recorded' }` followed
    whether or not anything had been recorded — `docs/162`, found by reading
    the success screen for the first time.

    `recordGatewayCharge` has early returns that book nothing, the live one
    being a campaign that reached its goal while the donor was entering a PIN
    (`payment-service.ts:835`, whose own comment names that window). On that
    path it writes `donation.manual_refund_required` at CRITICAL and returns
    above both the donation transaction and the receipt.
  */
  if (!donation) {
    const reason =
      'Palpluss settled this collection and no donation row was written. ' +
      'The money is in the platform wallet and needs manual reconciliation.';

    logError(new Error(`Palpluss collected but not recorded: ${txId}. ${reason}`), {
      requestId: txId,
      route: 'palpluss/settlement#collected-unrecorded',
    });

    /*
      Written onto the row so the durable record is honest too. The request
      stays `succeeded` — the COLLECTION did succeed, and a fourth enum value
      means a migration on a live money table for a path that has never fired
      (`docs/129`). What makes the row readable is `donation_id` being null
      beside it, which is the discriminator a caller reads.
    */
    await db
      .update(palplussPaymentRequests)
      .set({ failureReason: reason })
      .where(eq(palplussPaymentRequests.id, request.id));

    return { kind: 'collected_unrecorded', reason };
  }

  await db
    .update(palplussPaymentRequests)
    .set({ donationId: donation.id })
    .where(eq(palplussPaymentRequests.id, request.id));

  return {
    kind: 'recorded',
    amountMinor: request.amount,
    currency: request.currency,
    donationId: donation.id,
  };
}
