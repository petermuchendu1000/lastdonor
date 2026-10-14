import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, verificationDocuments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth, requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import {
  uploadPrivateObject,
  privateObjectRef,
  parseStorageRef,
  createSignedObjectUrl,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/supabase-storage';
import { uploadVerificationDocumentSchema } from '@/lib/validators/verification';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';

export const runtime = 'nodejs';

const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10MB for documents
const ALLOWED_DOC_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/user-campaigns/[id]/verification/documents
 *
 * Upload a verification document for a campaign.
 * Campaigner (campaign creator) only.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id: campaignId } = await params;

  try {
    const session = await auth();
    if (!session?.user) throw new UnauthorizedError();

    // Verify campaign exists and user is the creator
    const [campaign] = await db
      .select({
        id: campaigns.id,
        creatorId: campaigns.creatorId,
        verificationStatus: campaigns.verificationStatus,
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

    // Only allow uploads when verification is in an uploadable state
    const uploadableStates = ['unverified', 'submitted_for_review', 'documents_uploaded', 'info_requested', 'identity_verified', 'rejected'];
    if (!uploadableStates.includes(campaign.verificationStatus)) {
      return NextResponse.json(
        { ok: false, error: { code: 'CONFLICT', message: 'Cannot upload documents in current verification state', requestId } } satisfies ApiError,
        { status: 409 },
      );
    }

    // Parse multipart form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid form data', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'No file provided', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Validate file
    if (!ALLOWED_DOC_TYPES.includes(file.type)) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `Invalid file type. Allowed: ${ALLOWED_DOC_TYPES.join(', ')}`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    if (file.size > MAX_DOC_SIZE) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'File too large. Maximum size is 10MB', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Validate metadata fields
    const documentType = formData.get('documentType') as string | null;
    const description = formData.get('description') as string | null;

    const parsed = uploadVerificationDocumentSchema.safeParse({
      documentType,
      description: description || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Invalid input', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // ── Upload to the PRIVATE bucket (audit P0-1) ──────────────────────────
    // These files are government IDs, medical records and death certificates.
    // They used to land in the public `media` bucket and be persisted as a
    // permanent unauthenticated `getPublicUrl(...)`. They now go to the
    // private bucket and the row stores a non-dereferenceable reference; the
    // only read path is the admin-only GET below, which mints a 15-minute
    // signed URL.
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5);
    const storagePath = `verification-documents/${campaignId}/${randomUUID()}.${safeExt}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await uploadPrivateObject(storagePath, buffer, {
      contentType: file.type,
    });

    if (uploadError) {
      console.error('Verification document upload failed:', uploadError.message);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Upload failed', requestId } } satisfies ApiError,
        { status: 500 },
      );
    }

    // Insert document record. `fileUrl` holds a private reference, never a URL.
    const [doc] = await db
      .insert(verificationDocuments)
      .values({
        campaignId,
        uploadedBy: session.user.id!,
        documentType: parsed.data.documentType,
        fileUrl: privateObjectRef(storagePath),
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        description: parsed.data.description || null,
      })
      .returning({ id: verificationDocuments.id, status: verificationDocuments.status });

    // Deliberately no URL in the response: the uploader already holds the
    // file, and returning one would recreate a shareable handle to PII.
    return NextResponse.json({
      ok: true,
      data: { documentId: doc.id, status: doc.status },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not authorized to upload documents for this campaign', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error('Verification document upload error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}

/**
 * GET /api/v1/user-campaigns/[id]/verification/documents?documentId=<uuid>
 *
 * Issue a short-lived signed URL for one verification document (audit P0-1).
 *
 * This is the ONLY read path for verification documents. It is admin-only:
 * `requireRole(['admin'])` throws `ForbiddenError` for every other role,
 * including the campaigner who uploaded the file and the `editor` role that
 * can otherwise touch campaigns. The route is additionally covered by the
 * default-deny middleware, so an unauthenticated caller never reaches this
 * function at all.
 *
 * The URL expires after `SIGNED_URL_TTL_SECONDS` (15 minutes) and is never
 * persisted.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { id: campaignId } = await params;

  try {
    // Authorisation first: nothing about a document is revealed, not even
    // whether it exists, before the caller is proven to be an admin.
    await requireRole(['admin']);

    const documentId = request.nextUrl.searchParams.get('documentId');
    if (!documentId) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'documentId is required', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const [doc] = await db
      .select({
        id: verificationDocuments.id,
        campaignId: verificationDocuments.campaignId,
        fileUrl: verificationDocuments.fileUrl,
        fileName: verificationDocuments.fileName,
        mimeType: verificationDocuments.mimeType,
      })
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, documentId))
      .limit(1);

    // Scope the document to the campaign in the path, so a valid admin cannot
    // read a document through an unrelated campaign's URL.
    if (!doc || doc.campaignId !== campaignId) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Document not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    // Handles both the new `supabase-private://` references and legacy public
    // URLs from rows written before this fix, so review keeps working while
    // the stored objects are migrated.
    const ref = parseStorageRef(doc.fileUrl);
    if (!ref) {
      console.error('Unparseable verification document reference for', doc.id);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Document reference is unreadable', requestId } } satisfies ApiError,
        { status: 500 },
      );
    }

    const { signedUrl, error } = await createSignedObjectUrl(ref.bucket, ref.key);
    if (!signedUrl) {
      console.error('Failed to sign verification document URL:', error);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Could not issue document URL', requestId } } satisfies ApiError,
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: {
        documentId: doc.id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        url: signedUrl,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Administrator access required', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error('Verification document URL error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
