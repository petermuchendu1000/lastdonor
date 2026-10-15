/**
 * Over-withdrawal race (audit docs/29 P1-1).
 *
 * `totalWithdrawnAmount` is only written later, by the Connect webhook on
 * transfer.created. A balance check that reads `released - withdrawn` outside
 * a transaction therefore sees nothing of a withdrawal already in flight, so
 * two concurrent POSTs both passed it and both created real Stripe transfers.
 *
 * The fake database below models the one Postgres behaviour the fix relies on:
 * `SELECT ... FOR UPDATE` serialises transactions on the campaign row, and
 * because READ COMMITTED takes a fresh snapshot per statement, the second
 * transaction sees the first one's committed withdrawal row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

// ─── Fake Drizzle ───────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface Op {
  kind: 'select' | 'insert' | 'update';
  table: string;
  columns?: string[];
  values?: Row;
  set?: Row;
  locking: boolean;
  aggregate: boolean;
}

class FakeChain<T> implements PromiseLike<T> {
  constructor(private op: Op, private resolver: (op: Op) => unknown[]) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: any) { this.op.table = getTableName(table); return this; }
  where() { return this; }
  limit() { return this; }
  orderBy() { return this; }
  for() { this.op.locking = true; return this; }
  set(values: Row) { this.op.set = values; return this; }
  values(values: Row) { this.op.values = values; return this; }
  onConflictDoNothing() { return this; }
  returning() { return this; }

  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.resolver(this.op) as unknown as T)
      .then(onfulfilled, onrejected);
  }
}

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';
const CREATOR_ID = '22222222-2222-2222-2222-222222222222';
const PENDING = new Set(['requested', 'approved', 'processing']);

interface World {
  campaign: Row;
  user: Row;
  withdrawals: Row[];
  refundBatches: Row[];
  lockHeld: boolean;
  lockWaiters: (() => void)[];
  sawForUpdate: boolean;
}

let world: World;

function resolver(op: Op): unknown[] {
  const key = `${op.kind}:${op.table}`;

  switch (key) {
    case 'select:campaigns':
      if (op.locking) world.sawForUpdate = true;
      return [{ ...world.campaign }];

    case 'select:users':
      return [{ ...world.user }];

    case 'select:refund_batches':
      return world.refundBatches
        .filter((b) => b.campaignId === CAMPAIGN_ID && b.status === 'processing')
        .map((b) => ({ id: b.id }));

    case 'select:campaign_withdrawals': {
      if (op.aggregate) {
        const total = world.withdrawals
          .filter((w) => w.campaignId === CAMPAIGN_ID && PENDING.has(String(w.status)))
          .reduce((sum, w) => sum + Number(w.amount), 0);
        return [{ total }];
      }
      // Idempotency-key lookup. No replays in these tests.
      return [];
    }

    case 'insert:campaign_withdrawals':
      world.withdrawals.push({ ...op.values });
      return [];

    case 'update:campaign_withdrawals': {
      const target = world.withdrawals.find((w) => w.id === undefined) ?? world.withdrawals.at(-1);
      if (target && op.set) Object.assign(target, op.set);
      return [];
    }

    default:
      return [];
  }
}

function makeClient(inTx: boolean) {
  const start = (kind: Op['kind'], table?: unknown, columns?: string[]) =>
    new FakeChain(
      {
        kind,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        table: table ? getTableName(table as any) : '',
        columns,
        locking: false,
        aggregate: Boolean(columns?.includes('total')),
      },
      resolver,
    );

  void inTx;
  return {
    select: (cols?: Row) => start('select', undefined, cols ? Object.keys(cols) : undefined),
    insert: (table: unknown) => start('insert', table),
    update: (table: unknown) => start('update', table),
  };
}

/** Models the campaign row lock: one transaction in the critical section. */
async function acquireLock() {
  if (world.lockHeld) {
    await new Promise<void>((resolve) => world.lockWaiters.push(resolve));
  }
  world.lockHeld = true;
}

function releaseLock() {
  world.lockHeld = false;
  const next = world.lockWaiters.shift();
  if (next) next();
}

