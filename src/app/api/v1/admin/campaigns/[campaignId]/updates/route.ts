import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { insertCampaignUpdate } from '@/lib/echo-counters';
import { campaigns, campaignUpdates } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { notifyCampaignUpdateDigest } from '@/lib/notifications';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import type { ApiResponse, ApiError } from '@/types/api';
import { adminCampaignUpdateSchema } from '@/lib/validators/admin';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Params {
  params: Promise<{ campaignId: string }>;
}

/**
 * GET /api/v1/admin/campaigns/[campaignId]/updates - list updates for a campaign
 */
export async function GET(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { campaignId } = await params;

  try {
    await requireRole(['editor', 'admin']);

    if (!UUID_REGEX.test(campaignId)) {
      const body: ApiError = {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign ID', requestId },
      };
      return NextResponse.json(body, { status: 400 });
    }

    const updates = await db
      .select({
        id: campaignUpdates.id,
        title: campaignUpdates.title,
        bodyHtml: campaignUpdates.bodyHtml,
        imageUrl: campaignUpdates.imageUrl,
        createdAt: campaignUpdates.createdAt,
      })
      .from(campaignUpdates)
      .where(eq(campaignUpdates.campaignId, campaignId))
      .orderBy(desc(campaignUpdates.createdAt));

    const response: ApiResponse<typeof updates> = { ok: true, data: updates };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error(`[GET /api/v1/admin/campaigns/${campaignId}/updates]`, error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch updates', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/admin/campaigns/[campaignId]/updates - create a new campaign update
 */
export async function POST(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { campaignId } = await params;

  try {
    await requireRole(['editor', 'admin']);

    if (!UUID_REGEX.test(campaignId)) {
      const body: ApiError = {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign ID', requestId },
      };
      return NextResponse.json(body, { status: 400 });
    }

    // Verify campaign exists
    const [campaign] = await db
      .select({ id: campaigns.id, slug: campaigns.slug, title: campaigns.title, status: campaigns.status, currency: campaigns.currency, raisedAmount: campaigns.raisedAmount, goalAmount: campaigns.goalAmount })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) {
      const body: ApiError = {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId },
      };
      return NextResponse.json(body, { status: 404 });
    }

    const body = await request.json();
    const parsed = adminCampaignUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }
    const { title, bodyHtml, imageUrl } = parsed.data;

    const created = await insertCampaignUpdate({
      campaignId,
      title: title.trim(),
      bodyHtml: sanitizeHtml(bodyHtml),
      imageUrl: imageUrl?.trim() ?? null,
    });

    revalidatePath(`/campaigns/${campaign.slug}`);
    revalidatePath(`/admin/campaigns/${campaignId}`);

    // Notify subscribers (fire-and-forget)
    const plainText = bodyHtml ? bodyHtml.replace(/<[^>]+>/g, '') : '';
    const excerpt = plainText.substring(0, 300);
    const progressPercent = campaign.goalAmount > 0
      ? Math.min(Math.round((campaign.raisedAmount / campaign.goalAmount) * 100), 100)
      : 0;
    notifyCampaignUpdateDigest({
      campaignId,
      campaignTitle: campaign.title,
      campaignSlug: campaign.slug,
      campaignStatus: campaign.status,
      updateTitle: title.trim(),
      updateExcerpt: excerpt,
      progressPercent,
      // Without this every subscribed donor of a KES campaign was emailed
      // "$18400.00 of $50000.00 raised" (`docs/92`).
      currency: campaign.currency,
      raisedCents: campaign.raisedAmount,
      goalCents: campaign.goalAmount,
    }).catch((err) => console.error('[admin-campaign-update] notify error:', err));

    const response: ApiResponse<typeof created> = { ok: true, data: created };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error(`[POST /api/v1/admin/campaigns/${campaignId}/updates]`, error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create update', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
