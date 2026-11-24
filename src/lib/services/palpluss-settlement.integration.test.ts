/**
 * Settling a Palpluss collection, executed against a real Postgres.
 *
 * ── WHY THIS IS AN INTEGRATION TEST ────────────────────────────────────────
 *
 * `settlePalplussRequest` returns `{ kind: 'recorded' }` and a caller turns
 * that into "Thank you — your donation is in". Whether a donation row was
 * ACTUALLY written is decided inside `recordGatewayCharge`, which has early
 * returns that write none — and the only way to see which of those fired is
 * to run the whole thing against a database. A mock cannot refuse an insert
 * for a reason of its own, cannot raise a foreign-key violation, and cannot
 * lose a race (`docs/124` §5.1, `docs/130`).
 *
 * Only the GATEWAY is stubbed. Postgres is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import type { TransactionSnapshot } from '@/lib/palpluss';

const getTransactionStatus = vi.fn<(id: string) => Promise<TransactionSnapshot>>();

vi.mock('@/lib/palpluss', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/palpluss')>();
  // `classifyPalplussStatus` is deliberately NOT stubbed: the judgement under
  // test is the real one.
  return { ...actual, getTransactionStatus };
});

/*
  ⚠️ `payment-service.ts` imports `safeAsync` from `@/lib/api-handler`, which
  imports NextAuth -> `next/server`, which this node-environment suite CANNOT
  LOAD (`docs/126`, `docs/107`). Cutting it here is what lets the money path
  be executed at all. The stub is faithful: `safeAsync` takes an
  already-created promise and swallows its rejection.
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
const { settlePalplussRequest, PALPLUSS_REF_PREFIX } = await import(
  '@/lib/services/palpluss-settlement'
);
const { clearDatabase } = await import('../../../test/helpers');

let seq = 0;

/** A valid-looking Palpluss transaction uuid. */
function txId(): string {
  seq += 1;
  const tail = seq.toString(16).padStart(12, '0');
  return `1cbdbaca-2a6b-4e1c-84f4-${tail}`;
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

async function seedCampaign(status: 'active' | 'completed', currency = 'KES') {
  seq += 1;
  const [row] = await db
    .insert(schema.campaigns)
    .values({
      title: `Palpluss settlement fixture ${seq}`,
      slug: `palpluss-fixture-${seq}-${Date.now()}`,
      storyHtml: '<p>Lab fixture for the Palpluss settlement walk.</p>',
      subjectName: 'Lab Subject',
      category: 'medical',
      heroImageUrl: 'https://example.com/lab.jpg',
      goalAmount: 100_000,
      currency,
      status,
      publishedAt: new Date(),
    })
    .returning({ id: schema.campaigns.id });
  return row.id;
}

async function seedRequest(
  campaignId: string,
  amountMinor: number,
  over: Partial<typeof schema.palplussPaymentRequests.$inferInsert> = {},
) {
  const id = txId();
  seq += 1;
  const [row] = await db
    .insert(schema.palplussPaymentRequests)
    .values({
      campaignId,
      palplussTransactionId: id,
      accountReference: `LD-${seq.toString().padStart(6, '0')}`,
      // Same-currency: a KES campaign charged in KES, rate 1, no margin.
      currency: 'KES',
      amount: amountMinor,
      creditedAmountMinor: amountMinor,
      creditedCurrency: 'KES',
      fxRateMicro: 1_000_000,
      fxMarginBps: 0,
      fxQuotedAt: new Date(),
      phoneE164: '+254712345678',
      msisdnSent: '254712345678',
      channelId: '4e0750fe-f851-49d9-a888-ea98bea29878',
      donorEmail: 'lab-donor@example.com',
      donorName: 'Lab Donor',
      status: 'pending',
      ...over,
    })
    .returning({ id: schema.palplussPaymentRequests.id });
  return { rowId: row.id, txId: id };
}

async function readRequest(rowId: string) {
  const [row] = await db
    .select()
    .from(schema.palplussPaymentRequests)
    .where(eq(schema.palplussPaymentRequests.id, rowId))
    .limit(1);
  return row;
}

async function auditRows(eventType: string) {
  return db.select().from(schema.auditLogs).where(eq(schema.auditLogs.eventType, eventType));
}

describe('settling a Palpluss collection against a real database', () => {
  beforeEach(async () => {
    await clearDatabase();
    getTransactionStatus.mockReset();
  });

  // ── The success path, and its control ──────────────────────────────────────

  it('CONTROL: an active campaign records a donation and the request carries its id', async () => {
    const campaignId = await seedCampaign('active');
    const { rowId, txId: id } = await seedRequest(campaignId, 5_000); // KES 50.00
    getTransactionStatus.mockResolvedValue(
      snapshot(id, 'SUCCESS', { amountMajor: 50, mpesaReceipt: 'UK2JG0GO0Z' }),
    );

    const outcome = await settlePalplussRequest(id);

    expect(outcome.kind).toBe('recorded');

    const donationRows = await db
      .select()
      .from(schema.donations)
      .where(eq(schema.donations.campaignId, campaignId));
    expect(donationRows).toHaveLength(1);
    expect(donationRows[0].amount).toBe(5_000);
    expect(donationRows[0].currency).toBe('KES');
    // The provider is read before any gateway API is called, so it must be ours.
    expect(donationRows[0].provider).toBe('palpluss');
    // Namespaced, so two rails cannot collide in the only replay guard there is.
    expect(donationRows[0].stripePaymentId).toBe(`${PALPLUSS_REF_PREFIX}UK2JG0GO0Z`);

    const row = await readRequest(rowId);
    expect(row.status).toBe('succeeded');
    expect(row.providerReference).toBe('UK2JG0GO0Z');
    expect(row.donationId).toBe(donationRows[0].id);
    expect(row.settledAt).not.toBeNull();
    expect(row.failureReason).toBeNull();
    if (outcome.kind === 'recorded') expect(outcome.donationId).toBe(donationRows[0].id);
  });

  /*
    ⛔ CROSS-CURRENCY, and it is the row that makes `docs/168`'s split
    testable at all.

    Every other fixture here is same-currency (a KES campaign charged in KES),
    where charge and credit are the same number — so an injection swapping
    `creditedAmountMinor`/`creditedCurrency` for `amount`/`currency` changed
    nothing and PASSED. That hole was found by injection, not by reading.

    These are the real figures from `docs/168`'s first live cross-currency
    donation: a donor charged KES 650.00, a USD campaign credited $5.00, at
    ~130 KES per USD.
  */
  it('books the CREDIT in the campaign currency, not the CHARGE', async () => {
    const campaignId = await seedCampaign('active', 'USD');
    const { rowId, txId: id } = await seedRequest(campaignId, 65_000, {
      currency: 'KES', // the CHARGE: KES 650.00
      amount: 65_000,
      creditedCurrency: 'USD', // the CREDIT: $5.00
      creditedAmountMinor: 500,
      fxRateMicro: 130_000_000,
    });
    // Palpluss reports the CHARGE it collected, in major units.
    getTransactionStatus.mockResolvedValue(
      snapshot(id, 'SUCCESS', { amountMajor: 650, mpesaReceipt: 'UK2JG0GO0Z' }),
    );

    const outcome = await settlePalplussRequest(id);

    expect(outcome.kind).toBe('recorded');

    const [donation] = await db.select().from(schema.donations);
    // ⛔ $5.00 USD, not KES 65,000 minor. Booking the charge against a USD
    // campaign is refused by `recordGatewayCharge`'s currency guard, so the
    // swap shows up as `collected_unrecorded` and no donation at all.
    expect(donation.amount).toBe(500);
    expect(donation.currency).toBe('USD');

    // The amount guard compared CHARGE against CHARGE, which is why it needed
    // no change when the split landed.
    expect((await readRequest(rowId)).status).toBe('succeeded');
  });

  it('falls back to the transaction id when no M-Pesa receipt comes back', async () => {
    // A donation with no provider reference at all could be inserted twice.
    const campaignId = await seedCampaign('active');
    const { txId: id } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(
      snapshot(id, 'SUCCESS', { amountMajor: 50, mpesaReceipt: null }),
    );

    await settlePalplussRequest(id);

    const [donation] = await db.select().from(schema.donations);
    expect(donation.stripePaymentId).toBe(`${PALPLUSS_REF_PREFIX}${id}`);
  });

  /*
    ⛔ `docs/162`'s defect, in the twin. `recordGatewayCharge` books nothing
    when the campaign has COMPLETED - which it can do while the donor is
    entering a PIN - and returns above both the donation transaction and the
    receipt, writing `donation.manual_refund_required` at CRITICAL. The
    PayHero version returned `recorded` anyway and the donor was thanked.
  */
  it('reports collected_unrecorded when the charge settles and nothing is booked', async () => {
    const campaignId = await seedCampaign('completed');
    const { rowId, txId: id } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(
      snapshot(id, 'SUCCESS', { amountMajor: 50, mpesaReceipt: 'UK2JG0GO0Z' }),
    );

    const outcome = await settlePalplussRequest(id);

    expect(outcome.kind).toBe('collected_unrecorded');
    expect(outcome.kind).not.toBe('recorded');

    // No donation, and the row says so durably.
    expect(await db.select().from(schema.donations)).toHaveLength(0);
    const row = await readRequest(rowId);
    expect(row.status).toBe('succeeded'); // the COLLECTION did succeed
    expect(row.donationId).toBeNull(); // the discriminator
    expect(row.failureReason).toMatch(/no donation row was written/i);
  });

  // ── Non-success terminal states ───────────────────────────────────────────

  it.each(['FAILED', 'CANCELLED', 'EXPIRED'])(
    '%s settles as failed, books nothing, and records an info audit row',
    async (raw) => {
      const campaignId = await seedCampaign('active');
      const { rowId, txId: id } = await seedRequest(campaignId, 5_000);
      getTransactionStatus.mockResolvedValue(
        snapshot(id, raw, { resultCode: '1032', resultDescription: 'Request Cancelled by user.' }),
      );

      const outcome = await settlePalplussRequest(id);

      expect(outcome.kind).toBe('failed');
      expect(await db.select().from(schema.donations)).toHaveLength(0);

      const row = await readRequest(rowId);
      expect(row.status).toBe('failed');
      expect(row.settledAt).not.toBeNull();
      // Palpluss's own words are kept; the donor-facing sentence invents nothing.
      expect(row.failureReason).toContain(raw);

      expect(await auditRows('donation.palpluss_failed')).toHaveLength(1);
    },
  );

  /*
    REVERSED is NOT folded into failed. Money moved and came back, which is a
    movement on the service account - so it gets its own audit event at
    `error`, where a plain failure is `info`.
  */
  it('REVERSED is recorded separately and at a higher severity than a failure', async () => {
    const campaignId = await seedCampaign('active');
    const { rowId, txId: id } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(snapshot(id, 'REVERSED', { amountMajor: 50 }));

    const outcome = await settlePalplussRequest(id);

    expect(outcome.kind).toBe('reversed');
    expect(await db.select().from(schema.donations)).toHaveLength(0);

    const reversals = await auditRows('donation.palpluss_reversed');
    expect(reversals).toHaveLength(1);
    expect(reversals[0].severity).toBe('error');
    // And it did NOT take the plain-failure path.
    expect(await auditRows('donation.palpluss_failed')).toHaveLength(0);

    const row = await readRequest(rowId);
    expect(row.failureReason).toMatch(/reversed/i);
  });

  // ── Not over, and not knowable ────────────────────────────────────────────

  it.each(['PENDING', 'PROCESSING'])('%s leaves the row pending and books nothing', async (raw) => {
    const campaignId = await seedCampaign('active');
    const { rowId, txId: id } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(snapshot(id, raw));

    expect((await settlePalplussRequest(id)).kind).toBe('still_pending');

    const row = await readRequest(rowId);
    expect(row.status).toBe('pending');
    expect(row.settledAt).toBeNull();
    // The check itself is recorded, so a poll loop can see progress.
    expect(row.lastCheckedAt).not.toBeNull();
  });

  /*
    ⛔ An unrecognised status is NOT a failure. Reading it as one would mark a
    payment dead on the day Palpluss adds a value - and the row stays pending
    so a later read can still resolve it.
  */
  it('an unrecognised status leaves the row pending rather than failing it', async () => {
    const campaignId = await seedCampaign('active');
    const { rowId, txId: id } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(snapshot(id, 'SETTLED_SOMEHOW'));

    expect((await settlePalplussRequest(id)).kind).toBe('still_pending');

    const row = await readRequest(rowId);
    expect(row.status).toBe('pending');
    expect(await db.select().from(schema.donations)).toHaveLength(0);
    expect(await auditRows('donation.palpluss_failed')).toHaveLength(0);
  });

  /*
    The amount guard, which compares CHARGE against CHARGE and so needed no
    change when `docs/168` split presentment from settlement.
  */
  it('an amount mismatch books nothing and records a critical audit row', async () => {
    const campaignId = await seedCampaign('active');
    const { rowId, txId: id } = await seedRequest(campaignId, 5_000); // expects KES 50
    getTransactionStatus.mockResolvedValue(
      snapshot(id, 'SUCCESS', { amountMajor: 9_000_000, mpesaReceipt: 'FORGED' }),
    );

    const outcome = await settlePalplussRequest(id);

    expect(outcome.kind).toBe('unverifiable');
    expect(await db.select().from(schema.donations)).toHaveLength(0);

    const mismatches = await auditRows('donation.palpluss_amount_mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe('critical');

    // Still pending: nothing was established, so nothing is closed.
    expect((await readRequest(rowId)).status).toBe('pending');
  });

  it('a null reported amount is not treated as a mismatch', async () => {
    // The guard only fires when Palpluss actually reported a figure.
    const campaignId = await seedCampaign('active');
    const { txId: id } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(
      snapshot(id, 'SUCCESS', { amountMajor: null, mpesaReceipt: 'UK2JG0GO0Z' }),
    );

    expect((await settlePalplussRequest(id)).kind).toBe('recorded');
  });

  // ── The isolation boundary ────────────────────────────────────────────────

  /*
    The tenant is shared with two other products (`docs/180` §3). A
    transaction id that is not ours must be refused BEFORE any network call,
    or a forged callback could make us look up a stranger's payment.
  */
  it('a transaction id that is not ours is refused without asking Palpluss', async () => {
    const outcome = await settlePalplussRequest('ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(outcome.kind).toBe('unknown_reference');
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('a blank id (%p) is refused without asking Palpluss', async (id) => {
    expect((await settlePalplussRequest(id)).kind).toBe('unknown_reference');
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });

  // ── Replay and races ──────────────────────────────────────────────────────

  it('a settled request reports already_settled and carries its donation id', async () => {
    const campaignId = await seedCampaign('active');
    const { txId: id } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(
      snapshot(id, 'SUCCESS', { amountMajor: 50, mpesaReceipt: 'UK2JG0GO0Z' }),
    );

    await settlePalplussRequest(id);
    getTransactionStatus.mockClear();

    const again = await settlePalplussRequest(id);

    expect(again.kind).toBe('already_settled');
    if (again.kind === 'already_settled') {
      expect(again.status).toBe('succeeded');
      // ⛔ Not null: a caller cannot tell recorded from unrecorded otherwise.
      expect(again.donationId).not.toBeNull();
    }
    // No second lookup, and crucially no second donation.
    expect(getTransactionStatus).not.toHaveBeenCalled();
    expect(await db.select().from(schema.donations)).toHaveLength(1);
  });

  /*
    The callback and the donor's poll race by design. Of two concurrent
    settlements exactly one may book a donation - a mock cannot demonstrate
    this, which is the whole reason this file exists.
  */
  it('two concurrent settlements record exactly one donation', async () => {
    const campaignId = await seedCampaign('active');
    const { txId: id } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(
      snapshot(id, 'SUCCESS', { amountMajor: 50, mpesaReceipt: 'UK2JG0GO0Z' }),
    );

    const [a, b] = await Promise.all([
      settlePalplussRequest(id),
      settlePalplussRequest(id),
    ]);

    expect(await db.select().from(schema.donations)).toHaveLength(1);

    // Exactly one of them may claim to have recorded it.
    const kinds = [a.kind, b.kind].sort();
    expect(kinds.filter((k) => k === 'recorded')).toHaveLength(1);
  });

  /*
    ⛔ THE LOST-RACE PATH, forced deterministically.

    `alreadySettled()` is reached only when a competing caller claims the row
    while we are awaiting the status read — and the two-concurrent-callers
    test above does not reliably produce it, so an injection that returned the
    STALE local `request.donationId` instead of re-reading PASSED. Found by
    injection, not by reading.

    The window is real: `request` was read when the row was still pending, so
    its `donationId` is null by definition. Reporting that would say
    "collected but not recorded" about a donation that exists — which is
    exactly `docs/162`'s false claim, in the opposite direction.

    Forced by having the gateway stub do what the winner would have done,
    which is precisely when it happens in production.
  */
  it('a settlement that loses the race reports the WINNER\'s donation id', async () => {
    const campaignId = await seedCampaign('active');
    const { rowId, txId: id } = await seedRequest(campaignId, 5_000);

    let winnerDonationId: string | null = null;

    getTransactionStatus.mockImplementation(async () => {
      // Runs between our pending read and our claim: the competing caller
      // settles the row and links its donation.
      if (!winnerDonationId) {
        const [d] = await db
          .insert(schema.donations)
          .values({
            campaignId,
            stripePaymentId: `palpluss_WINNER_${id}`,
            amount: 5_000,
            currency: 'KES',
            donorEmail: 'winner@example.com',
            // ⚠️ Read out of the live `donation_phase` enum, not invented. My
            // first attempt wrote 'active' and Postgres refused it —
            // `docs/128` §6's class, where a fixture's made-up value read as
            // a defect in the code under test.
            phaseAtTime: 'first_believers',
            provider: 'palpluss',
          })
          .returning({ id: schema.donations.id });
        winnerDonationId = d.id;
        await db
          .update(schema.palplussPaymentRequests)
          .set({ status: 'succeeded', donationId: d.id, settledAt: new Date() })
          .where(eq(schema.palplussPaymentRequests.id, rowId));
      }
      return snapshot(id, 'SUCCESS', { amountMajor: 50, mpesaReceipt: 'UK2JG0GO0Z' });
    });

    const outcome = await settlePalplussRequest(id);

    expect(outcome.kind).toBe('already_settled');
    if (outcome.kind === 'already_settled') {
      expect(outcome.status).toBe('succeeded');
      // ⛔ The winner's id, read fresh — not the null we were holding.
      expect(outcome.donationId).toBe(winnerDonationId);
      expect(outcome.donationId).not.toBeNull();
    }

    // And the loser booked nothing of its own.
    expect(await db.select().from(schema.donations)).toHaveLength(1);
  });

  it('two concurrent failures write one audit row', async () => {
    const campaignId = await seedCampaign('active');
    const { txId: id } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(snapshot(id, 'FAILED'));

    await Promise.all([settlePalplussRequest(id), settlePalplussRequest(id)]);

    expect(await auditRows('donation.palpluss_failed')).toHaveLength(1);
  });

  // ── Database guarantees, which only a database can demonstrate ────────────

  /*
    `docs/92`'s invariant, moved to the credit column by `docs/168`: a
    campaign is only ever CREDITED in its own currency. A mock cannot raise
    this; the composite FK can.
  */
  it('the composite FK refuses a credit in a currency the campaign does not raise in', async () => {
    const campaignId = await seedCampaign('active', 'KES');
    await expect(
      seedRequest(campaignId, 5_000, { creditedCurrency: 'USD' }),
    ).rejects.toThrow();
  });

  it('the unique index refuses a second row for one Palpluss transaction', async () => {
    const campaignId = await seedCampaign('active');
    const { txId: id } = await seedRequest(campaignId, 5_000);
    await expect(
      seedRequest(campaignId, 5_000, { palplussTransactionId: id }),
    ).rejects.toThrow();
  });

  /*
    The fixture-cleanup class `docs/121`, `docs/123`, `docs/139` and
    `docs/157` each met. `clearDatabase` does not NAME this table - it relies
    on `TRUNCATE campaigns ... CASCADE` reaching it through the FK. That is
    reasoning, so it is checked.
  */
  it('clearDatabase really does empty this table', async () => {
    const campaignId = await seedCampaign('active');
    await seedRequest(campaignId, 5_000);
    expect(await db.select().from(schema.palplussPaymentRequests)).not.toHaveLength(0);

    await clearDatabase();

    expect(await db.select().from(schema.palplussPaymentRequests)).toHaveLength(0);
  });
});