const dbMock = {
  ...makeClient(false),
  transaction: async <T>(cb: (tx: ReturnType<typeof makeClient>) => Promise<T>): Promise<T> => {
    await acquireLock();
    try {
      return await cb(makeClient(true));
    } finally {
      releaseLock();
    }
  },
};

vi.mock('@/db', () => ({ db: dbMock }));

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const createTransfer = vi.fn();
vi.mock('@/lib/stripe-connect', () => ({
  createTransfer: (...args: unknown[]) => createTransfer(...args),
}));

const { POST } = await import('./route');

// ─── Helpers ────────────────────────────────────────────────────────────────

function request(amount: number, idempotencyKey: string): NextRequest {
  return { json: async () => ({ amount, idempotencyKey }) } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: CAMPAIGN_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: CREATOR_ID } });
  createTransfer.mockImplementation(async () => {
    // A real transfer takes a network round trip, which is exactly the window
    // the second request used to slip through.
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { transferId: `tr_${Math.random().toString(36).slice(2)}` };
  });
  world = {
    campaign: {
      id: CAMPAIGN_ID,
      creatorId: CREATOR_ID,
      title: 'Help Maria',
      status: 'active',
      verificationStatus: 'fully_verified',
      totalReleasedAmount: 50_000,
      totalWithdrawnAmount: 0,
    },
    user: {
      stripeConnectAccountId: 'acct_123',
      stripeConnectStatus: 'verified',
      payoutCurrency: 'usd',
    },
    withdrawals: [],
    refundBatches: [],
    lockHeld: false,
    lockWaiters: [],
    sawForUpdate: false,
  };
});

