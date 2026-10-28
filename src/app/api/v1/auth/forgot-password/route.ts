import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { accounts, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import { forgotPasswordSchema } from '@/lib/validators/user';
import { notifyPasswordResetOutcome } from '@/lib/notifications';
import { claimResetSend, issueResetToken } from '@/lib/password-reset-tokens';

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

    /*
      One send per address per minute, claimed BEFORE the account lookup so
      every outcome branch shares the decision.

      Until this existed the only control was the `auth` tier,
      `slidingWindow(10, '60 s')` per IP - [VERIFIED live, 2026-10-28: calls
      1-10 answered 400 and 11-13 answered 429] - which is per CALLER, while
      the cost of this endpoint lands on a MAILBOX and on the shared Resend
      quota. So one stranger who knew an address could put ten emails a
      minute into it and, because the mint below deletes the live token
      first, kill the recovery link about every six seconds.

      The response is unchanged on this path, so `docs/32`'s enumeration
      oracle stays closed, and `docs/74`'s property holds: "a reset link has
      been sent" is still true of that mailbox - a send inside the last
      minute is exactly what suppresses this one. `docs/127`.
    */
    if (!(await claimResetSend(email))) {
      return successResponse;
    }

    // Look up the user
    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    /*
      Three outcomes, three emails, one HTTP response.

      Both of the branches below used to `return successResponse` and send
      nothing, which made the response's promise ("a password reset link has
      been sent") untrue of any inbox for anyone without a password. The
      people it failed hardest are the ones who most need it: somebody who
      signed up with Google, forgot how, and clicked "forgot password" got
      silence, every time, with no way to find out why.

      This is the shape `/register` already uses (docs/39). The enumeration
      oracle docs/32 closed stays closed, because the HTTP response is byte
      for byte the same on all three paths and only the mailbox owner is told
      which one ran. See docs/74.
    */
    if (!user) {
      await notifyPasswordResetOutcome({ email, outcome: 'no_account' });
      return successResponse;
    }

    if (!user.passwordHash) {
      // Which provider, so the email can say "sign in with Google" rather
      // than the useless "you have no password". A user may have several;
      // the first is enough to name the route back in.
      const [linked] = await db
        .select({ provider: accounts.provider })
        .from(accounts)
        .where(eq(accounts.userId, user.id))
        .limit(1);

      await notifyPasswordResetOutcome({
        email,
        outcome: 'oauth_only',
        provider: linked?.provider ?? null,
      });
      return successResponse;
    }

    // Generate the token. The lifecycle lives in `password-reset-tokens.ts`
    // so the integration suite can execute it - nothing in `src/**` is run
    // from inside a route handler by any test here (`docs/107`, `docs/126`).
    const token = randomUUID();
    await issueResetToken(email, token);

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

    /*
      Rendered through the shared shell like every other template, instead of
      the raw `<div style="font-family: 'DM Sans'">` this route used to inline.
      docs/67 moved 44 templates onto that shell and missed this one, so the
      single most security-sensitive email the platform sends was also the
      only one with no doctype, no Outlook table scaffolding, no preheader,
      and no CAN-SPAM footer. `sendEmailOnly` keeps the same retry semantics
      (the Resend SDK resolves `{data:null,error}` rather than throwing, so
      `isFailure` is what gives this email a retry at all - docs/29 P0-4).
    */
    await notifyPasswordResetOutcome({ email, outcome: 'reset_link', resetUrl });

    return successResponse;
  } catch (error) {
    console.error('[POST /api/v1/auth/forgot-password]', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to process request', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
