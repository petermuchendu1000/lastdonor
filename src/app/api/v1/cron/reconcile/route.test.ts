/**
 * Reconcile must not be able to permanently kill itself.
 *
 * Both auto-corrections rewrite `campaigns.raised_amount` from the donation
 * rows. Neither clamped `total_released_amount`, so the moment a corrected
 * figure landed below what had already been released the
 * `campaigns_released_lte_raised` CHECK (`schema.ts:354`) fired. Step 1 caught
 * that per row; the step-4 drift loop had no try/catch, so the exception
 * escaped the loop, the handler 500'd, and step 5 (echo-column reconciliation)
 * never ran — every run, on the same row, for good.
 *
 * The fake database enforces the CHECK, so an unclamped UPDATE throws here the
 * way it throws in Postgres.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { NextRequest } from 'next/server';

const dialect = new PgDialect();

type Row = Record<string, unknown>;

interface Op {
  kind: 'select' | 'insert' | 'update';
  table: string;
  columns?: string[];
  values?: Row | Row[];
  set?: Row;
  returning: boolean;
}

const isSql = (v: unknown): v is SQL =>
  typeof v === 'object' && v !== null && 'queryChunks' in (v as Record<string, unknown>);

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

function evalSetValue(value: unknown, row: Row): unknown {
  if (!isSql(value)) return value;
  const q = dialect.sqlToQuery(value);
  let js = q.sql.replace(/\$(\d+)/g, (_m, i: string) => JSON.stringify(q.params[Number(i) - 1] ?? null));
  js = js.replace(/GREATEST/gi, 'Math.max').replace(/LEAST/gi, 'Math.min');
  js = js.replace(/"(\w+)"\."(\w+)"/g, (_m, _t: string, col: string) =>
    JSON.stringify(row[snakeToCamel(col)] ?? null),
  );
  // eslint-disable-next-line no-new-func
  return Function(`"use strict";return (${js});`)();
}

class FakeChain<T> implements PromiseLike<T> {
  constructor(private op: Op, private resolver: (op: Op) => unknown[]) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: any) { this.op.table = getTableName(table); return this; }
  where() { return this; }
  limit() { return this; }
  groupBy() { return this; }
  orderBy() { return this; }
  set(values: Row) { this.op.set = values; return this; }
  values(values: Row | Row[]) { this.op.values = values; return this; }
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

const C1 = '11111111-1111-1111-1111-111111111111';
const C2 = '22222222-2222-2222-2222-222222222222';

interface World {
  /** Completed campaigns, for step 1. */
  completed: Row[];
  /** Per-campaign donation totals, for step 1. */
  totals: Row[];
  /** Rows the step-4 drift query returns. */
  drifts: Row[];
  campaignsById: Map<string, Row>;
  auditLogs: Row[];
  executed: string[];
}

let world: World;

function campaign(id: string, overrides: Row = {}): Row {
  return {
    id,
    slug: `campaign-${id.slice(0, 4)}`,
    status: 'completed',
    raisedAmount: 10_000,
    donorCount: 2,
    totalReleasedAmount: 0,
    totalWithdrawnAmount: 0,
    completedAt: new Date(),
    ...overrides,
  };
}

function assertCheck(row: Row) {
  if (Number(row.totalReleasedAmount) > Number(row.raisedAmount)) {
    throw new Error(
      `23514: new row for relation "campaigns" violates check constraint ` +
      `"campaigns_released_lte_raised" (released=${row.totalReleasedAmount} raised=${row.raisedAmount})`,
    );
  }
}

/**
 * `.where()` is not evaluated here, so each UPDATE is applied to the campaign
 * the handler is currently iterating over. `currentTarget` tracks it.
 */
let currentTarget: string | null = null;

