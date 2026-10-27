import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users, auditLogs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { anonymiseAccount } from '@/lib/account-erasure';
import { updateProfileSchema } from '@/lib/validators/user';
import { resend } from '@/lib/resend';
import { retryWithBackoff } from '@/lib/utils/retry';
import { randomUUID } from 'crypto';
import type { ApiError, ApiResponse } from '@/types/api';

export async function GET() {
  const requestId = randomUUID();

  const session = await auth();
  if (!session?.user?.id) {
    const error: ApiError = {
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated', requestId },
    };
    return NextResponse.json(error, { status: 401 });
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      location: users.location,
      avatarUrl: users.avatarUrl,
      role: users.role,
      totalDonated: users.totalDonated,
      campaignsSupported: users.campaignsSupported,
      lastDonorCount: users.lastDonorCount,
      badges: users.badges,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) {
    const error: ApiError = {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'User not found', requestId },
    };
    return NextResponse.json(error, { status: 404 });
  }

  const response: ApiResponse<typeof user> = { ok: true, data: user };
  return NextResponse.json(response);
}

export async function PUT(request: NextRequest) {
  const requestId = randomUUID();

  const session = await auth();
  if (!session?.user?.id) {
    const error: ApiError = {
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated', requestId },
    };
    return NextResponse.json(error, { status: 401 });
  }

  const body = await request.json();
  const result = updateProfileSchema.safeParse(body);

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

  const [updated] = await db
    .update(users)
    .set(result.data)
    .where(eq(users.id, session.user.id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      location: users.location,
      avatarUrl: users.avatarUrl,
    });

  const response: ApiResponse<typeof updated> = { ok: true, data: updated };
  return NextResponse.json(response);
}

export async function DELETE(request: NextRequest) {
  const requestId = randomUUID();

  const session = await auth();
  if (!session?.user?.id) {
    const error: ApiError = {
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated', requestId },
    };
    return NextResponse.json(error, { status: 401 });
  }

  const body = await request.json();
  if (body?.confirm !== true) {
    const error: ApiError = {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Confirmation required. Send { "confirm": true }.',
        requestId,
      },
    };
    return NextResponse.json(error, { status: 400 });
  }

  /*
    ⛔ An administrator may not erase themselves here.

    `DELETE /api/v1/admin/users/[id]` has always refused an admin deleting
    their own account; this route did not, and the account page reaches it.
    Until now a foreign-key violation stopped it by ACCIDENT - [VERIFIED in
    production] the one admin holds six `site_settings.updated_by` rows - and
    the fix below removes that accident. The refusal has to be deliberate:
    scrubbing an admin takes the attribution on settings changes, institution
    vouches and verification reviews with it, and there is currently exactly
    one admin, so doing it would leave the platform with none. `docs/124`.
  */
  if (session.user.role === 'admin') {
    const error: ApiError = {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message:
          'An administrator account cannot be removed from here. Ask another administrator to remove it for you.',
        requestId,
      },
    };
    return NextResponse.json(error, { status: 403 });
  }

  const userId = session.user.id;
  const userEmail = session.user.email;

  try {
    await db.transaction(async (tx) => {
      /*
        Anonymise in place; do NOT delete the row.

        `tx.delete(users)` used to be the last statement here, and 31 of the
        36 foreign keys pointing at `users.id` are `NO ACTION`, so it raised
        a violation for anyone holding a reference this transaction did not
        happen to name. See `src/lib/account-erasure.ts` for the full
        reasoning and `docs/124` for the evidence.
      */
      await anonymiseAccount(tx, { userId, email: userEmail ?? null });

      await tx.insert(auditLogs).values({
        eventType: 'user.deleted',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
        severity: 'warning',
        details: { email: userEmail, mode: 'anonymised', initiatedBy: 'self' },
      });
    });
  } catch (error) {
    console.error('[DELETE /api/v1/users/me]', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete account. Please try again or contact support.', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }

  // Send confirmation email.
  //
  // This is the only signal a user gets that their account was deleted — if it
  // was not them, it is the only chance to raise it. The Resend SDK resolves
  // { data: null, error } rather than throwing, so the previous bare try/catch
  // could not observe a failed send at all (docs/29 P0-4,
  // src/lib/utils/retry.ts:6-12). The deletion still succeeds either way.
  if (userEmail) {
    try {
      const { error: sendError } = await retryWithBackoff(
        () => resend.emails.send({
          from: 'LastDonor.org <noreply@lastdonor.org>',
          to: userEmail,
          subject: 'We deleted your LastDonor.org account',
          text: 'We deleted your LastDonor.org account. Your name, email address and phone number are gone, and your donations are no longer linked to you. We keep the payment records themselves, with your name removed. If you did not ask for this, email support@lastdonor.org now.',
        }),
        { maxRetries: 2, baseDelayMs: 500, isFailure: (result) => Boolean(result?.error) },
      );
      if (sendError) {
        console.error('[DELETE /api/v1/users/me] Resend API error sending deletion confirmation:', sendError);
      }
    } catch (err) {
      console.error('[DELETE /api/v1/users/me] Failed to send deletion confirmation:', err);
    }
  }

  return NextResponse.json({ ok: true, data: null });
}
