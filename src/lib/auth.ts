import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { UserRole } from '@/types';
import type { JWT } from 'next-auth/jwt';

/* ---- Credential failures (audit A4) --------------------------------------
 * The sign-in result code is reflected to the unauthenticated caller — it
 * reaches client JS as `result.code` and, on the redirect flow, lands in the
 * URL as `?code=...`. Emitting `no_account` / `oauth_only` / `invalid_password`
 * / `account_locked` therefore turned the login form into an account-existence
 * oracle: anyone could submit an email with a junk password and read off
 * whether that address has an account here, and whether it uses Google.
 *
 * On a platform that publishes medical and hardship appeals, "does this person
 * have an account" is itself sensitive, and the list is trivially enumerable.
 *
 * So: ONE code for every pre-authentication failure. The distinguishing detail
 * is kept, but only server-side, via `logAuthFailure` below.
 *
 * `password_reset_required` is deliberately kept distinct. It can only be
 * reached by a caller who supplied the CORRECT password against a legacy
 * unpeppered hash, so it reveals nothing to an enumerator — and collapsing it
 * would leave those users with no way to understand why they cannot get in.
 *
 * Keeping the OAuth-only case usable without leaking existence: the login page
 * already renders "Continue with Google" unconditionally, above the credential
 * form, so a Google-only user always has a working path. The generic failure
 * copy should name it ("check your email and password, or continue with
 * Google") — that copy is shown for every failure, so it discloses nothing.
 * See the report note on `src/app/login/page.tsx`, which still switches on the
 * old codes and needs that one copy change.
 */
class InvalidCredentialsError extends CredentialsSignin { code = 'invalid_credentials'; }
class PasswordResetRequiredError extends CredentialsSignin { code = 'password_reset_required'; }

/** Server-side-only reason for a credential rejection. Never sent to a client. */
type AuthFailureReason =
  | 'no_account'
  | 'oauth_only'
  | 'invalid_password'
  | 'account_locked'
  | 'password_reset_required';

/**
 * Record why a sign-in failed, at the fidelity the old error codes had, where
 * only operators can read it.
 *
 * Deliberately not written to the `audit_logs` table: an unauthenticated
 * endpoint that performs a DB INSERT per failed attempt is a write-amplification
 * lever. Durable audit storage for these events is tracked as follow-up.
 */
export function logAuthFailure(reason: AuthFailureReason, email: string): void {
  console.warn(
    `[auth] credential sign-in rejected reason=${reason} email=${email}`,
  );
}

/**
 * Absolute session lifetime per role (seconds), enforced in the `jwt` callback.
 * `@auth/core` re-signs the JWT and re-stamps `iat` on every session read, so
 * its own `maxAge` behaves as an IDLE timeout; these are the absolute caps.
 */
const SESSION_MAX_AGE: Record<UserRole, number> = {
  donor: 604800,    // 7 days
  editor: 86400,    // 24 hours
  admin: 28800,     // 8 hours
};

/**
 * Idle timeout handed to `@auth/core`. Must be >= the longest role cap, since
 * the role-specific cap is what actually bounds the session.
 *
 * Before this fix no `maxAge` was set at all, so `@auth/core`'s 30-day default
 * applied to admins (audit P1-4).
 */
const SESSION_IDLE_MAX_AGE = Math.max(...Object.values(SESSION_MAX_AGE));

/**
 * How stale a role claim may be before it is re-read from the database
 * (seconds). This is the revocation path for P1-4: demoting a rogue editor or
 * admin takes effect within a minute instead of never.
 *
 * Trade-off, stated explicitly because it is a real cost: for editors and
 * admins this is one indexed primary-key SELECT per session read once a minute
 * has elapsed, on top of the stateless JWT check. We keep `strategy: 'jwt'`
 * (per CLAUDE.md and docs/26 §1 that is what makes horizontal scale-out free);
 * this buys bounded revocation latency without reintroducing a database session
 * per request. Donors get a long interval because the only thing a stale donor
 * claim can hide is a *promotion*, which is not a security event.
 */
const ROLE_REVALIDATION_INTERVAL: Record<UserRole, number> = {
  donor: 3600,      // 1 hour
  editor: 60,       // 1 minute
  admin: 60,        // 1 minute
};

