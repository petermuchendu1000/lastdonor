/**
 * Connect webhook idempotency and acknowledgement (audit docs/29 P1-1).
 *
 * The only dedup was a per-process in-memory `Set`, which is empty after a
 * restart and unknown to every other instance - so a redelivered
 * transfer.created incremented `totalWithdrawnAmount` again and emailed the
 * creator again. The durable guard is now the conditional UPDATE on the
 * withdrawal's status: only the delivery that actually moves the row out of
 * its current state may move the money counter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { NextRequest } from 'next/server';
import type Stripe from 'stripe';

// ─── Fake Drizzle (renders and evaluates the real SQL) ──────────────────────

const dialect = new PgDialect();

type Row = Record<string, unknown>;

interface Op {
  kind: 'select' | 'insert' | 'update';
  table: string;
  set?: Row;
  where?: unknown;
}

const isSql = (v: unknown): v is SQL =>
  typeof v === 'object' && v !== null && 'queryChunks' in (v as Record<string, unknown>);

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

function substitute(text: string, params: unknown[], row: Row): string {
  let js = text.replace(/\$(\d+)/g, (_m, i: string) => JSON.stringify(params[Number(i) - 1] ?? null));
  js = js.replace(/GREATEST/gi, 'Math.max').replace(/LEAST/gi, 'Math.min');
  return js.replace(/"(\w+)"\."(\w+)"/g, (_m, _t: string, col: string) =>
    JSON.stringify(row[snakeToCamel(col)] ?? null),
  );
}

function evalSetValue(value: unknown, row: Row): unknown {
  if (!isSql(value)) return value;
  const q = dialect.sqlToQuery(value);
  // eslint-disable-next-line no-new-func
  return Function(`"use strict";return (${substitute(q.sql, q.params, row)});`)();
}

function evalWhere(where: unknown, row: Row): boolean {
  if (!isSql(where)) return true;
  const q = dialect.sqlToQuery(where);
  const js = substitute(q.sql, q.params, row)
    .replace(/ <> /g, ' !== ')
    .replace(/ = /g, ' === ')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||');
  // eslint-disable-next-line no-new-func
  return Boolean(Function(`"use strict";return (${js});`)());
}

function applySet(row: Row, set: Row | undefined) {
  const before = { ...row };
  for (const [key, value] of Object.entries(set ?? {})) row[key] = evalSetValue(value, before);
}

class FakeChain<T> implements PromiseLike<T> {
  constructor(private op: Op, private resolver: (op: Op) => unknown[]) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: any) { this.op.table = getTableName(table); return this; }
  where(cond: unknown) { this.op.where = cond; return this; }
  limit() { return this; }
  set(values: Row) { this.op.set = values; return this; }
  values() { return this; }
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
const WITHDRAWAL_ID = '33333333-3333-3333-3333-333333333333';

interface World {
  withdrawal: Row;
  campaign: Row;
  failOnCampaignUpdate: boolean;
}

let world: World;

function resolver(op: Op): unknown[] {
  switch (`${op.kind}:${op.table}`) {
    case 'update:campaign_withdrawals': {
      if (!evalWhere(op.where, world.withdrawal)) return [];
      applySet(world.withdrawal, op.set);
      return [{ id: world.withdrawal.id }];
    }

    case 'update:campaigns':
      if (world.failOnCampaignUpdate) throw new Error('deadlock detected');
      applySet(world.campaign, op.set);
      return [{ id: world.campaign.id }];

    case 'update:users':
      return [];

    case 'select:campaigns':
      return [{ title: world.campaign.title, creatorId: CREATOR_ID }];

    case 'select:users':
      return [{ email: 'creator@example.com', name: 'Creator' }];

    default:
      return [];
  }
}

function makeClient() {
  const start = (kind: Op['kind'], table?: unknown) =>
    new FakeChain(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { kind, table: table ? getTableName(table as any) : '' },
      resolver,
    );

  return {
    select: () => start('select'),
    insert: (table: unknown) => start('insert', table),
    update: (table: unknown) => start('update', table),
  };
}

const dbMock = {
  ...makeClient(),
  transaction: async <T>(cb: (tx: ReturnType<typeof makeClient>) => Promise<T>): Promise<T> =>
    cb(makeClient()),
};

vi.mock('@/db', () => ({ db: dbMock }));

const constructEvent = vi.fn();
vi.mock('@/lib/stripe', () => ({
  stripe: { webhooks: { constructEvent: (...args: unknown[]) => constructEvent(...args) } },
}));

vi.mock('@/lib/stripe-connect', () => ({
  mapAccountToStatus: () => ({ status: 'verified' }),
}));

const notifyWithdrawalCompleted = vi.fn();
vi.mock('@/lib/notifications', () => ({
  notifyWithdrawalCompleted: (...args: unknown[]) => notifyWithdrawalCompleted(...args),
}));

const logError = vi.fn();
vi.mock('@/lib/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/errors')>();
  return { ...actual, logError: (...args: unknown[]) => logError(...args) };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function request(): NextRequest {
  return {
    text: async () => '{"raw":"body"}',
    headers: new Headers({ 'stripe-signature': 'sig_test' }),
  } as unknown as NextRequest;
}

function transferEvent(type: string, eventId: string): Stripe.Event {
  return {
    id: eventId,
    type,
    data: {
      object: {
        id: 'tr_abc',
        amount: 20_000,
        metadata: { withdrawal_id: WITHDRAWAL_ID, campaign_id: CAMPAIGN_ID },
      },
    },
  } as unknown as Stripe.Event;
}

/** Fresh module instance: models a process restart (empty dedup set). */
async function loadRoute() {
  vi.resetModules();
  return (await import('./route')).POST;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test';
  notifyWithdrawalCompleted.mockResolvedValue(undefined);
  world = {
    withdrawal: { id: WITHDRAWAL_ID, status: 'processing', amount: 20_000 },
    campaign: { id: CAMPAIGN_ID, title: 'Help Maria', totalWithdrawnAmount: 0 },
    failOnCampaignUpdate: false,
  };
});

