/**
 * Turning a PayHero outcome into a donation.
 *
 * The three properties these tests exist to hold:
 *
 *  1. **The callback body is never believed.** PayHero signs its callbacks
 *     with nothing, so a POST claiming `Status: "Success"` is unauthenticated
 *     input. The outcome always comes from an authenticated status read.
 *  2. **Only references this platform minted are acted on.** The PayHero
 *     account is shared with BETWOIN LTD; their traffic and any forgery must
 *     resolve to nothing.
 *  3. **Settling is single-shot.** The callback and the donor's own poll race
 *     routinely, and exactly one of them may record a donation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';
const REF = 'LD-22222222-2222-4222-8222-222222222222';

type Row = Record<string, unknown>;

const world: {
  request: Row | null;
  updates: Row[];
  audits: Row[];
  recorded: Row[];
  /** Simulates another caller winning the claim first. */
  claimLoses: boolean;
  /**
   * The row as the race WINNER left it, answered to the re-read in
   * `alreadySettled`. Defaults to a settled-and-recorded collection, which is
   * the ordinary outcome of losing a race.
   */
  rowAfterRace: Row;
} = {
  request: null,
  updates: [],
  audits: [],
  recorded: [],
  claimLoses: false,
  rowAfterRace: { status: 'succeeded', donationId: 'donation-xyz' },
};

const getTransactionStatus = vi.fn();

vi.mock('@/lib/payhero', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payhero')>();
  return {
    ...actual,
    getTransactionStatus: (...a: unknown[]) => getTransactionStatus(...a),
  };
});

const recordGatewayCharge = vi.fn(async (charge: Row) => {
  world.recorded.push(charge);
});
vi.mock('@/lib/services/payment-service', () => ({
  recordGatewayCharge: (c: Row) => recordGatewayCharge(c),
}));

vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));

vi.mock('@/db', () => {
  const db = {
    /*
      `db.select()` with NO argument is the full-row read of the collection
      request; `db.select({ id })` is the donation lookback afterwards. The
      no-argument call is why this cannot just index into `cols`.
    */
    select: (cols?: Row) =>
      ({
        from: () => ({
          where: () => ({
            limit: () => {
              const keys = cols == null ? [] : Object.keys(cols);
              const isDonationLookback = keys.length === 1 && 'id' in cols!;
              if (isDonationLookback) return Promise.resolve([{ id: 'donation-xyz' }]);
              /*
                The re-read after losing a settlement race (`docs/162`). It
                must answer the row as the WINNER left it, not the stale copy
                this mock holds in `world.request` - the whole reason the
                re-read exists is that another transaction changed it.

                ⚠️ A mock cannot represent that by itself, which is why the
                real behaviour is covered in
                `payhero-settlement.integration.test.ts` against Postgres
                (`docs/124` §5.1). This branch only keeps the SHAPE honest.
              */
              if (keys.length === 2 && 'status' in cols! && 'donationId' in cols!) {
                return Promise.resolve([world.rowAfterRace]);
              }
              return Promise.resolve(world.request ? [world.request] : []);
            },
          }),
        }),
      }) as unknown,
    update: () => ({
      set: (values: Row) => {
        world.updates.push(values);
        return {
          where: () => ({
            returning: () => Promise.resolve(world.claimLoses ? [] : [{ id: 'req-1' }]),
            then: (r: (v: unknown) => unknown) => Promise.resolve([]).then(r),
          }),
        };
      },
    }),
    insert: () => ({
      values: (values: Row) => {
        world.audits.push(values);
        return { then: (r: (v: unknown) => unknown) => Promise.resolve([]).then(r) };
      },
    }),
  };
  return { db };
});

const { settlePayHeroRequest, PAYHERO_REF_PREFIX } = await import('./payhero-settlement');

function pendingRequest(overrides: Row = {}): Row {
  return {
    id: 'req-1',
    externalReference: REF,
    payheroReference: 'E8UWT7CLUW',
    campaignId: CAMPAIGN_ID,
    currency: 'KES',
    amount: 5_000, // KES 50.00
    status: 'pending',
    donorName: 'Wanjiku',
    donorEmail: 'wanjiku@example.com',
    donorLocation: null,
    message: null,
    isAnonymous: false,
    subscribedToUpdates: false,
    shareLinkId: null,
    ...overrides,
  };
}

