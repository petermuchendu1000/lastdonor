/**
 * Money-path regression tests for `payment-service`.
 *
 * Covers audit docs/29:
 *   P0-3  refund divergence (released > raised -> CHECK violation -> rollback)
 *   P0-4  receipts fail silently with exactly one attempt
 *   P1-2  recurring donations charged but never recorded
 *   P1-3  campaigns and first-donation emails can fire twice
 *
 * The database is faked by a miniature Postgres that renders the real Drizzle
 * SQL with `PgDialect` and then evaluates it: SET expressions are computed
 * against the live row, and WHERE clauses actually filter. That is what lets
 * these tests prove a `WHERE status <> 'completed'` guard exists rather than
 * trusting the shape of the call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type Stripe from 'stripe';

// ─── Fake Drizzle ───────────────────────────────────────────────────────────

const dialect = new PgDialect();

type Row = Record<string, unknown>;

interface Op {
  kind: 'select' | 'insert' | 'update' | 'delete';
  table: string;
  columns?: string[];
  values?: Row;
  set?: Row;
  where?: unknown;
  returning: boolean;
  inTx: boolean;
}

const isSql = (v: unknown): v is SQL =>
  typeof v === 'object' && v !== null && 'queryChunks' in (v as Record<string, unknown>);

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

function renderSql(value: SQL): { text: string; params: unknown[] } {
  const q = dialect.sqlToQuery(value);
  return { text: q.sql, params: q.params };
}

function substitute(text: string, params: unknown[], row: Row): string {
  let js = text.replace(/\$(\d+)/g, (_m, i: string) => JSON.stringify(params[Number(i) - 1] ?? null));
  js = js.replace(/GREATEST/gi, 'Math.max').replace(/LEAST/gi, 'Math.min');
  js = js.replace(/"(\w+)"\."(\w+)"/g, (_m, _t: string, col: string) =>
    JSON.stringify(row[snakeToCamel(col)] ?? null),
  );
  return js;
}

/** Evaluate a SET value: a Drizzle SQL expression, or a literal passed through. */
function evalSetValue(value: unknown, row: Row): unknown {
  if (!isSql(value)) return value;
  const { text, params } = renderSql(value);
  // eslint-disable-next-line no-new-func
  return Function(`"use strict";return (${substitute(text, params, row)});`)();
}

/** Evaluate a WHERE clause against a row, so the fake honours real guards. */
function evalWhere(where: unknown, row: Row): boolean {
  if (where === undefined || where === null) return true;
  if (!isSql(where)) return true;
  const { text, params } = renderSql(where);
  let js = substitute(text, params, row);
  js = js
    .replace(/ <> /g, ' !== ')
    .replace(/ = /g, ' === ')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||');
  // eslint-disable-next-line no-new-func
  return Boolean(Function(`"use strict";return (${js});`)());
}

/**
 * Apply a SET clause with Postgres semantics: every expression is evaluated
 * against the PRE-update row, not against the partially-updated one. The
 * refund fix depends on exactly this - its two expressions both read the old
 * raised_amount.
 */
function applySet(row: Row, set: Row | undefined) {
  const before = { ...row };
  for (const [key, value] of Object.entries(set ?? {})) {
    row[key] = evalSetValue(value, before);
  }
}

type Resolver = (op: Op) => unknown[];

class FakeChain<T> implements PromiseLike<T> {
  constructor(private op: Op, private resolver: Resolver) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: any) { this.op.table = getTableName(table); return this; }
  where(cond: unknown) { this.op.where = cond; return this; }
  limit() { return this; }
  orderBy() { return this; }
  for() { return this; }
  set(values: Row) { this.op.set = values; return this; }
  values(values: Row) { this.op.values = values; return this; }
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

function makeClient(resolver: Resolver, inTx: boolean) {
  const start = (kind: Op['kind'], table?: unknown, columns?: string[]) =>
    new FakeChain(
      {
        kind,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        table: table ? getTableName(table as any) : '',
        columns,
        returning: false,
        inTx,
      },
      resolver,
    );

  return {
    select: (cols?: Row) => start('select', undefined, cols ? Object.keys(cols) : undefined),
    insert: (table: unknown) => start('insert', table),
    update: (table: unknown) => start('update', table),
    delete: (table: unknown) => start('delete', table),
  };
}

// ─── World ──────────────────────────────────────────────────────────────────

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';

