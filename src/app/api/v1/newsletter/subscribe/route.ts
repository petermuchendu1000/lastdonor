import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { newsletterSubscribers } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { subscribeSchema } from '@/lib/validators/newsletter';
import { resend } from '@/lib/resend';
import { retryWithBackoff } from '@/lib/utils/retry';
import { unsubscribeMechanism } from '@/lib/unsubscribe-tokens';
import { newsletterWelcomeEmail } from '@/lib/email-templates';
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

    /*
      Send the welcome, which carries a working opt-out: it once shipped with
      no unsubscribe link and no List-Unsubscribe header at all. The token is
      minted with the shared helper so the link is byte-compatible with the
      newsletter cron and the unsubscribe route.

      ⚠️ The body used to be a hand-written `text:` string right here, which
      put it outside BOTH email sweeps - `EMAIL_SOURCE_FILES` is a list of two
      files, so neither the plain-language budget (`docs/94`) nor the
      dark-mode contrast ratchet ever saw it. It now renders through the one
      shell like the other 49 templates. See `newsletterWelcomeEmail` for why
      it is transactional rather than `commercial: true`. `docs/123`.
    */
    const unsub = unsubscribeMechanism(created?.id ?? null);
    const welcome = newsletterWelcomeEmail({ unsubscribeUrl: unsub.url });
    try {
      // The Resend SDK resolves { data: null, error } instead of throwing, so
      // the old bare try/catch here could never observe a failure
      // (docs/29 P0-4, src/lib/utils/retry.ts:6-12).
      const { error: sendError } = await retryWithBackoff(
        () => resend.emails.send({
          from: 'LastDonor.org <noreply@lastdonor.org>',
          to: email,
          subject: welcome.subject,
          html: welcome.html,
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
