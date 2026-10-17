import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { maskPhone } from '@/lib/phone';
import { isSmsConfigured, isSmsSandbox } from '@/lib/africastalking';
import {
  sendPhoneCode,
  verifyPhoneCode,
  recordSmsConsent,
  MAX_ATTEMPTS,
} from '@/lib/phone-verification';
import type { ApiError, ApiResponse } from '@/types/api';

/**
 * The signed-in person's phone number.
 *
 *   GET    - what we hold, masked
 *   POST   - { phone }  send a verification code
 *   PUT    - { code }   check it, and record the number as verified
 *   PATCH  - { smsConsent } grant or withdraw agreement to be messaged
 *
 * See `docs/85`. Two things about this route are deliberate:
 *
 *   - **A number is never written from POST.** `users.phone_e164` is set
 *     only by PUT, after a code that was texted to that number came back.
 *     An unverified number must not be able to enter the column anything
 *     sends to.
 *   - **Verifying does not grant consent.** PATCH is a separate call for
 *     a separate decision (`docs/41`, the same split as mail).
 */

function unauthorized(requestId: string) {
  return NextResponse.json(
    { ok: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated', requestId } } satisfies ApiError,
    { status: 401 },
  );
}

function badRequest(
  requestId: string,
  message: string,
  field?: string,
  code: ApiError['error']['code'] = 'VALIDATION_ERROR',
) {
  return NextResponse.json(
    { ok: false, error: { code, message, field, requestId } } satisfies ApiError,
    { status: 400 },
  );
}

async function body(request: NextRequest): Promise<Record<string, unknown>> {
  return ((await request.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
}

export async function GET() {
  const requestId = randomUUID();
  const session = await auth();
  if (!session?.user?.id) return unauthorized(requestId);

  const [user] = await db
    .select({
      phoneE164: users.phoneE164,
      phoneVerifiedAt: users.phoneVerifiedAt,
      smsConsentAt: users.smsConsentAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const data = {
    // Masked even to its owner. This value lands in browser history,
    // screen shares and error reports; the owner already knows their own
    // number, so showing all of it buys nothing.
    phone: maskPhone(user?.phoneE164),
    verified: Boolean(user?.phoneVerifiedAt),
    smsConsent: Boolean(user?.smsConsentAt),
    /*
      Surfaced so the UI can say it. In sandbox the message goes to the
      Africa's Talking simulator and the person's handset never rings;
      telling them "we sent you a text" would be false.
    */
    smsAvailable: isSmsConfigured(),
    smsSandbox: isSmsSandbox(),
  };

  return NextResponse.json({ ok: true, data } satisfies ApiResponse<typeof data>);
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const session = await auth();
  if (!session?.user?.id) return unauthorized(requestId);

  if (!isSmsConfigured()) {
    return NextResponse.json(
      { ok: false, error: { code: 'SMS_UNAVAILABLE', message: 'Text messaging is not available right now.', requestId } } satisfies ApiError,
      { status: 503 },
    );
  }

  const { phone } = await body(request);
  if (typeof phone !== 'string' || !phone.trim()) {
    return badRequest(requestId, 'Enter a phone number.', 'phone');
  }

  const result = await sendPhoneCode(session.user.id, phone);

  if (!result.ok) {
    switch (result.reason) {
      case 'invalid_phone':
        return badRequest(requestId, 'That does not look like a phone number we can text.', 'phone');
      case 'cooldown':
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'RATE_LIMITED',
              message: `Wait ${Math.ceil((result.retryAfterMs ?? 0) / 1000)} seconds before asking for another code.`,
              requestId,
            },
          } satisfies ApiError,
          {
            status: 429,
            headers: { 'Retry-After': String(Math.ceil((result.retryAfterMs ?? 0) / 1000)) },
          },
        );
      default:
        /*
          `detail` is the provider's own token (InvalidPhoneNumber,
          InvalidSenderId, SmsNotConfiguredError). Logged, not returned:
          it tells an attacker about our configuration and tells the
          person nothing they can act on.
        */
        console.error('[users/phone] send failed', { requestId, detail: result.detail });
        return NextResponse.json(
          { ok: false, error: { code: 'SMS_SEND_FAILED', message: 'We could not send a code to that number.', requestId } } satisfies ApiError,
          { status: 502 },
        );
    }
  }

  const data = { sent: true, phone: maskPhone(result.phoneE164), sandbox: result.sandbox };
  return NextResponse.json({ ok: true, data } satisfies ApiResponse<typeof data>);
}

export async function PUT(request: NextRequest) {
  const requestId = randomUUID();
  const session = await auth();
  if (!session?.user?.id) return unauthorized(requestId);

  const { code } = await body(request);
  if (typeof code !== 'string' || !code.trim()) {
    return badRequest(requestId, 'Enter the code we sent you.', 'code');
  }

  const result = await verifyPhoneCode(session.user.id, code);

  if (!result.ok) {
    const message: Record<typeof result.reason, string> = {
      no_code: 'Ask for a new code.',
      expired: 'That code has expired. Ask for a new one.',
      too_many_attempts: `That code is no longer usable after ${MAX_ATTEMPTS} wrong tries. Ask for a new one.`,
      wrong_code: 'That code is not right.',
    };
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: result.reason === 'wrong_code' ? 'INVALID_CODE' : 'CODE_UNUSABLE',
          message: message[result.reason],
          requestId,
        },
      } satisfies ApiError,
      { status: 400 },
    );
  }

  const data = { verified: true, phone: maskPhone(result.phoneE164) };
  return NextResponse.json({ ok: true, data } satisfies ApiResponse<typeof data>);
}

export async function PATCH(request: NextRequest) {
  const requestId = randomUUID();
  const session = await auth();
  if (!session?.user?.id) return unauthorized(requestId);

  const { smsConsent } = await body(request);
  if (typeof smsConsent !== 'boolean') {
    return badRequest(requestId, 'smsConsent must be true or false.', 'smsConsent');
  }

  if (smsConsent) {
    /*
      Fails closed, like `SEED_DONATIONS_OPT_IN` in docs/41: consent can
      only be granted for a number we have proved reaches this person.
      Otherwise "they agreed" would be recorded against whatever they
      typed.
    */
    const [user] = await db
      .select({ phoneVerifiedAt: users.phoneVerifiedAt })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!user?.phoneVerifiedAt) {
      return badRequest(
        requestId,
        'Verify your phone number before turning on text messages.',
        'smsConsent',
        'PHONE_NOT_VERIFIED',
      );
    }
  }

  await recordSmsConsent(session.user.id, smsConsent);

  const data = { smsConsent };
  return NextResponse.json({ ok: true, data } satisfies ApiResponse<typeof data>);
}
