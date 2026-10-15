/**
 * Lump-sum release must exclude seed money (audit P0).
 *
 * `approve_t2` set `totalReleasedAmount = campaign.raisedAmount`, read without
 * a lock before the update. But `raised_amount` is a BLENDED figure: the
 * simulation engine increments the same column for donations written with
 * `source = 'seed'`, which are fabricated and carry no money. A campaign
 * showing $40,000 of which $38,000 was seeded therefore released $40,000 of
 * real platform money to the creator.
 *
 * The fix sums the real, un-refunded donations in the UPDATE itself, inside
 * the transaction that sets verification_status. The fake Drizzle below renders
 * the real SQL and evaluates it against a small donations table, so the test
 * exercises the actual expression rather than a restatement of it.
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
  set?: Row;
  values?: Row;
  locking: boolean;
}

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';
const CREATOR_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';

interface Donation {
  campaignId: string;
  amount: number;
  source: 'real' | 'seed';
  refunded: boolean;
}

interface World {
  campaign: Row;
  donations: Donation[];
  auditLogs: Row[];
  sawForUpdate: boolean;
}

let world: World;

const isSql = (v: unknown): v is SQL =>
  typeof v === 'object' && v !== null && 'queryChunks' in (v as Record<string, unknown>);

/**
 * Evaluates the rendered SET expression.
 *
 * Only the two shapes this route produces are supported: a LEAST(...) wrapper
 * around a correlated SUM over `donations`, and bare column references to the
 * campaign row.
 */
function evalSetValue(value: unknown, row: Row): unknown {
  if (!isSql(value)) return value;

  const { sql: text, params } = dialect.sqlToQuery(value);
  const flat = text.replace(/\s+/g, ' ');

  const sumMatch = /SELECT COALESCE\(SUM\("donations"\."amount"\), 0\)::int/i.test(flat);
  if (!sumMatch) throw new Error(`unsupported SET expression: ${flat}`);

  // The filters are asserted on the rendered SQL, so a silently dropped
  // predicate (e.g. source) fails the test rather than passing by luck.
  const wantsReal = /"donations"\."source" = 'real'/.test(flat) || params.includes('real');
  const wantsUnrefunded = /"donations"\."refunded" = false/.test(flat) || params.includes(false);

  const sum = world.donations
    .filter((d) => d.campaignId === CAMPAIGN_ID)
    .filter((d) => (wantsReal ? d.source === 'real' : true))
    .filter((d) => (wantsUnrefunded ? !d.refunded : true))
    .reduce((acc, d) => acc + d.amount, 0);

  if (/LEAST/i.test(flat)) return Math.min(sum, Number(row.raisedAmount ?? 0));
  return sum;
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

function resolver(op: Op): unknown[] {
  switch (`${op.kind}:${op.table}`) {
    case 'select:campaigns':
      if (op.locking) world.sawForUpdate = true;
      return [{ ...world.campaign }];

    case 'update:campaigns': {
      const before = { ...world.campaign };
      for (const [key, value] of Object.entries(op.set ?? {})) {
        world.campaign[key] = evalSetValue(value, before);
      }
      return [{ ...world.campaign }];
    }

    case 'insert:audit_logs':
      world.auditLogs.push({ ...op.values });
      return [];

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
      { kind, table: table ? getTableName(table as any) : '', locking: false },
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

const requireRole = vi.fn();
vi.mock('@/lib/auth', () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));

vi.mock('@/lib/notifications', () => ({
  notifyCreatorVerificationApproved: vi.fn().mockResolvedValue(undefined),
  notifyCreatorVerificationRejected: vi.fn().mockResolvedValue(undefined),
  notifyInfoRequest: vi.fn().mockResolvedValue(undefined),
}));

const { PATCH } = await import('./route');

const params = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };

function request(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({ user: { id: ADMIN_ID, role: 'admin' } });
  world = {
    campaign: {
      id: CAMPAIGN_ID,
      creatorId: CREATOR_ID,
      title: 'Help Maria',
      slug: 'help-maria',
      verificationStatus: 'identity_verified',
      raisedAmount: 4_000_000,
      totalReleasedAmount: 0,
    },
    donations: [],
    auditLogs: [],
    sawForUpdate: false,
  };
});