describe('POST /api/v1/stripe-connect/webhook - transfer.created', () => {
  it('settles the withdrawal and credits totalWithdrawnAmount once', async () => {
    constructEvent.mockReturnValue(transferEvent('transfer.created', 'evt_1'));
    const POST = await loadRoute();

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(world.withdrawal.status).toBe('completed');
    expect(world.campaign.totalWithdrawnAmount).toBe(20_000);
    expect(notifyWithdrawalCompleted).toHaveBeenCalledTimes(1);
  });

  it('does not re-process the event after a process restart', async () => {
    constructEvent.mockReturnValue(transferEvent('transfer.created', 'evt_same'));

    const first = await loadRoute();
    await first(request());

    // Same event id, brand new process: the in-memory set is gone.
    const second = await loadRoute();
    const res = await second(request());

    expect(res.status).toBe(200);
    expect(world.campaign.totalWithdrawnAmount).toBe(20_000);
    expect(notifyWithdrawalCompleted).toHaveBeenCalledTimes(1);
  });

  it('does not double-credit a redelivery that arrives with a different event id', async () => {
    const POST = await loadRoute();

    constructEvent.mockReturnValue(transferEvent('transfer.created', 'evt_a'));
    await POST(request());
    constructEvent.mockReturnValue(transferEvent('transfer.created', 'evt_b'));
    await POST(request());

    expect(world.campaign.totalWithdrawnAmount).toBe(20_000);
    expect(notifyWithdrawalCompleted).toHaveBeenCalledTimes(1);
  });

  it('returns 5xx when the handler fails, so Stripe retries', async () => {
    world.failOnCampaignUpdate = true;
    constructEvent.mockReturnValue(transferEvent('transfer.created', 'evt_fail'));
    const POST = await loadRoute();

    const res = await POST(request());

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(logError).toHaveBeenCalled();
  });

  it('still acknowledges an event type it does not handle', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_ignored',
      type: 'payout.paid',
      data: { object: {} },
    } as unknown as Stripe.Event);
    const POST = await loadRoute();

    const res = await POST(request());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: true });
  });

  it('returns 400 when the signature does not verify', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const POST = await loadRoute();

    const res = await POST(request());
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/stripe-connect/webhook - transfer.reversed', () => {
  it('debits totalWithdrawnAmount once across redeliveries', async () => {
    world.withdrawal.status = 'completed';
    // More than the transfer amount, so a second debit would be visible rather
    // than clamped to zero by GREATEST.
    world.campaign.totalWithdrawnAmount = 50_000;
    const POST = await loadRoute();

    constructEvent.mockReturnValue(transferEvent('transfer.reversed', 'evt_r1'));
    await POST(request());
    constructEvent.mockReturnValue(transferEvent('transfer.reversed', 'evt_r2'));
    await POST(request());

    expect(world.withdrawal.status).toBe('failed');
    expect(world.campaign.totalWithdrawnAmount).toBe(30_000);
  });
});
