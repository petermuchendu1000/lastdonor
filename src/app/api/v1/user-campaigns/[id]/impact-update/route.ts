import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, impactUpdates, auditLogs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { supabase, BUCKET_NAME, getPublicUrl } from '@/lib/supabase-storage';
import { randomUUID } from 'crypto';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { notifyAdminImpactUpdateSubmitted } from '@/lib/notifications';
import type { ApiError, ApiResponse } from '@/types/api';

export const runtime = 'nodejs';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 10;
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/user-campaigns/[id]/impact-update
 *
 * Get the impact update for a campaign (campaigner only).
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id: campaignId } = await params;

  try {
    const session = await auth();
    if (!session?.user) throw new UnauthorizedError();

    const [campaign] = await db
      .select({ id: campaigns.id, creatorId: campaigns.creatorId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    if (campaign.creatorId !== session.user.id) {
      throw new ForbiddenError();
    }

    const [impactUpdate] = await db
      .select()
      .from(impactUpdates)
      .where(eq(impactUpdates.campaignId, campaignId))
      .limit(1);

    const response: ApiResponse<typeof impactUpdate | null> = {
      ok: true,
      data: impactUpdate ?? null,
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
        { ok: false, error: { code: 'FORBIDDEN', message: 'You do not own this campaign', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/user-campaigns/[id]/impact-update
 *
 * Submit an impact update for a campaign.
 * Campaigner only. Multipart form data with photos, receipts, and text.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id: campaignId } = await params;

  try {
    const session = await auth();
    if (!session?.user) throw new UnauthorizedError();

    // Verify campaign ownership + status
    const [campaign] = await db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        creatorId: campaigns.creatorId,
        status: campaigns.status,
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

    if (campaign.creatorId !== session.user.id) {
      throw new ForbiddenError();
    }

    // Check for existing impact update - can only have one per campaign
    const [existing] = await db
      .select({ id: impactUpdates.id, status: impactUpdates.status })
      .from(impactUpdates)
      .where(eq(impactUpdates.campaignId, campaignId))
      .limit(1);

    if (existing && existing.status !== 'rejected') {
      return NextResponse.json(
        { ok: false, error: { code: 'CONFLICT', message: 'An impact update already exists for this campaign', requestId } } satisfies ApiError,
        { status: 409 },
      );
    }

    // Parse multipart form
    const formData = await request.formData();
    const title = formData.get('title') as string | null;
    const body = formData.get('body') as string | null;

    if (!title || !body) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Title and body are required', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    if (title.length > 200) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Title must be 200 characters or fewer', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Upload photos
    const photoFiles = formData.getAll('photos') as File[];
    const receiptFiles = formData.getAll('receipts') as File[];
    const allFiles = [...photoFiles, ...receiptFiles];

    if (allFiles.length > MAX_FILES) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Maximum ${MAX_FILES} files allowed`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    for (const file of allFiles) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { ok: false, error: { code: 'VALIDATION_ERROR', message: `File "${file.name}" exceeds 10MB limit`, requestId } } satisfies ApiError,
          { status: 400 },
        );
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          { ok: false, error: { code: 'VALIDATION_ERROR', message: `File type "${file.type}" is not allowed. Use JPEG, PNG, WebP, or PDF.`, requestId } } satisfies ApiError,
          { status: 400 },
        );
      }
    }

    async function uploadFile(file: File, subfolder: string): Promise<string> {
      const ext = file.name.split('.').pop() ?? 'bin';
      const storagePath = `impact-updates/${campaignId}/${subfolder}/${randomUUID()}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, buffer, { contentType: file.type, upsert: false });

      if (error) throw new Error(`Upload failed for ${file.name}: ${error.message}`);
      return getPublicUrl(storagePath);
    }

    const photoUrls = await Promise.all(
      photoFiles.map((f) => uploadFile(f, 'photos')),
    );
    const receiptUrls = await Promise.all(
      receiptFiles.map((f) => uploadFile(f, 'receipts')),
    );

    const sanitizedBody = sanitizeHtml(
      body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br />')}</p>`).join(''),
    );

    // Upsert: if a rejected update exists, replace it
    if (existing && existing.status === 'rejected') {
      const [updated] = await db
        .update(impactUpdates)
        .set({
          title,
          bodyHtml: sanitizedBody,
          photos: photoUrls,
          receiptUrls,
          status: 'submitted',
          submittedBy: session.user.id,
          submittedAt: new Date(),
          reviewerId: null,
          reviewerNotes: null,
          reviewedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(impactUpdates.id, existing.id))
        .returning();

      await db.insert(auditLogs).values({
        eventType: 'impact_update.resubmitted',
        actorId: session.user.id,
        targetType: 'campaign',
        targetId: campaignId,
        severity: 'info',
        details: { impactUpdateId: updated.id, photoCount: photoUrls.length, receiptCount: receiptUrls.length },
      });

      /*
        ⛔ The resubmission path needs this as much as the first submission:
        it is reached only after an admin asked for a change, so somebody is
        waiting on the second look. Fire-and-forget with a logged catch, the
        same shape as `user-campaigns/route.ts:260` - the row is already
        written and a mail failure must not 500 a successful submission.
        `docs/139`.
      */
      notifyAdminImpactUpdateSubmitted({
        campaignTitle: campaign.title,
        creatorName: session.user.name ?? 'The organiser',
        skipUserId: session.user.id,
      }).catch((err) =>
        console.error('[impact_update.resubmitted] admin notification error:', err),
      );

      const response: ApiResponse<typeof updated> = { ok: true, data: updated };
      return NextResponse.json(response, { status: 200 });
    }

    // Create new impact update
    const [impactUpdate] = await db
      .insert(impactUpdates)
      .values({
        campaignId,
        submittedBy: session.user.id,
        title,
        bodyHtml: sanitizedBody,
        photos: photoUrls,
        receiptUrls,
        status: 'submitted',
        submittedAt: new Date(),
      })
      .returning();

    await db.insert(auditLogs).values({
      eventType: 'impact_update.submitted',
      actorId: session.user.id,
      targetType: 'campaign',
      targetId: campaignId,
      severity: 'info',
      details: { impactUpdateId: impactUpdate.id, photoCount: photoUrls.length, receiptCount: receiptUrls.length },
    });

    /*
      ⛔ Nobody was told. An organiser reporting how a family's money was
      spent submitted into silence: this route sent no notification, no admin
      screen listed the queue, and `notifyAdminImpactUpdateSubmitted` had
      zero callers. `docs/139`.
    */
    notifyAdminImpactUpdateSubmitted({
      campaignTitle: campaign.title,
      creatorName: session.user.name ?? 'The organiser',
      skipUserId: session.user.id,
    }).catch((err) =>
      console.error('[impact_update.submitted] admin notification error:', err),
    );

    const response: ApiResponse<typeof impactUpdate> = { ok: true, data: impactUpdate };
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
        { ok: false, error: { code: 'FORBIDDEN', message: 'You do not own this campaign', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
