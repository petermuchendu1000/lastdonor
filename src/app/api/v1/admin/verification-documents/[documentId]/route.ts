import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { verificationDocuments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import { verificationDocReviewSchema } from '@/lib/validators/admin';
import { parseStorageRef, createSignedObjectUrl } from '@/lib/supabase-storage';

interface Params {
  params: Promise<{ documentId: string }>;
}

/**
 * GET /api/v1/admin/verification-documents/[documentId]
 *
 * Redirects an admin to a short-lived signed URL for the stored object.
 *
 * ── Why this exists (docs/88 F2) ─────────────────────────────────────────
 *
 * Identity documents live in a PRIVATE bucket and `verificationDocuments
 * .fileUrl` holds a reference, not a URL: `supabase-private://<bucket>/<key>`.
 * The admin list endpoint returned that string raw and the review queue
 * rendered it as `<a href={doc.fileUrl}>View</a>`, so clicking View asked
 * the browser to open an unknown URL scheme and nothing happened. **No
 * admin could open a single identity document.**
 *
 * The organiser side already signed correctly
 * (`user-campaigns/[id]/verification/documents`), and `parseStorageRef`
 * even documents that it tolerates legacy public URLs "so admin review
 * keeps working" - but nothing on the admin side ever called it.
 *
 * A redirect rather than a JSON url: the queue renders an ordinary
 * anchor, so the href can stay a stable same-origin link and the URL is
 * minted at click time. That means no signed URL is created for a
 * document nobody opens, and none can go stale sitting in a list.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { documentId } = await params;

  try {
    await requireRole(['admin']);

    const [doc] = await db
      .select({ id: verificationDocuments.id, fileUrl: verificationDocuments.fileUrl })
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, documentId))
      .limit(1);

    if (!doc) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Document not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const ref = parseStorageRef(doc.fileUrl);
    if (!ref) {
      console.error('[admin/verification-documents] unparseable reference for', doc.id);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Document reference is unreadable', requestId } } satisfies ApiError,
        { status: 500 },
      );
    }

    const { signedUrl, error } = await createSignedObjectUrl(ref.bucket, ref.key);
    if (!signedUrl) {
      console.error('[admin/verification-documents] could not sign:', error);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Could not issue document URL', requestId } } satisfies ApiError,
        { status: 500 },
      );
    }

    /*
      302, not 307: this is a GET and the redirect is to a different
      origin (Supabase storage), so the method is irrelevant and a plain
      "found" is the honest status. `no-store` because the target is a
      credential with a TTL and must never sit in a shared cache.
    */
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (error) {
    if ((error as Error).name === 'UnauthorizedError') {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if ((error as Error).name === 'ForbiddenError') {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error('[admin/verification-documents] GET error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/v1/admin/verification-documents/[documentId]
 *
 * Admin approve or reject an individual verification document.
 * Body: { action: 'approve' | 'reject', notes?: string }
 *
 * - `notes` is required when action is `reject`.
 * - Updates the document status, reviewerId, reviewerNotes, reviewedAt.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { documentId } = await params;

  try {
    const session = await requireRole(['admin']);

    const body = await request.json();
    const parsed = verificationDocReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }
    const { action, notes } = parsed.data;

    const [doc] = await db
      .select({ id: verificationDocuments.id, status: verificationDocuments.status })
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, documentId))
      .limit(1);

    if (!doc) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Document not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const now = new Date();
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    await db
      .update(verificationDocuments)
      .set({
        status: newStatus,
        reviewerId: session.user.id!,
        reviewerNotes: notes || null,
        reviewedAt: now,
      })
      .where(eq(verificationDocuments.id, documentId));

    return NextResponse.json({
      ok: true,
      data: {
        id: documentId,
        status: newStatus,
        reviewerNotes: notes || null,
        reviewedAt: now.toISOString(),
      },
    });
  } catch (error) {
    if ((error as Error).name === 'UnauthorizedError') {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if ((error as Error).name === 'ForbiddenError') {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error('Admin document review error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