describe('POST /api/v1/user-campaigns/[id]/withdraw', () => {
  it('lets exactly one of two concurrent full-balance withdrawals through', async () => {
    const [a, b] = await Promise.all([
      POST(request(50_000, '00000000-0000-4000-8000-00000000000a'), params),
      POST(request(50_000, '00000000-0000-4000-8000-00000000000b'), params),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);

    // The money side is what matters: one real Stripe transfer, one reservation.
    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(world.withdrawals).toHaveLength(1);
  });

  it('reserves under a row lock on the campaign', async () => {
    await POST(request(10_000, '00000000-0000-4000-8000-00000000000c'), params);
    expect(world.sawForUpdate).toBe(true);
  });

  it('counts an in-flight withdrawal against the balance before the webhook lands', async () => {
    // totalWithdrawnAmount is still 0 here - only the pending row exists.
    world.withdrawals.push({
      id: 'w-existing',
      campaignId: CAMPAIGN_ID,
      amount: 45_000,
      status: 'processing',
    });

    const res = await POST(request(10_000, '00000000-0000-4000-8000-00000000000d'), params);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining('5000') }),
    });
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('ignores withdrawals that already failed, so a failed transfer releases the funds', async () => {
    world.withdrawals.push({
      id: 'w-failed',
      campaignId: CAMPAIGN_ID,
      amount: 50_000,
      status: 'failed',
    });

    const res = await POST(request(50_000, '00000000-0000-4000-8000-00000000000e'), params);

    expect(res.status).toBe(201);
    expect(createTransfer).toHaveBeenCalledTimes(1);
  });

  it('allows three sequential withdrawals that together exhaust the balance exactly once', async () => {
    const results = await Promise.all([
      POST(request(20_000, '00000000-0000-4000-8000-000000000011'), params),
      POST(request(20_000, '00000000-0000-4000-8000-000000000012'), params),
      POST(request(20_000, '00000000-0000-4000-8000-000000000013'), params),
    ]);

    const accepted = results.filter((r) => r.status === 201);
    expect(accepted).toHaveLength(2); // 20000 + 20000 <= 50000, the third fails
    expect(createTransfer).toHaveBeenCalledTimes(2);
  });

  it('rejects an unauthenticated request', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(request(1_000, '00000000-0000-4000-8000-00000000000f'), params);
    expect(res.status).toBe(401);
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('rejects a withdrawal on a campaign the caller does not own', async () => {
    world.campaign.creatorId = '99999999-9999-9999-9999-999999999999';
    const res = await POST(request(1_000, '00000000-0000-4000-8000-000000000010'), params);
    expect(res.status).toBe(403);
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('rejects a body that omits the idempotency key, with a message written for the campaigner', async () => {
    const res = await POST({ json: async () => ({ amount: 1_000 }) } as unknown as NextRequest, params);

    expect(res.status).toBe(400);
    const payload = await res.json();
    // Not "idempotencyKey must be a valid UUID": the route surfaces this
    // message verbatim to the creator.
    expect(payload.error.message).not.toMatch(/uuid/i);
    expect(createTransfer).not.toHaveBeenCalled();
  });
});

/**
 * Campaign-state gate (audit P0).
 *
 * The handler selected only id/creatorId/title: there was no status check and
 * no verification re-check anywhere. An admin cancelling a fraudulent campaign
 * and refunding donors one at a time takes minutes, and in that window the
 * creator could withdraw the whole released balance - the platform then paid
 * the fraudster AND refunded the donors.
 */
describe('POST /api/v1/user-campaigns/[id]/withdraw - campaign state', () => {
  it.each([
    ['cancelled'],
    ['suspended'],
    ['under_review'],
    ['paused'],
    ['draft'],
    ['archived'],
  ])('refuses a withdrawal while the campaign is %s', async (status) => {
    world.campaign.status = status;

    const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000021'), params);

    expect(res.status).toBe(409);
    expect(createTransfer).not.toHaveBeenCalled();
    // Nothing reserved either: the balance must stay as it was.
    expect(world.withdrawals).toHaveLength(0);
  });

  it.each([['active'], ['last_donor_zone'], ['completed']])(
    'allows a withdrawal while the campaign is %s',
    async (status) => {
      world.campaign.status = status;

      const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000022'), params);

      expect(res.status).toBe(201);
      expect(createTransfer).toHaveBeenCalledTimes(1);
    },
  );

  it.each([['rejected'], ['suspended'], ['identity_verified'], ['unverified'], ['info_requested']])(
    'refuses a withdrawal when verification is %s rather than fully_verified',
    async (verificationStatus) => {
      world.campaign.verificationStatus = verificationStatus;

      const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000023'), params);

      expect(res.status).toBe(409);
      expect(createTransfer).not.toHaveBeenCalled();
      expect(world.withdrawals).toHaveLength(0);
    },
  );

  it('refuses a withdrawal while a refund batch for the campaign is still processing', async () => {
    world.refundBatches.push({ id: 'batch-1', campaignId: CAMPAIGN_ID, status: 'processing' });

    const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000024'), params);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining('refunded') }),
    });
    expect(createTransfer).not.toHaveBeenCalled();
    expect(world.withdrawals).toHaveLength(0);
  });

  it('allows a withdrawal once the refund batch has finished', async () => {
    world.refundBatches.push({ id: 'batch-1', campaignId: CAMPAIGN_ID, status: 'completed' });

    const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000025'), params);

    expect(res.status).toBe(201);
    expect(createTransfer).toHaveBeenCalledTimes(1);
  });

  it('checks campaign state under the row lock, after the reservation lock is taken', async () => {
    world.campaign.status = 'cancelled';
    await POST(request(10_000, '00000000-0000-4000-8000-000000000026'), params);
    expect(world.sawForUpdate).toBe(true);
  });
});

/**
 * Currency gate (audit P0).
 *
 * Every inbound charge is created in USD, so the ledger is USD cents. The
 * handler passed `user.payoutCurrency ?? 'usd'` straight to transfers.create,
 * so a Mexican account received transfers.create({amount: 100000,
 * currency: 'mxn'}) = MX$1,000 (~US$55) for a US$1,000 balance, and the
 * webhook then debited total_withdrawn_amount by the MXN figure. JPY is
 * zero-decimal, so it is 100x out in the other direction.
 */
