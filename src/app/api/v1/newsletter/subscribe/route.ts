import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { newsletterSubscribers } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { subscribeSchema } from '@/lib/validators/newsletter';
import { resend } from '@/lib/resend';
import { retryWithBackoff } from '@/lib/utils/retry';
import { unsubscribeMechanism } from '@/lib/unsubscribe-tokens';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';

export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const body = await request.json();
    const result = subscribeSchema.safeParse(body);

    if (!result.success) {
      const firstError = result.error.errors[0];
      const error: ApiError = {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: firstError?.message ?? 'Invalid input',
          field: firstError?.path.join('.'),
          requestId,
        },
      };
      return NextResponse.json(error, { status: 400 });
    }

    const { email, source } = result.data;

    // Check for existing subscriber
    const [existing] = await db
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
      .limit(1);

    if (existing) {
      if (!existing.unsubscribedAt) {
        // Already actively subscribed - idempotent success
        return NextResponse.json({ ok: true, data: { status: 'already_subscribed' } });
      }

      // Re-subscribe
      await db
        .update(newsletterSubscribers)
        .set({ unsubscribedAt: null, source: source ?? existing.source })
        .where(eq(newsletterSubscribers.id, existing.id));

      return NextResponse.json({ ok: true, data: { status: 'resubscribed' } });
    }

    // New subscriber
    const [created] = await db.insert(newsletterSubscribers).values({
      email,
      source: source ?? null,
    }).returning({ id: newsletterSubscribers.id });

    // Send welcome email.
    //
    // This is a marketing message, so it must carry a working opt-out: it
    // previously shipped with no unsubscribe link and no List-Unsubscribe
    // header at all. The token is minted with the shared helper so the link
    // is byte-compatible with the newsletter cron and the unsubscribe route.
    const unsub = unsubscribeMechanism(created?.id ?? null);
    try {
      // The Resend SDK resolves { data: null, error } instead of throwing, so
      // the old bare try/catch here could never observe a failure
      // (docs/29 P0-4, src/lib/utils/retry.ts:6-12).
      const { error: sendError } = await retryWithBackoff(
        () => resend.emails.send({
          from: 'LastDonor.org <noreply@lastdonor.org>',
          to: email,
          subject: 'Welcome to LastDonor.org',
          text: `Thank you for subscribing to LastDonor.org!\n\nYou'll receive updates about campaigns making a real difference in people's lives.\n\nEvery dollar has a name behind it.\n\n- The LastDonor.org Team\n\n---\nDon't want these emails? Unsubscribe: ${unsub.url}`,
          headers: unsub.headers,
        }),
        { maxRetries: 2, baseDelayMs: 500, isFailure: (result) => Boolean(result?.error) },
      );
      if (sendError) {
        // Don't fail the subscription if email fails, but never swallow it.
        console.error('[newsletter/subscribe] Resend API error sending welcome email:', sendError);
      }
    } catch (err) {
      console.error('[newsletter/subscribe] Failed to send welcome email:', err);
    }

    return NextResponse.json(
      { ok: true, data: { status: 'subscribed' } },
      { status: 201 },
    );
  } catch (error) {
    console.error('[POST /api/v1/newsletter/subscribe]', error);
    const errResp: ApiError = {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Subscription failed. Please try again.',
        requestId,
      },
    };
    return NextResponse.json(errResp, { status: 500 });
  }
}
