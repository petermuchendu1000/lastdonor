/**
 * `GET /api/v1/donations/palpluss/status`, EXECUTED against a real Postgres.
 *
 * ── Why an integration test ───────────────────────────────────────────────
 *
 * Every answer this route gives is a statement about somebody's money, and
 * which one it gives depends on rows: whether a donation exists beside a
 * `succeeded` request (`docs/162`), whether the row carries a gateway id at
 * all (`docs/182` §2), and what `recordGatewayCharge` decided to book. None of
 * that is visible to a mocked database — `docs/124` §5.1 is the standing
 * reason, and `docs/107` §7 records that no route's data query is executed by
 * anything.
 *
 * Only the GATEWAY is stubbed. The validator, the lookup, the settlement, the
 * composite FK, `recordGatewayCharge` and the donation insert are all real.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

import type { TransactionSnapshot } from '@/lib/palpluss';

const getTransactionStatus = vi.fn<(id: string) => Promise<TransactionSnapshot>>();

vi.mock('@/lib/palpluss', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/palpluss')>();
  /*
    `classifyPalplussStatus` and `mintAccountReference` are deliberately NOT
    stubbed: the judgement under test is the real one, and the fixture mints
    references with the real minter so the validator sees what production
    produces.
  */
  return { ...actual, getTransactionStatus };
});

/*
  ⚠️ `payment-service.ts` imports `safeAsync` from `@/lib/api-handler`, which
  imports NextAuth -> `next/server`, which this node-environment suite CANNOT
  LOAD (`docs/126`, `docs/107`). Cutting it here is what lets the money path be
  executed at all. The stub is faithful: `safeAsync` takes an already-created
  promise and swallows its rejection.

  ⚠️ Note this is NOT the same as the route importing `next/server` itself,
  which loads fine (`docs/182` §9.1). NextAuth is the thing that cannot.
*/
vi.mock('@/lib/api-handler', () => ({
  safeAsync: (p: Promise<unknown>) => {
    void Promise.resolve(p).catch(() => {});
  },
}));

// Outside a request scope `revalidatePath` has no store to invalidate.
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { db } = await import('@/db');
const schema = await import('@/db/schema');
const { mintAccountReference } = await import('@/lib/palpluss');
const { PROMPT_LIFETIME_MS, COLLECTED_UNRECORDED_MESSAGE } = await import('@/lib/mpesa-prompt');
const { GET } = await import('./route');
const { clearDatabase } = await import('../../../../../../../test/helpers');

let seq = 0;

function txId(): string {
  seq += 1;
  return `1cbdbaca-2a6b-4e1c-84f4-${seq.toString(16).padStart(12, '0')}`;
}

function snapshot(
  id: string,
  rawStatus: string,
  over: Partial<TransactionSnapshot> = {},
): TransactionSnapshot {
  return {
    transactionId: id,
    status: 'PENDING',
    rawStatus,
    amountMajor: null,
    currency: 'KES',
    phone: '254712345678',
    accountReference: null,
    mpesaReceipt: null,
    resultCode: null,
    resultDescription: null,
    transactionFeeMajor: 0,
    ...over,
  };
}

async function seedCampaign(
  status: 'active' | 'completed' = 'active',
  currency = 'KES',
): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(schema.campaigns)
    .values({
      title: `Palpluss poll fixture ${seq}`,
      slug: `palpluss-poll-${seq}-${Date.now()}`,
      storyHtml: '<p>Lab fixture for the Palpluss status poll.</p>',
      subjectName: 'Lab Subject',
      category: 'medical',
      heroImageUrl: 'https://example.com/lab.jpg',
      goalAmount: 1_000_000,
      currency,
      status,
      publishedAt: new Date(),
    })
    .returning({ id: schema.campaigns.id });
  return row.id;
}

