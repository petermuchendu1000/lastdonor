import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { auth, UnauthorizedError } from '@/lib/auth';
import { logError } from '@/lib/errors';
import { acceptInvite } from '@/lib/collaborators/invites';
import type { ApiError } from '@/types/api';

/**
 * Accept an invitation to help with a campaign.
 *
 * The TOKEN is the credential. A signed-in session is required so there is an
 * account to attach the membership to, but the signed-in address does NOT
 * have to match the invited one - see the note on `acceptInvite`. A family
 * member forwarding their invitation to the account they actually use is the
 * common case, and requiring a match would also leak whether an address has
 * an account (the `docs/32`/`docs/39` enumeration concern).
 *
 * ⛔ Accepting grants only the content capabilities in
 * `src/lib/collaborators/capabilities.ts`. It cannot reach money or identity,
 * and this file deliberately does not import `canCollaborate` - there is
 * nothing to check, the acceptance IS the grant.
 */
const schema = z.object({
  token: z.string().trim().min(10, 'Invalid invitation').max(512, 'Invalid invitation'),
});

export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid invitation', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const outcome = await acceptInvite({
      token: parsed.data.token,
      userId: session.user.id,
    });

    if (!outcome.ok) {
      /*
        One message for every failure, deliberately. "Not found", "expired"
        and "already accepted by somebody else" would each tell a holder of a
        guessed token something about which tokens exist. The reason is
        recorded in the audit row instead, where only we can read it.
      */
      await db
        .insert(auditLogs)
        .values({
          eventType: 'collaborator.accept_failed',
          actorId: session.user.id,
          targetType: 'campaign',
          severity: 'warning',
          details: { reason: outcome.reason },
        })
        .catch(() => { /* an audit write must not mask the refusal */ });

      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'That invitation is no longer valid. Ask the organiser to send a new one.',
            requestId,
          },
        } satisfies ApiError,
        { status: 400 },
      );
    }

    await db.insert(auditLogs).values({
      eventType: 'collaborator.accepted',
      actorId: session.user.id,
      targetType: 'campaign',
      targetId: outcome.campaignId,
      severity: 'info',
      details: {},
    });

    // The dashboard lists campaigns this user can act on, so its cached
    // shell is now wrong for them.
    revalidatePath('/dashboard/campaigns');

    return NextResponse.json({
      ok: true,
      data: { campaignId: outcome.campaignId, requestId },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to accept this invitation', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    logError(error, { requestId, route: 'POST /api/v1/collaborators/accept' });
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Could not accept the invitation', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
