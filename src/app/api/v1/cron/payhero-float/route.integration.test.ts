/**
 * The float alert, EXECUTED against a real Postgres.
 *
 * ── WHY A UNIT TEST CANNOT COVER THIS ───────────────────────────────────────
 *
 * The part of this job that can silently not work is the COOLDOWN, and it is a
 * SQL query: `eventType = …` AND `timestamp >= …` AND
 * `severity IN ('warning','error')`, ordered and limited. `docs/124` §5.1 is
 * the lesson - its route test mocked drizzle, and *"a mock cannot raise a
 * foreign-key or NOT NULL violation"*, so two branches that had never once
 * worked sat under a green suite. The same applies here in a milder form: a
 * mocked `db` returns whatever the mock says, so it would confirm my
 * expectations about the query rather than the query.
 *
 * `docs/107`, `docs/126` and `docs/130` all moved a statement somewhere a test
 * could run it, for exactly this reason. This one is already in a route, so
 * the test comes to the route.
 *
 * Only PayHero is mocked - it is an external wallet and calling it from a test
 * would read a real balance and spend a real request. The database, the audit
 * row and the cooldown are real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { clearDatabase, seedUser } from '../../../../../../test/helpers';
import { LOW_FLOAT_WARN_KES, LOW_FLOAT_EMAIL_COOLDOWN_HOURS } from '@/lib/payhero-float';

/*
  `verifyCronAuth` reads `process.env.CRON_SECRET` and returns false when it is
  unset (`cron-auth.ts:10-11`), and the integration setup does not define one -
  so without this every call 401s and all ten tests fail for a reason that has
  nothing to do with what they test. Set before the route module is imported.
*/
const CRON_SECRET = 'integration-float-secret-not-a-real-one';
process.env.CRON_SECRET = CRON_SECRET;

/** The wallet reading this run should see. Set per test. */
let walletBalance = 0;
let walletThrows: Error | null = null;

vi.mock('@/lib/payhero', () => ({
  isPayHeroConfigured: () => true,
  getWalletBalance: async () => {
    if (walletThrows) throw walletThrows;
    return { currency: 'KES', availableBalance: walletBalance, walletStatus: 'PENDING' };
  },
}));

/** The lock is Redis-backed; this suite is about the database half. */
vi.mock('@/lib/locks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/locks')>();
  return {
    ...actual,
    acquireCronLock: async () => ({
      ok: true,
      degraded: false,
      lock: { release: async () => {} },
    }),
  };
});

/** Count sends without touching Resend. */
const sent: string[] = [];
vi.mock('@/lib/resend', () => ({
  resend: {
    emails: {
      send: async ({ to }: { to: string }) => {
        sent.push(to);
        return { data: { id: 'test' }, error: null };
      },
    },
  },
  getResend: () => ({}),
}));

async function callRoute() {
  const { GET } = await import('./route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/v1/cron/payhero-float', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const res = await GET(req);
  return { status: res.status, body: await res.json() };
}

async function latestRow() {
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.eventType, 'cron.payhero_float'))
    .orderBy(desc(auditLogs.timestamp))
    .limit(1);
  return row;
}

async function seedAdmin(email: string) {
  await seedUser({ email, name: 'Ops', role: 'admin' });
}

