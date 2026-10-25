import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, campaignUpdates } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { updateUserCampaignSchema } from '@/lib/validators/user-campaign';
import { auth, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import type { ApiResponse, ApiError } from '@/types/api';
import { canCollaborate } from '@/lib/collaborators/can-collaborate';
import type { Capability } from '@/lib/collaborators/capabilities';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Verify session + ownership. Returns { session, campaign } or a Response.
 */
/**
 * Resolve the campaign and authorise the caller.
 *
 * `allowCollaborator` is the capability a non-owner collaborator may use to
 * reach this handler, or `undefined` for creator-and-staff only.
 *
 * ⛔ DELETE passes NOTHING, deliberately. Destroying a campaign and its
 * history is not a content capability, and `delete_campaign` is named in
 * `NEVER_DELEGATED` (`src/lib/collaborators/capabilities.ts`). The parameter
 * is explicit at every call site precisely so that widening one method cannot
 * widen the others by accident - which is what a single shared `requireOwner`
 * would have done.
 */
async function requireOwner(
  id: string,
  _requestId: string,
  allowCollaborator?: Capability,
) {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();

  const [campaign] = await db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      title: campaigns.title,
      status: campaigns.status,
      heroImageUrl: campaigns.heroImageUrl,
      storyHtml: campaigns.storyHtml,
      category: campaigns.category,
      subjectName: campaigns.subjectName,
      subjectHometown: campaigns.subjectHometown,
      goalAmount: campaigns.goalAmount,
      raisedAmount: campaigns.raisedAmount,
      donorCount: campaigns.donorCount,
      verificationStatus: campaigns.verificationStatus,
      beneficiaryRelation: campaigns.beneficiaryRelation,
      creatorId: campaigns.creatorId,
      createdAt: campaigns.createdAt,
      publishedAt: campaigns.publishedAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);

  if (!campaign) return null;

  const role = session.user.role as string;
  const isOwner = campaign.creatorId === session.user.id;
  const isStaff = ['editor', 'admin'].includes(role);

  // See the note on `canCollaborate`'s short-circuit order: the query only
  // runs for a caller who is neither the owner nor staff.
  const asCollaborator =
    !isOwner &&
    !isStaff &&
    allowCollaborator !== undefined &&
    (await canCollaborate(campaign.id, session.user.id, allowCollaborator));

  if (!isOwner && !isStaff && !asCollaborator) {
    throw new ForbiddenError();
  }

  return { session, campaign };
}

/**
 * GET /api/v1/user-campaigns/[id] - Get a single user campaign (with updates)
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    const result = await requireOwner(id, requestId, 'edit_content');

    if (!result) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const updates = await db
      .select({
        id: campaignUpdates.id,
        title: campaignUpdates.title,
        bodyHtml: campaignUpdates.bodyHtml,
        updateType: campaignUpdates.updateType,
        createdAt: campaignUpdates.createdAt,
      })
      .from(campaignUpdates)
      .where(eq(campaignUpdates.campaignId, id))
      .orderBy(desc(campaignUpdates.createdAt));

    const response: ApiResponse = {
      ok: true,
      data: { ...result.campaign, updates },
    };
    return NextResponse.json(response);
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
    console.error(`[GET /api/v1/user-campaigns/${id}]`, error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch campaign', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}

/**
 * PUT /api/v1/user-campaigns/[id] - Update campaign (owner-only fields)
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    const result = await requireOwner(id, requestId, 'edit_content');

    if (!result) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    // Cannot edit completed or archived campaigns
    if (['completed', 'archived'].includes(result.campaign.status)) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Cannot edit a completed or archived campaign', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }

    const body = await request.json();
    const parsed = updateUserCampaignSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0];
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: firstError.message, field: firstError.path.join('.'), requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const data = parsed.data;
    const updateValues: Record<string, unknown> = { updatedAt: new Date() };

    if (data.title !== undefined) updateValues.title = data.title;
    if (data.category !== undefined) updateValues.category = data.category;
    if (data.heroImageUrl !== undefined) updateValues.heroImageUrl = data.heroImageUrl;
    if (data.galleryImages !== undefined) updateValues.galleryImages = data.galleryImages ?? [];
    if (data.subjectHometown !== undefined) updateValues.subjectHometown = data.subjectHometown;
    if (data.story !== undefined) {
      updateValues.storyHtml = sanitizeHtml(
        data.story
          .split(/\n{2,}/)
          .map((p) => `<p>${p.replace(/\n/g, '<br />')}</p>`)
          .join(''),
      );
    }

    const [updated] = await db
      .update(campaigns)
      .set(updateValues)
      .where(eq(campaigns.id, id))
      .returning({ id: campaigns.id, slug: campaigns.slug, title: campaigns.title });

    revalidatePath(`/campaigns/${result.campaign.slug}`);
    revalidatePath('/campaigns');

    const response: ApiResponse<typeof updated> = { ok: true, data: updated };
    return NextResponse.json(response);
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
    console.error(`[PUT /api/v1/user-campaigns/${id}]`, error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update campaign', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/user-campaigns/[id] - Close/archive a campaign (owner-only)
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id } = await params;

  try {
    const result = await requireOwner(id, requestId);

    if (!result) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    // Already archived or completed
    if (['archived', 'completed'].includes(result.campaign.status)) {
      return NextResponse.json(
        { ok: false, error: { code: 'CONFLICT', message: 'Campaign is already closed', requestId } } satisfies ApiError,
        { status: 409 },
      );
    }

    await db
      .update(campaigns)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(campaigns.id, id));

    revalidatePath(`/campaigns/${result.campaign.slug}`);
    revalidatePath('/campaigns');

    return NextResponse.json({ ok: true, data: { id, status: 'archived' } });
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
    console.error(`[DELETE /api/v1/user-campaigns/${id}]`, error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to close campaign', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