function baseCampaign(overrides: Row = {}): Row {
  return {
    id: CAMPAIGN_ID,
    slug: 'help-maria',
    title: 'Help Maria',
    currency: 'USD',
    creatorId: '22222222-2222-2222-2222-222222222222',
    category: 'medical',
    beneficiaryRelation: 'self',
    status: 'active',
    raisedAmount: 0,
    goalAmount: 1_000_00,
    donorCount: 0,
    totalReleasedAmount: 0,
    totalWithdrawnAmount: 0,
    simulationFlag: false,
    ...overrides,
  };
}

interface World {
  /** Frozen pre-transaction read. Both concurrent webhooks see this. */
  snapshot: Row;
  /** Live row, mutated by UPDATEs. */
  campaign: Row;
  donations: Row[];
  campaignUpdates: Row[];
  auditLogs: Row[];
  campaignMessages: Row[];
  userRow: Row | null;
  creatorRow: Row | null;
  preferences: Row | null;
  log: string[];
}

let world: World;

function resolver(op: Op): unknown[] {
  const key = `${op.kind}:${op.table}`;
  world.log.push(`${op.inTx ? 'tx:' : 'db:'}${key}`);

  switch (key) {
    case 'select:campaigns':
      // Always the frozen snapshot: this is the stale read that two
      // concurrent webhook deliveries both take before either commits.
      return [{ ...world.snapshot }];

    case 'select:users': {
      const cols = op.columns ?? [];
      if (cols.includes('preferences')) return world.preferences ? [world.preferences] : [];
      if (cols.includes('email')) return world.creatorRow ? [world.creatorRow] : [];
      return world.userRow ? [world.userRow] : [];
    }

    case 'select:donations':
      return world.donations;

    case 'insert:donations': {
      const values = op.values ?? {};
      // Models the UNIQUE index on donations.stripe_payment_id.
      if (world.donations.some((d) => d.stripePaymentId === values.stripePaymentId)) return [];
      const row = { id: `don-${world.donations.length + 1}`, refunded: false, ...values };
      world.donations.push(row);
      return [{ id: row.id }];
    }

    case 'update:donations': {
      // Returns the rows it actually matched, which is what makes the
      // conditional refund claim (`WHERE refunded = false ... RETURNING`)
      // observable: a second concurrent claim matches nothing and gets [].
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
      return [{ ...world.campaign }];
    }

    case 'update:users':
      return [];

    case 'insert:campaignUpdates':
    case 'insert:campaign_updates':
      world.campaignUpdates.push(op.values ?? {});
      return [];

    case 'insert:auditLogs':
    case 'insert:audit_logs':
      world.auditLogs.push(op.values ?? {});
      return [];

    case 'insert:campaign_messages':
      world.campaignMessages.push(op.values ?? {});
      return [];

    default:
      return [];
  }
}

const dbMock = {
  ...makeClient(resolver, false),
  transaction: async <T>(cb: (tx: ReturnType<typeof makeClient>) => Promise<T>): Promise<T> => {
    world.log.push('tx:begin');
    const result = await cb(makeClient(resolver, true));
    world.log.push('tx:commit');
    return result;
  },
};

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/db', () => ({ db: dbMock }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const resendSend = vi.fn();
vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: (...args: unknown[]) => resendSend(...args) } },
  getResend: () => ({ emails: { send: (...args: unknown[]) => resendSend(...args) } }),
}));

const stripeMock = {
  refunds: { create: vi.fn() },
  invoices: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
  paymentIntents: { update: vi.fn() },
};
vi.mock('@/lib/stripe', () => ({ stripe: stripeMock }));

const notifications = {
  notifyAdminsDonationReceived: vi.fn(),
  notifyCreatorDonationReceived: vi.fn(),
  notifyCreatorFirstDonation: vi.fn(),
  notifyCreatorCampaignCompleted: vi.fn(),
};
vi.mock('@/lib/notifications', () => notifications);

const logError = vi.fn();
vi.mock('@/lib/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/errors')>();
  return { ...actual, logError: (...args: unknown[]) => logError(...args) };
});

const safeAsyncFailures: { label: string; error: unknown }[] = [];
vi.mock('@/lib/api-handler', () => ({
  safeAsync: (promise: PromiseLike<unknown>, label: string) => {
    // Drizzle builders are thenable, not Promises; the real safeAsync only
    // ever receives awaited promises from the production call sites.
    Promise.resolve(promise).catch((error) => safeAsyncFailures.push({ label, error }));
  },
}));

