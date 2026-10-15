import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  BREACHED_PASSWORD_MESSAGE,
  checkPwnedPassword,
  hashPassword,
} from '@/lib/password';
import { registerSchema } from '@/lib/validators/user';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';

/* ---- Registration is not an account-existence oracle (audit A4) ------------
 *
 * This endpoint used to answer 409 CONFLICT "An account with this email
 * already exists." to any unauthenticated caller. That is the same oracle the
 * login form was deliberately stripped of in docs/32 — one HTTP request per
 * address tells you whether that person has an account here. On a platform
 * that publishes medical and hardship appeals, "has an account here" is itself
 * sensitive information about a named individual.
 *
 * So the duplicate-email path now returns the SAME status (201) and the SAME
 * body shape as a real creation, spends the SAME bcrypt work, and records the
 * real reason only in the server log.
 *
 * Residual gap, deliberately left to the owner of `src/app/register/page.tsx`
 * (not this file): that page auto-signs-in after a 201, so a duplicate address
 * fails the subsequent `signIn` and lands on /login while a fresh address lands
 * on the callback URL. The page already treats "created but auto-login failed"
 * the same way, so the fix there is to stop branching on the sign-in result —
 * but it cannot be done from this route.
 */

/** Server-side-only reason a registration attempt did not create a row. */
type RegisterFailureReason = 'email_taken';

/**
 * Record why a registration did not create an account, at the fidelity the
 * 409 response used to have, where only operators can read it.
 *
 * This mirrors `logAuthFailure` in `src/lib/auth.ts` rather than calling it:
 * that helper's `AuthFailureReason` union has no value for this case, and
 * importing it here would pull the whole NextAuth configuration (and its
 * `NextAuth()` side effect) into this route's module graph. Folding
 * `email_taken` into that union is a reasonable follow-up.
 *
 * Deliberately not written to `audit_logs`, for the same reason given there: an
 * unauthenticated endpoint that INSERTs per attempt is a write-amplification
 * lever.
 */
function logRegisterFailure(reason: RegisterFailureReason, email: string): void {
  console.warn(
    `[auth] registration rejected reason=${reason} email=${email}`,
  );
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const body = await request.json();
    const result = registerSchema.safeParse(body);

    if (!result.success) {
      const firstError = result.error.errors[0];
      const response: ApiError = {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: firstError?.message ?? 'Invalid input',
          field: firstError?.path.join('.'),
          requestId,
        },
      };
      return NextResponse.json(response, { status: 400 });
    }

    const { email, password, name } = result.data;

    // Breach check first, and for every caller: it runs before the existence
    // lookup so neither its outcome nor its (network-bound) latency can depend
    // on whether the address is already registered.
    const pwned = await checkPwnedPassword(password);
    if (pwned) {
      const response: ApiError = {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: BREACHED_PASSWORD_MESSAGE,
          field: 'password',
          requestId,
        },
      };
      return NextResponse.json(response, { status: 400 });
    }

    // Hash unconditionally, BEFORE the existence check. bcrypt at 12 rounds is
    // the dominant cost of this request, so skipping it on the duplicate path
    // would hand the timing channel back everything the status code used to
    // give away. This is the register-route counterpart of the
    // DECOY_PASSWORD_HASH work in `authorize()` (src/lib/auth.ts).
    const passwordHash = await hashPassword(password);

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      logRegisterFailure('email_taken', email);

      // Indistinguishable from a creation: same status, same body shape. The
      // `id` is a fresh random UUID, never the existing user's — echoing the
      // real id would both restore the oracle and leak an internal identifier
      // for an account this caller does not control. Nothing is written, and
      // no session is issued, so this grants no access to the existing account.
      return NextResponse.json(
        { ok: true, data: { id: randomUUID(), email, name } },
        { status: 201 },
      );
    }

    const [newUser] = await db
      .insert(users)
      .values({
        email,
        name,
        passwordHash,
        role: 'donor',
      })
      .returning({ id: users.id, email: users.email, name: users.name });

    return NextResponse.json(
      { ok: true, data: { id: newUser.id, email: newUser.email, name: newUser.name } },
      { status: 201 },
    );
  } catch (error) {
    console.error('[POST /api/auth/register]', error);
    const response: ApiError = {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Registration failed. Please try again.',
        requestId,
      },
    };
    return NextResponse.json(response, { status: 500 });
  }
}
