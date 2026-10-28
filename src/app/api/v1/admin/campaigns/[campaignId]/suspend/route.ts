import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { campaigns, auditLogs, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { suspendCampaignSchema } from '@/lib/validators/verification';
import { notifyCampaignSuspended, notifyCampaignRefused } from '@/lib/notifications';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import type { CampaignStatus, UserRole } from '@/types';

type RouteParams = { params: Promise<{ campaignId: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses that can be suspended. */
const SUSPENDABLE: CampaignStatus[] = ['active', 'last_donor_zone', 'paused', 'under_review'];

/**
 * POST /api/v1/admin/campaigns/[campaignId]/suspend
 *
 * Suspends a campaign pending investigation.
 * Notifies subscribed donors that funds are secured.
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
    const parsed = suspendCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const { reason, internalNotes } = parsed.data;

    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        creatorId: campaigns.creatorId,
        /*
          ⛔ Load-bearing for `docs/131`. A REFUSED campaign (`under_review ->
          suspended`) has never been published, so it has no public page and
          its donor notification must carry no link - and it has no donors
          either. A LIVE campaign suspended for investigation does have one.
          This column is what tells the two apart; the status cannot.
        */
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

    if (!SUSPENDABLE.includes(campaign.status as CampaignStatus)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Cannot suspend a campaign with status "${campaign.status}".`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    await db.update(campaigns).set({
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedReason: reason,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));

    await db.insert(auditLogs).values({
      eventType: campaign.status === 'under_review' ? 'campaign.refused' : 'campaign.suspended',
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      targetType: 'campaign',
      targetId: campaignId,
      severity: 'critical',
      details: { title: campaign.title, previousStatus: campaign.status, reason, internalNotes },
    });

    /*
      TWO DIFFERENT SITUATIONS WEAR THE SAME STATUS.

      Suspending a LIVE campaign is an investigation: it has donors, and
      `notifyCampaignSuspended` tells them their money is safe. Suspending an
      `under_review` campaign is a REFUSAL: it has never been public, so it
      has no donors at all, and the person who needs telling is the organiser.

      Until 2026-10-25 only the first case notified anybody, so a refused
      campaign notified NOBODY - `notifyCampaignSuspended` iterates subscribed
      donors, and an unpublished campaign has none, so it sent zero emails and
      looked like it had worked. `docs/93` found it; the owner's decision is to
      email the organiser with this reason.
    */
    const isRefusalAtReview = campaign.status === 'under_review';

    if (isRefusalAtReview) {
      if (campaign.creatorId) {
        const [creator] = await db
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, campaign.creatorId))
          .limit(1);

        if (creator?.email) {
          notifyCampaignRefused({
            creatorId: campaign.creatorId,
            creatorEmail: creator.email,
            creatorName: creator.name ?? '',
            campaignTitle: campaign.title,
            reason,
          }).catch((err) => console.error('[campaign.refused] notification error:', err));
        }
      }
    } else {
      notifyCampaignSuspended({
        campaignId,
        campaignTitle: campaign.title,
        campaignSlug: campaign.slug ?? '',
        campaignPublishedAt: campaign.publishedAt,
      }).catch((err) => console.error('[campaign.suspended] notification error:', err));
    }

    revalidatePath(`/campaigns/${campaign.slug}`);
    return NextResponse.json({ ok: true, data: { id: campaignId, status: 'suspended' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[POST /api/v1/admin/campaigns/[campaignId]/suspend]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to suspend campaign', requestId } } satisfies ApiError, { status: 500 });
  }
}