const { processPaymentSuccess, processRefund, sendDonationReceipt, recordGatewayCharge } = await import('./payment-service');

// ─── Helpers ────────────────────────────────────────────────────────────────

function paymentIntent(overrides: Partial<Stripe.PaymentIntent> = {}): Stripe.PaymentIntent {
  return {
    id: 'pi_test_1',
    amount: 2_000,
    // Stripe reports the charged currency lowercase and always sends it; the
    // adapter reads it from here rather than from our metadata copy, because
    // only this one debited a card.
    currency: 'usd',
    metadata: {
      campaignId: CAMPAIGN_ID,
      donorName: 'Ada',
      donorEmail: 'ada@example.com',
      donorLocation: 'Portland, OR',
      message: '',
      isAnonymous: 'false',
      isRecurring: 'false',
      subscribedToUpdates: 'false',
    },
    invoice: null,
    ...overrides,
  } as unknown as Stripe.PaymentIntent;
}

async function waitFor(predicate: () => boolean, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function resetWorld(campaign: Row = baseCampaign()) {
  world = {
    snapshot: { ...campaign },
    campaign: { ...campaign },
    donations: [],
    campaignUpdates: [],
    auditLogs: [],
    campaignMessages: [],
    userRow: null,
    creatorRow: { id: campaign.creatorId, email: 'creator@example.com', name: 'Creator' },
    preferences: null,
    log: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  safeAsyncFailures.length = 0;
  resendSend.mockResolvedValue({ data: { id: 'email_1' }, error: null });
  stripeMock.paymentIntents.update.mockResolvedValue({});
  resetWorld();
});

// ─── P0-3 · Refund divergence ───────────────────────────────────────────────

describe('processRefund (docs/29 P0-3)', () => {
  function seedRefundWorld(campaign: Row) {
    resetWorld(campaign);
    world.donations.push({
      id: 'don-1',
      campaignId: CAMPAIGN_ID,
      stripePaymentId: 'pi_refund_1',
      amount: 4_000,
      refunded: false,
    });
  }

  const charge = { payment_intent: 'pi_refund_1' } as unknown as Stripe.Charge;

  it('keeps total_released_amount <= raised_amount, the CHECK that rolled refunds back', async () => {
    seedRefundWorld(baseCampaign({ raisedAmount: 10_000, donorCount: 3, totalReleasedAmount: 10_000 }));

    await processRefund(charge);

    expect(world.campaign.raisedAmount).toBe(6_000);
    // Without the clamp this stays at 10000 and migration 0027's
    // campaigns_released_lte_raised CHECK aborts the whole transaction,
    // leaving refunded = false while Stripe has already paid the donor back.
    expect(world.campaign.totalReleasedAmount).toBe(6_000);
    expect(world.campaign.totalReleasedAmount as number)
      .toBeLessThanOrEqual(world.campaign.raisedAmount as number);
    expect(world.campaign.donorCount).toBe(2);
    expect(world.donations[0].refunded).toBe(true);
  });

  it('leaves released alone when it is already below the post-refund raised amount', async () => {
    seedRefundWorld(baseCampaign({ raisedAmount: 10_000, donorCount: 3, totalReleasedAmount: 3_000 }));

    await processRefund(charge);

    expect(world.campaign.raisedAmount).toBe(6_000);
    expect(world.campaign.totalReleasedAmount).toBe(3_000);
  });

  it('never drives raised or released below zero', async () => {
    seedRefundWorld(baseCampaign({ raisedAmount: 1_000, donorCount: 0, totalReleasedAmount: 1_000 }));

    await processRefund(charge);

    expect(world.campaign.raisedAmount).toBe(0);
    expect(world.campaign.totalReleasedAmount).toBe(0);
    expect(world.campaign.donorCount).toBe(0);
  });

  it('records the post-refund totals and flags a clawback below what was already withdrawn', async () => {
    seedRefundWorld(baseCampaign({
      raisedAmount: 10_000,
      donorCount: 3,
      totalReleasedAmount: 10_000,
      totalWithdrawnAmount: 8_000,
    }));

    await processRefund(charge);

    const audit = world.auditLogs.find((a) => a.eventType === 'donation.refunded');
    expect(audit).toBeDefined();
    const details = audit!.details as Record<string, unknown>;
    expect(details.raisedAmountAfter).toBe(6_000);
    expect(details.totalReleasedAmountAfter).toBe(6_000);
    // 6000 released vs 8000 already paid out is a real cash shortfall, and
    // nothing else in the system would notice it.
    expect(details.releasedBelowWithdrawn).toBe(true);
  });

  it('is a no-op for an already-refunded donation', async () => {
    seedRefundWorld(baseCampaign({ raisedAmount: 10_000, totalReleasedAmount: 10_000 }));
    world.donations[0].refunded = true;

    await processRefund(charge);

    expect(world.campaign.raisedAmount).toBe(10_000);
  });
});

// ─── P1-3 · Double completion / double first-donation ───────────────────────

describe('completion is decided inside the transaction (docs/29 P1-3)', () => {
  it('completes a campaign once when two donors cross the goal concurrently', async () => {
    // Both webhook deliveries read the same pre-transaction snapshot
    // (status 'active', raised 9000) and both push the campaign past goal.
    resetWorld(baseCampaign({ raisedAmount: 9_000, donorCount: 5, goalAmount: 10_000 }));

    await processPaymentSuccess(paymentIntent({ id: 'pi_a', amount: 2_000 }));
    await processPaymentSuccess(paymentIntent({ id: 'pi_b', amount: 2_000 }));

    expect(world.donations).toHaveLength(2);
    expect(world.campaign.raisedAmount).toBe(13_000);
    expect(world.campaign.status).toBe('completed');

    // One completion email, one celebration post, one payout eligibility.
    expect(notifications.notifyCreatorCampaignCompleted).toHaveBeenCalledTimes(1);
    expect(world.campaignUpdates.filter((u) => u.updateType === 'celebration')).toHaveLength(1);
  });

  it('reports the live post-increment donor count on the completion email', async () => {
    resetWorld(baseCampaign({ raisedAmount: 9_000, donorCount: 5, goalAmount: 10_000 }));

    await processPaymentSuccess(paymentIntent({ id: 'pi_a', amount: 2_000 }));

    expect(notifications.notifyCreatorCampaignCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ donorCount: 6 }),
    );
  });

  it('sends the first-donation email once when two first donations race', async () => {
    resetWorld(baseCampaign({ raisedAmount: 0, donorCount: 0, goalAmount: 1_000_00 }));

    await processPaymentSuccess(paymentIntent({ id: 'pi_a', amount: 2_000 }));
    await processPaymentSuccess(paymentIntent({ id: 'pi_b', amount: 2_000 }));

    expect(world.donations).toHaveLength(2);
    expect(world.campaign.donorCount).toBe(2);
    expect(notifications.notifyCreatorFirstDonation).toHaveBeenCalledTimes(1);
  });

  it('ignores a duplicate webhook for the same PaymentIntent', async () => {
    resetWorld(baseCampaign({ raisedAmount: 9_000, donorCount: 5, goalAmount: 10_000 }));

    await processPaymentSuccess(paymentIntent({ id: 'pi_same', amount: 2_000 }));
    await processPaymentSuccess(paymentIntent({ id: 'pi_same', amount: 2_000 }));

    expect(world.donations).toHaveLength(1);
    expect(world.campaign.raisedAmount).toBe(11_000);
    expect(notifications.notifyCreatorCampaignCompleted).toHaveBeenCalledTimes(1);
  });

  it('still promotes an active campaign into the last-donor zone', async () => {
    resetWorld(baseCampaign({ raisedAmount: 8_000, donorCount: 4, goalAmount: 10_000 }));

    await processPaymentSuccess(paymentIntent({ id: 'pi_a', amount: 1_000 }));

    expect(world.campaign.status).toBe('last_donor_zone');
    expect(notifications.notifyCreatorCampaignCompleted).not.toHaveBeenCalled();
  });
});

