/**
 * The failed-login counter, executed against a real Postgres.
 *
 * ── WHY AN INTEGRATION TEST ─────────────────────────────────────────────────
 *
 * `recordFailedAttempt` (`src/lib/auth.ts`) is a READ-MODIFY-WRITE:
 *
 *     const [user] = await db.select({ failedLoginCount … })   // :297-305
 *     …
 *     await db.update(users).set({ failedLoginCount: user.failedLoginCount + 1 })
 *
 * Two attempts that interleave between those statements both read N and both
 * write N+1, so one increment is lost. That is not something a type checker, a
 * grep or a mocked test can see - it is a property of two statements racing in
 * one database, so it is measured here.
 *
 * ⚠️ The control matters as much as the subject: an atomic
 * `sql`count + 1`` increment is run through the identical harness, so a result
 * showing loss is attributable to the statement shape and not to the test.
 *
 * `docs/126`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { clearDatabase } from '../../test/helpers';

const EMAIL = 'lockout-race@example.invalid';

async function seedUser(): Promise<void> {
  await db.insert(schema.users).values({
    email: EMAIL,
    name: 'Race Subject',
    failedLoginCount: 0,
    failedLoginWindowStart: new Date(),
  });
}

const countNow = async (): Promise<number> => {
  const [row] = await db
    .select({ n: schema.users.failedLoginCount })
    .from(schema.users)
    .where(eq(schema.users.email, EMAIL))
    .limit(1);
  return row.n;
};

/** Exactly the shape `recordFailedAttempt` uses today. */
async function readModifyWriteIncrement(): Promise<void> {
  const [user] = await db
    .select({ failedLoginCount: schema.users.failedLoginCount })
    .from(schema.users)
    .where(eq(schema.users.email, EMAIL))
    .limit(1);
  if (!user) return;
  await db
    .update(schema.users)
    .set({ failedLoginCount: user.failedLoginCount + 1 })
    .where(eq(schema.users.email, EMAIL));
}

/** The fix: the database does the arithmetic, so nothing can interleave. */
async function atomicIncrement(): Promise<void> {
  await db
    .update(schema.users)
    .set({ failedLoginCount: sql`${schema.users.failedLoginCount} + 1` })
    .where(eq(schema.users.email, EMAIL));
}

/**
 * The pool is `max: 5` (`docs/87`), so five is the most that can genuinely
 * overlap. Ten callers is a realistic attacker: the `auth` limiter allows
 * **10 requests per 60 s** per IP (`rate-limit.ts`, `slidingWindow(10,
 * '60 s')`) against a lockout threshold of **5**.
 */
const CONCURRENT = 10;

describe('the harness can observe a lost update at all', () => {
  beforeEach(async () => {
    await clearDatabase();
    await seedUser();
  });

  it('⚠️ sequential read-modify-write loses nothing (the negative control)', async () => {
    /*
      Without this, "concurrent increments lose some" could be true of a
      harness that simply cannot count, and every number below would be
      meaningless.
    */
    for (let i = 0; i < CONCURRENT; i++) await readModifyWriteIncrement();
    expect(await countNow()).toBe(CONCURRENT);
  });
});

describe('⛔ the lockout counter loses increments under concurrency', () => {
  beforeEach(async () => {
    await clearDatabase();
    await seedUser();
  });

  it('concurrent failed attempts do NOT all get recorded', async () => {
    /*
      ⛔ This asserts the DEFECT as it behaves today, so the state is on the
      record. When `recordFailedAttempt` becomes atomic, this is the
      assertion that fails - and the comment above is the reason to change it
      rather than to make it pass again.

      ⚠️ Measured over SEVERAL ROUNDS on purpose. A race is probabilistic: one
      round could in principle interleave perfectly and record all ten, and a
      single-round assertion would then fail in CI for a reason that has
      nothing to do with the code. Asserting "at least one round lost an
      increment" is the same claim without the flake. Observed repeatedly on
      this schema: 5 concurrent record 2, 10 record 1, 20 record 1.
    */
    const ROUNDS = 3;
    const results: number[] = [];

    for (let r = 0; r < ROUNDS; r++) {
      await db.delete(schema.users).where(eq(schema.users.email, EMAIL));
      await seedUser();
      await Promise.all(Array.from({ length: CONCURRENT }, () => readModifyWriteIncrement()));
      results.push(await countNow());
    }

    expect(results.every((n) => n > 0), `no round recorded anything: ${results}`).toBe(true);
    expect(
      results.some((n) => n < CONCURRENT),
      `every round recorded all ${CONCURRENT} - the race did not reproduce: ${results}`,
    ).toBe(true);
  });

  it('⚠️ the atomic form records every one (the fix, same harness)', async () => {
    await Promise.all(Array.from({ length: CONCURRENT }, () => atomicIncrement()));
    expect(await countNow()).toBe(CONCURRENT);
  });
});