/** A request row in the shape the initiate route writes. */
async function seedRequest(
  campaignId: string,
  over: Partial<typeof schema.palplussPaymentRequests.$inferInsert> = {},
): Promise<{ reference: string; id: string }> {
  // The REAL minter, so the validator is exercised against production values.
  const reference = mintAccountReference();
  const [row] = await db
    .insert(schema.palplussPaymentRequests)
    .values({
      campaignId,
      palplussTransactionId: txId(),
      accountReference: reference,
      currency: 'KES',
      amount: 65_000,
      creditedAmountMinor: 65_000,
      creditedCurrency: 'KES',
      fxRateMicro: 1_000_000,
      fxMarginBps: 0,
      fxQuotedAt: new Date(),
      phoneE164: '+254712345678',
      msisdnSent: '254712345678',
      donorName: 'Asha Mutiso',
      donorEmail: 'asha@example.invalid',
      ...over,
    })
    .returning({ id: schema.palplussPaymentRequests.id });
  return { reference, id: row.id };
}

async function poll(reference: string) {
  const url = `https://lastdonor.org/api/v1/donations/palpluss/status?reference=${encodeURIComponent(reference)}`;
  const res = await GET(new NextRequest(url));
  return { res, body: await res.json() };
}

beforeEach(async () => {
  await clearDatabase();
  getTransactionStatus.mockReset();
  process.env.PALPLUSS_API_KEY = 'pp_test_integration';
});

describe('what a caller may ask about', () => {
  it('refuses anything that is not a reference we could have minted', async () => {
    for (const bad of [
      '',
      'LD-',
      'LD-TOOSHORT',
      'LD-TOOLONGVALUE',
      'LD-lowercase',
      'LD-ABCDEF01I', // 0/1/8/9 are outside base32
      'XX-ABCDEFGHJ', // wrong prefix
      '1cbdbaca-2a6b-4e1c-84f4-23e214794b6c', // ⛔ Palpluss's own id shape
    ]) {
      const { res, body } = await poll(bad);
      expect(res.status, `${bad} should be refused`).toBe(400);
      expect(body.error.field).toBe('reference');
    }
    // And nothing was asked of the gateway for any of them.
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });

  it('CONTROL: a well-formed reference gets past validation', async () => {
    /*
      Without this the rule above passes against a schema that refuses
      everything, which would take the whole rail down silently.
    */
    const { res, body } = await poll(mintAccountReference());
    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 for a reference that is ours in shape but matches no row', async () => {
    await seedRequest(await seedCampaign());
    const { res } = await poll(mintAccountReference());
    expect(res.status).toBe(404);
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });
});

describe('a row that has already settled is answered from the row', () => {
  it('reports a booked donation as succeeded, with no outbound call', async () => {
    const campaignId = await seedCampaign();
    const { reference, id } = await seedRequest(campaignId);

    const [donation] = await db
      .insert(schema.donations)
      .values({
        campaignId,
        stripePaymentId: `palpluss_LAB${Date.now()}`,
        amount: 65_000,
        currency: 'KES',
        donorName: 'Asha Mutiso',
        donorEmail: 'asha@example.invalid',
        phaseAtTime: 'first_believers',
        source: 'real',
      })
      .returning({ id: schema.donations.id });

    await db
      .update(schema.palplussPaymentRequests)
      .set({ status: 'succeeded', donationId: donation.id, settledAt: new Date() })
      .where(eq(schema.palplussPaymentRequests.id, id));

    const { res, body } = await poll(reference);
    expect(res.status).toBe(200);
    expect(body.data.state).toBe('succeeded');
    expect(body.data.keepPolling).toBe(false);
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });

  /*
    ⛔ THE `docs/162` PROPERTY, proven by execution on this rail. A
    `succeeded` row with NO donation means the gateway collected the money and
    nothing was booked. Read from `status` alone the two rows are identical,
    which is exactly how the PayHero twin came to thank a donor for a donation
    that did not exist.
  */
  it('refuses to call a settled collection a donation when none was booked', async () => {
    const { reference, id } = await seedRequest(await seedCampaign());
    await db
      .update(schema.palplussPaymentRequests)
      .set({ status: 'succeeded', donationId: null, settledAt: new Date() })
      .where(eq(schema.palplussPaymentRequests.id, id));

    const { body } = await poll(reference);
    expect(body.data.state).toBe('collected_unrecorded');
    expect(body.data.message).toBe(COLLECTED_UNRECORDED_MESSAGE);
    expect(body.data.keepPolling).toBe(false);
    // ⛔ It must not say the money is untouched: here we KNOW it moved.
    expect(body.data.message).not.toMatch(/nothing has been charged/i);
  });

  it('reports a failed row as failed, and claims the money is untouched', async () => {
    const { reference, id } = await seedRequest(await seedCampaign());
    await db
      .update(schema.palplussPaymentRequests)
      .set({ status: 'failed', failureReason: 'Palpluss reported the payment as FAILED.' })
      .where(eq(schema.palplussPaymentRequests.id, id));

    const { body } = await poll(reference);
    expect(body.data.state).toBe('failed');
    expect(body.data.message).toMatch(/nothing has been charged/i);
    expect(body.data.keepPolling).toBe(false);
  });
});

