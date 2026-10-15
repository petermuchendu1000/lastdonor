import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users, donations, campaigns, campaignMessages, donorCampaignSubscriptions, newsletterSubscribers, supportConversations, auditLogs } from '@/db/schema';
import { eq, or } from 'drizzle-orm';
import { DELETED_DONOR_PLACEHOLDER, DELETED_DONOR_NAME } from '@/lib/constants';
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

  const userId = session.user.id;
  const userEmail = session.user.email;

  try {
    await db.transaction(async (tx) => {
      // Anonymize donations (null FK + scrub PII)
      await tx
        .update(donations)
        .set({
          donorName: DELETED_DONOR_NAME,
          donorEmail: DELETED_DONOR_PLACEHOLDER,
          message: null,
          userId: null,
        })
        .where(eq(donations.userId, userId));

      // Null out campaign messages FK
      await tx
        .update(campaignMessages)
        .set({ userId: null, donorName: DELETED_DONOR_NAME })
        .where(eq(campaignMessages.userId, userId));

      // Erase campaign-update subscriptions outright.
      //
      // Nulling `userId` here (what this did before) left `donor_email`
      // holding the deleted person's REAL address in a table that mail is
      // sent to: `bulk-email-recipients.ts` resolves the `subscribed_donors`
      // filter straight off `donor_campaign_subscriptions.donor_email`, and
      // the campaign-update digest reads the same rows. So a user who
      // deleted their account kept receiving campaign email at the address
      // they had just asked us to forget.
      //
      // Deleted rather than scrubbed to the `deleted@lastdonor.org`
      // placeholder: `idx_donor_subs_email_campaign` is UNIQUE on
      // (donor_email, campaign_id), so two deleted users who both followed
      // the same campaign would collide and abort the transaction. Deletion
      // is also the honest reading of an erasure request.
      //
      // Matched on userId OR the address, because a row can carry the email
      // with a null userId (a guest donor who later registered).
      await tx
        .delete(donorCampaignSubscriptions)
        .where(
          userEmail
            ? or(
                eq(donorCampaignSubscriptions.userId, userId),
                eq(donorCampaignSubscriptions.donorEmail, userEmail),
              )
            : eq(donorCampaignSubscriptions.userId, userId),
        );

      // Erase the newsletter subscription.
      //
      // Previously untouched by account deletion, so a deleted user's row
      // kept `unsubscribed_at IS NULL` and the weekly newsletter cron kept
      // mailing them indefinitely. There is no userId on this table, so the
      // address is the only join.
      //
      // Trade-off accepted: deleting the row leaves no suppression record,
      // so the same address could be subscribed again later. That would be a
      // fresh, affirmative opt-in, which is the correct outcome for someone
      // who asked to be forgotten; keeping a durable record of them in order
      // to honour the erasure would defeat it.
      if (userEmail) {
        await tx
          .delete(newsletterSubscribers)
          .where(eq(newsletterSubscribers.email, userEmail));
      }

      // Null out support conversations FK
      await tx
        .update(supportConversations)
        .set({ userId: null })
        .where(eq(supportConversations.userId, userId));

      // Null out campaigns creator FK (campaigns persist for donors)
      await tx
        .update(campaigns)
        .set({ creatorId: null })
        .where(eq(campaigns.creatorId, userId));

      // Delete user
      await tx.delete(users).where(eq(users.id, userId));

      // Audit log
      await tx.insert(auditLogs).values({
        eventType: 'user.deleted',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
        severity: 'warning',
        details: { email: userEmail },
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
          subject: 'Your LastDonor.org account has been deleted',
          text: 'Your account has been permanently deleted and your donation records have been anonymized. If you did not request this, please contact support@lastdonor.org immediately.',
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
