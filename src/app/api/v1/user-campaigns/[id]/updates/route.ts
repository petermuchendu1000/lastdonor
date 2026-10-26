import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { insertCampaignUpdate } from '@/lib/echo-counters';
import { campaigns, campaignUpdates } from '@/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { auth, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { notifyCampaignUpdateDigest } from '@/lib/notifications';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { ApiResponse, ApiError } from '@/types/api';
import { canCollaborate } from '@/lib/collaborators/can-collaborate';

const createUpdateSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  body: z.string().min(10, 'Update must be at least 10 characters').max(5000),
});

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/user-campaigns/[id]/updates - Post a progress update
 */
export async function POST(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    const session = await auth();
    if (!session?.user) throw new UnauthorizedError();

    const [campaign] = await db
      .select({ id: campaigns.id, slug: campaigns.slug, title: campaigns.title, creatorId: campaigns.creatorId, status: campaigns.status, currency: campaigns.currency, raisedAmount: campaigns.raisedAmount, goalAmount: campaigns.goalAmount })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const role = session.user.role as string;
    const isOwner = campaign.creatorId === session.user.id;
    const isStaff = ['editor', 'admin'].includes(role);
    /*
      A collaborator the organiser invited may post updates (`docs/111`).

      ⚠️ `canCollaborate` is evaluated LAST on purpose. It issues a query, and
      every route here is capped at three concurrent database queries
      (`src/db/pool-fanout.ratchet.test.ts`, pool `max: 5`, `docs/87`); the
      short-circuit keeps the owner's path - the common one - at the cost it
      had before this feature existed.
    */
    if (
      !isOwner &&
      !isStaff &&
      !(await canCollaborate(campaign.id, session.user.id, 'post_update'))
    ) {
      throw new ForbiddenError();
    }

    if (campaign.status === 'archived') {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Cannot post updates to an archived campaign', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }

    const body = await request.json();
    const parsed = createUpdateSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0];
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: firstError.message, field: firstError.path.join('.'), requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const bodyHtml = sanitizeHtml(
      parsed.data.body
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, '<br />')}</p>`)
        .join(''),
    );

    // Idempotency: reject duplicate updates with same title within 60 seconds
    const recentWindow = new Date(Date.now() - 60_000);
    const [duplicate] = await db
      .select({ id: campaignUpdates.id, title: campaignUpdates.title, createdAt: campaignUpdates.createdAt })
      .from(campaignUpdates)
      .where(
        and(
          eq(campaignUpdates.campaignId, id),
          eq(campaignUpdates.title, parsed.data.title),
          gte(campaignUpdates.createdAt, recentWindow),
        ),
      )
      .limit(1);

    if (duplicate) {
      const response: ApiResponse<typeof duplicate> = { ok: true, data: duplicate };
      return NextResponse.json(response, { status: 200 });
    }

    const update = await insertCampaignUpdate({
      campaignId: id,
      title: parsed.data.title,
      bodyHtml,
      updateType: 'progress',
    });

    revalidatePath(`/campaigns/${campaign.slug}`);

    // Notify subscribers (fire-and-forget, never block response)
    const excerpt = parsed.data.body.substring(0, 300);
    const progressPercent = campaign.goalAmount > 0
      ? Math.min(Math.round((campaign.raisedAmount / campaign.goalAmount) * 100), 100)
      : 0;
    notifyCampaignUpdateDigest({
      campaignId: id,
      campaignTitle: campaign.title,
      campaignSlug: campaign.slug,
      updateTitle: parsed.data.title,
      updateExcerpt: excerpt,
      progressPercent,
      // Without this every subscribed donor of a KES campaign was emailed
      // "$18400.00 of $50000.00 raised" (`docs/92`).
      currency: campaign.currency,
      raisedCents: campaign.raisedAmount,
      goalCents: campaign.goalAmount,
    }).catch((err) => console.error('[user-campaign-update] notify error:', err));

    const response: ApiResponse<typeof update> = { ok: true, data: update };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not your campaign', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error(`[POST /api/v1/user-campaigns/${id}/updates]`, error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to post update', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
