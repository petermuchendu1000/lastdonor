import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { db } from '@/db';
import { newsletterSubscribers } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import type { ApiError } from '@/types/api';

/**
 * Newsletter unsubscribe (audit P1-6).
 *
 * ## What was wrong
 *
 * This route took an email address out of the request body and unsubscribed
 * it, with no authentication of any kind — `PUBLIC_API_PREFIXES` listed
 * `/api/v1/newsletter`, so anyone could unsubscribe anybody whose address they
 * could guess. Separately, the link we actually put in newsletters
 * (`cron/send-newsletter`) is a **GET** to `?token=<signed>`, and this file
 * exported only `POST` and never read `token` — so the real unsubscribe link
 * in every newsletter answered 405 while the forgeable path worked.
 *
 * ## How it is authorised now
 *
 * Two paths, both of which prove the caller is entitled to act on the address:
 *
 * 1. **Signed token** (the email-link path, no session required). The token is
 *    `<subscriberId>.<hex hmac-sha256(NEWSLETTER_UNSUBSCRIBE_SECRET, subscriberId)>`
 *    — byte-for-byte the format `cron/send-newsletter` already mints, so every
 *    link already sitting in a subscriber's inbox keeps working (and starts
 *    working, for GET). Unsubscribing must not require a login: CAN-SPAM
 *    §316.5 requires the mechanism in the message to function, and GDPR Art. 7(3)
 *    requires withdrawal to be as easy as consent.
 * 2. **Session ownership** — a signed-in user unsubscribing their own address.
 *
 * Anything else is refused. The address in the body is never trusted on its own.
 *
 * ## Trade-offs taken deliberately
 *
 * - **GET performs the unsubscribe.** A link-prefetching mail client or
 *   security scanner can therefore unsubscribe someone who never clicked. The
 *   alternative — an interstitial confirmation page — needs a page this task
 *   does not own, and the failure mode here is fail-quiet (no mail), which is
 *   the safe direction for a consent flow. RFC 8058 one-click POST is supported
 *   for clients that do it properly.
 * - **Not single-use.** A single-use token needs persisted redemption state,
 *   and migrations are frozen (see CLAUDE.md). Replay is harmless because the
 *   operation is idempotent and terminal: replaying it cannot resubscribe
 *   anyone or disclose anything. A `newsletter_unsubscribe_tokens` table (or a
 *   `unsubscribed_at`-dependent signature) is recorded as follow-up.
 * - **No expiry.** Deliberate: the token format already in circulation has no
 *   expiry claim, and an unsubscribe link that stops working is itself a
 *   compliance defect.
 */

/** Non-disclosure: the same answer whether or not the address is on the list. */
const OK_UNSUBSCRIBED = { ok: true, data: { status: 'unsubscribed' } } as const;

function errorResponse(
  code: ApiError['error']['code'],
  message: string,
  requestId: string,
  status: number,
  field?: string,
): NextResponse {
  const body: ApiError = { ok: false, error: { code, message, requestId, ...(field ? { field } : {}) } };
  return NextResponse.json(body, { status });
}

function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Verify `<subscriberId>.<signature>` and return the subscriber id.
 *
 * Must stay identical to `createUnsubscribeToken` in
 * `src/app/api/v1/cron/send-newsletter/route.ts`. Duplicated rather than
 * shared because extracting it needs a new `src/lib/` module, which is outside
 * this change's ownership — see the follow-up note in the handover.
 */
function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  if (!token) return null;

  const secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  if (!secret) {
    // Fail closed. A missing secret must never degrade into "accept anything".
    console.error('[newsletter/unsubscribe] NEWSLETTER_UNSUBSCRIBE_SECRET is not set; rejecting all tokens.');
    return null;
  }

  const separator = token.lastIndexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;

  const subscriberId = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = createHmac('sha256', secret).update(subscriberId).digest('hex');
  return hexEquals(signature, expected) ? subscriberId : null;
}

/** Mark a subscriber unsubscribed by primary key. Idempotent. */
async function unsubscribeById(subscriberId: string): Promise<'unsubscribed' | 'already_unsubscribed' | 'not_found'> {
  const [subscriber] = await db
    .select({ id: newsletterSubscribers.id, unsubscribedAt: newsletterSubscribers.unsubscribedAt })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.id, subscriberId))
    .limit(1);

  if (!subscriber) return 'not_found';
  if (subscriber.unsubscribedAt) return 'already_unsubscribed';

  await db
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: new Date() })
    .where(eq(newsletterSubscribers.id, subscriber.id));

  return 'unsubscribed';
}

