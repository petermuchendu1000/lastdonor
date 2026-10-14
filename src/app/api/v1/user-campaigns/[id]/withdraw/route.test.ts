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
  withdrawals: Row[];
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
      return [{
        stripeConnectAccountId: 'acct_123',
        stripeConnectStatus: 'verified',
        payoutCurrency: 'usd',
      }];

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
      totalReleasedAmount: 50_000,
      totalWithdrawnAmount: 0,
    },
    withdrawals: [],
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
});