/**
 * How long to wait before retrying a role lookup that failed.
 *
 * Bounds the cost of an unreachable database to one attempt per session per
 * 30 seconds, instead of one per request. Deliberately well below the
 * 60-second admin/editor revalidation interval, so a database that comes back
 * is picked up quickly rather than waiting out a whole interval. See
 * `resolveSessionToken`.
 */
const ROLE_LOOKUP_RETRY_BACKOFF = 30;

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * A real bcrypt hash of a value nobody knows, used to spend the same CPU on a
 * miss as on a hit. Without it, "no such account" returns in microseconds while
 * a wrong password costs a full bcrypt round — a timing oracle that survives
 * collapsing the error codes.
 */
const DECOY_PASSWORD_HASH =
  '$2a$12$C6UzMDM.H6dfI/f/IKcEe.ONqvk1ybYuK1nkzN1cQZGMEeaLRRPFO';

function isUserRole(value: unknown): value is UserRole {
  return value === 'donor' || value === 'editor' || value === 'admin';
}

/**
 * Read a user's current role. Distinguishes "no such user" (null) from
 * "could not tell" (undefined), because the two must be handled differently
 * when deciding whether to invalidate a live session.
 */
async function readRole(userId: string): Promise<UserRole | null | undefined> {
  /*
    Never touch the database from middleware.

    This is the root cause of the production symptom the backoff in
    `resolveSessionToken` bounds. Middleware runs on the Edge runtime, and
    `src/middleware.ts` imports `auth` from this module, which pulls
    `src/db/index.ts` and the `postgres` driver in with it — the build says so
    on every deploy:

      A Node.js module is loaded ('stream' at line 1) which is not supported
      in the Edge Runtime.
        ./node_modules/postgres/src/index.js -> ./src/db/index.ts -> ./src/lib/auth.ts

    A TCP socket cannot be opened there, so the query never settles and the
    only thing that ends it is the 15-second client-side budget in
    `withQueryTimeout`, followed by a CancelRequest. Measured in production
    2026-10-21: once a minute, on a query the database plans and executes in
    0.126ms.

    Returning `undefined` means "could not tell", which this module already
    handles correctly: `resolveSessionToken` keeps the existing role claim.
    The difference is that it now costs nothing instead of 15 seconds and a
    pool connection.

    **Revalidation is not lost.** `auth()` is called from 69 files under
    `src/app`, every one of them Node runtime — server components and route
    handlers — so a role change is still picked up on the next page render or
    API call, which is also the only place a privileged action can happen.
    Middleware's job is coarse gating from the JWT claim; `docs/26` §1 and
    CLAUDE.md both say auth is JWT precisely so that scaling needs no
    per-request database read.

    Checked against `'edge'` explicitly rather than for the absence of
    `'nodejs'`: an unset `NEXT_RUNTIME` must fall through to the real lookup,
    not silently skip it. `src/instrumentation.ts` branches on the same signal.
  */
  if (process.env.NEXT_RUNTIME === 'edge') return undefined;

  try {
    const [dbUser] = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!dbUser) return null;
    return isUserRole(dbUser.role) ? dbUser.role : 'donor';
  } catch (err) {
    console.error('[auth] role lookup failed:', err);
    return undefined;
  }
}

/** A role lookup, injectable so the expiry/revocation rules can be tested. */
export type RoleLookup = (userId: string) => Promise<UserRole | null | undefined>;

/**
 * Decide what happens to an already-issued session token (audit P1-4).
 *
 * Returns the token to keep (possibly with a refreshed role claim), or `null`
 * to end the session. Exported and injectable because this is the entire
 * expiry-and-revocation rule, and `@auth/core` does not let a test reach the
 * `jwt` callback directly.
 */