/** Mark a subscriber unsubscribed by address. Idempotent. */
async function unsubscribeByEmail(email: string): Promise<'unsubscribed' | 'already_unsubscribed' | 'not_found'> {
  const [subscriber] = await db
    .select({ id: newsletterSubscribers.id, unsubscribedAt: newsletterSubscribers.unsubscribedAt })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email))
    .limit(1);

  if (!subscriber) return 'not_found';
  if (subscriber.unsubscribedAt) return 'already_unsubscribed';

  await db
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: new Date() })
    .where(eq(newsletterSubscribers.id, subscriber.id));

  return 'unsubscribed';
}

function confirmationHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/><title>Unsubscribed - LastDonor.org</title></head>
<body style="margin:0;background:#F8F6F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1A1A">
<div style="max-width:32rem;margin:4rem auto;padding:2rem;background:#fff;border-radius:12px;text-align:center">
<h1 style="font-size:1.25rem;margin:0 0 .75rem">You have been unsubscribed</h1>
<p style="font-size:.875rem;color:#6B7280;margin:0 0 1.5rem">You will no longer receive the LastDonor.org newsletter.</p>
<a href="/" style="display:inline-block;background:#0F766E;color:#fff;padding:.625rem 1.25rem;border-radius:8px;text-decoration:none;font-size:.875rem;font-weight:600">Back to LastDonor.org</a>
</div></body></html>`;
}

/**
 * GET /api/v1/newsletter/unsubscribe?token=...
 *
 * The link printed in every newsletter and advertised in `List-Unsubscribe`.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const subscriberId = verifyUnsubscribeToken(request.nextUrl.searchParams.get('token'));
    if (!subscriberId) {
      return errorResponse(
        'UNAUTHORIZED',
        'This unsubscribe link is invalid or incomplete. Please use the link from the most recent email.',
        requestId,
        401,
      );
    }

    await unsubscribeById(subscriberId);

    // Rendered in a browser from an email link, so answer in HTML when asked.
    if (request.headers.get('accept')?.includes('text/html')) {
      return new NextResponse(confirmationHtml(), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    return NextResponse.json(OK_UNSUBSCRIBED);
  } catch (error) {
    console.error('[GET /api/v1/newsletter/unsubscribe]', error);
    return errorResponse('INTERNAL_ERROR', 'Unsubscribe failed. Please try again.', requestId, 500);
  }
}

/**
 * POST /api/v1/newsletter/unsubscribe
 *
 * Accepts either:
 *   - RFC 8058 one-click: `?token=...` (body is `List-Unsubscribe=One-Click`), or
 *     the same token in a JSON body;
 *   - an authenticated user unsubscribing their own address.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    // The one-click body is form-encoded, not JSON, so body parsing must not
    // be allowed to fail the request.
    let bodyEmail: string | null = null;
    let bodyToken: string | null = null;
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => null);
      bodyEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;
      bodyToken = typeof body?.token === 'string' ? body.token.trim() : null;
    }

    // ── Path 1: signed token (no session required) ────────────────────────
    const token = request.nextUrl.searchParams.get('token') ?? bodyToken;
    const subscriberId = verifyUnsubscribeToken(token);
    if (subscriberId) {
      await unsubscribeById(subscriberId);
      return NextResponse.json(OK_UNSUBSCRIBED);
    }

    if (token) {
      return errorResponse(
        'UNAUTHORIZED',
        'This unsubscribe link is invalid or incomplete. Please use the link from the most recent email.',
        requestId,
        401,
      );
    }

    // ── Path 2: a signed-in user unsubscribing their own address ──────────
    if (!bodyEmail) {
      return errorResponse('VALIDATION_ERROR', 'Email is required', requestId, 400, 'email');
    }

    const session = await auth();
    const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? null;

    if (!sessionEmail) {
      return errorResponse(
        'UNAUTHORIZED',
        'Use the unsubscribe link from your email, or sign in to manage your email preferences.',
        requestId,
        401,
      );
    }

    if (sessionEmail !== bodyEmail) {
      // Never act on a third party's address on a caller's word. This is the
      // P1-6 defect; without this check the whole route is an open relay for
      // unsubscribing other people.
      return errorResponse(
        'FORBIDDEN',
        'You can only change the email preferences for your own address.',
        requestId,
        403,
        'email',
      );
    }

    await unsubscribeByEmail(sessionEmail);
    return NextResponse.json(OK_UNSUBSCRIBED);
  } catch (error) {
    console.error('[POST /api/v1/newsletter/unsubscribe]', error);
    return errorResponse('INTERNAL_ERROR', 'Unsubscribe failed. Please try again.', requestId, 500);
  }
}