/** PayHero's status payload, shaped exactly as the live API returns it. */
function status(overrides: Row = {}) {
  return {
    status: 'SUCCESS',
    amountMajor: 50,
    providerReference: 'SKQ96C7K7H',
    externalReference: REF,
    phoneNumber: '0713572703',
    merchant: 'muchs',
    raw: { status: 'SUCCESS' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  world.request = pendingRequest();
  world.updates = [];
  world.audits = [];
  world.recorded = [];
  world.claimLoses = false;
  world.rowAfterRace = { status: 'succeeded', donationId: 'donation-xyz' };
  getTransactionStatus.mockResolvedValue(status());
});

// ─── Isolation from BETWOIN LTD ─────────────────────────────────────────────

describe('only references this platform minted are acted on', () => {
  it('refuses a reference outside the LastDonor namespace before any lookup', async () => {
    // BETWOIN's own references look like plain UUIDs or invoice numbers.
    for (const foreign of ['INV-009', '93d84052-35d9-48b9-a532-fbc88c7e2647', 'BETWOIN-1']) {
      expect(await settlePayHeroRequest(foreign)).toEqual({ kind: 'unknown_reference' });
    }
    // The decisive assertion: PayHero was never asked about someone else's
    // payment, so the shared account cannot be probed through this route.
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });

  it('refuses an empty reference', async () => {
    expect(await settlePayHeroRequest('')).toEqual({ kind: 'unknown_reference' });
    expect(await settlePayHeroRequest('   ')).toEqual({ kind: 'unknown_reference' });
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });

  it('refuses a well-formed reference with no row of ours', async () => {
    world.request = null;
    expect(await settlePayHeroRequest(REF)).toEqual({ kind: 'unknown_reference' });
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });
});

// ─── The body is never believed ─────────────────────────────────────────────

describe('the outcome comes from an authenticated read, not from a caller', () => {
  it('asks PayHero using PayHero’s reference, never our own', async () => {
    await settlePayHeroRequest(REF);

    // Our external_reference 404s at the status endpoint (probed), so asking
    // with it would make every settlement fail.
    expect(getTransactionStatus).toHaveBeenCalledWith('E8UWT7CLUW');
    expect(getTransactionStatus).not.toHaveBeenCalledWith(REF);
  });

  it('records a donation only when PayHero says SUCCESS', async () => {
    const result = await settlePayHeroRequest(REF);

    expect(result).toEqual({
      kind: 'recorded',
      amountMinor: 5_000,
      currency: 'KES',
      // docs/162: carried so the status route has ONE place that answers a
      // thank-you, and that place always reads a donation link.
      donationId: 'donation-xyz',
    });
    expect(world.recorded).toHaveLength(1);
    expect(world.recorded[0]).toMatchObject({
      provider: 'payhero',
      amountMinor: 5_000,
      currency: 'KES',
    });
  });

  /*
   * `success: true` is about the API call, not the payment. Observed live:
   * success true alongside status FAILED. A client reading `success` books
   * failed payments as paid.
   */
  it('does not record a donation when status is FAILED, whatever `success` said', async () => {
    getTransactionStatus.mockResolvedValue(
      status({ status: 'FAILED', raw: { success: true, status: 'FAILED' } }),
    );

    const result = await settlePayHeroRequest(REF);

    expect(result.kind).toBe('failed');
    expect(world.recorded).toHaveLength(0);
    expect(world.updates.some((u) => u.status === 'failed')).toBe(true);
  });

  it('leaves it pending while PayHero still says QUEUED', async () => {
    getTransactionStatus.mockResolvedValue(status({ status: 'QUEUED' }));

    expect(await settlePayHeroRequest(REF)).toEqual({ kind: 'still_pending' });
    expect(world.recorded).toHaveLength(0);
  });

  /*
   * If PayHero adds PARTIAL or REVERSED tomorrow, it must not be read as
   * money. Left pending so a later check can resolve it.
   */
  it('treats an undocumented status as pending, never as money', async () => {
    getTransactionStatus.mockResolvedValue(
      status({ status: 'UNKNOWN', raw: { status: 'REVERSED' } }),
    );

    expect(await settlePayHeroRequest(REF)).toEqual({ kind: 'still_pending' });
    expect(world.recorded).toHaveLength(0);
    expect(world.updates.some((u) => u.status === 'succeeded')).toBe(false);
  });
});

// ─── The amount must match what we asked for ────────────────────────────────

describe('amount verification', () => {
  /*
   * PayHero reports major units; our row holds minor. A disagreement is not
   * something to resolve by trusting either number: on an account shared with
   * another company, a mismatch is also what a reference collision would look
   * like. Not booked, and written down at critical.
   */
  it('refuses to record a settlement for a different amount', async () => {
    getTransactionStatus.mockResolvedValue(status({ amountMajor: 5 })); // KES 5, not 50

    const result = await settlePayHeroRequest(REF);

    expect(result.kind).toBe('unverifiable');
    expect(world.recorded).toHaveLength(0);

    const flagged = world.audits.find(
      (a) => a.eventType === 'donation.payhero_amount_mismatch',
    );
    expect(flagged).toBeDefined();
    expect(flagged!.severity).toBe('critical');
    expect(flagged!.details).toMatchObject({
      expectedMajor: 50,
      reportedMajor: 5,
      currency: 'KES',
    });
  });

  it('accepts a settlement whose amount matches', async () => {
    getTransactionStatus.mockResolvedValue(status({ amountMajor: 50 }));
    expect((await settlePayHeroRequest(REF)).kind).toBe('recorded');
  });

  it('records it when PayHero reports no amount at all', async () => {
    // Absent is not the same as different. Our own row is authoritative for
    // what was requested and the claim is what makes it single-shot.
    getTransactionStatus.mockResolvedValue(status({ amountMajor: null }));
    expect((await settlePayHeroRequest(REF)).kind).toBe('recorded');
  });
});

// ─── Single-shot settling ───────────────────────────────────────────────────

describe('the callback and the donor’s poll race', () => {
  it('reports already_settled when another caller won the claim', async () => {
    world.claimLoses = true;

    const result = await settlePayHeroRequest(REF);

    expect(result).toEqual({
      kind: 'already_settled',
      status: 'succeeded',
      // docs/162: re-read from the row the winner left, not the stale copy.
      donationId: 'donation-xyz',
    });
    // The decisive assertion: the loser records nothing, so a campaign
    // cannot be credited twice for one M-Pesa payment.
    expect(world.recorded).toHaveLength(0);
  });

  it('reports already_settled without asking PayHero when the row is done', async () => {
    world.request = pendingRequest({ status: 'succeeded' });

    expect(await settlePayHeroRequest(REF)).toEqual({
      kind: 'already_settled',
      status: 'succeeded',
    });
    expect(getTransactionStatus).not.toHaveBeenCalled();
  });

  it('does not double-write a failure either', async () => {
    getTransactionStatus.mockResolvedValue(status({ status: 'FAILED' }));
    world.claimLoses = true;
    // The winner of this race wrote a FAILURE, so it left no donation behind.
    world.rowAfterRace = { status: 'failed', donationId: null };

    expect(await settlePayHeroRequest(REF)).toEqual({
      kind: 'already_settled',
      status: 'failed',
      donationId: null,
    });
  });
});

// ─── The reference namespace in `donations` ─────────────────────────────────

describe('the provider reference written onto the donation', () => {
  it('namespaces the M-Pesa code so two gateways cannot collide', async () => {
    await settlePayHeroRequest(REF);

    // donations.stripe_payment_id is UNIQUE across the platform and holds
    // `pi_…`, `payhero_…` and `seed_…`.
    expect(world.recorded[0].providerRef).toBe(`${PAYHERO_REF_PREFIX}SKQ96C7K7H`);
  });

  it('falls back to our own reference when PayHero sends no M-Pesa code', async () => {
    // A donation with no reference could be inserted twice, because the
    // unique index is what prevents that.
    getTransactionStatus.mockResolvedValue(status({ providerReference: null }));

    await settlePayHeroRequest(REF);

    expect(world.recorded[0].providerRef).toBe(`${PAYHERO_REF_PREFIX}${REF}`);
  });
});

// ─── Unverifiable requests ──────────────────────────────────────────────────

describe('a request with no PayHero reference', () => {
  /*
   * Our own external_reference does not resolve at the status endpoint, so
   * without PayHero's reference the payment can never be confirmed. That
   * means initiation failed between the insert and the API answering - so
   * nothing was charged and there is nothing to confirm.
   */
  it('is reported unverifiable without calling PayHero', async () => {
    world.request = pendingRequest({ payheroReference: null });

    const result = await settlePayHeroRequest(REF);

    expect(result.kind).toBe('unverifiable');
    expect(getTransactionStatus).not.toHaveBeenCalled();
    expect(world.recorded).toHaveLength(0);
  });
});

// ─── Donor context survives the wait ────────────────────────────────────────

describe('the donor context stored at initiation', () => {
  it('is carried onto the donation, including share attribution', async () => {
    world.request = pendingRequest({
      donorName: 'Anonymous Giver',
      donorEmail: 'giver@example.com',
      donorLocation: 'Nairobi',
      message: 'Pole sana.',
      isAnonymous: true,
      subscribedToUpdates: true,
      shareLinkId: '33333333-3333-4333-8333-333333333333',
    });

    await settlePayHeroRequest(REF);

    expect(world.recorded[0].metadata).toMatchObject({
      campaignId: CAMPAIGN_ID,
      donorName: 'Anonymous Giver',
      donorEmail: 'giver@example.com',
      donorLocation: 'Nairobi',
      message: 'Pole sana.',
      isAnonymous: true,
      subscribedToUpdates: true,
      shareLinkId: '33333333-3333-4333-8333-333333333333',
      // An STK push is a single authorised debit, not a mandate: there is
      // nothing behind it to charge again.
      isRecurring: false,
    });
  });
});
