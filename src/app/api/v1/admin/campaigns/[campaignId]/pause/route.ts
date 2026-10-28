import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { campaigns, auditLogs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { pauseCampaignSchema } from '@/lib/validators/verification';
import { notifyCampaignPaused } from '@/lib/notifications';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import type { CampaignStatus, UserRole } from '@/types';

type RouteParams = { params: Promise<{ campaignId: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses that can transition to "paused". */
const PAUSEABLE: CampaignStatus[] = ['active', 'last_donor_zone'];

/**
 * POST /api/v1/admin/campaigns/[campaignId]/pause
 *
 * Pauses a campaign. Only active or LDZ campaigns can be paused.
 * Optionally notifies subscribed donors.
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

    const body = await request.json().catch(() => null);
    const parsed = pauseCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const { reason, notifyDonors } = parsed.data;

    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        // Carried for the notification's link: a paused campaign has a public
        // page only if it was published (`docs/131`).
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

    if (!PAUSEABLE.includes(campaign.status as CampaignStatus)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Cannot pause a campaign with status "${campaign.status}". Must be active or last_donor_zone.`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    await db.update(campaigns).set({
      status: 'paused',
      pausedAt: new Date(),
      pausedReason: reason,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));

    await db.insert(auditLogs).values({
      eventType: 'campaign.paused',
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      targetType: 'campaign',
      targetId: campaignId,
      severity: 'warning',
      details: { title: campaign.title, previousStatus: campaign.status, reason, notifyDonors },
    });

    notifyCampaignPaused({
      campaignId,
      campaignTitle: campaign.title,
      campaignSlug: campaign.slug ?? '',
      campaignPublishedAt: campaign.publishedAt,
      reason,
      notifyDonors,
    }).catch((err) => console.error('[campaign.paused] notification error:', err));

    revalidatePath(`/campaigns/${campaign.slug}`);
    return NextResponse.json({ ok: true, data: { id: campaignId, status: 'paused' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[POST /api/v1/admin/campaigns/[campaignId]/pause]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to pause campaign', requestId } } satisfies ApiError, { status: 500 });
  }
}
