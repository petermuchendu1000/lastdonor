import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { infoRequests, campaigns, users, auditLogs } from '@/db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { createInfoRequestSchema, infoRequestsQueueQuerySchema } from '@/lib/validators/verification';
import { notifyInfoRequest } from '@/lib/notifications';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import type { UserRole } from '@/types';

/**
 * GET /api/v1/admin/info-requests - List info requests (admin queue)
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  try {
    await requireRole(['admin']);

    const url = new URL(request.url);
    const query = infoRequestsQueueQuerySchema.parse({
      status: url.searchParams.get('status') ?? undefined,
      page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    });

    const { status, page, limit } = query;
    const offset = (page - 1) * limit;

    const conditions = status ? [eq(infoRequests.status, status as 'pending' | 'responded' | 'expired' | 'closed')] : [];

    const [items, [{ total }]] = await Promise.all([
      db
        .select({
          id: infoRequests.id,
          campaignId: infoRequests.campaignId,
          campaignTitle: campaigns.title,
          requestedBy: infoRequests.requestedBy,
          targetUser: infoRequests.targetUser,
          targetName: users.name,
          targetEmail: users.email,
          requestType: infoRequests.requestType,
          details: infoRequests.details,
          deadline: infoRequests.deadline,
          status: infoRequests.status,
          pauseCampaign: infoRequests.pauseCampaign,
          responseText: infoRequests.responseText,
          respondedAt: infoRequests.respondedAt,
          reminderSent: infoRequests.reminderSent,
          escalated: infoRequests.escalated,
          createdAt: infoRequests.createdAt,
        })
        .from(infoRequests)
        .innerJoin(campaigns, eq(infoRequests.campaignId, campaigns.id))
        .innerJoin(users, eq(infoRequests.targetUser, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(infoRequests.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(infoRequests)
        .where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[GET /api/v1/admin/info-requests]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch info requests', requestId } } satisfies ApiError, { status: 500 });
  }
}

/**
 * POST /api/v1/admin/info-requests - Create a new info request
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const session = await requireRole(['admin']);

    const body = await request.json().catch(() => null);
    const parsed = createInfoRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const { campaignId, requestType, details, deadlineDays, pauseCampaign } = parsed.data;

    // Fetch campaign + creator
    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        creatorId: campaigns.creatorId,
        // For the pause guard below. One more column on a query that already
        // runs - no extra round trip (docs/87's three-query cap).
        status: campaigns.status,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign || !campaign.creatorId) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign or campaign creator not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const [creator] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, campaign.creatorId))
      .limit(1);

    if (!creator) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign creator user not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + deadlineDays);

    const [infoReq] = await db.insert(infoRequests).values({
      campaignId,
      requestedBy: session.user?.id ?? '',
      targetUser: creator.id,
      requestType,
      details,
      deadline,
      pauseCampaign,
    }).returning();

    /*
      Optionally pause the campaign.

      ⛔ The status guard is the fix. This was the only completely unguarded
      write to `campaigns.status` in the codebase: no check of where the
      campaign currently is, so `under_review -> paused` went through - and
      `paused` is in `PUBLICLY_VIEWABLE_STATUSES`, so asking a queued
      organiser for more information PUBLISHED their unreviewed campaign.

      Worse, it was the first half of the only route to `active` with a NULL
      `published_at`: once paused, the detail page offers Resume, and that
      route did not stamp the column. The homepage's featured order,
      `/campaigns`'s "newest" sort and the sitemap's `lastmod` all read it.
      `docs/120`.

      `PAUSEABLE` matches `POST .../pause`, which is the dedicated route for
      this transition and has always been guarded.
    */
    const PAUSEABLE: string[] = ['active', 'last_donor_zone'];
    if (pauseCampaign && !PAUSEABLE.includes(campaign.status)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Cannot pause a campaign with status "${campaign.status}". Only an active campaign can be paused.`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }
    if (pauseCampaign) {
      await db.update(campaigns).set({
        status: 'paused',
        pausedAt: new Date(),
        pausedReason: `Information request: ${requestType}`,
        updatedAt: new Date(),
      }).where(eq(campaigns.id, campaignId));
    }

    await db.insert(auditLogs).values({
      eventType: 'info_request.created',
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      targetType: 'campaign',
      targetId: campaignId,
      severity: 'warning',
      details: { infoRequestId: infoReq.id, requestType, deadlineDays, pauseCampaign },
    });

    // Notify the campaigner
    notifyInfoRequest({
      campaignerId: creator.id,
      campaignerEmail: creator.email,
      campaignerName: creator.name ?? 'Campaigner',
      campaignId,
      campaignTitle: campaign.title,
      requestType,
      details,
      deadline: deadline.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    }).catch((err) => console.error('[info_request.created] notification error:', err));

    return NextResponse.json({ ok: true, data: infoReq }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[POST /api/v1/admin/info-requests]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create info request', requestId } } satisfies ApiError, { status: 500 });
  }
}