describe('PATCH admin verification - approve_t2 release basis', () => {
  it('releases only the real donations, not the blended raised amount', async () => {
    // $40,000 raised, of which $38,000 is fabricated seed money.
    world.donations = [
      { campaignId: CAMPAIGN_ID, amount: 200_000, source: 'real', refunded: false },
      { campaignId: CAMPAIGN_ID, amount: 3_800_000, source: 'seed', refunded: false },
    ];

    const res = await PATCH(request({ action: 'approve_t2' }), params);

    expect(res.status).toBe(200);
    expect(world.campaign.verificationStatus).toBe('fully_verified');
    // $2,000 of real money, NOT $40,000.
    expect(world.campaign.totalReleasedAmount).toBe(200_000);
  });

  it('excludes refunded donations from the release', async () => {
    world.donations = [
      { campaignId: CAMPAIGN_ID, amount: 150_000, source: 'real', refunded: false },
      { campaignId: CAMPAIGN_ID, amount: 100_000, source: 'real', refunded: true },
      { campaignId: CAMPAIGN_ID, amount: 500_000, source: 'seed', refunded: false },
    ];

    await PATCH(request({ action: 'approve_t2' }), params);

    expect(world.campaign.totalReleasedAmount).toBe(150_000);
  });

  it('releases nothing when every donation is seeded', async () => {
    world.donations = [
      { campaignId: CAMPAIGN_ID, amount: 4_000_000, source: 'seed', refunded: false },
    ];

    await PATCH(request({ action: 'approve_t2' }), params);

    expect(world.campaign.totalReleasedAmount).toBe(0);
    expect(world.campaign.verificationStatus).toBe('fully_verified');
  });

  it('never releases more than raised_amount, so the released<=raised CHECK holds', async () => {
    // A partially-failed bulk refund zeroes raised_amount while leaving some
    // donations un-refunded. Releasing the raw sum would abort the whole
    // transaction and leave the verification decision unrecorded.
    world.campaign.raisedAmount = 0;
    world.donations = [
      { campaignId: CAMPAIGN_ID, amount: 150_000, source: 'real', refunded: false },
    ];

    const res = await PATCH(request({ action: 'approve_t2' }), params);

    expect(res.status).toBe(200);
    expect(world.campaign.totalReleasedAmount).toBe(0);
  });

  it('computes the release under the campaign row lock, in the transaction that sets the status', async () => {
    world.donations = [{ campaignId: CAMPAIGN_ID, amount: 100_000, source: 'real', refunded: false }];

    await PATCH(request({ action: 'approve_t2' }), params);

    expect(world.sawForUpdate).toBe(true);
  });

  it('records both the released figure and the blended raised figure in the audit log', async () => {
    world.donations = [
      { campaignId: CAMPAIGN_ID, amount: 200_000, source: 'real', refunded: false },
      { campaignId: CAMPAIGN_ID, amount: 3_800_000, source: 'seed', refunded: false },
    ];

    await PATCH(request({ action: 'approve_t2' }), params);

    const entry = world.auditLogs.at(-1);
    expect(entry?.eventType).toBe('verification_approve_t2');
    expect(entry?.details).toMatchObject({
      releasedAmount: 200_000,
      blendedRaisedAmount: 4_000_000,
    });
  });
});

describe('PATCH admin verification - other actions do not release', () => {
  it('approve_t1 leaves totalReleasedAmount alone', async () => {
    world.campaign.verificationStatus = 'documents_uploaded';
    world.donations = [{ campaignId: CAMPAIGN_ID, amount: 200_000, source: 'real', refunded: false }];

    const res = await PATCH(request({ action: 'approve_t1' }), params);

    expect(res.status).toBe(200);
    expect(world.campaign.verificationStatus).toBe('identity_verified');
    expect(world.campaign.totalReleasedAmount).toBe(0);
  });

  it('reject leaves totalReleasedAmount alone', async () => {
    const res = await PATCH(request({ action: 'reject', notes: 'Documents do not match' }), params);

    expect(res.status).toBe(200);
    expect(world.campaign.verificationStatus).toBe('rejected');
    expect(world.campaign.totalReleasedAmount).toBe(0);
  });

  it('refuses a transition the current status does not allow', async () => {
    world.campaign.verificationStatus = 'unverified';

    const res = await PATCH(request({ action: 'approve_t2' }), params);

    expect(res.status).toBe(409);
    expect(world.campaign.totalReleasedAmount).toBe(0);
  });
});
