import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { impactUpdates, campaigns, auditLogs, users } from '@/db/schema';
import {
  notifyCreatorImpactUpdateApproved,
  notifyCreatorImpactUpdateRejected,
} from '@/lib/notifications';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { randomUUID } from 'crypto';
import type { ApiError, ApiResponse } from '@/types/api';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/admin/impact-updates/[id]/review
 *
 * Get full impact update details for admin review.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    await requireRole(['admin']);

    const [impactUpdate] = await db
      .select()
      .from(impactUpdates)
      .where(eq(impactUpdates.id, id))
      .limit(1);

    if (!impactUpdate) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Impact update not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const [campaign] = await db
      .select({ title: campaigns.title, slug: campaigns.slug, creatorId: campaigns.creatorId })
      .from(campaigns)
      .where(eq(campaigns.id, impactUpdate.campaignId))
      .limit(1);

    const response: ApiResponse<{ impactUpdate: typeof impactUpdate; campaign: typeof campaign }> = {
      ok: true,
      data: { impactUpdate, campaign },
    };
    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/v1/admin/impact-updates/[id]/review
 *
 * Approve or reject an impact update.
 * Body: { action: 'approve' | 'reject', notes?: string }
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    const session = await requireRole(['admin']);
    const body = await request.json();

    const { action, notes } = body as { action: string; notes?: string };

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Action must be "approve" or "reject"', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    /*
      ⛔ A refusal carries a reason, and `notes` used to be optional on both
      actions. The organiser is emailed the admin's words - so a reject with
      no notes produced "What they said:" followed by nothing, which is the
      `docs/107` §8.2 shape, and told them nothing about what to change.

      This is `docs/93`'s decision applied to the same situation one table
      over: the campaign suspend route demands at least three characters for
      exactly this reason. There are no other callers of this route, so
      tightening it breaks nothing. `docs/139`.
    */
    if (action === 'reject' && (typeof notes !== 'string' || notes.trim().length < 3)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Say what needs to change. The organiser is sent your words.', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    /*
      The campaign and the submitter are folded into the lookup that was
      already running, rather than added as a second and third query - the
      pool is `max: 5` and an entry point is capped at three (docs/87).

      It joins on `submitted_by`, not `campaigns.creator_id`: the submitter is
      the person waiting on this decision, and `creator_id` is NULLABLE - 13
      of 14 live campaigns have no organiser at all (docs/119). Both columns
      can be null, so the notify below is conditional, never assumed.
    */
    const [impactUpdate] = await db
      .select({
        id: impactUpdates.id,
        campaignId: impactUpdates.campaignId,
        status: impactUpdates.status,
        campaignTitle: campaigns.title,
        campaignSlug: campaigns.slug,
        campaignStatus: campaigns.status,
        campaignPublishedAt: campaigns.publishedAt,
        submitterId: users.id,
        submitterEmail: users.email,
        submitterName: users.name,
      })
      .from(impactUpdates)
      .innerJoin(campaigns, eq(impactUpdates.campaignId, campaigns.id))
      .leftJoin(users, eq(impactUpdates.submittedBy, users.id))
      .where(eq(impactUpdates.id, id))
      .limit(1);

    if (!impactUpdate) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Impact update not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    if (impactUpdate.status !== 'submitted') {
      return NextResponse.json(
        { ok: false, error: { code: 'CONFLICT', message: `Cannot review impact update in status: ${impactUpdate.status}`, requestId } } satisfies ApiError,
        { status: 409 },
      );
    }

    const newStatus = action === 'approve' ? 'approved' as const : 'rejected' as const;

    const [updated] = await db
      .update(impactUpdates)
      .set({
        status: newStatus,
        reviewerId: session.user.id,
        reviewerNotes: notes ?? null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(impactUpdates.id, id))
      .returning();

    await db.insert(auditLogs).values({
      /*
        ⛔ Written out, not assembled. This was `` `impact_update.${action}d` ``,
        which for `action: 'reject'` produced **`impact_update.rejectd`** -
        found by executing the route and reading the row it wrote, not by
        reading the line.

        Two reasons it is a literal now. The spelling is one. The other is
        that `docs/137` §5 recorded, as the one thing its sweep could not
        cover, that *"an event type assembled from a variable yields nothing.
        No such site is known, and none was searched for."* This was that
        site - so a constructed event type is both unreadable to the sweep
        and, here, wrong. The sibling submit route already writes its two
        literals out. `docs/139`.
      */
      eventType: action === 'approve' ? 'impact_update.approved' : 'impact_update.rejected',
      actorId: session.user.id,
      actorRole: 'admin',
      targetType: 'campaign',
      targetId: impactUpdate.campaignId,
      severity: 'info',
      details: { impactUpdateId: id, action, notes },
    });

    /*
      ⛔ The organiser was never told. This route wrote the decision and the
      audit row and sent nothing - while `notifyCreatorImpactUpdateApproved`
      and `notifyCreatorImpactUpdateRejected` sat with zero callers. An
      impact update reports how a family's money was spent; being refused in
      silence is the `docs/93` defect in a second place.

      Conditional on a submitter existing: `submitted_by` is nullable, and so
      is `campaigns.creator_id` (docs/119). Fire-and-forget with a logged
      catch - the decision is already committed and a mail failure must not
      turn it into a 500.
    */
    if (impactUpdate.submitterId && impactUpdate.submitterEmail) {
      const who = {
        creatorId: impactUpdate.submitterId,
        creatorEmail: impactUpdate.submitterEmail,
        creatorName: impactUpdate.submitterName ?? 'there',
        campaignTitle: impactUpdate.campaignTitle,
      };
      const sent =
        action === 'approve'
          ? notifyCreatorImpactUpdateApproved({
              ...who,
              campaignSlug: impactUpdate.campaignSlug,
              campaignStatus: impactUpdate.campaignStatus,
              campaignPublishedAt: impactUpdate.campaignPublishedAt,
            })
          : notifyCreatorImpactUpdateRejected({
              ...who,
              campaignId: impactUpdate.campaignId,
              // Guaranteed a non-empty string by the reject guard above.
              reviewerNotes: notes!.trim(),
            });
      sent.catch((err) =>
        // My own line had inherited the same typo from the template above.
        console.error(`[impact_update.${action}] creator notification error:`, err),
      );
    }

    const response: ApiResponse<typeof updated> = { ok: true, data: updated };
    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
