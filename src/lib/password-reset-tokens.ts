import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { verificationTokens } from '@/db/schema';

/**
 * The password-reset token lifecycle, and the per-address cooldown that bounds
 * what one stranger can do to somebody else's inbox and recovery link.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `POST /api/v1/auth/forgot-password` takes an address from an anonymous body
 * and, on every accepted call, (a) sends that address an email and (b) DELETES
 * the live reset token and mints a new one. The only control on it was the
 * `auth` rate-limit tier, which is `slidingWindow(10, '60 s')` **per IP**.
 *
 * [VERIFIED live against production, 2026-10-28] requests 1-10 answered 400
 * (handler) and 11-13 answered 429, so the tier is real, it is enforced on
 * this path, and ten a minute from one address is exactly what it permits.
 *
 * [VERIFIED against a real Postgres] a second request kills the first link:
 * reproducing the route's DELETE-then-INSERT, `token_one_valid` goes from
 * `t` to `f`. So anyone who knows an address could, from a single IP:
 *
 *   - put ten emails a minute into that inbox, off the one shared Resend
 *     quota every transactional email on this platform draws from; and
 *   - kill the recovery link roughly every six seconds, so the person
 *     reading the newest email has that long to click it before it dies.
 *
 * ⚠️ **Narrowed honestly.** Every one of those requests mails a FRESH, valid
 * link to the victim's own inbox, so this is a race, not a permanent lockout:
 * the newest email always works if they reach it in time. It composes badly
 * with the lockout, though, which is per email address by design
 * (`docs/126` §7) - so one stranger could hold an account locked and make
 * recovering it a race.
 *
 * ── THE CONTROL ─────────────────────────────────────────────────────────────
 *
 * A per-ADDRESS cooldown, not a tighter IP tier. This codebase has already
 * reasoned this out once, for the identical hazard: `phone-verification.ts:145`
 * carries a 60-second `RESEND_COOLDOWN_MS` and says why in its own comment -
 * *"A cooldown, not a rate-limit tier. Each send costs real money"* - and
 * `docs/85` states the general form, that an IP limit does not protect a
 * resource keyed by something other than IP. Email is the same shape at a
 * lower unit price: the cost lands on a mailbox and on a shared quota, neither
 * of which is keyed by who asked.
 *
 * ⚠️ The cooldown is claimed BEFORE the account lookup, so all three outcome
 * branches (`docs/74`: reset link, sign-in-with-Google, no account) share one
 * decision. A cooldown that applied only where a token is minted would
 * throttle real users and leave every non-user address unprotected, and the
 * difference would be observable.
 *
 * ⚠️ It does not reopen `docs/32`'s enumeration oracle. The HTTP response is
 * byte for byte the same whether a send happened or was suppressed, and
 * `docs/74`'s property still holds: the promise *"a reset link has been
 * sent"* stays true of that mailbox, because a send inside the last minute is
 * precisely what suppresses the next one.
 */

/** A reset link is good for an hour. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * One reset email per address per minute.
 *
 * The same figure as `RESEND_COOLDOWN_MS` in `phone-verification.ts`, and for
 * the same reason: above the honest case (a person asks once, and maybe once
 * more when the first does not arrive), far below a useful volume for anyone
 * spending our quota on somebody else's inbox.
 */
export const RESET_RESEND_COOLDOWN_MS = 60 * 1000;

/** The identifier holding a live reset token for an address. */
export function resetIdentifier(email: string): string {
  return `reset:${email}`;
}

/**
 * The identifier holding "we mailed this address recently".
 *
 * A separate prefix, so it can never be mistaken for a token: the reset route
 * looks up `reset:<email>` exactly, and `verification_tokens` is keyed
 * `(identifier, token)`, so a constant token gives one row per address rather
 * than one per attempt. `docs/85` noted there is nowhere on that table to hang
 * an attempt COUNT; a timestamp is all this needs, and `expires` is one.
 */
function cooldownIdentifier(email: string): string {
  return `reset-cooldown:${email}`;
}

/**
 * Every `verification_tokens.identifier` this module writes for an address.
 *
 * ⛔ Exported so account erasure has ONE place to ask, rather than a second
 * hand-written list of prefixes to keep in step. `verification_tokens` stores
 * the address in the identifier as PLAINTEXT and `anonymiseAccount` never
 * touched that table, so an erased person's `reset:<their address>` row
 * survived them - and this module would otherwise have added a second one.
 * `docs/124` was explicit that a hand-written scrub list is only as good as
 * whoever remembered to extend it. `docs/127`.
 */
