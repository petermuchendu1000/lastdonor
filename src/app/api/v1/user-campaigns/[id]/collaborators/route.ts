import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { auditLogs, campaigns, users } from '@/db/schema';
import { auth, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { logError } from '@/lib/errors';
import { notifyCollaboratorInvited } from '@/lib/notifications';
import { appBaseUrl } from '@/lib/unsubscribe-tokens';
import {
  createInvite,
  listCollaborators,
  MAX_LIVE_COLLABORATORS,
} from '@/lib/collaborators/invites';
import type { ApiError } from '@/types/api';

type Params = { params: Promise<{ id: string }> };

/**
 * The campaign's team: list it, and invite somebody to it.
 *
 * ⛔ CREATOR ONLY, both verbs. A collaborator may not invite further
 * collaborators - `invite_collaborator` is in `NEVER_DELEGATED`
 * (`src/lib/collaborators/capabilities.ts`), because the trust root is the
 * person who started the campaign and one compromised helper account must not
 * be able to grow the team. So this file deliberately does NOT import
 * `canCollaborate`, and `collaborator-call-sites.test.ts` asserts that no file
 * outside the two delegating surfaces does.
 *
 * ⚠️ POST sends email from `lastdonor.org`, so it sits in its own rate-limit
 * tier (`collab`, 5/60 s) rather than the generic bucket every other
 * `/api/v1/user-campaigns` route falls into. The tier is matched by a
 * PREDICATE, not a prefix, because the campaign id is in the middle of the
 * path - see `isCollaboratorInvite` and `docs/111` §5.
 */

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3, 'Enter an email address')
    .max(320, 'That email address is too long')
    .email('Enter a valid email address'),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the campaign and refuse anybody who is not its creator. */
async function requireCreator(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError();
  if (!UUID.test(id)) return null;

  const [campaign] = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      creatorId: campaigns.creatorId,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);

  if (!campaign) return null;

  /*
    Creator only. Staff are NOT admitted either: an admin managing somebody
    else's team is a different feature with different consent questions, and
    admins already have `/admin/campaigns`.
  */
  if (campaign.creatorId !== session.user.id) throw new ForbiddenError();

  return { session, campaign };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    const found = await requireCreator(id);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const rows = await listCollaborators(found.campaign.id);
    return NextResponse.json({
      ok: true,
      data: {
        collaborators: rows.map((r) => ({
          id: r.id,
          email: r.invitedEmail,
          accepted: r.acceptedAt !== null,
          invitedAt: r.createdAt,
        })),
        limit: MAX_LIVE_COLLABORATORS,
        requestId,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId, 'GET');
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    const found = await requireCreator(id);
    if (!found) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const email = parsed.data.email.toLowerCase();

    // Inviting yourself is a no-op that would consume a slot and send you
    // your own email. Refused with a specific message rather than silently.
    const [me] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, found.session.user!.id!))
      .limit(1);

    if (me?.email && me.email.toLowerCase() === email) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'You already run this campaign.', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    let invite: Awaited<ReturnType<typeof createInvite>>;
    try {
      invite = await createInvite({
        campaignId: found.campaign.id,
        invitedEmail: email,
        invitedBy: found.session.user!.id!,
      });
    } catch (err) {
      /*
        The partial unique index `idx_campaign_collaborators_live` is the
        authority on duplicates, not a prior SELECT - checking first would be
        a race. A duplicate is a 409 with a plain message, not a 500.
      */
      if (String(err).includes('idx_campaign_collaborators_live')) {
        return NextResponse.json(
          { ok: false, error: { code: 'CONFLICT', message: 'That person has already been invited.', requestId } } satisfies ApiError,
          { status: 409 },
        );
      }
      throw err;
    }

    if (!invite) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `A campaign can have ${MAX_LIVE_COLLABORATORS} helpers at a time. Remove somebody first.`,
            requestId,
          },
        } satisfies ApiError,
        { status: 400 },
      );
    }

    /*
      The raw token exists here and in the email, and nowhere else. ⛔ It must
      not reach a log, an audit row, or the response body - only the hash is
      stored, so a leak of any of those would otherwise be a working invite.
    */
    const acceptUrl = `${appBaseUrl()}/collaborate/accept?token=${encodeURIComponent(invite.token)}`;

    await notifyCollaboratorInvited({
      invitedEmail: email,
      inviterName: me?.name ?? '',
      campaignTitle: found.campaign.title,
      acceptUrl,
    }).catch((err) => console.error('[collaborator.invited] email error:', err));

    await db.insert(auditLogs).values({
      eventType: 'collaborator.invited',
      actorId: found.session.user!.id!,
      targetType: 'campaign',
      targetId: found.campaign.id,
      severity: 'info',
      // The address and the row id. Never the token.
      details: { invitedEmail: email, collaboratorId: invite.row.id },
    });

    return NextResponse.json({
      ok: true,
      data: { id: invite.row.id, email, accepted: false, requestId },
    });
  } catch (error) {
    return errorResponse(error, requestId, 'POST');
  }
}

function errorResponse(error: unknown, requestId: string, verb: string): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } } satisfies ApiError,
      { status: 401 },
    );
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'Only the organiser can manage helpers', requestId } } satisfies ApiError,
      { status: 403 },
    );
  }
  logError(error, { requestId, route: `${verb} /api/v1/user-campaigns/[id]/collaborators` });
  return NextResponse.json(
    { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Could not manage helpers', requestId } } satisfies ApiError,
    { status: 500 },
  );
}
