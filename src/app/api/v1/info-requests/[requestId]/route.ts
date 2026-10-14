import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { infoRequests, campaigns, auditLogs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { randomUUID } from 'crypto';
import { uploadPrivateObject, privateObjectRef } from '@/lib/supabase-storage';
import type { ApiError } from '@/types/api';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ requestId: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/info-requests/[requestId] - Get info request details
 * Accessible by the targeted campaigner or admin.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const rid = randomUUID();
  const { requestId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId: rid } } satisfies ApiError,
        { status: 401 },
      );
    }

    if (!UUID_REGEX.test(requestId)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request ID', requestId: rid } } satisfies ApiError,
        { status: 400 },
      );
    }

    const [infoReq] = await db
      .select({
        id: infoRequests.id,
        campaignId: infoRequests.campaignId,
        campaignTitle: campaigns.title,
        requestType: infoRequests.requestType,
        details: infoRequests.details,
        deadline: infoRequests.deadline,
        status: infoRequests.status,
        responseText: infoRequests.responseText,
        respondedAt: infoRequests.respondedAt,
        createdAt: infoRequests.createdAt,
      })
      .from(infoRequests)
      .innerJoin(campaigns, eq(infoRequests.campaignId, campaigns.id))
      .where(eq(infoRequests.id, requestId))
      .limit(1);

    if (!infoReq) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Info request not found', requestId: rid } } satisfies ApiError,
        { status: 404 },
      );
    }

    // Only the target user or admin can view
    const [fullReq] = await db
      .select({ targetUser: infoRequests.targetUser })
      .from(infoRequests)
      .where(eq(infoRequests.id, requestId))
      .limit(1);

    const isAdmin = session.user.role === 'admin';
    if (!isAdmin && fullReq?.targetUser !== session.user.id) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'You do not have access to this info request', requestId: rid } } satisfies ApiError,
        { status: 403 },
      );
    }

    return NextResponse.json({ ok: true, data: infoReq });
  } catch (error) {
    console.error('[GET /api/v1/info-requests/[requestId]]', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch info request', requestId: rid } } satisfies ApiError,
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/v1/info-requests/[requestId] - Respond to an info request
 * Only the targeted campaigner can respond.
 * Accepts multipart/form-data with responseText + optional file attachments.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const rid = randomUUID();
  const { requestId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId: rid } } satisfies ApiError,
        { status: 401 },
      );
    }

    if (!UUID_REGEX.test(requestId)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request ID', requestId: rid } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Parse form data (supports both multipart and JSON)
    let responseText = '';
    let files: File[] = [];

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      responseText = (formData.get('responseText') as string) ?? '';
      const formFiles = formData.getAll('files');
      files = formFiles.filter((f): f is File => typeof f !== 'string' && f.size > 0) as File[];
    } else {
      const body = await request.json().catch(() => null);
      responseText = body?.responseText ?? '';
    }

    if (!responseText.trim() && files.length === 0) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Response text or at least one file is required', requestId: rid } } satisfies ApiError,
        { status: 400 },
      );
    }

    if (responseText.length > 2000) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Response text must not exceed 2000 characters', requestId: rid } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Validate files
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const MAX_FILES = 5;

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Maximum ${MAX_FILES} files allowed`, requestId: rid } } satisfies ApiError,
        { status: 400 },
      );
    }

    for (const file of files) {
      const fileType = file.type || (() => {
        const extLower = file.name.split('.').pop()?.toLowerCase();
        const EXT_MAP: Record<string, string> = {
          pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          png: 'image/png', webp: 'image/webp', doc: 'application/msword',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
        return (extLower && EXT_MAP[extLower]) || '';
      })();
      if (!ALLOWED_TYPES.includes(fileType)) {
        return NextResponse.json(
          { ok: false, error: { code: 'VALIDATION_ERROR', message: `File type not allowed: ${file.name}`, requestId: rid } } satisfies ApiError,
          { status: 400 },
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { ok: false, error: { code: 'VALIDATION_ERROR', message: `File too large: ${file.name}. Maximum 10MB`, requestId: rid } } satisfies ApiError,
          { status: 400 },
        );
      }
    }

    const [infoReq] = await db
      .select({
        id: infoRequests.id,
        targetUser: infoRequests.targetUser,
        campaignId: infoRequests.campaignId,
        status: infoRequests.status,
        pauseCampaign: infoRequests.pauseCampaign,
      })
      .from(infoRequests)
      .where(eq(infoRequests.id, requestId))
      .limit(1);

    if (!infoReq) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Info request not found', requestId: rid } } satisfies ApiError,
        { status: 404 },
      );
    }

    if (infoReq.targetUser !== session.user.id) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Only the campaign owner can respond to this request', requestId: rid } } satisfies ApiError,
        { status: 403 },
      );
    }

    if (infoReq.status !== 'pending') {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Cannot respond to a request with status "${infoReq.status}"`, requestId: rid } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Upload files to storage
    const uploadedFiles: { name: string; url: string; size: number; type: string }[] = [];
    for (const file of files) {
      // Determine content type - fall back to extension-based detection
      let detectedType = file.type;
      if (!detectedType) {
        const extLower = file.name.split('.').pop()?.toLowerCase();
        const EXT_TYPES: Record<string, string> = {
          pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          png: 'image/png', webp: 'image/webp',
          doc: 'application/msword',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
        detectedType = (extLower && EXT_TYPES[extLower]) || 'application/octet-stream';
      }

      const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-zA-Z0-9]/g, '').slice(0, 5) || 'bin';
      const storagePath = `info-request-responses/${infoReq.campaignId}/${requestId}/${randomUUID()}.${ext}`;

      let buffer: Buffer;
      try {
        const arrayBuffer = await file.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } catch (readErr) {
        console.error('Failed to read file buffer:', readErr);
        return NextResponse.json(
          { ok: false, error: { code: 'INTERNAL_ERROR', message: `Failed to read file: ${file.name}`, requestId: rid } } satisfies ApiError,
          { status: 500 },
        );
      }

      // P0-1b (docs/29): these uploads previously went to the PUBLIC bucket and
      // were persisted as getPublicUrl(), so government IDs, medical records and
      // other verification evidence were readable by anyone with the URL and the
      // URL never expired. They now go to the private bucket; getPublicUrl()
      // throws for this prefix, so no caller can mint a public URL for one.
      const { error: uploadError } = await uploadPrivateObject(
        storagePath,
        buffer,
        { contentType: detectedType },
      );

      if (uploadError) {
        console.error('Info request file upload failed:', uploadError.message, 'path:', storagePath, 'type:', file.type, 'size:', file.size);
        return NextResponse.json(
          { ok: false, error: { code: 'INTERNAL_ERROR', message: `Failed to upload file: ${file.name}. Please try again.`, requestId: rid } } satisfies ApiError,
          { status: 500 },
        );
      }

      uploadedFiles.push({
        name: file.name,
        // Deliberately NOT a dereferenceable URL. Admin review must mint a
        // short-lived signed URL via createSignedObjectUrl() after an
        // authorisation check; storing a fetchable link here is what made P0-1b
        // a leak in the first place.
        url: privateObjectRef(storagePath),
        size: file.size,
        type: file.type,
      });
    }

    const [updated] = await db.update(infoRequests).set({
      responseText: responseText.trim() || null,
      responseFiles: uploadedFiles,
      respondedAt: new Date(),
      status: 'responded',
    }).where(eq(infoRequests.id, requestId)).returning();

    // Transition campaign verificationStatus back to submitted_for_review
    // so the campaign re-enters the admin verification queue
    const [currentCampaign] = await db
      .select({ verificationStatus: campaigns.verificationStatus })
      .from(campaigns)
      .where(eq(campaigns.id, infoReq.campaignId))
      .limit(1);

    if (currentCampaign?.verificationStatus === 'info_requested') {
      await db.update(campaigns).set({
        verificationStatus: 'submitted_for_review',
        updatedAt: new Date(),
      }).where(eq(campaigns.id, infoReq.campaignId));
    }

    // If the campaign was paused for this request, put it under_review
    if (infoReq.pauseCampaign) {
      await db.update(campaigns).set({
        status: 'under_review',
        pausedAt: null,
        pausedReason: null,
        updatedAt: new Date(),
      }).where(eq(campaigns.id, infoReq.campaignId));
    }

    await db.insert(auditLogs).values({
      eventType: 'info_request.responded',
      actorId: session.user.id,
      actorRole: session.user.role ?? 'user',
      targetType: 'campaign',
      targetId: infoReq.campaignId,
      severity: 'info',
      details: { infoRequestId: requestId, responseLength: responseText.length, fileCount: uploadedFiles.length },
    });

    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    console.error('[PATCH /api/v1/info-requests/[requestId]]', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to respond to info request', requestId: rid } } satisfies ApiError,
      { status: 500 },
    );
  }
}
