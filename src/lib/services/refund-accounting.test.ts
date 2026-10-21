/**
 * Refund accounting: the four paths must agree, and none of them may move
 * money at Stripe and then abort on a CHECK constraint.
 *
 * There were four independent implementations of refund accounting — the
 * `charge.refunded` webhook, the admin single refund, the bulk cancel, and the
 * refund-batch retry — and only the webhook respected
 * `campaigns_released_lte_raised` (`schema.ts:354`,
 * `total_released_amount <= raised_amount`). The other three lowered or zeroed
 * `raised_amount` with no clamp, or never touched `campaigns` at all, with the
 * Stripe refunds already committed.
 *
 * The fake database below models the two Postgres behaviours the fixes depend
 * on:
 *
 *   1. `campaigns_released_lte_raised` is ENFORCED. An UPDATE that leaves
 *      released above raised throws 23514, and the enclosing transaction rolls
 *      back — exactly as production did, after Stripe had already paid the
 *      donor back.
 *   2. Transactions serialise, and a conditional UPDATE sees committed state.
 *      That is what makes `WHERE refunded = false ... RETURNING` a real claim
 *      and the old read-then-write a real double-spend.
 *
 * Every test here fails against the pre-fix code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { NextRequest } from 'next/server';
import type Stripe from 'stripe';

// ─── Fake Drizzle ───────────────────────────────────────────────────────────

const dialect = new PgDialect();

type Row = Record<string, unknown>;

interface Op {
  kind: 'select' | 'insert' | 'update' | 'delete';
  table: string;
  joined: string[];
  columns?: string[];
  values?: Row | Row[];
  set?: Row;
  where?: unknown;
  returning: boolean;
}

const isSql = (v: unknown): v is SQL =>
  typeof v === 'object' && v !== null && 'queryChunks' in (v as Record<string, unknown>);

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

function substitute(value: SQL, row: Row): string {
  const q = dialect.sqlToQuery(value);
  let js = q.sql.replace(/\$(\d+)/g, (_m, i: string) => JSON.stringify(q.params[Number(i) - 1] ?? null));
  js = js.replace(/GREATEST/gi, 'Math.max').replace(/LEAST/gi, 'Math.min');
  js = js.replace(/"(\w+)"\."(\w+)"/g, (_m, _t: string, col: string) =>
    JSON.stringify(row[snakeToCamel(col)] ?? null),
  );
  return js;
}

function evalSetValue(value: unknown, row: Row): unknown {
  if (!isSql(value)) return value;
  // eslint-disable-next-line no-new-func
  return Function(`"use strict";return (${substitute(value, row)});`)();
}

function evalWhere(where: unknown, row: Row): boolean {
  if (where === undefined || where === null) return true;
  if (!isSql(where)) return true;
  let js = substitute(where, row);
  js = js
    .replace(/ <> /g, ' !== ')
    .replace(/ = /g, ' === ')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||');
  // eslint-disable-next-line no-new-func
  return Boolean(Function(`"use strict";return (${js});`)());
}

/** Postgres SET semantics: every expression reads the PRE-update row. */
function applySet(row: Row, set: Row | undefined) {
  const before = { ...row };
  for (const [key, value] of Object.entries(set ?? {})) {
    row[key] = evalSetValue(value, before);
  }
}

class FakeChain<T> implements PromiseLike<T> {
  constructor(private op: Op, private resolver: (op: Op) => Promise<unknown[]>) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: any) { this.op.table = getTableName(table); return this; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  innerJoin(table: any) { this.op.joined.push(getTableName(table)); return this; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leftJoin(table: any) { this.op.joined.push(getTableName(table)); return this; }
  where(cond: unknown) { this.op.where = cond; return this; }
  limit() { return this; }
  orderBy() { return this; }
  groupBy() { return this; }
  for() { return this; }
  set(values: Row) { this.op.set = values; return this; }
  values(values: Row | Row[]) { this.op.values = values; return this; }
  onConflictDoNothing() { return this; }
  returning() { this.op.returning = true; return this; }

  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.resolver(this.op) as unknown as T)
      .then(onfulfilled, onrejected);
  }
}

// ─── World ──────────────────────────────────────────────────────────────────

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
const BATCH_ID = '33333333-3333-3333-3333-333333333333';

interface World {
  campaign: Row;
  donations: Row[];
  auditLogs: Row[];
  refundBatches: Row[];
  refundRecords: Row[];
}