// ─── P1-2 · Recurring donations ─────────────────────────────────────────────

describe('recurring donations (docs/29 P1-2)', () => {
  const subscriptionMetadata = {
    campaignId: CAMPAIGN_ID,
    donorName: 'Grace',
    donorEmail: 'grace@example.com',
    donorLocation: 'Austin, TX',
    message: '',
    isAnonymous: 'false',
    isRecurring: 'true',
    subscribedToUpdates: 'false',
  };

  function stubSubscriptionLookup() {
    stripeMock.invoices.retrieve.mockResolvedValue({ id: 'in_1', subscription: 'sub_1' });
    stripeMock.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', metadata: subscriptionMetadata });
  }

  it('records a donation for a subscription invoice whose PaymentIntent has no metadata', async () => {
    stubSubscriptionLookup();
    resetWorld(baseCampaign({ raisedAmount: 5_000, donorCount: 2, goalAmount: 1_000_00 }));

    await processPaymentSuccess(
      paymentIntent({ id: 'pi_recurring_1', amount: 2_500, metadata: {}, invoice: 'in_1' } as never),
    );

    expect(world.donations).toHaveLength(1);
    expect(world.donations[0]).toMatchObject({
      campaignId: CAMPAIGN_ID,
      stripePaymentId: 'pi_recurring_1',
      amount: 2_500,
      donorEmail: 'grace@example.com',
      isRecurring: true,
    });
    // Campaign credited.
    expect(world.campaign.raisedAmount).toBe(7_500);
    // Receipt attempted.
    expect(resendSend).toHaveBeenCalledTimes(1);
  });

  it('writes the donor context back onto the PaymentIntent (disaster-recovery substrate)', async () => {
    stubSubscriptionLookup();
    resetWorld();

    await processPaymentSuccess(
      paymentIntent({ id: 'pi_recurring_2', amount: 2_500, metadata: {}, invoice: 'in_1' } as never),
    );

    expect(stripeMock.paymentIntents.update).toHaveBeenCalledWith(
      'pi_recurring_2',
      { metadata: expect.objectContaining({ campaignId: CAMPAIGN_ID, isRecurring: 'true' }) },
    );
  });

  it('performs every Stripe call before the transaction opens', async () => {
    stubSubscriptionLookup();
    resetWorld();

    await processPaymentSuccess(
      paymentIntent({ id: 'pi_recurring_3', amount: 2_500, metadata: {}, invoice: 'in_1' } as never),
    );

    // Transactions must contain no external I/O. The metadata lookup runs
    // first, so by the time the transaction opens all Stripe work is done.
    expect(world.log).toContain('tx:begin');
    expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(stripeMock.invoices.retrieve).toHaveBeenCalledTimes(1);
  });

  it('records nothing and reports when neither the PaymentIntent nor a subscription has metadata', async () => {
    resetWorld();

    await processPaymentSuccess(paymentIntent({ id: 'pi_orphan', metadata: {}, invoice: null } as never));

    expect(world.donations).toHaveLength(0);
    expect(logError).toHaveBeenCalled();
  });

  it('survives a failed metadata write-back and still records the donation', async () => {
    stubSubscriptionLookup();
    stripeMock.paymentIntents.update.mockRejectedValue(new Error('stripe down'));
    resetWorld();

    await processPaymentSuccess(
      paymentIntent({ id: 'pi_recurring_4', amount: 2_500, metadata: {}, invoice: 'in_1' } as never),
    );

    expect(world.donations).toHaveLength(1);
  });
});