describe('POST /api/v1/user-campaigns/[id]/withdraw - payout currency', () => {
  it.each([['mxn'], ['eur'], ['jpy'], ['gbp'], ['MXN']])(
    'refuses to transfer when the payout account settles in %s',
    async (currency) => {
      world.user.payoutCurrency = currency;

      const res = await POST(request(100_000, '00000000-0000-4000-8000-000000000031'), params);

      expect(res.status).toBe(400);
      expect(createTransfer).not.toHaveBeenCalled();
      expect(world.withdrawals).toHaveLength(0);
      await expect(res.json()).resolves.toMatchObject({
        error: expect.objectContaining({ message: expect.stringContaining(currency.toUpperCase()) }),
      });
    },
  );

  it('transfers in usd when the account has no recorded currency', async () => {
    world.user.payoutCurrency = null;

    const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000032'), params);

    expect(res.status).toBe(201);
    expect(createTransfer).toHaveBeenCalledWith(
      10_000,
      'usd',
      'acct_123',
      expect.anything(),
      '00000000-0000-4000-8000-000000000032',
    );
  });

  it('transfers in usd, never the account currency, for a usd account', async () => {
    world.user.payoutCurrency = 'USD';

    const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000033'), params);

    expect(res.status).toBe(201);
    expect(createTransfer).toHaveBeenCalledWith(10_000, 'usd', 'acct_123', expect.anything(), expect.any(String));
  });
});

/**
 * Unknown transfer outcome (audit P0).
 *
 * The catch-all marked the row 'failed', which takes it out of the pending set
 * and frees the reserved balance. But a thrown error from a payment API is an
 * UNKNOWN outcome, not a failure: if transfers.create succeeded and the
 * response was lost, the money left AND the balance was freed, so the next
 * attempt pays twice.
 */
describe('POST /api/v1/user-campaigns/[id]/withdraw - transfer error classification', () => {
  const stripeError = (fields: Record<string, unknown>) => Object.assign(new Error(String(fields.message ?? 'boom')), fields);

  it('keeps the reservation when the transfer outcome is unknown (dropped connection)', async () => {
    createTransfer.mockRejectedValue(stripeError({ type: 'StripeConnectionError', message: 'socket hang up' }));

    const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000041'), params);

    expect(res.status).toBe(502);
    // Still 'processing' => still counted as pending => balance NOT freed.
    expect(world.withdrawals.at(-1)?.status).toBe('processing');
    expect(String(world.withdrawals.at(-1)?.failureReason)).toContain('UNKNOWN_OUTCOME');
  });

  it.each([
    ['StripeAPIError', 'upstream 500'],
    ['StripeIdempotencyError', 'key reused'],
    ['StripeRateLimitError', 'too many requests'],
    ['', 'ETIMEDOUT'],
  ])('keeps the reservation for a %s', async (type, message) => {
    createTransfer.mockRejectedValue(stripeError({ type, message }));

    const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000042'), params);

    expect(res.status).toBe(502);
    expect(world.withdrawals.at(-1)?.status).toBe('processing');
  });

  it('does not free the balance for a later request after an unknown outcome', async () => {
    createTransfer.mockRejectedValueOnce(stripeError({ type: 'StripeConnectionError', message: 'socket hang up' }));
    await POST(request(50_000, '00000000-0000-4000-8000-000000000043'), params);

    // The full balance is still reserved by the in-doubt row.
    createTransfer.mockResolvedValue({ transferId: 'tr_second' });
    const res = await POST(request(50_000, '00000000-0000-4000-8000-000000000044'), params);

    expect(res.status).toBe(400);
    expect(createTransfer).toHaveBeenCalledTimes(1);
  });

  it('releases the reservation on a definite rejection (StripeInvalidRequestError)', async () => {
    createTransfer.mockRejectedValue(
      stripeError({ type: 'StripeInvalidRequestError', message: 'No such destination', code: 'resource_missing' }),
    );

    const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000045'), params);

    expect(res.status).toBe(500);
    expect(world.withdrawals.at(-1)?.status).toBe('failed');
  });

  it('releases the reservation on balance_insufficient', async () => {
    createTransfer.mockRejectedValue(
      stripeError({ type: 'StripeInvalidRequestError', code: 'balance_insufficient', message: 'insufficient funds' }),
    );

    const res = await POST(request(10_000, '00000000-0000-4000-8000-000000000046'), params);

    expect(res.status).toBe(500);
    expect(world.withdrawals.at(-1)?.status).toBe('failed');
    const freed = await POST(request(10_000, '00000000-0000-4000-8000-000000000047'), params);
    // A definite failure really does free the funds again.
    expect(freed.status).not.toBe(400);
  });
});
