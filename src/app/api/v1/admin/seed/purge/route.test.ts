/**
 * Seed purge recomputes `raised_amount` for EVERY campaign in one batch
 * UPDATE. Without a `total_released_amount` clamp in the same statement, a
 * single fully-verified campaign (released == raised) whose seed money is
 * being removed trips `campaigns_released_lte_raised` (`schema.ts:354`) and
 * 500s the entire purge — nothing is recomputed for any campaign.
 *
 * The statement is raw SQL over the whole table, so the clamp is asserted on
 * the statement itself rather than on one row's outcome.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { NextRequest } from 'next/server';

const dialect = new PgDialect();

type Row = Record<string, unknown>;

interface Op {
  kind: 'select' | 'insert' | 'update' | 'delete';
  table: string;
  columns?: string[];
}

class FakeChain<T> implements PromiseLike<T> {
  constructor(private op: Op, private resolver: (op: Op) => unknown[]) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: any) { this.op.table = getTableName(table); return this; }
  where() { return this; }
  limit() { return this; }
  set() { return this; }
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

const executed: string[] = [];

function resolver(op: Op): unknown[] {
  if (op.kind === 'select') return [{ count: 3, totalAmount: 4_500 }];
  return [];
}

function makeClient() {
  const start = (kind: Op['kind'], table?: unknown, columns?: string[]) =>
    new FakeChain(
      {
        kind,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        table: table ? getTableName(table as any) : '',
        columns,
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

const dbMock = {
  ...makeClient(),
  execute: async (query: SQL) => {
    executed.push(dialect.sqlToQuery(query).sql);
    return { count: 0 };
  },
};

vi.mock('@/db', () => ({ db: dbMock }));
vi.mock('@/lib/auth', () => ({
  requireRole: async () => ({ user: { id: '22222222-2222-2222-2222-222222222222', role: 'admin' } }),
}));

const { POST } = await import('./route');

const request = () => ({} as unknown as NextRequest);

beforeEach(() => {
  vi.clearAllMocks();
  executed.length = 0;
});

describe('seed purge campaign recomputation', () => {
  it('clamps total_released_amount in the same UPDATE that rewrites raised_amount', async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);

    const recompute = executed.find((q) => q.includes('raised_amount = sub.total_amount'));
    expect(recompute).toBeDefined();

    const normalized = recompute!.replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'total_released_amount = LEAST(campaigns.total_released_amount, sub.total_amount)',
    );
  });
});
