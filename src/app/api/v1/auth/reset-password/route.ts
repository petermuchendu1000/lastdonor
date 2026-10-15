import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, verificationTokens } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  BREACHED_PASSWORD_MESSAGE,
  checkPwnedPassword,
  hashPassword,
} from '@/lib/password';
import type { ApiError } from '@/types/api';
import { resetPasswordApiSchema } from '@/lib/validators/user';

/** Shown for a token that is missing, already used, expired or orphaned. */
const INVALID_LINK_MESSAGE = 'Invalid or expired reset link';

/**
 * POST /api/v1/auth/reset-password
 * Body: { email: string, token: string, password: string }
 * Validates the token and sets a new password.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const body = await request.json();
    const parsed = resetPasswordApiSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const { email, token, password } = parsed.data;

    // Look up the token
    const [record] = await db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, `reset:${email}`),
          eq(verificationTokens.token, token),
        ),
      )
      .limit(1);

    if (!record) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: INVALID_LINK_MESSAGE, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Check expiration
    if (record.expires < new Date()) {
      // Clean up expired token
      await db
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, `reset:${email}`),
            eq(verificationTokens.token, token),
          ),
        );
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Reset link has expired. Please request a new one.', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Same breach bar as registration (docs/29 P3). Registration refused
    // known-breached passwords while reset accepted them, so the recovery flow
    // was the way around the control. Checked only AFTER the token is proven
    // valid, so this does not become a free HIBP proxy for anonymous callers.
    const pwned = await checkPwnedPassword(password);
    if (pwned) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: BREACHED_PASSWORD_MESSAGE, requestId, field: 'password' } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Hash new password and update user
    const passwordHash = await hashPassword(password);

    // Clearing the lockout counters is part of the reset, not a convenience.
    // `authorize()` checks `checkAccountLocked` BEFORE verifying the password
    // and only a SUCCESSFUL sign-in calls `clearFailedAttempts`, so a user who
    // tripped the 5-attempt lockout and then reset their password was still
    // refused with the new password until the 15-minute window aged out — and
    // the login page showed them a generic failure, so nothing explained it.
    // Proving control of the mailbox is stronger evidence of ownership than a
    // password, so there is no security argument for keeping the lock on.
    //
    // `.returning()` is load-bearing: `verification_tokens` has no foreign key
    // to `users`, so a token can outlive the row it refers to (deleted or
    // GDPR-erased user). Without checking the result this endpoint reported
    // "Password has been reset successfully" having updated zero rows.
    const updated = await db
      .update(users)
      .set({ passwordHash, failedLoginCount: 0, failedLoginWindowStart: null })
      .where(eq(users.email, email))
      .returning({ id: users.id });

    if (updated.length === 0) {
      // Orphaned token: valid, unexpired, but no user. Burn it so it cannot be
      // replayed, and answer exactly as for an unknown token — a distinct
      // status here would report "this address had an account and no longer
      // does", which is the enumeration leak docs/32 closed elsewhere.
      await db
        .delete(verificationTokens)
        .where(eq(verificationTokens.identifier, `reset:${email}`));
      console.warn(
        `[auth] password reset matched no user reason=orphaned_token email=${email}`,
      );
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: INVALID_LINK_MESSAGE, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Delete the used token
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, `reset:${email}`));

    return NextResponse.json({
      ok: true,
      data: { message: 'Password has been reset successfully. You can now log in.' },
    });
  } catch (error) {
    console.error('[POST /api/v1/auth/reset-password]', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to reset password', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