/**
 * A barrier over the pre-transaction donation read.
 *
 * Two concurrent `charge.refunded` deliveries both SELECT the donation before
 * either opens a transaction. Without a barrier the first delivery's whole
 * transaction runs inside one macrotask drain and the second one's read lands
 * after it, which hides the race the fix is about. `armReadBarrier(n)` holds
 * the first n donation reads until all n have arrived, then releases them in
 * the same microtask batch - so both callers hold the same stale snapshot,
 * exactly as production did.
 */
let readBarrier: { expected: number; waiters: (() => void)[] } | null = null;

function armReadBarrier(expected: number) {
  readBarrier = { expected, waiters: [] };
}

function waitAtReadBarrier(): Promise<void> | null {
  if (!readBarrier) return null;
  return new Promise<void>((resolve) => {
    const barrier = readBarrier!;
    barrier.waiters.push(resolve);
    if (barrier.waiters.length >= barrier.expected) {
      readBarrier = null;
      for (const w of barrier.waiters) w();
    }
  });
}

let world: World;

function campaignRow(overrides: Row = {}): Row {
  return {
    id: CAMPAIGN_ID,
    slug: 'help-maria',
    title: 'Help Maria',
    status: 'active',
    category: 'medical',
    location: 'Portland, OR',
    raisedAmount: 0,
    goalAmount: 1_000_00,
    donorCount: 0,
    totalReleasedAmount: 0,
    totalWithdrawnAmount: 0,
    ...overrides,
  };
}

function donationRow(i: number, overrides: Row = {}): Row {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    campaignId: CAMPAIGN_ID,
    stripePaymentId: `pi_${i}`,
    // Required since docs/92: every refund path checks the provider before
    // calling a gateway API, because `stripePaymentId` now holds the
    // reference for PayHero too and a `payhero_…` value cannot be sent to
    // stripe.refunds.create. A row with no provider is treated as non-Stripe.
    provider: 'stripe',
    currency: 'USD',
    amount: 1_000,
    donorName: `Donor ${i}`,
    donorEmail: `donor${i}@example.com`,
    source: 'real',
    refunded: false,
    ...overrides,
  };
}

/**
 * The CHECK that aborted refunds in production. Enforced at the statement, so
 * the enclosing transaction rolls back and every write in it is lost.
 */
function assertCheckConstraints() {
  const released = Number(world.campaign.totalReleasedAmount);
  const raised = Number(world.campaign.raisedAmount);
  if (released > raised) {
    throw new Error(
      `23514: new row for relation "campaigns" violates check constraint ` +
      `"campaigns_released_lte_raised" (released=${released} raised=${raised})`,
    );
  }
  if (released < 0 || raised < 0) {
    throw new Error('23514: violates check constraint "campaigns_released_nonneg"');
  }
}

async function resolver(op: Op): Promise<unknown[]> {
  const key = `${op.kind}:${op.table}`;
  const cols = op.columns ?? [];

  switch (key) {
    case 'select:campaigns':
      if (!evalWhere(op.where, world.campaign)) return [];
      return [{ ...world.campaign }];

    case 'select:donations': {
      const barrier = waitAtReadBarrier();
      if (barrier) await barrier;
      return world.donations.filter((d) => evalWhere(op.where, d)).map((d) => ({ ...d }));
    }

    case 'update:donations': {
      const updated: Row[] = [];
      for (const d of world.donations) {
        if (!evalWhere(op.where, d)) continue;
        applySet(d, op.set);
        updated.push({ ...d });
      }
      return updated;
    }

    case 'update:campaigns': {
      if (!evalWhere(op.where, world.campaign)) return [];
      applySet(world.campaign, op.set);
      assertCheckConstraints();
      return [{ ...world.campaign }];
    }

    case 'insert:audit_logs':
      world.auditLogs.push(...[op.values ?? {}].flat());
      return [];

    case 'insert:refund_batches': {
      const row = { id: BATCH_ID, ...[op.values ?? {}].flat()[0] };
      world.refundBatches.push(row);
      return [{ id: row.id }];
    }

    case 'select:refund_batches':
      return world.refundBatches.filter((b) => evalWhere(op.where, b)).map((b) => ({ ...b }));

    case 'update:refund_batches': {
      for (const b of world.refundBatches) {
        if (!evalWhere(op.where, b)) continue;
        applySet(b, op.set);
      }
      return [];
    }

    case 'insert:refund_records': {
      const rows = [op.values ?? {}].flat();
      rows.forEach((r, i) => world.refundRecords.push({ id: `rec-${world.refundRecords.length + i}`, ...r }));
      return [];
    }

    case 'select:refund_records': {
      // The route joins donations to pick up stripePaymentId; merge the donation
      // onto the record so the real WHERE can be evaluated unchanged.
      const merged = world.refundRecords.map((r) => {
        const d = world.donations.find((x) => x.id === r.donationId) ?? {};
        return { ...d, ...r };
      });
      const rows = merged.filter((r) => evalWhere(op.where, r));
      if (cols.includes('stripePaymentId')) {
        return rows.map((r) => ({
          id: r.id,
          donationId: r.donationId,
          amount: r.amount,
          stripePaymentId: r.stripePaymentId ?? null,
          // The route reads the provider to decide whether a retry can call
          // Stripe at all. Carried through from the joined donation.
          provider: r.provider ?? 'stripe',
        }));
      }
      return rows.map((r) => ({ ...r }));
    }

    case 'update:refund_records': {
      for (const r of world.refundRecords) {
        if (!evalWhere(op.where, r)) continue;
        applySet(r, op.set);
      }
      return [];
    }

    default:
      return [];
  }
}