// ─── P0-4 · Receipt observability ───────────────────────────────────────────

describe('donation receipts (docs/29 P0-4)', () => {
  const receiptArgs = () => ({
    // `sendDonationReceipt` takes a provider-neutral GatewayCharge now, so
    // the same function serves the Stripe and PayHero rails. The Stripe
    // adapter builds this from the PaymentIntent.
    charge: {
      provider: 'stripe' as const,
      providerRef: 'pi_receipt',
      amountMinor: 5_000,
      currency: 'USD',
      metadata: {
        campaignId: CAMPAIGN_ID,
        donorName: 'Ada',
        donorEmail: 'ada@example.com',
        donorLocation: null,
        message: null,
        isAnonymous: false,
        isRecurring: false,
        subscribedToUpdates: false,
        shareLinkId: null,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    campaign: baseCampaign() as any,
    userId: null,
  });

  it('retries a result-shaped Resend failure and reports it', async () => {
    resendSend.mockResolvedValue({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'Too many requests' },
    });

    await expect(sendDonationReceipt(receiptArgs())).rejects.toThrow(/rate_limit_exceeded/);

    // maxRetries: 2 means three attempts. The old loop made exactly one.
    expect(resendSend).toHaveBeenCalledTimes(3);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('rate_limit_exceeded') }),
      expect.objectContaining({ route: 'webhook/receipt-email' }),
    );
  });

  it('sends once and reports nothing on success', async () => {
    await expect(sendDonationReceipt(receiptArgs())).resolves.toBeUndefined();
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it('surfaces a receipt failure to the caller through safeAsync', async () => {
    resendSend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'invalid to address' },
    });
    resetWorld();

    await processPaymentSuccess(paymentIntent({ id: 'pi_receipt_fail' }));

    // The receipt is fire-and-forget behind three attempts with backoff, so
    // poll rather than guess at a delay.
    await waitFor(() => safeAsyncFailures.some((f) => f.label === 'webhook/receipt-email'));

    expect(safeAsyncFailures.map((f) => f.label)).toContain('webhook/receipt-email');
  });

  it('honours the donor opting out of receipt emails', async () => {
    resetWorld();
    world.userRow = { id: '33333333-3333-3333-3333-333333333333' };
    world.preferences = { preferences: { emailDonationReceipts: false } };

    await sendDonationReceipt({ ...receiptArgs(), userId: '33333333-3333-3333-3333-333333333333' });

    expect(resendSend).not.toHaveBeenCalled();
  });
});