function resolver(op: Op): unknown[] {
  const key = `${op.kind}:${op.table}`;
  const cols = op.columns ?? [];

  switch (key) {
    case 'select:campaigns':
      // Step 2 (auto-archive) selects only id + title; step 1 selects everything.
      if (cols.length === 2 && cols.includes('title')) return [];
      return world.completed.map((c) => ({ ...c }));

    case 'select:donations':
      return world.totals.map((t) => ({ ...t }));

    case 'select:fund_pool_allocations':
      return [{ count: 0, total: 0 }];

    case 'select:users':
      return [];

    case 'insert:audit_logs':
      world.auditLogs.push(...[op.values ?? {}].flat());
      return [];

    case 'update:campaigns': {
      const row = currentTarget ? world.campaignsById.get(currentTarget) : undefined;
      if (!row) return [];
      const before = { ...row };
      for (const [k, v] of Object.entries(op.set ?? {})) row[k] = evalSetValue(v, before);
      assertCheck(row);
      return [{ ...row }];
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
        columns,
        returning: false,
      },
      resolver,
    );

  return {
    select: (c?: Row) => start('select', undefined, c ? Object.keys(c) : undefined),
    insert: (table: unknown) => start('insert', table),
    update: (table: unknown) => start('update', table),
  };
}

const dbMock = {
  ...makeClient(),
  // Step 4's drift query and step 5's echo-column UPDATE are raw SQL.
  execute: async (query: SQL) => {
    const text = dialect.sqlToQuery(query).sql;
    world.executed.push(text);
    if (text.includes('derived')) return world.drifts.map((d) => ({ ...d }));
    return { count: 0 };
  },
};

vi.mock('@/db', () => ({ db: dbMock }));
vi.mock('@/lib/cron-auth', () => ({ verifyCronAuth: () => true }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));
vi.mock('@/lib/locks', () => ({
  CRON_LOCKS: { reconcile: { name: 'reconcile' } },
  acquireCronLock: async () => ({ ok: true, lock: { release: async () => {} } }),
  lockSkipPayload: () => ({ ok: true, data: { skipped: true } }),
}));

const { GET } = await import('./route');

function request(): NextRequest {
  return { headers: new Headers({ authorization: 'Bearer test' }) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentTarget = null;
  world = {
    completed: [],
    totals: [],
    drifts: [],
    campaignsById: new Map(),
    auditLogs: [],
    executed: [],
  };
});

// ─── Step 1 · completed-campaign reconciliation ─────────────────────────────

describe('reconcile step 1 auto-correction', () => {
  it('clamps released when the corrected raised amount lands below it', async () => {
    const row = campaign(C1, { raisedAmount: 10_000, totalReleasedAmount: 10_000 });
    world.completed = [row];
    world.campaignsById.set(C1, row);
    // Only $40 of un-refunded donations survive: the rest were refunded.
    world.totals = [{ campaignId: C1, realTotal: 4_000, seedTotal: 0, donorCount: 1 }];
    currentTarget = C1;

    const res = await GET(request());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.discrepancies).toBe(1);
    // Pre-fix this UPDATE threw 23514 and step 1's per-row catch swallowed it
    // into results.errors, so the drift was logged but never repaired - every
    // run, for good.
    expect(payload.data.errors).toEqual([]);
    expect(row.raisedAmount).toBe(4_000);
    expect(row.totalReleasedAmount).toBe(4_000);
  });
});

// ─── Step 4 · which campaigns it even looks at ──────────────────────────────