function makeClient() {
  const start = (kind: Op['kind'], table?: unknown, columns?: string[]) =>
    new FakeChain(
      {
        kind,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        table: table ? getTableName(table as any) : '',
        joined: [],
        columns,
        returning: false,
      },
      resolver,
    );

  return {
    select: (c?: Row) => start('select', undefined, c ? Object.keys(c) : undefined),
    insert: (table: unknown) => start('insert', table),
    update: (table: unknown) => start('update', table),
    delete: (table: unknown) => start('delete', table),
  };
}

/** Models row-level serialisation: one transaction in the critical section. */
let txHeld = false;
const txWaiters: (() => void)[] = [];

function cloneWorld(): World {
  return {
    campaign: { ...world.campaign },
    donations: world.donations.map((d) => ({ ...d })),
    auditLogs: [...world.auditLogs],
    refundBatches: world.refundBatches.map((b) => ({ ...b })),
    refundRecords: world.refundRecords.map((r) => ({ ...r })),
  };
}

const dbMock = {
  ...makeClient(),
  execute: async () => [],
  transaction: async <T>(cb: (tx: ReturnType<typeof makeClient>) => Promise<T>): Promise<T> => {
    if (txHeld) await new Promise<void>((resolve) => txWaiters.push(resolve));
    txHeld = true;
    const backup = cloneWorld();
    try {
      return await cb(makeClient());
    } catch (error) {
      // ROLLBACK. Every write in the transaction is lost - including the
      // `refunded` flags and the refund_records for donors Stripe has already
      // paid back.
      world = backup;
      throw error;
    } finally {
      txHeld = false;
      const next = txWaiters.shift();
      if (next) next();
    }
  },
};

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/db', () => ({ db: dbMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const refundsCreate = vi.fn();
vi.mock('@/lib/stripe', () => ({ stripe: { refunds: { create: (...a: unknown[]) => refundsCreate(...a) } } }));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireRole: async () => ({ user: { id: ADMIN_ID, role: 'admin' } }),
    auth: async () => ({ user: { id: ADMIN_ID, role: 'admin' } }),
  };
});

vi.mock('@/lib/notifications', () => ({
  notifyDonationRefund: vi.fn().mockResolvedValue(undefined),
  notifyBulkRefundCompleted: vi.fn().mockResolvedValue(undefined),
  notifyAdminsDonationReceived: vi.fn().mockResolvedValue(undefined),
  notifyCreatorDonationReceived: vi.fn().mockResolvedValue(undefined),
  notifyCreatorFirstDonation: vi.fn().mockResolvedValue(undefined),
  notifyCreatorCampaignCompleted: vi.fn().mockResolvedValue(undefined),
}));

const resendSend = vi.fn();
vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: (...a: unknown[]) => resendSend(...a) } },
  getResend: () => ({ emails: { send: (...a: unknown[]) => resendSend(...a) } }),
}));

vi.mock('@/lib/utils/similar-campaigns', () => ({ findSimilarCampaigns: async () => [] }));

vi.mock('@/lib/api-handler', () => ({
  safeAsync: (promise: PromiseLike<unknown>) => { Promise.resolve(promise).catch(() => {}); },
}));