// ─── The provider-neutral writer (docs/92) ──────────────────────────────────

/*
  `docs/41` established one writer for donation accounting after four
  independent refund implementations had drifted apart, three of them wrongly.
  A second gateway with its own copy of the campaign-tally, completion,
  fund-pool, echo-counter, receipt and notification logic would recreate
  exactly that, in the half of the code that moves money rather than the half
  that reports it. These run against the same fake Postgres as everything
  above, so they prove the real SQL, not the shape of a call.
*/

function payheroCharge(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'payhero' as const,
    providerRef: 'payhero_E8UWT7CLUW',
    amountMinor: 5_000,
    currency: 'KES',
    metadata: {
      campaignId: CAMPAIGN_ID,
      donorName: 'Wanjiku',
      donorEmail: 'wanjiku@example.com',
      donorLocation: null,
      message: null,
      isAnonymous: false,
      isRecurring: false,
      subscribedToUpdates: false,
      shareLinkId: null,
    },
    ...overrides,
  };
}

describe('recordGatewayCharge: a PayHero donation uses the same writer', () => {
  beforeEach(() => resetWorld(baseCampaign({ currency: 'KES', goalAmount: 1_000_000 })));

  it('writes one donation carrying its provider and currency', async () => {
    await recordGatewayCharge(payheroCharge());

    expect(world.donations).toHaveLength(1);
    expect(world.donations[0]).toMatchObject({
      stripePaymentId: 'payhero_E8UWT7CLUW',
      provider: 'payhero',
      currency: 'KES',
      amount: 5_000,
      source: 'real',
    });
  });

  it('credits the campaign in its own currency', async () => {
    await recordGatewayCharge(payheroCharge());

    expect(world.campaign.raisedAmount).toBe(5_000);
    expect(world.campaign.donorCount).toBe(1);
  });

  it('records the provider and currency on the audit row', async () => {
    await recordGatewayCharge(payheroCharge());

    const recorded = world.auditLogs.find((r) => r.eventType === 'donation.recorded');
    expect(recorded).toBeDefined();
    expect(recorded!.details).toMatchObject({
      provider: 'payhero',
      currency: 'KES',
      providerRef: 'payhero_E8UWT7CLUW',
      // Kept under the old key too: queries written before there was a second
      // gateway read `stripePaymentId`.
      stripePaymentId: 'payhero_E8UWT7CLUW',
    });
  });

  it('is idempotent: a replayed callback writes exactly one donation', async () => {
    await recordGatewayCharge(payheroCharge());
    await recordGatewayCharge(payheroCharge());

    expect(world.donations).toHaveLength(1);
    expect(world.campaign.raisedAmount).toBe(5_000);
    expect(world.auditLogs.filter((r) => r.eventType === 'donation.recorded')).toHaveLength(1);
  });

  it('never calls Stripe for a PayHero charge', async () => {
    await recordGatewayCharge(payheroCharge());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it('announces completion in the campaign currency, not dollars', async () => {
    resetWorld(baseCampaign({ currency: 'KES', goalAmount: 5_000 }));

    await recordGatewayCharge(payheroCharge());

    expect(world.campaign.status).toBe('completed');
    const celebration = world.campaignUpdates.find((u) => u.updateType === 'celebration');
    expect(celebration).toBeDefined();
    // The old code interpolated `$${(amount / 100).toFixed(2)}` into a post
    // published on the campaign page, so a KES campaign announced its own
    // completion in dollars.
    expect(String(celebration!.bodyHtml)).not.toContain('$');
    expect(String(celebration!.bodyHtml)).toMatch(/K(sh|ES)/);
  });
});

describe('recordGatewayCharge: currency safety', () => {
  /*
    The money has already moved by the time this runs. A currency the platform
    cannot account for is therefore not a validation error to return - it is a
    liability that must be written down for a human.
  */
  it('refuses a charge in a currency the campaign does not raise in', async () => {
    resetWorld(baseCampaign({ currency: 'USD' }));

    await recordGatewayCharge(payheroCharge({ currency: 'KES' }));

    expect(world.donations).toHaveLength(0);
    expect(world.campaign.raisedAmount).toBe(0);
    const flagged = world.auditLogs.find((r) => r.eventType === 'donation.currency_mismatch');
    expect(flagged).toBeDefined();
    expect(flagged!.severity).toBe('critical');
    expect(flagged!.details).toMatchObject({ chargedCurrency: 'KES', campaignCurrency: 'USD' });
  });

  /*
    The hole the existing fixtures above exposed: checking only that the two
    AGREE lets `'' === ''` through, and the first thing to fail was then
    `formatMoney` INSIDE the transaction, after the donation row had been
    inserted - losing a real donation to a rollback whose error message was
    about string formatting.
  */
  it('refuses when both sides are blank, instead of agreeing on nothing', async () => {
    resetWorld(baseCampaign({ currency: '' }));

    await recordGatewayCharge(payheroCharge({ currency: '' }));

    expect(world.donations).toHaveLength(0);
    const flagged = world.auditLogs.find((r) => r.eventType === 'donation.currency_mismatch');
    expect(flagged).toBeDefined();
    expect(flagged!.details).toMatchObject({
      chargeCurrencySupported: false,
      campaignCurrencySupported: false,
    });
  });

  it('refuses a currency with no rail, even when both sides match', async () => {
    resetWorld(baseCampaign({ currency: 'NGN' }));

    await recordGatewayCharge(payheroCharge({ currency: 'NGN' }));

    expect(world.donations).toHaveLength(0);
    expect(
      world.auditLogs.find((r) => r.eventType === 'donation.currency_mismatch'),
    ).toBeDefined();
  });

  it('accepts a lowercase gateway currency, because Stripe sends it that way', async () => {
    resetWorld(baseCampaign({ currency: 'USD' }));

    await recordGatewayCharge(
      payheroCharge({ provider: 'stripe', providerRef: 'pi_lower', currency: 'usd' }),
    );

    expect(world.donations).toHaveLength(1);
    expect(world.donations[0].currency).toBe('USD');
  });
});

describe('recordGatewayCharge: a payment that lands after completion', () => {
  it('auto-refunds a Stripe charge', async () => {
    resetWorld(baseCampaign({ currency: 'USD', status: 'completed' }));

    await recordGatewayCharge(
      payheroCharge({ provider: 'stripe', providerRef: 'pi_late', currency: 'USD' }),
    );

    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_late' },
      { idempotencyKey: 'refund:auto:pi_late' },
    );
    expect(world.donations).toHaveLength(0);
  });

  /*
    PayHero exposes no refund API, so this money cannot be sent back
    automatically. Returning silently would leave the donor's money in the
    platform wallet with no donation row and no record that anybody owes it
    back - so it is written down at `critical` for a human to act on.
  */
  it('writes a critical audit row for PayHero rather than dropping it silently', async () => {
    resetWorld(baseCampaign({ currency: 'KES', status: 'completed' }));

    await recordGatewayCharge(payheroCharge());

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(world.donations).toHaveLength(0);

    const flagged = world.auditLogs.find(
      (r) => r.eventType === 'donation.manual_refund_required',
    );
    expect(flagged).toBeDefined();
    expect(flagged!.severity).toBe('critical');
    expect(flagged!.details).toMatchObject({
      provider: 'payhero',
      providerRef: 'payhero_E8UWT7CLUW',
      amount: 5_000,
      currency: 'KES',
      donorEmail: 'wanjiku@example.com',
    });
  });
});
