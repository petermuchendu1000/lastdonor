/**
 * The failed-login lockout, executed against a real Postgres.
 *
 * ── WHY AN INTEGRATION TEST, AND WHY IT RUNS THE REAL FUNCTION ─────────────
 *
 * `recordFailedAttempt` used to SELECT `failedLoginCount` and then write
 * `user.failedLoginCount + 1`, with an `await` between the two statements.
 * Concurrent failed sign-ins all read N and all wrote N+1, so every increment
 * but one was lost - and because the attacker chooses the concurrency, the
 * control got WEAKER the harder it was attacked. Measured on this schema
 * before the fix:
 *
 *     sequential x10 (control) -> recorded 10
 *      5 concurrent attempts   -> recorded  2   below the threshold of 5
 *     10 concurrent attempts   -> recorded  1
 *     20 concurrent attempts   -> recorded  1
 *
 * None of that is visible to a type checker, a grep, or a mocked test: it is
 * a property of two statements racing in one database. `docs/126`.
 *
 * ⛔ These tests call the REAL `recordFailedAttempt` and `checkAccountLocked`,
 * not a replica of their SQL. A replica would be the `docs/101` trap in test
 * form - it would prove what I believe the code does rather than what it does.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MS,
  checkAccountLocked,
  recordFailedAttempt,
} from '@/lib/auth-lockout';
import { clearDatabase } from '../../test/helpers';

const EMAIL = 'lockout-race@example.invalid';

/*
  Imported, not mirrored. A copy of a constant drifts from the one that
  decides, and then the test is asserting yesterday's policy.
*/
const THRESHOLD = LOCKOUT_THRESHOLD;
const WINDOW_MS = LOCKOUT_WINDOW_MS;

/**
 * The pool is `max: 5` (`docs/87`), so five is the most that can genuinely
 * overlap. Ten callers is a realistic attacker: the `auth` limiter allows
 * **10 requests per 60 s** per IP (`rate-limit.ts`, `slidingWindow(10,
 * '60 s')`), which is ABOVE the lockout threshold - so the limiter never
 * subsumed this control.
 */
const CONCURRENT = 10;

async function seedUser(windowStart: Date | null = new Date(), count = 0): Promise<void> {
  await db.delete(schema.users).where(eq(schema.users.email, EMAIL));
  await db.insert(schema.users).values({
    email: EMAIL,
    name: 'Race Subject',
    failedLoginCount: count,
    failedLoginWindowStart: windowStart,
  });
}

async function counters(): Promise<{ count: number; windowStart: Date | null }> {
  const [row] = await db
    .select({
      count: schema.users.failedLoginCount,
      windowStart: schema.users.failedLoginWindowStart,
    })
    .from(schema.users)
    .where(eq(schema.users.email, EMAIL))
    .limit(1);
  return row;
}

describe('the statement executes at all, and counts', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('⚠️ the cheapest assertion and the one that matters most: it runs', async () => {
    /*
      `docs/107`: an inline `sql` template that interpolates a bare `Date`
      binds a parameter with no encoder and throws inside the driver, while
      typecheck and every unit test stay green. This statement interpolates
      two Dates. If `sql.param` were dropped, this is where it surfaces.
    */
    await seedUser();
    await expect(recordFailedAttempt(EMAIL)).resolves.not.toThrow();
    expect((await counters()).count).toBe(1);
  });

  it('counts sequentially, so the harness can count', async () => {
    await seedUser();
    for (let i = 0; i < CONCURRENT; i++) await recordFailedAttempt(EMAIL);
    expect((await counters()).count).toBe(CONCURRENT);
  });

  it('⚠️ does nothing for an address with no account', async () => {
    // The old version returned early on a missing row; the UPDATE simply
    // matches nothing. Asserted so that behaviour is not lost silently.
    await clearDatabase();
    await expect(recordFailedAttempt('nobody@example.invalid')).resolves.not.toThrow();
  });
});

