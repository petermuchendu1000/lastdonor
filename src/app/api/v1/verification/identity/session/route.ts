import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, auditLogs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { createDiditSession, DiditNotConfiguredError, DiditApiError } from '@/lib/didit';
import { appBaseUrl } from '@/lib/unsubscribe-tokens';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import { identitySessionSchema } from '@/lib/validators/admin';

/**
 * POST /api/v1/verification/identity/session
 * Creates a Didit identity-verification session for a campaign.
 *
 * Provider switched from Stripe Identity 2026-10-17, see docs/81. The
 * route shape, the ownership check and the allowed-status list are
 * unchanged; only who performs the check changed.
 *
 * Body: { campaignId: string, force?: boolean }
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  try {
    const session = await auth();
    if (!session?.user) throw new UnauthorizedError();

    const body = await req.json();
    const parsed = identitySessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }
    const { campaignId, force } = parsed.data;

    // Load campaign - must be owned by current user
    const [campaign] = await db
      .select({
        id: campaigns.id,
        slug: campaigns.slug,
        creatorId: campaigns.creatorId,
        verificationStatus: campaigns.verificationStatus,
        diditSessionId: campaigns.diditSessionId,
        diditSessionUrl: campaigns.diditSessionUrl,
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

    // Only allow session creation for campaigns that haven't completed identity verification
    const allowedStatuses = ['unverified', 'pending', 'documents_uploaded', 'info_requested', 'rejected'];
    if (!allowedStatuses.includes(campaign.verificationStatus)) {
      return NextResponse.json(
        { ok: false, error: { code: 'CONFLICT', message: 'Identity verification already completed or in progress', requestId } } satisfies ApiError,
        { status: 409 },
      );
    }

    // If session already exists, return it - unless caller explicitly requests a fresh session
    if (campaign.diditSessionId && campaign.diditSessionUrl && !force) {
      return NextResponse.json({
        ok: true,
        data: {
          sessionId: campaign.diditSessionId,
          url: campaign.diditSessionUrl,
          existing: true,
        },
      });
    }

    // Clear stale session if force-creating a new one
    if (force && campaign.diditSessionId) {
      await db
        .update(campaigns)
        .set({
          diditSessionId: null,
          diditSessionUrl: null,
          updatedAt: new Date(),
        })
        .where(eq(campaigns.id, campaign.id));
    }

    /*
      `callback` is where Didit returns the person after the hosted flow.
      It is a destination for a browser, not a trust boundary: the status
      shown there is read from our own database, which is only ever
      written from Didit's decision API. `appBaseUrl()` rather than a
      literal, for the reason docs/57 records about share links.
    */
    const result = await createDiditSession({
      campaignId: campaign.id,
      callbackUrl: `${appBaseUrl()}/dashboard?verification=${campaign.slug}`,
    });

    await db
      .update(campaigns)
      .set({
        diditSessionId: result.sessionId,
        diditSessionUrl: result.url,
        verificationStatus: 'pending',
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaign.id));

    // Audit log
    await db.insert(auditLogs).values({
      actorId: session.user.id,
      eventType: 'identity_session_created',
      targetType: 'campaign',
      targetId: campaign.id,
      details: { provider: 'didit', diditSessionId: result.sessionId },
      severity: 'info',
    });

    return NextResponse.json({
      ok: true,
      data: {
        sessionId: result.sessionId,
        url: result.url,
        existing: false,
      },
    });
  } catch (error) {
    /*
      A provider that is not configured is unavailability, not a bug in
      the request: 503, and say so plainly. Same shape as the Stripe
      `PAYMENTS_UNAVAILABLE` branch in docs/72.
    */
    if (error instanceof DiditNotConfiguredError) {
      console.error('[verification/identity/session] DIDIT_API_KEY is not set.', { requestId });
      return NextResponse.json(
        { ok: false, error: { code: 'VERIFICATION_UNAVAILABLE', message: 'Identity verification is temporarily unavailable. This is a problem on our side, not with your documents.', requestId } } satisfies ApiError,
        { status: 503 },
      );
    }
    if (error instanceof DiditApiError) {
      // `error.message` carries Didit's validation detail, never our key:
      // the key is only ever a request header.
      console.error('[verification/identity/session] Didit rejected the request:', error.message, { requestId });
      return NextResponse.json(
        { ok: false, error: { code: 'VERIFICATION_UNAVAILABLE', message: 'We could not start identity verification just now. Please try again shortly.', requestId } } satisfies ApiError,
        { status: 503 },
      );
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError,
        { status: 401 },
      );
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not authorized', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error('[Identity Session] Error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create verification session', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