export function authEmailIdentifiersFor(email: string): string[] {
  return [resetIdentifier(email), cooldownIdentifier(email)];
}

const COOLDOWN_TOKEN = 'cooldown';

/**
 * Claim the right to send this address a reset email, or report that somebody
 * already did inside the cooldown.
 *
 * ⛔ **One statement, and that is the point.** Reading the marker and then
 * writing it would be a read-modify-write across an `await`, and concurrency
 * is not an accident here - it is the attack. `docs/126` measured exactly that
 * shape on the login lockout: five concurrent attempts recorded 2, ten
 * recorded 1, and the control got weaker the harder it was pushed. The
 * decision and the write have to be the same statement.
 *
 * `ON CONFLICT … DO UPDATE … WHERE expires <= now` updates the row only when
 * the previous cooldown has lapsed, and `RETURNING` reports whether this
 * caller is the one that claimed it. A conflicting row still inside its window
 * matches no `WHERE`, so nothing is written and nothing is returned.
 *
 * ⚠️ `sql.param(value, column)` and not a bare `${date}` - an unencoded `Date`
 * in a `sql` template throws inside the driver (`docs/107`), and this
 * statement interpolates two of them.
 */
export async function claimResetSend(email: string, now: Date = new Date()): Promise<boolean> {
  const until = new Date(now.getTime() + RESET_RESEND_COOLDOWN_MS);
  const expires = verificationTokens.expires;

  const claimed = await db
    .insert(verificationTokens)
    .values({ identifier: cooldownIdentifier(email), token: COOLDOWN_TOKEN, expires: until })
    .onConflictDoUpdate({
      target: [verificationTokens.identifier, verificationTokens.token],
      set: { expires: sql`${sql.param(until, expires)}` },
      setWhere: sql`${expires} <= ${sql.param(now, expires)}`,
    })
    .returning({ token: verificationTokens.token });

  return claimed.length > 0;
}

/*
  ⛔ `POST /api/auth/register` is NOT given this treatment, and that is a
  decision rather than an omission. It mails the address on BOTH outcomes
  (`docs/39`), so a stranger can put the "somebody tried to sign up as you"
  notice into somebody else's inbox at the same ten a minute - the same hazard
  as above, minus the part that matters most, since no link is destroyed.

  Throttling only the duplicate branch creates a TIMING ORACLE: the second
  request for an existing address would skip a Resend round trip that the same
  request for a fresh address still makes. `notifications.ts:250` states that
  invariant outright - "keep the call shape identical ... so response time does
  not encode the outcome either" - and `docs/32`/`docs/39` are what it protects.
  Throttling both branches instead would withhold the welcome email a new
  account is told on screen to go and look for.

  So it needs a design that keeps both branches equal in cost (an off-request
  send, or a matched delay), which is a decision and not a copy-level fix.
  Reported in `docs/127` §7, not half-fixed.
*/

/**
 * Replace any live reset token for this address with a fresh one.
 *
 * Unchanged behaviour, moved out of the route handler **so that a test can run
 * it**. `auth.ts` could never be loaded by the node-environment integration
 * suite and a lost update survived there under 47 unit tests (`docs/126`);
 * `docs/107` moved a query into `report-periods.ts` for the same reason. A
 * route handler is the same kind of place: nothing in `src/**` is executed by
 * the integration suite from inside one.
 */
export async function issueResetToken(
  email: string,
  token: string,
  now: Date = new Date(),
): Promise<{ token: string; expires: Date }> {
  const expires = new Date(now.getTime() + RESET_TOKEN_TTL_MS);

  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, resetIdentifier(email)));
  await db.insert(verificationTokens).values({ identifier: resetIdentifier(email), token, expires });

  return { token, expires };
}

/** Read the live reset token for an address. Exported for tests. */
export async function liveResetToken(email: string): Promise<string | null> {
  const [row] = await db
    .select({ token: verificationTokens.token })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, resetIdentifier(email)),
        sql`${verificationTokens.expires} > now()`,
      ),
    )
    .limit(1);
  return row?.token ?? null;
}