describe('cron/payhero-float, against a real database', () => {
  beforeEach(async () => {
    await clearDatabase();
    sent.length = 0;
    walletThrows = null;
  });

  it('⛔ the reported symptom: a low float now tells somebody', async () => {
    /*
      This is the whole point. Before this job the condition was detectable
      (`/api/v1/health` judged it) and reached nobody.
    */
    await seedAdmin('ops1@example.test');
    walletBalance = 100;

    const { status, body } = await callRoute();
    expect(status).toBe(200);
    expect(body.data.isLow).toBe(true);
    expect(body.data.emailed).toBe(1);
    expect(sent).toEqual(['ops1@example.test']);
  });

  it('tells EVERY administrator, and records both counts', async () => {
    await seedAdmin('ops1@example.test');
    await seedAdmin('ops2@example.test');
    walletBalance = 10;

    const { body } = await callRoute();
    expect(sent.sort()).toEqual(['ops1@example.test', 'ops2@example.test']);
    const row = await latestRow();
    /*
      ⚠️ `warning`, not `error`. My first version of this asserted `error` and
      the CODE was right: KES 10 is above the KES 8.9 fee, so the float can
      still pay for exactly one more collection and is not exhausted. Left as
      a comment because the off-by-one is the obvious mistake to make here.
    */
    expect(row.severity).toBe('warning');
    expect((row.details as Record<string, unknown>).emailed).toBe(2);
    expect((row.details as Record<string, unknown>).recipients).toBe(2);
  });

  it('an exhausted float is severity error, a merely low one is warning', async () => {
    // The boundary is the fee itself: below it, not one more collection fits.
    walletBalance = 5;
    await callRoute();
    expect((await latestRow()).severity).toBe('error');

    await clearDatabase();
    walletBalance = 400;
    await callRoute();
    expect((await latestRow()).severity).toBe('warning');
  });

  it('⛔ the COOLDOWN works, and it works by reading the row the last run wrote', async () => {
    /*
      The real test of this file. The first run writes a `warning` row; the
      second must find it and suppress the email. No separate store, no
      in-memory flag - if the query is wrong, the second run mails again.
    */
    await seedAdmin('ops1@example.test');
    walletBalance = 100;

    await callRoute();
    expect(sent).toHaveLength(1);

    const second = await callRoute();
    expect(sent).toHaveLength(1); // still one
    expect(second.body.data.emailed).toBe(0);
    expect(second.body.data.emailSkippedReason).toMatch(
      new RegExp(`${LOW_FLOAT_EMAIL_COOLDOWN_HOURS}h`),
    );
  });

  it('and the cooldown EXPIRES, so the alert is suppressed and not cancelled', async () => {
    /*
      The other half, and the one that would make a bug invisible: a cooldown
      that never expires looks identical to a working one for as long as
      anybody watches.
    */
    await seedAdmin('ops1@example.test');
    walletBalance = 100;
    await callRoute();
    expect(sent).toHaveLength(1);

    // Age the warning row past the cooldown.
    const stale = new Date(Date.now() - (LOW_FLOAT_EMAIL_COOLDOWN_HOURS + 1) * 3_600_000);
    await db
      .update(auditLogs)
      .set({ timestamp: stale })
      .where(eq(auditLogs.eventType, 'cron.payhero_float'));

    await callRoute();
    expect(sent).toHaveLength(2);
  });

  it('⚠️ a HEALTHY run writes an info row that does NOT suppress a later alert', async () => {
    /*
      The severity filter is what makes this true, and getting it wrong would
      be silent: if healthy runs counted, one `info` row would mute the alert
      for six hours, and an hourly healthy job would mute it forever.
    */
    await seedAdmin('ops1@example.test');

    walletBalance = LOW_FLOAT_WARN_KES + 1000;
    await callRoute();
    expect(sent).toHaveLength(0);
    expect((await latestRow()).severity).toBe('info');

    walletBalance = 100;
    await callRoute();
    expect(sent).toHaveLength(1);
  });

  it('writes a row on EVERY run, so the float has a queryable history', async () => {
    // docs/123: a job that decides to do nothing says so. docs/136 §10
    // measured what the opposite costs.
    walletBalance = 5000;
    await callRoute();
    await callRoute();
    await callRoute();
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.eventType, 'cron.payhero_float'));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect((r.details as Record<string, unknown>).balanceKes).toBe(5000);
    }
  });

  it('⚠️ zero administrators is reported as such, not as a successful send', async () => {
    // `emailed: 0` without a reason is the kind of audit row nobody can use.
    walletBalance = 100;
    const { body } = await callRoute();
    expect(body.data.emailed).toBe(0);
    expect(body.data.emailSkippedReason).toMatch(/no administrator accounts exist/);
  });

  it('the provider-never-responds case: 500, an error row, and no claim of a reading', async () => {
    walletThrows = new Error('PayHero timed out');
    const { status, body } = await callRoute();
    expect(status).toBe(500);
    expect(body.error.code).toBe('FLOAT_CHECK_FAILED');

    const row = await latestRow();
    expect(row.severity).toBe('error');
    expect((row.details as Record<string, unknown>).failed).toBe(true);
    expect((row.details as Record<string, unknown>).balanceKes).toBeUndefined();
  });

  it('⛔ and a failed reading does NOT start the cooldown', async () => {
    /*
      It writes `severity: 'error'`, which the cooldown query matches - so a
      provider outage could suppress the next real alert. Asserted because the
      behaviour is a trade-off worth knowing about rather than a mistake: an
      alert suppressed for six hours after a failed read is better than one
      mailed every hour during an outage, and the failure itself is on the
      audit row either way.
    */
    await seedAdmin('ops1@example.test');
    walletThrows = new Error('PayHero timed out');
    await callRoute();

    walletThrows = null;
    walletBalance = 100;
    const { body } = await callRoute();
    expect(body.data.emailed).toBe(0);
    expect(body.data.emailSkippedReason).toMatch(/already recorded/);
  });

  it('rejects a request with no cron secret', async () => {
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest('http://localhost/api/v1/cron/payhero-float'));
    expect(res.status).toBe(401);
  });
});
