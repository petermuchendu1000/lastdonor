import { NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, donations, campaignUpdates } from '@/db/schema';
import { publicCampaignSelect } from '@/db/public-select';
import { eq, and, or, desc } from 'drizzle-orm';
import { updateCampaignSchema } from '@/lib/validators/campaign';
import { requireRole } from '@/lib/auth';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { revalidatePath } from 'next/cache';
import { withApiHandler } from '@/lib/api-handler';
import { requireAuth, parseBody, redactAnonymousDonor } from '@/lib/api-helpers';
import { apiError } from '@/lib/errors';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withApiHandler(async (_request, { requestId, params }) => {
  const slug = params!.slug;

  const [campaign] = await db
    .select(publicCampaignSelect)
    .from(campaigns)
    .where(
      and(
        eq(campaigns.slug, slug),
        or(
          eq(campaigns.status, 'active'),
          eq(campaigns.status, 'last_donor_zone'),
          eq(campaigns.status, 'completed'),
        ),
      ),
    )
    .limit(1);

  if (!campaign) {
    return apiError('NOT_FOUND', `Campaign with slug "${slug}" not found.`, requestId);
  }

  const [recentDonors, updates] = await Promise.all([
    db
      .select({
        id: donations.id,
        donorName: donations.donorName,
        donorLocation: donations.donorLocation,
        amount: donations.amount,
        currency: donations.currency,
        message: donations.message,
        isAnonymous: donations.isAnonymous,
        createdAt: donations.createdAt,
      })
      .from(donations)
      .where(eq(donations.campaignId, campaign.id))
      .orderBy(desc(donations.createdAt))
      .limit(10),
    db
      .select({
        id: campaignUpdates.id,
        title: campaignUpdates.title,
        bodyHtml: campaignUpdates.bodyHtml,
        imageUrl: campaignUpdates.imageUrl,
        createdAt: campaignUpdates.createdAt,
      })
      .from(campaignUpdates)
      .where(eq(campaignUpdates.campaignId, campaign.id))
      .orderBy(desc(campaignUpdates.createdAt)),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      ...campaign,
      recentDonors: recentDonors.map(redactAnonymousDonor),
      updates,
    },
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
});

export const PUT = withApiHandler(async (request, { requestId, session, params }) => {
  const idOrSlug = params!.slug;

  const auth = requireAuth(session, requestId);
  if ('error' in auth) return auth.error;

  const parsed = await parseBody(request, updateCampaignSchema, requestId);
  if ('error' in parsed) return parsed.error;

  // Look up by UUID or slug
  const condition = UUID_REGEX.test(idOrSlug)
    ? eq(campaigns.id, idOrSlug)
    : eq(campaigns.slug, idOrSlug);

  const [existing] = await db
    .select({ id: campaigns.id, slug: campaigns.slug, creatorId: campaigns.creatorId })
    .from(campaigns)
    .where(condition)
    .limit(1);

  if (!existing) {
    return apiError('NOT_FOUND', 'Campaign not found.', requestId);
  }

  // Authorization: editor/admin OR campaign creator
  const role = (auth.session.user as { role?: string }).role ?? '';
  const isOwner = existing.creatorId === auth.session.user.id;
  if (!['editor', 'admin'].includes(role) && !isOwner) {
    return apiError('FORBIDDEN', 'Insufficient permissions.', requestId);
  }

  const data = parsed.data;

  // Campaign owners can only update a subset of fields
  if (isOwner && !['editor', 'admin'].includes(role)) {
    const ownerAllowed = ['title', 'heroImageUrl', 'photoCredit', 'subjectName', 'subjectHometown', 'storyHtml', 'impactTiers'] as const;
    const disallowed = Object.keys(data).filter((k) => !(ownerAllowed as readonly string[]).includes(k));
    if (disallowed.length > 0) {
      return apiError('FORBIDDEN', `Campaign owners cannot update: ${disallowed.join(', ')}.`, requestId);
    }
  }

  /*
    ⛔ A campaign's status is NOT changed through this route.

    It used to be, and that is how `/admin` published campaigns without
    recording it. This route accepted `status` and, on `'active'`, stamped
    `publishedAt` - with no transition check, no audit row and no email.
    Meanwhile `/admin/campaigns/[id]/edit/page.tsx` handed an `under_review`
    campaign to `CampaignEditor` as `'active'` (anything not `draft` was
    coerced), the editor PUT its whole form back here, and so **an admin who
    opened the dashboard's own "Review" link and pressed Save published the
    campaign** - silently. Two clicks from `/admin`, and the resulting row is
    indistinguishable in `audit_logs` from one that was never reviewed, which
    is the evidence `docs/116` §8's forensics depend on. See `docs/120`.

    A status transition now has ONE writer:
    `PATCH /api/v1/admin/campaigns/[campaignId]`, which checks
    `ALLOWED_TRANSITIONS`, stamps `publishedAt` only when it is null, writes
    `campaign.published`, and emails the organiser - plus the dedicated
    pause / resume / suspend / cancel routes for the states that carry a
    reason.

    ⚠️ This is an explicit 400 rather than a silent omission. The
    field-by-field `updateValues` above would simply ignore `status`, and a
    caller that still sends one (the "Restore to Draft" button did) would
    appear to work and do nothing. `docs/116` §3 could leave `currency` to
    silent omission because nothing should ever send it; `status` had a live
    caller, so it has to be loud.
  */
  if (data.status !== undefined) {
    return apiError(
      'VALIDATION_ERROR',
      'A campaign status is not changed through this route. Use PATCH /api/v1/admin/campaigns/<id>, or the pause, resume, suspend and cancel routes, which check the transition, write an audit row and tell the organiser.',
      requestId,
    );
  }

  // If slug changed, check uniqueness
  if (data.slug && data.slug !== existing.slug) {
    const [conflict] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.slug, data.slug))
      .limit(1);

    if (conflict) {
      return apiError('CONFLICT', 'Slug already in use.', requestId);
    }
  }

  // Build update values
  const updateValues: Record<string, unknown> = { updatedAt: new Date() };
  if (data.title !== undefined) updateValues.title = data.title;
  if (data.slug !== undefined) updateValues.slug = data.slug;
  if (data.category !== undefined) updateValues.category = data.category;
  if (data.heroImageUrl !== undefined) updateValues.heroImageUrl = data.heroImageUrl;
  if (data.photoCredit !== undefined) updateValues.photoCredit = data.photoCredit;
  if (data.subjectName !== undefined) updateValues.subjectName = data.subjectName;
  if (data.subjectHometown !== undefined) updateValues.subjectHometown = data.subjectHometown;
  if (data.storyHtml !== undefined) updateValues.storyHtml = sanitizeHtml(data.storyHtml);
  if (data.goalAmount !== undefined) updateValues.goalAmount = data.goalAmount;
  if (data.impactTiers !== undefined) updateValues.impactTiers = data.impactTiers;

  const [updated] = await db
    .update(campaigns)
    .set(updateValues)
    .where(eq(campaigns.id, existing.id))
    .returning();

  revalidatePath(`/campaigns/${updated.slug}`);
  revalidatePath('/campaigns');

  return NextResponse.json({ ok: true, data: updated });
});

export const DELETE = withApiHandler(async (_request, { requestId, params }) => {
  const idOrSlug = params!.slug;

  // requireRole will throw UnauthorizedError/ForbiddenError caught by withApiHandler
  await requireRole(['admin']);

  const condition = UUID_REGEX.test(idOrSlug)
    ? eq(campaigns.id, idOrSlug)
    : eq(campaigns.slug, idOrSlug);

  const [existing] = await db
    .select({ id: campaigns.id, status: campaigns.status, slug: campaigns.slug })
    .from(campaigns)
    .where(condition)
    .limit(1);

  if (!existing) {
    return apiError('NOT_FOUND', 'Campaign not found.', requestId);
  }

  if (!['draft', 'completed'].includes(existing.status)) {
    return apiError('VALIDATION_ERROR', 'Can only archive campaigns in draft or completed status.', requestId);
  }

  await db
    .update(campaigns)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(campaigns.id, existing.id));

  revalidatePath(`/campaigns/${existing.slug}`);
  revalidatePath('/campaigns');

  return NextResponse.json({ ok: true, data: null });
});
