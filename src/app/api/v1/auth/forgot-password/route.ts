import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, verificationTokens } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { resend } from '@/lib/resend';
import type { ApiError } from '@/types/api';
import { forgotPasswordSchema } from '@/lib/validators/user';
import { retryWithBackoff } from '@/lib/utils/retry';

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * POST /api/v1/auth/forgot-password
 * Body: { email: string }
 * Sends a password reset email if the user exists.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const body = await request.json();
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Valid email is required', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }
    const { email } = parsed.data;

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json({
      ok: true,
      data: { message: 'If an account with that email exists, a password reset link has been sent.' },
    });

    // Look up the user
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Only send if user exists and has a password (not OAuth-only)
    if (!user?.passwordHash) {
      return successResponse;
    }

    // Generate token
    const token = randomUUID();
    const expires = new Date(Date.now() + TOKEN_EXPIRY_MS);

    // Delete any existing tokens for this email
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, `reset:${email}`));

    // Insert new token
    await db.insert(verificationTokens).values({
      identifier: `reset:${email}`,
      token,
      expires,
    });

    // Send email.
    //
    // The token and the address travel in the query string because
    // `/login/reset-password` reads them from `useSearchParams`. A URL is the
    // leakiest place to put a credential — it reaches `Referer` headers,
    // browser history, server access logs, and any client-side telemetry that
    // captures `window.location`. Two of those are closed deliberately and
    // must stay closed:
    //
    //   1. `src/instrumentation-client.ts` strips `token` and `email` from
    //      every event, transaction and breadcrumb before Sentry sends it.
    //      Without that hook, `replaysOnErrorSampleRate: 1.0` uploaded a live
    //      account-takeover credential on any error on that page.
    //   2. `src/app/login/reset-password/layout.tsx` is `robots: { index:
    //      false }`.
    //
    // Moving the token into a POST body or a one-time-exchange cookie would
    // remove the class of problem rather than mitigating it, but that needs a
    // change to the reset page as well, so it is left as follow-up.
    const resetUrl = `${process.env.NEXTAUTH_URL || 'https://lastdonor.org'}/login/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    const { error: sendError } = await retryWithBackoff(
      () => resend.emails.send({
        from: 'LastDonor.org <noreply@lastdonor.org>',
        to: email,
        subject: 'Reset Your Password - LastDonor.org',
        html: `
          <div style="font-family: 'DM Sans', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h1 style="color: #0F766E; font-size: 24px;">Password Reset Request</h1>
            <p>We received a request to reset your password. Click the link below to set a new password:</p>
            <p style="margin: 24px 0;">
              <a href="${resetUrl}" style="background-color: #0F766E; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
                Reset Password
              </a>
            </p>
            <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px;">LastDonor.org</p>
          </div>
        `,
      }),
      // Resend resolves with {data:null,error} rather than throwing, so without
      // isFailure this password-reset email had no retry at all (docs/29 P0-4).
      { maxRetries: 2, baseDelayMs: 500, isFailure: (result) => Boolean(result?.error) },
    );

    if (sendError) {
      console.error('[forgot-password] Resend API error:', sendError);
    }

    return successResponse;
  } catch (error) {
    console.error('[POST /api/v1/auth/forgot-password]', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to process request', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
