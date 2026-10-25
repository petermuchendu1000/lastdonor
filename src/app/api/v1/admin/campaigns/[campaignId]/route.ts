import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
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
  /*
    ⛔ `under_review -> suspended` is DELIBERATELY ABSENT, and this is the
    only route to `suspended` that ever existed here.

    Refusing a campaign at review is the one status change that must carry a
    REASON: the organiser is emailed it (`docs/93`, owner decision
    2026-10-25). This endpoint takes `{ status }` and nothing else, so every
    refusal through it was reasonless AND silent. The refusal path is
    `POST /api/v1/admin/campaigns/[campaignId]/suspend`, whose schema
    requires a reason of at least three characters.

    Leaving it here "for convenience" would keep a door open that cannot
    notify anybody, which is exactly the defect being closed.
  */
  under_review: ['active'],
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

    // Name the right endpoint rather than leaving an admin to guess from
    // "Allowed: active". See the note on ALLOWED_TRANSITIONS above.
    if (currentStatus === 'under_review' && newStatus === 'suspended') {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Refusing a campaign needs a reason the organiser can be told. Use POST /api/v1/admin/campaigns/[campaignId]/suspend with a reason.', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

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
      would have left `publishedAt` null forever  - and the homepage orders
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

    /*
      Purge the cached page for this slug. Every sibling status route -
      suspend, resume, pause, cancel - already did this; the route that
      makes a campaign public for the FIRST time did not, which is the
      one transition where a stale entry is guaranteed to exist.

      While a campaign sits in `under_review` the detail query does not
      match it (the status list in `campaigns/[slug]/page.tsx` excludes
      it), so the page calls `notFound()`. Since the soft-404 fix of
      2026-10-18 (docs/80) that is a REAL 404, and Next caches it as an
      ISR entry. Approving the campaign changed the database and left
      that entry in place, so an approved, live campaign served HTTP 404
      until the next revalidation happened to regenerate it.

      Observed in production 2026-10-19: `nicholas-cabo` was `active`
      with `published_at` set to the previous morning and answered 404,
      then 200 a few minutes later once the entry aged out. Before the
      soft-404 fix the same staleness served a 200 with a "not found"
      body - equally wrong, but it did not tell a crawler the appeal was
      gone, which is the thing docs/43 exists to prevent.

      The listing pages are purged too: a newly approved campaign has to
      appear on them, and they were relying on their own `revalidate`
      windows to notice.
    */
    revalidatePath(`/campaigns/${campaign.slug}`);
    revalidatePath('/campaigns');
    revalidatePath('/');

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
 *
 * Two outcomes, in this order:
 *   1. ANY donation row (real or seed) -> archived, never destroyed.
 *   2. No donations and status is `draft` -> hard deleted, with its
 *      updates and seed messages.
 *   3. No donations and any other status -> REFUSED (409).
 *
 * ── Why rule 3 exists (docs/88 F13) ──────────────────────────────────────
 *
 * This docblock used to claim "only allowed for draft campaigns" and NO
 * such check existed. Proven against production on 2026-10-17 with
 * throwaway rows: `draft`, `active`, `completed` AND `under_review` all
 * returned 200 and left zero rows. `CampaignsList` renders Delete on every
 * row, so any campaign  - including the review queue of appeals naming real
 * people  - was two clicks from permanent destruction.
 *
 * The guard is a refusal rather than a silent archive because an admin who
 * asked to delete an active campaign has either picked the wrong row or
 * wants `archived`; both are better served by being told than by having
 * one of them guessed at.
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

    /*
      ANY donation row, real or seed. The name used to be
      `realDonationCount` while the query had no `source` filter  - see
      docs/88 F12. Renamed rather than filtered: counting seed rows too is
      the conservative side, and adding `source = 'real'` here would start
      hard-deleting seed-funded campaigns, which is a product decision and
      not a rename.
    */
    const [donationCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(donations)
      .where(eq(donations.campaignId, campaignId));

    if (donationCount.count > 0) {
      // Archive instead of delete for data integrity
      await db.update(campaigns).set({ status: 'archived', updatedAt: new Date() }).where(eq(campaigns.id, campaignId));

      await db.insert(auditLogs).values({
        eventType: 'campaign.archived',
        actorId: session.user?.id ?? null,
        actorRole: session.user?.role as UserRole,
        targetType: 'campaign',
        targetId: campaignId,
        severity: 'warning',
        details: { title: campaign.title, reason: 'delete_requested_with_donations', donationCount: donationCount.count },
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
        data: { id: campaignId, action: 'archived', reason: `Campaign has ${donationCount.count} donation(s) - archived instead of deleted for financial integrity.` },
      });
    }

    /*
      The guard docs/88 F13 found missing. Only a draft may be destroyed;
      anything that has been submitted, published or reviewed is refused
      and the admin is pointed at archive, which is reversible.
    */
    if (campaign.status !== 'draft') {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'CONFLICT',
            message:
              `Only a draft campaign can be deleted. This one is "${campaign.status}". ` +
              'Archive it instead: archiving is reversible, deleting is not.',
            requestId,
          },
        } satisfies ApiError,
        { status: 409 },
      );
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