describe('⛔ concurrent failed attempts are all recorded', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('ten at once record ten, not one', async () => {
    /*
      ⛔ THE REGRESSION TEST. Against the read-modify-write this recorded 1.
      Run over several rounds because a race is probabilistic: a single round
      that happened to serialise would have made the OLD code look correct.
    */
    const ROUNDS = 3;
    const seen: number[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      await seedUser();
      await Promise.all(Array.from({ length: CONCURRENT }, () => recordFailedAttempt(EMAIL)));
      seen.push((await counters()).count);
    }
    expect(seen, `lost increments in at least one round: ${seen}`).toEqual(
      Array(ROUNDS).fill(CONCURRENT),
    );
  });

  it('⛔ and the security property itself: five at once LOCKS the account', async () => {
    /*
      The point of the whole thing. Before the fix, five simultaneous guesses
      recorded 2 and `checkAccountLocked` returned false, so the attacker
      simply continued.
    */
    await seedUser();
    await Promise.all(Array.from({ length: THRESHOLD }, () => recordFailedAttempt(EMAIL)));

    expect((await counters()).count).toBe(THRESHOLD);
    expect(await checkAccountLocked(EMAIL)).toBe(true);
  });

  it('⚠️ the control: one below the threshold does NOT lock', async () => {
    /*
      Without this, "five concurrent attempts lock the account" would also be
      satisfied by an implementation that locks everybody always - which is a
      denial of service, not a control.
    */
    await seedUser();
    await Promise.all(
      Array.from({ length: THRESHOLD - 1 }, () => recordFailedAttempt(EMAIL)),
    );

    expect((await counters()).count).toBe(THRESHOLD - 1);
    expect(await checkAccountLocked(EMAIL)).toBe(false);
  });
});

describe('⚠️ the window boundary, on both sides', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('an attempt INSIDE the window increments and keeps the window start', async () => {
    const started = new Date(Date.now() - WINDOW_MS / 2);
    await seedUser(started, 3);

    await recordFailedAttempt(EMAIL);

    const after = await counters();
    expect(after.count).toBe(4);
    expect(after.windowStart?.getTime()).toBe(started.getTime());
  });

  it('an attempt AFTER the window starts a fresh one at 1', async () => {
    /*
      The branch that used to live in TypeScript and now lives in the CASE.
      A count of 4 from an expired window must NOT carry over, or an honest
      user who mistyped weeks ago is locked by one slip today.
    */
    const stale = new Date(Date.now() - WINDOW_MS - 60_000);
    await seedUser(stale, 4);

    await recordFailedAttempt(EMAIL);

    const after = await counters();
    expect(after.count).toBe(1);
    expect(after.windowStart!.getTime()).toBeGreaterThan(stale.getTime());
    expect(await checkAccountLocked(EMAIL)).toBe(false);
  });

  it('⚠️ a NULL window start is treated as a fresh window', async () => {
    await seedUser(null, 0);
    await recordFailedAttempt(EMAIL);

    const after = await counters();
    expect(after.count).toBe(1);
    expect(after.windowStart).not.toBeNull();
  });

  it('⚠️ concurrent attempts on an EXPIRED window do not resurrect the old count', async () => {
    /*
      The case the split read/write could get wrong in the other direction:
      some callers reading the stale window take the "new window" arm while
      others take the increment arm, so the carried-over count depends on
      scheduling. One statement cannot disagree with itself.
    */
    const stale = new Date(Date.now() - WINDOW_MS - 60_000);
    await seedUser(stale, 4);

    await Promise.all(Array.from({ length: CONCURRENT }, () => recordFailedAttempt(EMAIL)));

    // Every caller sees the same pre-update row, so each takes the new-window
    // arm: the count is the number of attempts, never 4 + anything.
    const after = await counters();
    expect(after.count).toBeLessThanOrEqual(CONCURRENT);
    expect(after.count).toBeGreaterThan(0);
    expect(after.windowStart!.getTime()).toBeGreaterThan(stale.getTime());
  });
});

describe('⚠️ the database still guards the column', () => {
  it('the live CHECK keeps the counter non-negative', async () => {
    /*
      [VERIFIED against production] `users_failed_login_nonneg` is
      `CHECK (failed_login_count >= 0)`. An increment cannot violate it, which
      is why this fix needs no constraint change - asserted here so that a
      future change to the column notices the constraint exists.
    */
    await clearDatabase();
    await seedUser(new Date(), 0);
    await expect(
      db
        .update(schema.users)
        .set({ failedLoginCount: sql`${schema.users.failedLoginCount} - 1` })
        .where(eq(schema.users.email, EMAIL)),
    ).rejects.toThrow();
  });
});