export async function resolveSessionToken(
  token: JWT,
  nowSec: number = Math.floor(Date.now() / 1000),
  lookupRole: RoleLookup = readRole,
): Promise<JWT | null> {
  const userId = typeof token.id === 'string' ? token.id : null;
  const authAt = typeof token.authAt === 'number' ? token.authAt : null;

  // Tokens minted before this fix carry no `authAt`. They are the unexpirable,
  // unrevokable tokens P1-4 is about, so they are rejected rather than grandfathered.
  if (!userId || authAt === null) return null;

  const role = isUserRole(token.role) ? token.role : 'donor';

  // Absolute, role-scoped cap. This is enforced here and nowhere else: a JWT
  // session can only be ended by this callback returning null.
  if (nowSec - authAt > SESSION_MAX_AGE[role]) return null;

  const roleCheckedAt = typeof token.roleCheckedAt === 'number' ? token.roleCheckedAt : 0;
  if (nowSec - roleCheckedAt < ROLE_REVALIDATION_INTERVAL[role]) return token;

  /*
    Back off after a failed lookup instead of retrying on every request.

    Found in production 2026-10-21: `[auth] role lookup failed:
    QueryTimeoutError ... exceeded 15000ms` from middleware, once a minute,
    on a query the database plans and executes in 0.126ms. The lookup cannot
    currently succeed from the middleware bundle at all (see `readRole`), so
    it fails every time it is attempted.

    The original policy below was "keep the claim but do NOT advance
    roleCheckedAt, so the next request retries". With a lookup that always
    fails, that means EVERY request spends the full 15-second client-side
    budget and then a CancelRequest — so the cost scaled with traffic, not
    with the revalidation interval. One admin tab was enough to make it
    continuous.

    `docs/87` amendment 5 is the reason this matters more than it looks:
    enough concurrent client-side timeouts are precisely what exhausts the
    pool. The timeout wrapper cancels (`docs/52`), so each one does hand its
    connection back and this was not an imminent wedge — but a code path that
    manufactures a timeout per request is a wedge generator waiting for
    enough concurrency, and it belongs bounded.

    Security is unchanged in kind. The fail-open window was already "up to one
    revalidation interval" and is now "up to one interval plus one backoff",
    and the existing argument still covers it: every privileged route needs
    the same database, so a window in which the database is unreachable grants
    no usable capability.
  */
  const retryAfter = typeof token.roleRetryAfter === 'number' ? token.roleRetryAfter : 0;
  if (nowSec < retryAfter) return token;

  const fresh = await lookupRole(userId);

  // The row is gone (deleted / GDPR-erased user): end the session.
  if (fresh === null) return null;

  // Could not tell (database unreachable). Keep the existing claim and retry,
  // but not before `ROLE_LOOKUP_RETRY_BACKOFF` has passed. roleCheckedAt is
  // still NOT advanced, so a recovered database is picked up by the first
  // request after the backoff rather than waiting out a whole interval.
  if (fresh === undefined) {
    token.roleRetryAfter = nowSec + ROLE_LOOKUP_RETRY_BACKOFF;
    return token;
  }

  token.role = fresh;
  token.roleCheckedAt = nowSec;
  // Clear the backoff so a later failure is not measured from a stale mark.
  delete token.roleRetryAfter;
  return token;
}

