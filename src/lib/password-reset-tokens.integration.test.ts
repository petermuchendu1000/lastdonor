/**
 * The per-address password-reset cooldown, executed against a real Postgres.
 *
 * ── WHAT IT HAS TO CATCH ────────────────────────────────────────────────────
 *
 * `POST /api/v1/auth/forgot-password` mails an address supplied by an
 * anonymous caller and, every time, deletes the live reset token and mints a
 * new one. Its only control was the `auth` tier - `slidingWindow(10, '60 s')`
 * **per IP**, [VERIFIED live against production: calls 1-10 answered 400 and
 * 11-13 answered 429]. So one stranger could mail an inbox ten times a minute
 * and kill the recovery link about every six seconds.
 *
 * ⛔ None of that is visible to a type checker, a grep or a mocked test. The
 * claim is a property of one statement racing itself in a database, which is
 * the `docs/126` lesson repeated: these tests call the REAL functions, never a
 * replica of their SQL.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { verificationTokens } from '@/db/schema';
import {
  RESET_RESEND_COOLDOWN_MS,
  RESET_TOKEN_TTL_MS,
  claimResetSend,
  issueResetToken,
  liveResetToken,
  resetIdentifier,
} from '@/lib/password-reset-tokens';
import { clearDatabase } from '../../test/helpers';

const EMAIL = 'reset-cooldown@example.invalid';

/*
  Imported, not mirrored. A copied constant drifts from the one that decides,
  and the test is then asserting yesterday's policy (`docs/126`).
*/
const COOLDOWN_MS = RESET_RESEND_COOLDOWN_MS;

describe('the statement executes at all, and claims', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('⚠️ the cheapest assertion and the one that matters most: it runs', async () => {
    /*
      `docs/107`: an unencoded `Date` in a `sql` template binds a parameter
      with no encoder and throws inside the driver, while typecheck and every
      unit test stay green. `claimResetSend` interpolates two Dates. If
      `sql.param` were dropped, this is where it surfaces.
    */
    await expect(claimResetSend(EMAIL)).resolves.toBe(true);
  });

  it('⚠️ the control: a first send for an untouched address is allowed', async () => {
    /*
      Without this, "a second send is suppressed" would also be satisfied by
      an implementation that suppresses everything - which is a denial of
      password recovery, not a control.
    */
    expect(await claimResetSend('somebody-else@example.invalid')).toBe(true);
  });
});

describe('⛔ one send per address per cooldown', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('a second send inside the window is refused', async () => {
    expect(await claimResetSend(EMAIL)).toBe(true);
    expect(await claimResetSend(EMAIL)).toBe(false);
  });

  it('⚠️ and is allowed again once the window has passed', async () => {
    const t0 = new Date();
    expect(await claimResetSend(EMAIL, t0)).toBe(true);

    const justInside = new Date(t0.getTime() + COOLDOWN_MS - 1_000);
    expect(await claimResetSend(EMAIL, justInside)).toBe(false);

    const justOutside = new Date(t0.getTime() + COOLDOWN_MS + 1_000);
    expect(await claimResetSend(EMAIL, justOutside)).toBe(true);
  });

  it('⚠️ throttles each address separately, not everybody at once', async () => {
    /*
      A per-address control must not become a global one. If the marker were
      keyed on anything shared, one person asking for a reset would silence
      everybody else's for a minute - a denial of service wearing the costume
      of a rate limit.
    */
    expect(await claimResetSend('alice@example.invalid')).toBe(true);
    expect(await claimResetSend('bob@example.invalid')).toBe(true);
    expect(await claimResetSend('alice@example.invalid')).toBe(false);
  });
});

describe('⛔ concurrent claims produce exactly one winner', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('ten at once send one email, not ten', async () => {
    /*
      ⛔ THE REGRESSION TEST, and the reason the claim is one statement.

      Concurrency is not an accident on this endpoint, it is the attack: the
      `auth` tier permits ten a minute from one IP and nothing stops them
      arriving together. A read-then-write claim would let every caller read
      "no cooldown" and every caller send - exactly the shape `docs/126`
      measured on the login lockout, where five concurrent attempts recorded 2.

      Several rounds, because a race is probabilistic and one round that
      happened to serialise would make a broken implementation look correct.
    */
    const ROUNDS = 3;
    const winners: number[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      await clearDatabase();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => claimResetSend(EMAIL)),
      );
      winners.push(results.filter(Boolean).length);
    }
    expect(winners, `more than one send claimed in a round: ${winners}`).toEqual(
      Array(ROUNDS).fill(1),
    );
  });
});

describe('⛔ the security property: a live link survives a second request', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('the token a person was emailed is still valid after somebody else asks', async () => {
    /*
      The whole point. [VERIFIED against a real Postgres before the fix] the
      route's DELETE-then-INSERT took `token_one_valid` from `t` to `f`, so
      the link in the victim's inbox died the moment anyone POSTed their
      address again.

      This models the route: a caller may only mint a token if it claimed the
      send. The attacker's claim is refused, so nothing is minted and the
      victim's link is untouched.
    */
    expect(await claimResetSend(EMAIL)).toBe(true);
    await issueResetToken(EMAIL, 'VICTIM-TOKEN');
    expect(await liveResetToken(EMAIL)).toBe('VICTIM-TOKEN');

    // The attacker, inside the cooldown.
    for (let i = 0; i < 10; i++) {
      const allowed = await claimResetSend(EMAIL);
      expect(allowed).toBe(false);
      if (allowed) await issueResetToken(EMAIL, `ATTACKER-${i}`);
    }

    expect(await liveResetToken(EMAIL)).toBe('VICTIM-TOKEN');
  });

  it('⚠️ the control: a genuine re-request after the cooldown DOES replace it', async () => {
    /*
      The single-live-token invariant is load-bearing for
      `reset-password/route.ts`, which looks up `reset:<email>` and a token
      together. If the fix had been "stop deleting the old token", a used or
      leaked link would stay valid for its full hour alongside the new one.
      It was not, and this asserts so.
    */
    const t0 = new Date();
    expect(await claimResetSend(EMAIL, t0)).toBe(true);
    await issueResetToken(EMAIL, 'FIRST-TOKEN', t0);

    const later = new Date(t0.getTime() + COOLDOWN_MS + 1_000);
    expect(await claimResetSend(EMAIL, later)).toBe(true);
    await issueResetToken(EMAIL, 'SECOND-TOKEN', later);

    expect(await liveResetToken(EMAIL)).toBe('SECOND-TOKEN');
    const rows = await db
      .select({ token: verificationTokens.token })
      .from(verificationTokens)
      .where(eq(verificationTokens.identifier, resetIdentifier(EMAIL)));
    expect(rows.map((r) => r.token)).toEqual(['SECOND-TOKEN']);
  });

  it('⚠️ a reset token still lasts the hour the email promises', async () => {
    const t0 = new Date();
    const { expires } = await issueResetToken(EMAIL, 'TTL-TOKEN', t0);
    expect(expires.getTime() - t0.getTime()).toBe(RESET_TOKEN_TTL_MS);
    expect(RESET_TOKEN_TTL_MS).toBeGreaterThan(COOLDOWN_MS);
  });
});