describe('what the response may contain', () => {
  /*
    ⛔ `failure_reason` is an OPERATOR field on this table. The initiate route
    writes reconciliation instructions into it (`docs/182` §3), and the
    settlement writes the gateway's own wording. None of that is for a donor,
    and the PayHero twin selects the column and reads it zero times
    (`docs/159`) — so this route does not select it at all.
  */
  it('never leaks the operator failure reason', async () => {
    const { reference, id } = await seedRequest(await seedCampaign());
    const operatorText =
      'Initiation outcome UNKNOWN: no response from Palpluss. Reconcile by matching this ' +
      "row's account_reference against external_reference in Palpluss's transaction list.";
    await db
      .update(schema.palplussPaymentRequests)
      .set({ status: 'failed', failureReason: operatorText })
      .where(eq(schema.palplussPaymentRequests.id, id));

    const { res, body } = await poll(reference);
    expect(res.status).toBe(200);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('Reconcile');
    expect(serialised).not.toContain('external_reference');
    expect(serialised).not.toContain('account_reference');
  });

  it("never leaks the gateway's transaction id", async () => {
    const campaignId = await seedCampaign();
    const gatewayId = txId();
    const { reference } = await seedRequest(campaignId, {
      palplussTransactionId: gatewayId,
      status: 'failed',
    });

    const { body } = await poll(reference);
    /*
      That id is the key to `GET /v1/transactions/{id}` on a tenant that may be
      shared with another product (`docs/180` §3). It stays server-side.
    */
    expect(JSON.stringify(body)).not.toContain(gatewayId);
  });

  it('states the CHARGE, not the credit', async () => {
    /*
      `docs/168`: a cross-currency row charges KES and credits the campaign in
      its own currency. A donor watching their prompt resolve needs the figure
      that left their account.
    */
    const campaignId = await seedCampaign('active', 'USD');
    const { reference, id } = await seedRequest(campaignId, {
      currency: 'KES',
      amount: 65_000,
      creditedCurrency: 'USD',
      creditedAmountMinor: 500,
      fxRateMicro: 130_000_000,
    });
    await db
      .update(schema.palplussPaymentRequests)
      .set({ status: 'failed' })
      .where(eq(schema.palplussPaymentRequests.id, id));

    const { body } = await poll(reference);
    expect(body.data.amount).toBe(65_000);
    expect(body.data.currency).toBe('KES');
  });
});

describe('a row with no gateway id cannot be checked', () => {
  /*
    ⛔ The state `docs/182` §2 created deliberately: the initiate route writes
    the row BEFORE calling Palpluss, so a lost response leaves everything about
    the donation except the one key the status endpoint accepts. This route is
    its first reachable caller.
  */
  it('stops the poll and claims nothing, without calling the gateway', async () => {
    const { reference } = await seedRequest(await seedCampaign(), {
      palplussTransactionId: null,
    });

    const { res, body } = await poll(reference);
    expect(res.status).toBe(200);
    expect(body.data.state).toBe('pending');
    expect(body.data.keepPolling).toBe(false);
    expect(body.data.message).toBeTruthy();

    /*
      ⛔ THE ASSERTION THAT MATTERS. `getTransactionStatus` refuses a non-UUID
      before building a URL precisely because a blank id collapses onto the
      LIST endpoint and answers HTTP 200 with another tenant's transactions
      (`docs/180` finding 1). The route must not reach it at all.
    */
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });

  it('⛔ says nothing about whether the money moved', async () => {
    const { reference } = await seedRequest(await seedCampaign(), {
      palplussTransactionId: null,
    });
    const { body } = await poll(reference);
    const msg: string = body.data.message;
    // `docs/159` §6: a push may well have been sent, and we do not know.
    expect(msg).not.toMatch(/nothing has been charged/i);
    expect(msg).not.toMatch(/did not go through/i);
    expect(msg).not.toMatch(/went through/i);
  });
});