/*
  The check used to read `status IN ('active', 'last_donor_zone',
  'paused')`. docs/79 then gated both creation paths to `under_review`,
  and by 2026-10-18 every campaign on the platform sat in a status this
  query did not select - a financial integrity control running against
  an empty set every night, silently.

  It is an exclusion list now, so a status added later is covered by
  default and leaving one out has to be written down.
*/
describe('reconcile step 4 scope (docs/87-era regression)', () => {
  function driftQuery(): string {
    const q = world.executed.find((text) => text.includes('derived') && text.includes('raised_amount'));
    expect(q, 'step 4 drift query was never executed').toBeTruthy();
    return q!;
  }

  it('does not restrict itself to a fixed list of live statuses', async () => {
    await GET(request());
    expect(driftQuery()).not.toMatch(/status\s+IN\s*\(/i);
  });

  it('filters on no status at all, so every campaign is checked', async () => {
    await GET(request());
    const q = driftQuery();
    // An exclusion list was the first fix and was itself wrong: step 1
    // auto-corrects `completed` rather than merely auditing it, so
    // excluding it protected nothing, and excluding `archived` left
    // that status covered by neither step.
    expect(q).not.toMatch(/NOT\s+IN/i);
    expect(q).not.toMatch(/status/i);
  });

  it('names no status as an exception, including completed and archived', async () => {
    await GET(request());
    const q = driftQuery();
    for (const status of [
      'under_review', 'paused', 'suspended', 'cancelled',
      'active', 'last_donor_zone', 'completed', 'archived', 'draft',
    ]) {
      expect(q, `${status} must not be excluded from the drift check`).not.toContain(`'${status}'`);
    }
  });

  it('corrects a drifting ARCHIVED campaign, which nothing used to check', async () => {
    const row = campaign(C2, { status: 'archived', raisedAmount: 5_000, totalReleasedAmount: 5_000 });
    world.campaignsById.set(C2, row);
    world.drifts = [{ id: C2, slug: 'old-appeal', stored: 5_000, derived: 1_200 }];
    currentTarget = C2;

    const res = await GET(request());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.activeCampaignDrifts).toBe(1);
    expect(payload.data.errors).toEqual([]);
    expect(row.raisedAmount).toBe(1_200);
    // Clamped, or `campaigns_released_lte_raised` would have thrown.
    expect(row.totalReleasedAmount).toBe(1_200);
  });

  it('still corrects a drifting under_review campaign end to end', async () => {
    const row = campaign(C2, { status: 'under_review', raisedAmount: 7_500, totalReleasedAmount: 0 });
    world.campaignsById.set(C2, row);
    world.drifts = [{ id: C2, slug: 'keisha-wallace', stored: 7_500, derived: 0 }];
    currentTarget = C2;

    const res = await GET(request());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.activeCampaignDrifts).toBe(1);
    expect(payload.data.errors).toEqual([]);
    expect(row.raisedAmount).toBe(0);
  });
});

// ─── Step 4 · active-campaign drift ─────────────────────────────────────────

describe('reconcile step 4 drift correction', () => {
  it('clamps released and still reaches step 5 when a correction would violate the CHECK', async () => {
    const row = campaign(C2, { status: 'active', raisedAmount: 9_000, totalReleasedAmount: 9_000 });
    world.campaignsById.set(C2, row);
    world.drifts = [{ id: C2, slug: 'help-maria', stored: 9_000, derived: 2_000 }];
    currentTarget = C2;

    const res = await GET(request());
    const payload = await res.json();

    // Pre-fix: the step-4 loop body had no try/catch, so 23514 escaped the
    // loop, the handler returned 500, and step 5 never ran.
    expect(res.status).toBe(200);
    expect(payload.data.activeCampaignDrifts).toBe(1);
    expect(payload.data.errors).toEqual([]);
    expect(row.raisedAmount).toBe(2_000);
    expect(row.totalReleasedAmount).toBe(2_000);
    // Step 5 ran: the echo-column UPDATE was issued.
    expect(world.executed.some((q) => q.includes('seed_donation_count'))).toBe(true);
  });

  it('keeps going and reports the row when a drift correction still fails', async () => {
    // No campaign row for this id, and the fake makes the UPDATE throw.
    world.drifts = [{ id: C2, slug: 'gone', stored: 9_000, derived: 2_000 }];
    const exploding = campaign(C2, { status: 'active' });
    world.campaignsById.set(C2, exploding);
    currentTarget = C2;
    Object.defineProperty(exploding, 'raisedAmount', {
      get: () => 1_000,
      set: () => { throw new Error('23514: simulated constraint failure'); },
    });

    const res = await GET(request());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.errors).toHaveLength(1);
    expect(payload.data.errors[0]).toContain(C2);
    // Step 5 still ran despite the failure.
    expect(world.executed.some((q) => q.includes('seed_donation_count'))).toBe(true);
  });
});
