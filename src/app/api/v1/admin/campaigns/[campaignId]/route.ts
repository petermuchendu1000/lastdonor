import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, donations, campaignUpdates, campaignSeedMessages, auditLogs, users } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { notifyCampaignStatusChange, notifyWelcomeCampaigner } from '@/lib/notifications';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import type { CampaignStatus, UserRole } from '@/types';

type RouteParams = { params: Promise<{ campaignId: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATUSES: CampaignStatus[] = ['draft', 'active', 'last_donor_zone', 'completed', 'archived', 'paused', 'under_review', 'suspended', 'cancelled'];

const ALLOWED_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['active', 'archived'],
  active: ['draft', 'completed', 'archived'],
  last_donor_zone: ['active', 'completed', 'archived'],
  completed: ['archived'],
  archived: ['draft'],
  paused: ['active'],
  under_review: ['active', 'suspended'],
  suspended: ['active', 'cancelled'],
  cancelled: [],
};

/**
 * PATCH /api/v1/admin/campaigns/[campaignId] - Update campaign status
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

    let body: { status?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    if (!body.status || !VALID_STATUSES.includes(body.status as CampaignStatus)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Status must be one of: ${VALID_STATUSES.join(', ')}`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const newStatus = body.status as CampaignStatus;

    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        status: campaigns.status,
        slug: campaigns.slug,
        creatorId: campaigns.creatorId,
        // Read so the publish stamp below can tell a first publication
        // from a return to active.
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

    const currentStatus = campaign.status as CampaignStatus;
    const allowed = ALLOWED_TRANSITIONS[currentStatus];
    if (!allowed?.includes(newStatus)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Cannot transition from "${currentStatus}" to "${newStatus}". Allowed: ${allowed?.join(', ') ?? 'none'}`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
    /*
      First publication stamps `publishedAt`.

      This used to check `currentStatus === 'draft'` only. Since docs/78
      every user submission arrives as `under_review`, so approving one
      would have left `publishedAt` null forever — and the homepage orders
      featured campaigns by it, `/campaigns` sorts on it, and the sitemap
      reads it. Keyed on the column being empty rather than on a specific
      previous status, so a later route into `active` cannot miss it and a
      republish cannot silently re-date a campaign that was already live.
    */
    const isFirstPublication = newStatus === 'active' && campaign.publishedAt === null;
    if (isFirstPublication) {
      updates.publishedAt = new Date();
    }
    if (newStatus === 'completed') {
      updates.completedAt = new Date();
    }

    await db.update(campaigns).set(updates).where(eq(campaigns.id, campaignId));

    /*
      A first publication is the event donors and the organiser care
      about, and it is what `campaign.submitted` in the creation route is
      waiting to be paired with. Logged under its own type so the review
      queue is auditable end to end: submitted -> published, or submitted
      -> suspended.
    */
    await db.insert(auditLogs).values({
      eventType: isFirstPublication ? 'campaign.published' : 'campaign.status_changed',
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      targetType: 'campaign',
      targetId: campaignId,
      severity: 'warning',
      details: { title: campaign.title, previousStatus: currentStatus, newStatus },
    });

    // Fetch campaign details needed for notification (slug, goalAmount)
    const [full] = await db
      .select({ slug: campaigns.slug, goalAmount: campaigns.goalAmount })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    /*
      On a first publication the organiser gets the "Your Campaign Is
      Live!" email with its sharing steps. That email used to be sent at
      submission, which only made sense while nothing was reviewed; this
      is the moment it became true. See docs/78.

      `notifyCampaignStatusChange` below writes to DONORS, of which a
      never-published campaign has none, so the two do not overlap.
    */
    if (isFirstPublication && campaign.creatorId) {
      const [creator] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, campaign.creatorId))
        .limit(1);

      if (creator?.email) {
        notifyWelcomeCampaigner({
          campaignerId: campaign.creatorId,
          campaignerEmail: creator.email,
          campaignerName: creator.name ?? 'Campaigner',
          campaignTitle: campaign.title,
          campaignSlug: campaign.slug,
        }).catch((err) => console.error('[campaign.published] welcome notification error:', err));
      }
    }

    // Notify donors asynchronously - do not block the response
    notifyCampaignStatusChange({
      campaignId,
      campaignTitle: campaign.title,
      campaignSlug: full?.slug ?? '',
      previousStatus: currentStatus,
      newStatus,
      goalAmount: full?.goalAmount ?? 0,
    }).catch((err) => console.error('[campaign.status_changed] notification error:', err));

    return NextResponse.json({ ok: true, data: { id: campaignId, status: newStatus } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[PATCH /api/v1/admin/campaigns/[campaignId]]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update campaign', requestId } } satisfies ApiError, { status: 500 });
  }
}

/**
 * DELETE /api/v1/admin/campaigns/[campaignId] - Delete a campaign
 * Only allowed for draft campaigns with no real donations.
 * Campaigns with real donations are archived instead.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
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

    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        status: campaigns.status,
        raisedAmount: campaigns.raisedAmount,
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

    // Check for real donations - cannot hard-delete campaigns with real money
    const [realDonationCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(donations)
      .where(eq(donations.campaignId, campaignId));

    if (realDonationCount.count > 0) {
      // Archive instead of delete for data integrity
      await db.update(campaigns).set({ status: 'archived', updatedAt: new Date() }).where(eq(campaigns.id, campaignId));

      await db.insert(auditLogs).values({
        eventType: 'campaign.archived',
        actorId: session.user?.id ?? null,
        actorRole: session.user?.role as UserRole,
        targetType: 'campaign',
        targetId: campaignId,
        severity: 'warning',
        details: { title: campaign.title, reason: 'delete_requested_with_donations', donationCount: realDonationCount.count },
      });

      // Fetch slug for notification
      const [c] = await db
        .select({ slug: campaigns.slug, goalAmount: campaigns.goalAmount })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId))
        .limit(1);

      notifyCampaignStatusChange({
        campaignId,
        campaignTitle: campaign.title,
        campaignSlug: c?.slug ?? '',
        previousStatus: campaign.status as string,
        newStatus: 'archived',
        goalAmount: c?.goalAmount ?? 0,
      }).catch((err) => console.error('[campaign.archived] notification error:', err));

      return NextResponse.json({
        ok: true,
        data: { id: campaignId, action: 'archived', reason: `Campaign has ${realDonationCount.count} donation(s) - archived instead of deleted for financial integrity.` },
      });
    }

    // Safe to hard-delete: remove seed messages, updates, then campaign
    await db.delete(campaignSeedMessages).where(eq(campaignSeedMessages.campaignId, campaignId));
    await db.delete(campaignUpdates).where(eq(campaignUpdates.campaignId, campaignId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));

    await db.insert(auditLogs).values({
      eventType: 'campaign.deleted',
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      targetType: 'campaign',
      targetId: campaignId,
      severity: 'warning',
      details: { title: campaign.title, previousStatus: campaign.status },
    });

    return NextResponse.json({ ok: true, data: { id: campaignId, action: 'deleted' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[DELETE /api/v1/admin/campaigns/[campaignId]]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete campaign', requestId } } satisfies ApiError, { status: 500 });
  }
}