const { processRefund, applyRefund } = await import('./payment-service');
const { PATCH: adminRefundPatch } = await import('@/app/api/v1/admin/donations/[id]/route');
const { POST: cancelCampaign } = await import('@/app/api/v1/admin/campaigns/[campaignId]/cancel/route');
const { PATCH: retryBatch } = await import('@/app/api/v1/admin/refund-batches/[id]/route');

// ─── Helpers ────────────────────────────────────────────────────────────────

function resetWorld(campaign: Row, donations: Row[] = []) {
  world = {
    campaign,
    donations,
    auditLogs: [],
    refundBatches: [],
    refundRecords: [],
  };
}

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  txHeld = false;
  txWaiters.length = 0;
  readBarrier = null;
  refundsCreate.mockImplementation(async () => ({ id: `re_${Math.random().toString(36).slice(2)}` }));
  resendSend.mockResolvedValue({ data: { id: 'e1' }, error: null });
  resetWorld(campaignRow());
});

// ─── 1 · Concurrent double webhook ──────────────────────────────────────────

describe('processRefund dedup is a claim, not a read', () => {
  it('decrements once when the same charge.refunded is delivered twice concurrently', async () => {
    const donation = donationRow(1, { amount: 500, stripePaymentId: 'pi_dup' });
    resetWorld(campaignRow({ raisedAmount: 1_000, donorCount: 2 }), [donation]);
    // Both deliveries take their pre-transaction read before either commits.
    armReadBarrier(2);

    const charge = { payment_intent: 'pi_dup' } as unknown as Stripe.Charge;
    await Promise.all([processRefund(charge), processRefund(charge)]);

    // Pre-fix: `refunded` was read outside the transaction and then written
    // unconditionally, so both deliveries decremented - a $5 refund removed
    // $10 and two donors.
    expect(world.campaign.raisedAmount).toBe(500);
    expect(world.campaign.donorCount).toBe(1);
    expect(world.donations[0].refunded).toBe(true);
    expect(world.auditLogs.filter((a) => a.eventType === 'donation.refunded')).toHaveLength(1);
  });

  it('is a no-op on a sequential replay', async () => {
    const donation = donationRow(1, { amount: 500, stripePaymentId: 'pi_dup' });
    resetWorld(campaignRow({ raisedAmount: 1_000, donorCount: 2 }), [donation]);
    const charge = { payment_intent: 'pi_dup' } as unknown as Stripe.Charge;

    await processRefund(charge);
    await processRefund(charge);

    expect(world.campaign.raisedAmount).toBe(500);
    expect(world.campaign.donorCount).toBe(1);
  });

  it('returns null from applyRefund when another writer already claimed the row', async () => {
    const donation = donationRow(1, { amount: 500 });
    resetWorld(campaignRow({ raisedAmount: 1_000, donorCount: 1 }), [donation]);

    const first = await applyRefund({ donationId: donation.id as string });
    const second = await applyRefund({ donationId: donation.id as string });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(world.campaign.raisedAmount).toBe(500);
  });

  it('leaves the campaign untouched for a seed donation', async () => {
    const donation = donationRow(1, { amount: 500, source: 'seed' });
    resetWorld(campaignRow({ raisedAmount: 1_000, donorCount: 1 }), [donation]);

    const applied = await applyRefund({ donationId: donation.id as string });

    expect(applied?.raisedAmountAfter).toBeNull();
    expect(world.campaign.raisedAmount).toBe(1_000);
    expect(world.donations[0].refunded).toBe(true);
  });
});

// ─── 2 · Admin single refund on a fully-verified campaign ───────────────────

