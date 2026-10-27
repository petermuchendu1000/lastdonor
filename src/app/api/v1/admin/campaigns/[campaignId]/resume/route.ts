import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { campaigns, auditLogs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { resumeCampaignSchema } from '@/lib/validators/verification';
import { notifyCampaignResumed } from '@/lib/notifications';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import type { UserRole } from '@/types';

type RouteParams = { params: Promise<{ campaignId: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/v1/admin/campaigns/[campaignId]/resume
 *
 * Resumes a paused campaign back to "active".
 * Clears pausedAt/pausedReason and notifies subscribed donors.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const requestId = randomUUID();
  const { campaignId } = await params;

  try {
    const session = await requireRole(['admin']);

    if (!UUID_REGEX.test(campaignId)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign ID', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = resumeCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const { notes } = parsed.data;

    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        // For the first-publication stamp below. One more column on a query
        // that already runs - no extra round trip (docs/87's three-query cap).
        publishedAt: campaigns.publishedAt,
      })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const RESUMABLE = ['paused', 'suspended'] as const;

    if (!RESUMABLE.includes(campaign.status as typeof RESUMABLE[number])) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Cannot resume a campaign with status "${campaign.status}". Must be paused or suspended.`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    /*
      ⛔ `publishedAt` is stamped here too, keyed on the column being null.

      It was not, and that made this the second half of the only path to a
      live campaign with a NULL `published_at`: a queued campaign could be
      moved to `paused` (by `POST /api/v1/admin/info-requests` with
      `pauseCampaign: true`, which checked nothing - now guarded) and then
      resumed straight to `active`. The homepage orders featured campaigns by
      that column, `/api/v1/campaigns` sorts "newest" on it, and
      `src/app/sitemap.ts` derives every listing `lastmod` from it and skips
      a null - so the campaign would have been live and undated everywhere.

      Keyed on null, exactly as
      `PATCH /api/v1/admin/campaigns/[campaignId]` does it, so resuming a
      campaign that WAS live does not re-date its publication. `docs/120`.
    */
    const isFirstPublication = campaign.publishedAt === null;

    await db.update(campaigns).set({
      status: 'active',
      pausedAt: null,
      pausedReason: null,
      suspendedAt: null,
      suspendedReason: null,
      ...(isFirstPublication ? { publishedAt: new Date() } : {}),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));

    await db.insert(auditLogs).values({
      eventType: 'campaign.resumed',
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      targetType: 'campaign',
      targetId: campaignId,
      severity: 'info',
      details: { title: campaign.title, notes, previousStatus: campaign.status },
    });

    notifyCampaignResumed({
      campaignId,
      campaignTitle: campaign.title,
      campaignSlug: campaign.slug ?? '',
    }).catch((err) => console.error('[campaign.resumed] notification error:', err));

    revalidatePath(`/campaigns/${campaign.slug}`);
    return NextResponse.json({ ok: true, data: { id: campaignId, status: 'active' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[POST /api/v1/admin/campaigns/[campaignId]/resume]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to resume campaign', requestId } } satisfies ApiError, { status: 500 });
  }
}