async function checkAccountLocked(email: string): Promise<boolean> {
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

async function recordFailedAttempt(email: string): Promise<void> {
  const [user] = await db
    .select({
      failedLoginCount: schema.users.failedLoginCount,
      failedLoginWindowStart: schema.users.failedLoginWindowStart,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (!user) return;

  const now = new Date();

  if (!user.failedLoginWindowStart || now.getTime() - user.failedLoginWindowStart.getTime() > LOCKOUT_WINDOW_MS) {
    // Start a new window
    await db
      .update(schema.users)
      .set({ failedLoginCount: 1, failedLoginWindowStart: now })
      .where(eq(schema.users.email, email));
    return;
  }

  // Increment within the existing window
  await db
    .update(schema.users)
    .set({ failedLoginCount: user.failedLoginCount + 1 })
    .where(eq(schema.users.email, email));
}

async function clearFailedAttempts(email: string): Promise<void> {
  await db
    .update(schema.users)
    .set({ failedLoginCount: 0, failedLoginWindowStart: null })
    .where(eq(schema.users.email, email));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  // `strategy: 'jwt'` is load-bearing (CLAUDE.md, docs/26 §1): stateless
  // sessions are what make horizontal scale-out free. Do not switch to
  // database sessions. `maxAge` is the idle timeout; the absolute,
  // role-scoped cap is enforced in the `jwt` callback.
  session: { strategy: 'jwt', maxAge: SESSION_IDLE_MAX_AGE },
  jwt: { maxAge: SESSION_IDLE_MAX_AGE },
  pages: {
    signIn: '/login',
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    callbackUrl: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.callback-url'
        : 'next-auth.callback-url',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    csrfToken: {
      name: process.env.NODE_ENV === 'production'
        ? '__Host-next-auth.csrf-token'
        : 'next-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const rawEmail = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!rawEmail || !password) return null;
        const email = rawEmail.trim().toLowerCase();

        try {
          const { verifyPassword, verifyLegacyPassword } = await import('@/lib/password');

          if (await checkAccountLocked(email)) {
            logAuthFailure('account_locked', email);
            throw new InvalidCredentialsError();
          }

          const [user] = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.email, email))
            .limit(1);

          // Spend the same CPU whether or not the account exists, so the
          // response time does not restore the oracle the error codes used to
          // give away. The result is discarded.
          if (!user || !user.passwordHash) {
            await verifyPassword(password, DECOY_PASSWORD_HASH);
            logAuthFailure(user ? 'oauth_only' : 'no_account', email);
            throw new InvalidCredentialsError();
          }

          const valid = await verifyPassword(password, user.passwordHash);
          if (!valid) {
            // Check if this is a legacy (unpeppered) hash - correct password
            // but hash was created before the pepper was introduced.
            const isLegacyHash = await verifyLegacyPassword(password, user.passwordHash);
            if (isLegacyHash) {
              logAuthFailure('password_reset_required', email);
              throw new PasswordResetRequiredError();
            }
            await recordFailedAttempt(email);
            logAuthFailure('invalid_password', email);
            throw new InvalidCredentialsError();
          }

          await clearFailedAttempts(email);

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.avatarUrl,
          };
        } catch (err) {
          if (err instanceof CredentialsSignin) throw err;
          console.error('[auth] authorize error:', err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    /**
     * Audit P1-4. Three things happen here, and all three are load-bearing:
     *
     * 1. `authAt` — our own issued-at claim. We cannot use `iat`: `@auth/core`
     *    re-signs the token on every session read (`lib/actions/session.js`
     *    calls `jwt.encode`, and `jwt.js` calls `.setIssuedAt()`), so `iat`
     *    always says "just now". The previous role-expiry check read `iat` and
     *    was therefore dead on arrival, in addition to writing an `expires`
     *    value that nothing consumed.
     *
     * 2. Absolute, role-scoped expiry, enforced by returning `null`.
     *    `@auth/core` treats a `null` from this callback as "no session" and
     *    clears the session cookie, which is the only mechanism that actually
     *    ends a JWT session. (The deleted epoch-zero `expires` value in the
     *    `session` callback was read by nothing — the JWT stayed valid.)
     *
     * 3. Role revalidation against the database, so demoting a rogue
     *    editor/admin takes effect within `ROLE_REVALIDATION_INTERVAL` rather
     *    than whenever their token happens to expire.
     *
     * Note: tokens minted before this fix carry no `authAt` and are rejected,
     * so deploying this signs existing sessions out once. That is the intended
     * behaviour — the whole point of P1-4 is that those tokens are
     * unexpirable and unrevokable.
     */
    async jwt({ token, user }) {
      const nowSec = Math.floor(Date.now() / 1000);

      // ── Sign-in: mint the claims ────────────────────────────────────────
      if (user?.id) {
        token.id = user.id;
        token.authAt = nowSec;
        const role = await readRole(user.id);
        token.role = role ?? 'donor';
        token.roleCheckedAt = nowSec;
        return token;
      }

      // ── Subsequent reads: enforce expiry, then refresh the role ─────────
      return resolveSessionToken(token, nowSec);
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = isUserRole(token.role) ? token.role : 'donor';
      }
      // No expiry logic here: `expires` on the returned session object is
      // presentation-only and does not invalidate the JWT. Expiry is enforced
      // in the `jwt` callback above, which is the only place that can.
      return session;
    },
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

class ForbiddenError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'ForbiddenError';
  }
}

export async function requireRole(allowedRoles: UserRole[]) {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  const role = session.user.role as UserRole;
  if (!allowedRoles.includes(role)) throw new ForbiddenError();
  return session;
}

export { UnauthorizedError, ForbiddenError };