describe('admin single refund on a fully-verified campaign', () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it('does not abort on campaigns_released_lte_raised after refunding at Stripe', async () => {
    const donation = donationRow(1, { amount: 4_000 });
    // released == raised: a fully-verified campaign. Lowering raised alone
    // violates the CHECK.
    resetWorld(
      campaignRow({ raisedAmount: 10_000, donorCount: 3, totalReleasedAmount: 10_000 }),
      [donation],
    );

    const res = await adminRefundPatch(jsonRequest({ refunded: true }), params(donation.id as string));
    const payload = await res.json();

    // Pre-fix: the UPDATE threw 23514, the transaction rolled back, and the
    // admin got a 500 with the donor already refunded at Stripe, `refunded`
    // still false, totals unchanged and no audit log. The retry then got
    // `charge_already_refunded`.
    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.changed).toBe(true);
    expect(world.donations[0].refunded).toBe(true);
    expect(world.campaign.raisedAmount).toBe(6_000);
    expect(world.campaign.totalReleasedAmount).toBe(6_000);
    expect(world.campaign.donorCount).toBe(2);
    expect(world.auditLogs.filter((a) => a.eventType === 'donation.refunded')).toHaveLength(1);
  });

  it('passes a per-donation idempotency key to Stripe', async () => {
    const donation = donationRow(1, { amount: 4_000 });
    resetWorld(campaignRow({ raisedAmount: 10_000, donorCount: 1 }), [donation]);

    await adminRefundPatch(jsonRequest({ refunded: true }), params(donation.id as string));

    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_1' },
      { idempotencyKey: `refund:${donation.id}` },
    );
  });

  it('records the refund exactly once when the webhook already claimed it', async () => {
    const donation = donationRow(1, { amount: 4_000, refunded: false });
    resetWorld(campaignRow({ raisedAmount: 10_000, donorCount: 1 }), [donation]);

    // The charge.refunded webhook lands first.
    await processRefund({ payment_intent: 'pi_1' } as unknown as Stripe.Charge);
    const res = await adminRefundPatch(jsonRequest({ refunded: true }), params(donation.id as string));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.changed).toBe(false);
    expect(world.campaign.raisedAmount).toBe(6_000);
    expect(world.auditLogs.filter((a) => a.eventType === 'donation.refunded')).toHaveLength(1);
  });
});

// ─── 3 · Partial bulk-refund success ────────────────────────────────────────

describe('bulk refund on campaign cancel', () => {
  const params = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };
  const body = { reason: 'terms_violation', notifyDonors: false, refundAll: true };

  it('decrements by the sum of the refunds that actually succeeded, not to zero', async () => {
    const donations = [donationRow(1), donationRow(2), donationRow(3)];
    resetWorld(campaignRow({ raisedAmount: 3_000, donorCount: 3 }), donations);

    // Donation 2's refund fails at Stripe. Its donor's money is still held.
    refundsCreate.mockImplementation(async (args: { payment_intent: string }) => {
      if (args.payment_intent === 'pi_2') throw new Error('card_declined');
      return { id: `re_${args.payment_intent}` };
    });

    const res = await cancelCampaign(jsonRequest(body), params);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.refund.failedCount).toBe(1);

    // Pre-fix: `raisedAmount: 0, donorCount: 0` under an
    // `if (refundedCount > 0)` guard, so the ledger claimed the campaign had
    // raised nothing while donation 2's money was still held.
    expect(world.campaign.raisedAmount).toBe(1_000);
    expect(world.campaign.donorCount).toBe(1);
    expect(world.donations.map((d) => d.refunded)).toEqual([true, false, true]);
  });

  it('does not abort the whole batch on a fully-verified campaign', async () => {
    const donations = [donationRow(1), donationRow(2)];
    resetWorld(
      campaignRow({ raisedAmount: 2_000, donorCount: 2, totalReleasedAmount: 2_000 }),
      donations,
    );

    const res = await cancelCampaign(jsonRequest(body), params);

    // Pre-fix: zeroing raised_amount with released at 2000 threw 23514, which
    // rolled back every refund_record and every `refunded` flag for donors
    // Stripe had already paid back.
    expect(res.status).toBe(200);
    expect(world.campaign.raisedAmount).toBe(0);
    expect(world.campaign.totalReleasedAmount).toBe(0);
    expect(world.donations.every((d) => d.refunded === true)).toBe(true);
    expect(world.refundRecords.filter((r) => r.status === 'completed')).toHaveLength(2);
  });

  it('only emails the donors whose refund actually succeeded', async () => {
    const donations = [donationRow(1), donationRow(2), donationRow(3)];
    resetWorld(campaignRow({ raisedAmount: 3_000, donorCount: 3 }), donations);
    refundsCreate.mockImplementation(async (args: { payment_intent: string }) => {
      if (args.payment_intent === 'pi_2') throw new Error('card_declined');
      return { id: `re_${args.payment_intent}` };
    });

    await cancelCampaign(jsonRequest(body), params);
    // The email send is fire-and-forget; let it drain.
    await new Promise((r) => setTimeout(r, 0));

    const recipients = resendSend.mock.calls.map((c) => (c[0] as { to: string }).to);
    // Pre-fix: donor 2's refund failed at Stripe and they were still told
    // their money had been refunded.
    expect(recipients).not.toContain('donor2@example.com');
    expect(recipients).toEqual(
      expect.arrayContaining(['donor1@example.com', 'donor3@example.com']),
    );
  });

  it('passes a per-donation idempotency key for every refund in the batch', async () => {
    const donations = [donationRow(1), donationRow(2)];
    resetWorld(campaignRow({ raisedAmount: 2_000, donorCount: 2 }), donations);

    await cancelCampaign(jsonRequest(body), params);

    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_1' },
      { idempotencyKey: `refund:${donations[0].id}` },
    );
    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_2' },
      { idempotencyKey: `refund:${donations[1].id}` },
    );
  });

  it('never drives the ledger negative when the stored total is already short', async () => {
    const donations = [donationRow(1, { amount: 1_000 })];
    resetWorld(campaignRow({ raisedAmount: 400, donorCount: 0 }), donations);

    await cancelCampaign(jsonRequest(body), params);

    expect(world.campaign.raisedAmount).toBe(0);
    expect(world.campaign.donorCount).toBe(0);
  });
});

