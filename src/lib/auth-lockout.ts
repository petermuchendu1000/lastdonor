/**
 * The failed-login lockout: five attempts in fifteen minutes, counted in the
 * database.
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 *
 * It lived in `src/lib/auth.ts`, which imports NextAuth, which imports
 * `next/server` - so nothing in the integration suite could import it, and
 * nothing could EXECUTE its SQL. That is how the defect below survived: a
 * read-modify-write is invisible to a type checker, to a grep, and to a
 * mocked test, and only shows itself when two statements race in a real
 * database. Moved here for the same reason `docs/107` moved a query into
 * `src/lib/report-periods.ts` - so that a test could run it. `docs/126`.
 *
 * `auth.ts` imports these three; nothing else should. The lockout is
 * `authorize()`'s business.
 */
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function checkAccountLocked(email: string): Promise<boolean> {
  const [user] = await db
    .select({
      failedLoginCount: schema.users.failedLoginCount,
      failedLoginWindowStart: schema.users.failedLoginWindowStart,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (!user?.failedLoginWindowStart) return false;

  const elapsed = Date.now() - user.failedLoginWindowStart.getTime();
  if (elapsed > LOCKOUT_WINDOW_MS) {
    // Window expired, reset
    await db
      .update(schema.users)
      .set({ failedLoginCount: 0, failedLoginWindowStart: null })
      .where(eq(schema.users.email, email));
    return false;
  }

  return user.failedLoginCount >= LOCKOUT_THRESHOLD;
}

/**
 * Record one failed sign-in, in a SINGLE statement.
 *
 * ── WHY THIS IS ONE STATEMENT AND NOT A READ THEN A WRITE ──────────────────
 *
 * This used to SELECT `failedLoginCount` and then write
 * `user.failedLoginCount + 1`, with an `await` in between. Concurrent failed
 * attempts all read N and all write N+1, so every increment but one was lost
 * - and the attacker chooses the concurrency, so the control got WEAKER the
 * harder it was attacked. Measured against a real Postgres on this schema:
 *
 *     sequential x10 (control) -> recorded 10
 *      5 concurrent attempts   -> recorded  2   under the threshold of 5
 *     10 concurrent attempts   -> recorded  1
 *     20 concurrent attempts   -> recorded  1
 *
 * The `auth` rate-limit tier is `slidingWindow(10, '60 s')` per IP, which is
 * ABOVE `LOCKOUT_THRESHOLD`, so the limiter never subsumed this - the lockout
 * was the binding control and parallelism defeated it. `docs/126`.
 *
 * ⛔ The window decision is in the CASE, not in TypeScript, because that is
 * the root cause: the branch and the write have to be the same statement. In
 * an UPDATE's SET list every column reference on the right-hand side reads
 * the row's PRE-UPDATE value, so both arms see the same window start.
 *
 * ⚠️ `sql.param(value, column)` and NOT `${cutoff}` - a bare `Date` in a `sql`
 * template binds with no encoder and throws inside the driver (`docs/107`).
 */
export async function recordFailedAttempt(email: string): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - LOCKOUT_WINDOW_MS);

  const windowStart = schema.users.failedLoginWindowStart;
  const startsNewWindow = sql`${windowStart} IS NULL OR ${windowStart} < ${sql.param(cutoff, windowStart)}`;

  await db
    .update(schema.users)
    .set({
      failedLoginCount: sql`CASE WHEN ${startsNewWindow} THEN 1 ELSE ${schema.users.failedLoginCount} + 1 END`,
      failedLoginWindowStart: sql`CASE WHEN ${startsNewWindow} THEN ${sql.param(now, windowStart)} ELSE ${windowStart} END`,
    })
    .where(eq(schema.users.email, email));
}

export async function clearFailedAttempts(email: string): Promise<void> {
  await db
    .update(schema.users)
    .set({ failedLoginCount: 0, failedLoginWindowStart: null })
    .where(eq(schema.users.email, email));
}
