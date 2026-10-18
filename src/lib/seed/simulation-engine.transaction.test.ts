import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * P1-11: `runSimulation` wrote the donation, its message-wall mirror and the
 * campaign tally as three un-transacted statements, so a mid-run failure (or a
 * machine killed at `maxDuration`) could leave a donation with no tally, and
 * two overlapping runs could breach the 150% overfund cap because each carried
 * its own in-memory campaign total.
 *
 * The `db.insert` / `db.update` stubs below THROW. Any write that is not routed
 * through `db.transaction` therefore fails, which is exactly how this suite
 * fails against the pre-fix code.
 */

// ─── Mutable stubs (plain functions, so no mock reset can blank them) ───────

type Call = { op: string; table: string; inTx: boolean };

let calls: Call[] = [];
let campaignRows: Record<string, unknown>[] = [];
/** Rows the cap-guarded campaign UPDATE returns: [] means "cap reached". */
let tallyUpdateResult: { id: string }[] = [];
let insideTransaction = false;
let messageStub: string | null = 'Thinking of you.';
let transactionThrows: Error | null = null;

const donorStub = {
  displayName: 'Jane Donor',
  displayLocation: 'Portland, OR',
  isAnonymous: false,
};

/** A thenable that also supports `.returning()`, like a Drizzle query builder. */
function queryResult<T>(rows: T[]) {
  const promise = Promise.resolve(rows) as Promise<T[]> & { returning: () => Promise<T[]> };
  promise.returning = () => Promise.resolve(rows);
  return promise;
}

function tableNameOf(table: unknown): string {
  // Drizzle keeps the SQL name on a well-known symbol.
  const sym = Object.getOwnPropertySymbols(table as object).find((s) =>
    String(s).includes('Name'),
  );
  return sym ? String((table as Record<symbol, unknown>)[sym]) : 'unknown';
}

const txMock = {
  insert: (table: unknown) => ({
    values: () => {
      const name = tableNameOf(table);
      calls.push({ op: 'insert', table: name, inTx: insideTransaction });
      return queryResult([{ id: `${name}-row` }]);
    },
  }),
  update: (table: unknown) => ({
    set: () => ({
      where: () => {
        calls.push({ op: 'update', table: tableNameOf(table), inTx: insideTransaction });
        return queryResult(tallyUpdateResult);
      },
    }),
  }),
};

let transactionCount = 0;

async function fakeTransaction(cb: (tx: typeof txMock) => Promise<unknown>) {
  transactionCount++;
  if (transactionThrows) throw transactionThrows;
  insideTransaction = true;
  try {
    return await cb(txMock);
  } finally {
    insideTransaction = false;
  }
}

vi.mock('@/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(campaignRows) }) }),
    transaction: (cb: (tx: typeof txMock) => Promise<unknown>) => fakeTransaction(cb),
    insert: () => {
      throw new Error('UNTRANSACTED INSERT: seed writes must go through db.transaction');
    },
    update: () => {
      throw new Error('UNTRANSACTED UPDATE: seed writes must go through db.transaction');
    },
  },
}));

vi.mock('./donor-selector', () => ({
  selectSimulatedDonor: () => Promise.resolve(donorStub),
  maybeBuildCohort: () => null,
}));

vi.mock('./message-generator', () => ({
  pickSeedMessage: () => Promise.resolve(messageStub),
  generatePhaseTransitionMessages: () => Promise.resolve(undefined),
}));

vi.mock('./amount-generator', () => ({
  seedAmountCents: () => 5_000, // $50
}));

vi.mock('./trajectory-profiles', () => ({
  getActiveSurgeMultiplier: () => 1,
}));

vi.mock('@/lib/ai/call-ai', () => ({ callAI: () => Promise.resolve('{}') }));
vi.mock('@/lib/ai/openrouter', () => ({ ai: {} }));

const { runSimulation } = await import('./simulation-engine');

// ─── Fixtures ───────────────────────────────────────────────────────────────

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'campaign-1',
    title: 'Test',
    slug: 'test',
    status: 'active',
    goalAmount: 1_000_000, // $10,000 - one $50 donation cannot change phase
    raisedAmount: 0,
    donorCount: 0,
    category: 'medical',
    campaignProfile: null,
    campaignOrganizer: null,
    simulationConfig: null,
    simulationFlag: true,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: new Date(),
    ...overrides,
  };
}

let randomSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls = [];
  transactionCount = 0;
  insideTransaction = false;
  transactionThrows = null;
  messageStub = 'Thinking of you.';
  tallyUpdateResult = [{ id: 'campaign-1' }];
  campaignRows = [campaign()];
  // Lowest value: makes shouldDonateThisCycle fire and pins the cycle to one
  // donation, so the write path is exercised exactly once.
  randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  randomSpy.mockRestore();
});

describe('runSimulation donation writes (P1-11)', () => {
  it('writes the donation through a transaction, not as loose statements', async () => {
    const result = await runSimulation(1.0);

    expect(result.errors).toEqual([]);
    expect(result.donationsCreated).toBe(1);
    expect(transactionCount).toBe(1);
  });

  it('puts the donation, the message mirror, the tally and the counter in ONE transaction', async () => {
    await runSimulation(1.0);

    // All of them, same transaction, nothing outside it.
    expect(calls.every((c) => c.inTx)).toBe(true);
    expect(transactionCount).toBe(1);

    const ops = calls.map((c) => `${c.op}:${c.table}`);
    expect(ops).toContain('insert:donations');
    expect(ops).toContain('insert:campaign_messages');

    /*
      FOUR operations, not three. The fourth is `message_count`,
      which `insertCampaignMessage` moves in the same transaction as
      the row it counts (2026-10-18). Before that the counter was
      never incremented anywhere and `cron/reconcile` repaired it
      after the fact; this assertion used to read `toHaveLength(3)`
      and correctly noticed the change.
    */
    expect(ops).toHaveLength(4);
    expect(ops.filter((o) => o === 'update:campaigns')).toHaveLength(2);
  });

  it('takes the campaign row lock first, before inserting anything', async () => {
    await runSimulation(1.0);

    // The cap-guarded UPDATE must come first: it is what serialises concurrent
    // writers on the campaign and decides whether the donation may exist.
    expect(calls[0]).toMatchObject({ op: 'update', table: 'campaigns' });
  });

  it('creates no donation at all when the database refuses the tally', async () => {
    // The cap-guarded UPDATE matches no row: another writer already took the
    // campaign to its 150% cap, which the stale in-memory total cannot see.
    tallyUpdateResult = [];

    const result = await runSimulation(1.0);

    expect(result.donationsCreated).toBe(0);
    expect(result.errors).toEqual([]);
    // No orphan donation, no orphan message.
    expect(calls.filter((c) => c.op === 'insert')).toEqual([]);
  });

  it('skips the message mirror but keeps the transaction when there is no message', async () => {
    messageStub = null;

    const result = await runSimulation(1.0);

    expect(result.donationsCreated).toBe(1);
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      'update:campaigns',
      'insert:donations',
    ]);
  });

  it('counts no donation when the transaction itself fails', async () => {
    transactionThrows = new Error('deadlock detected');

    const result = await runSimulation(1.0);

    // The engine records the failure per campaign and counts no donation; the
    // transaction is what guarantees no half-written row survived it.
    expect(result.donationsCreated).toBe(0);
    expect(result.errors.join(' ')).toContain('deadlock detected');
  });
});

describe('the overfund cap is enforced by the database (P1-11)', () => {
  const source = readFileSync(
    path.resolve(__dirname, 'simulation-engine.ts'),
    'utf8',
  );

  it('guards the tally UPDATE with the cap and the overfund window', () => {
    // The cap must be a predicate on committed state. Checking it only in JS
    // against a per-run in-memory copy is what let two overlapping runs each
    // believe there was room.
    expect(source).toContain('db.transaction');
    expect(source).toMatch(/OVERFUND_CAP_PERCENT\}/);
    expect(source).toContain('completedAt} IS NULL OR');
  });

  it('leaves no un-transacted donation write behind', () => {
    // The cohort path had the same three-statement shape as the main loop.
    expect(source).not.toMatch(/db\s*\n?\s*\.insert\(schema\.donations\)/);
    expect(source).not.toMatch(/db\.insert\(schema\.donations\)/);
    expect(source).not.toMatch(/db\.insert\(schema\.campaignMessages\)/);
  });
});