// ─── 4 · Batch retry must adjust the campaign ───────────────────────────────

describe('refund-batch retry', () => {
  const params = { params: Promise.resolve({ id: BATCH_ID }) };

  function seedFailedBatch(campaign: Row) {
    const donations = [donationRow(1, { amount: 2_500 }), donationRow(2, { amount: 1_500 })];
    resetWorld(campaign, donations);
    world.refundBatches.push({
      id: BATCH_ID,
      campaignId: CAMPAIGN_ID,
      status: 'partial_failure',
      refundedCount: 0,
      failedCount: 2,
      totalDonations: 2,
      totalAmount: 4_000,
    });
    world.refundRecords.push(
      { id: 'rec-0', batchId: BATCH_ID, donationId: donations[0].id, amount: 2_500, status: 'failed' },
      { id: 'rec-1', batchId: BATCH_ID, donationId: donations[1].id, amount: 1_500, status: 'failed' },
    );
    return donations;
  }

  it('corrects the campaign totals in the same transaction that flips refunded', async () => {
    seedFailedBatch(campaignRow({ raisedAmount: 10_000, donorCount: 4 }));

    const res = await retryBatch(jsonRequest({}), params);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.retriedOk).toBe(2);

    // Pre-fix: this route set `donations.refunded = true` and never touched
    // `campaigns`. The charge.refunded webhook then saw `refunded` already
    // true, returned early, and the totals were NEVER corrected.
    expect(world.donations.every((d) => d.refunded === true)).toBe(true);
    expect(world.campaign.raisedAmount).toBe(6_000);
    expect(world.campaign.donorCount).toBe(2);
    expect(world.auditLogs.filter((a) => a.eventType === 'donation.refunded')).toHaveLength(2);
  });

  it('clamps released so a fully-verified campaign does not abort the retry', async () => {
    seedFailedBatch(campaignRow({ raisedAmount: 4_000, donorCount: 2, totalReleasedAmount: 4_000 }));

    const res = await retryBatch(jsonRequest({}), params);

    expect(res.status).toBe(200);
    expect(world.campaign.raisedAmount).toBe(0);
    expect(world.campaign.totalReleasedAmount).toBe(0);
    expect(world.donations.every((d) => d.refunded === true)).toBe(true);
  });

  it('does not double-count a donation the webhook already refunded', async () => {
    const donations = seedFailedBatch(campaignRow({ raisedAmount: 10_000, donorCount: 4 }));
    // The first retry's Stripe call succeeded but the response was lost; the
    // webhook arrived and claimed the row.
    await processRefund({ payment_intent: donations[0].stripePaymentId } as unknown as Stripe.Charge);
    expect(world.campaign.raisedAmount).toBe(7_500);

    await retryBatch(jsonRequest({}), params);

    // Only donation 2 is still claimable: 7500 - 1500.
    expect(world.campaign.raisedAmount).toBe(6_000);
  });

  it('passes a per-donation idempotency key on retry', async () => {
    const donations = seedFailedBatch(campaignRow({ raisedAmount: 10_000, donorCount: 4 }));

    await retryBatch(jsonRequest({}), params);

    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_1' },
      { idempotencyKey: `refund:${donations[0].id}` },
    );
  });
});