describe('a pending row is settled through the gateway', () => {
  it('books the donation and reports success', async () => {
    const campaignId = await seedCampaign();
    const { reference, id } = await seedRequest(campaignId);
    const [row] = await db
      .select({ tx: schema.palplussPaymentRequests.palplussTransactionId })
      .from(schema.palplussPaymentRequests)
      .where(eq(schema.palplussPaymentRequests.id, id));

    getTransactionStatus.mockResolvedValue(
      snapshot(row.tx!, 'SUCCESS', { amountMajor: 650, mpesaReceipt: 'UK2JG0GO0Z' }),
    );

    const { body } = await poll(reference);
    expect(body.data.state).toBe('succeeded');
    expect(body.data.keepPolling).toBe(false);

    // The donation really exists, which is the only evidence of a booking.
    const donations = await db
      .select({ id: schema.donations.id })
      .from(schema.donations)
      .where(eq(schema.donations.campaignId, campaignId));
    expect(donations).toHaveLength(1);
  });

  it('reports a gateway failure as failed', async () => {
    const campaignId = await seedCampaign();
    const { reference, id } = await seedRequest(campaignId);
    const [row] = await db
      .select({ tx: schema.palplussPaymentRequests.palplussTransactionId })
      .from(schema.palplussPaymentRequests)
      .where(eq(schema.palplussPaymentRequests.id, id));

    getTransactionStatus.mockResolvedValue(
      snapshot(row.tx!, 'FAILED', { resultCode: '1032', resultDescription: 'Request cancelled' }),
    );

    const { body } = await poll(reference);
    expect(body.data.state).toBe('failed');
    expect(body.data.message).toMatch(/nothing has been charged/i);
    expect(body.data.keepPolling).toBe(false);
  });

  /*
    ⛔ A reversal is NOT a failure and NOT a success. `failed` would tell the
    donor "nothing has been charged" and let the client append three ordinary
    causes, none true of money that moved and came back — `docs/160`'s defect
    on a new input. `collected_unrecorded` opens "Your payment went through",
    which is also false.
  */
  it('reports a reversal as its own outcome, claiming neither', async () => {
    const campaignId = await seedCampaign();
    const { reference, id } = await seedRequest(campaignId);
    const [row] = await db
      .select({ tx: schema.palplussPaymentRequests.palplussTransactionId })
      .from(schema.palplussPaymentRequests)
      .where(eq(schema.palplussPaymentRequests.id, id));

    getTransactionStatus.mockResolvedValue(snapshot(row.tx!, 'REVERSED'));

    const { body } = await poll(reference);
    expect(body.data.state).toBe('reversed');
    expect(body.data.keepPolling).toBe(false);

    const msg: string = body.data.message;
    expect(msg).not.toMatch(/nothing has been charged/i);
    expect(msg).not.toMatch(/went through/i);
    expect(msg).not.toMatch(/did not go through/i);
    /*
      ⚠️ The positive half is a PROPERTY, not the wording: a reversal must not
      be told in the same words as either outcome it is not. Pinning the
      sentence itself would fail on correct code the first time somebody
      improved it — `docs/160` §5.2, and `docs/163` §5.2 where exactly that
      happened to me minutes after reading it. The loose match is a floor, not
      the assertion.
    */
    expect(msg).toBeTruthy();
    expect(msg).not.toBe(COLLECTED_UNRECORDED_MESSAGE);
    expect(msg).toMatch(/sent back|returned|came back|reversed|refund/i);

    // Nothing was booked.
    const donations = await db.select().from(schema.donations);
    expect(donations).toHaveLength(0);
  });

  /*
    ⛔ `docs/160`: an outcome we cannot establish is reported as `pending` with
    the poll stopped, never as `failed`. On the amount-mismatch path the
    platform's own audit row reads "Money moved but no donation row was
    written", so a "nothing has been charged" there would be addressed to
    somebody whose balance had just been debited.
  */
  it('reports an unverifiable outcome as pending, and stops the poll', async () => {
    const campaignId = await seedCampaign();
    const { reference, id } = await seedRequest(campaignId);
    const [row] = await db
      .select({ tx: schema.palplussPaymentRequests.palplussTransactionId })
      .from(schema.palplussPaymentRequests)
      .where(eq(schema.palplussPaymentRequests.id, id));

    // SUCCESS for an amount that is not the one we asked for.
    getTransactionStatus.mockResolvedValue(snapshot(row.tx!, 'SUCCESS', { amountMajor: 9_000_000 }));

    const { body } = await poll(reference);
    expect(body.data.state).toBe('pending');
    expect(body.data.keepPolling).toBe(false);
    expect(body.data.message).not.toMatch(/nothing has been charged/i);
    expect(body.data.message).not.toMatch(/did not go through/i);

    // And no donation was booked on a figure we could not verify.
    expect(await db.select().from(schema.donations)).toHaveLength(0);

    // The critical audit row is what gets a human to look.
    const audits = await db.select().from(schema.auditLogs);
    expect(audits.some((a) => a.eventType === 'donation.palpluss_amount_mismatch')).toBe(true);
  });

  it('keeps the poll alive while the prompt could still be answered', async () => {
    const campaignId = await seedCampaign();
    const { reference, id } = await seedRequest(campaignId);
    const [row] = await db
      .select({ tx: schema.palplussPaymentRequests.palplussTransactionId })
      .from(schema.palplussPaymentRequests)
      .where(eq(schema.palplussPaymentRequests.id, id));

    getTransactionStatus.mockResolvedValue(snapshot(row.tx!, 'PENDING'));

    const { body } = await poll(reference);
    expect(body.data.state).toBe('pending');
    expect(body.data.keepPolling).toBe(true);
    expect(body.data.message).toBeNull();
  });

  /*
    ⛔ `docs/159`: the poll must stop. The row stays `pending` rather than
    being marked failed — a prompt we never heard about is not a prompt known
    to have failed, and Palpluss may still settle it.
  */
  it('stops the poll once the prompt can no longer be live', async () => {
    const campaignId = await seedCampaign();
    const { reference, id } = await seedRequest(campaignId, {
      createdAt: new Date(Date.now() - PROMPT_LIFETIME_MS - 60_000),
    });
    const [row] = await db
      .select({
        tx: schema.palplussPaymentRequests.palplussTransactionId,
        status: schema.palplussPaymentRequests.status,
      })
      .from(schema.palplussPaymentRequests)
      .where(eq(schema.palplussPaymentRequests.id, id));

    getTransactionStatus.mockResolvedValue(snapshot(row.tx!, 'PENDING'));

    const { body } = await poll(reference);
    expect(body.data.state).toBe('pending');
    expect(body.data.keepPolling).toBe(false);
    /*
      ⚠️ The PROPERTY, not the sentence: the donor must be told something
      (the fresh-prompt case sends `null`, so a non-null message is what
      distinguishes a stopped poll from a live one) and it must claim neither
      outcome. The earlier version of this row matched `/not heard back/i`,
      which would have failed on any rewording of correct copy.

      ⚠️ AND `/went through/` IS DELIBERATELY ABSENT HERE, unlike the reversal
      row above. My first attempt forbade it and FAILED ON CORRECT CODE: this
      message reads *"If your phone says it went through, email support"* — a
      CONDITIONAL, which is the platform declining to claim an outcome, and a
      phrase match cannot tell that from an assertion of one. `docs/152`'s
      "the qualifier must precede the claim" and `docs/140`'s date rule are
      the same shape. On the reversal message the phrase would be a bare
      claim, with no reason for a conditional, so it stays forbidden there.
    */
    expect(body.data.message).toBeTruthy();
    expect(body.data.message).not.toMatch(/nothing has been charged/i);
    expect(body.data.message).not.toMatch(/did not go through/i);

    // The row is untouched: an expired poll is not evidence about the payment.
    const [after] = await db
      .select({ status: schema.palplussPaymentRequests.status })
      .from(schema.palplussPaymentRequests)
      .where(eq(schema.palplussPaymentRequests.id, id));
    expect(after.status).toBe('pending');
  });
});
