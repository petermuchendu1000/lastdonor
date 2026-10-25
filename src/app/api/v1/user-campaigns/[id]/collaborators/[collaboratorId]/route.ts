import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { auditLogs, campaigns } from '@/db/schema';
import { auth, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { logError } from '@/lib/errors';
import { revokeCollaborator } from '@/lib/collaborators/invites';
import type { ApiError } from '@/types/api';

type Params = { params: Promise<{ id: string; collaboratorId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remove a helper, or cancel an invitation that has not been accepted.
 *
 * ⛔ CREATOR ONLY. A collaborator cannot remove another collaborator, for the
 * same reason they cannot invite one: the trust root is the organiser.
 *
 * ⚠️ Revocation stamps `revoked_at` rather than deleting the row. The record
 * that somebody had access is worth more than a tidy table, and the partial
 * unique index is keyed on `revoked_at IS NULL`, so the same person can be
 * invited again afterwards. Both halves are proven against real Postgres in
 * `collaborators.integration.test.ts`.
 *
 * `canCollaborate` reads the same `revoked_at IS NULL` predicate, so a
 * revocation takes effect on the revoked helper's very next request - there is
 * no session or cache to wait for.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id, collaboratorId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthorizedError();

    if (!UUID.test(id) || !UUID.test(collaboratorId)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid id', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const [campaign] = await db
      .select({ id: campaigns.id, creatorId: campaigns.creatorId })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    if (campaign.creatorId !== session.user.id) throw new ForbiddenError();

    /*
      `revokeCollaborator` scopes the update to this campaign as well as the
      row id, so one organiser cannot revoke another campaign's helper by
      guessing an id. It returns false when nothing live matched, which is a
      404 rather than a reported revocation that did not happen.
    */
    const revoked = await revokeCollaborator({
      campaignId: campaign.id,
      collaboratorId,
    });

    if (!revoked) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'That helper is not on this campaign', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    await db.insert(auditLogs).values({
      eventType: 'collaborator.revoked',
      actorId: session.user.id,
      targetType: 'campaign',
      targetId: campaign.id,
      severity: 'info',
      details: { collaboratorId },
    });

    return NextResponse.json({ ok: true, data: { id: collaboratorId, revoked: true, requestId } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Only the organiser can remove helpers', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    logError(error, { requestId, route: 'DELETE /api/v1/user-campaigns/[id]/collaborators/[collaboratorId]' });
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Could not remove that helper', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
