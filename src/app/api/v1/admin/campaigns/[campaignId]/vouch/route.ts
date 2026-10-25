/**
 * Recording and listing institutional vouches for one campaign (`docs/108`).
 *
 * ⛔ Admin only, and that is not a placeholder for an institutional login. An
 * institution's representative writes in or calls; an admin records what they
 * said, naming them. Shipping a self-serve institutional portal would mean
 * shipping an authentication path no real institution has ever exercised,
 * which is what `docs/76` (an auto-goal toggle never POSTed), `docs/77` (a
 * review claim with no review) and `docs/81` (Didit v2's unusable workflow id)
 * are all about. The columns a portal needs are already in the table.
 *
 * ⚠️ So `representative_*` is ATTRIBUTION, not AUTHENTICATION. No screen may
 * imply the platform proved who that person is.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth';
import { apiError } from '@/lib/errors';
import { getClientIp } from '@/lib/rate-limit';
import { countCampaignDocuments, listCampaignVouches, recordVouch } from '@/lib/trust-network/vouch';
import { recordVouchSchema } from '@/lib/validators/trust-network';
import type { ApiError } from '@/types/api';

interface Params {
  params: Promise<{ campaignId: string }>;
}

/*
  Each refusal's HTTP status lives in the central registry in
  `src/lib/errors.ts`, and `apiError` reads it from there. A second copy in
  this file is a second thing to keep in step, and a budget refusal that
  answers 409 in one route and 429 in another is a client bug waiting.
*/
function authErrors(error: unknown, requestId: string, where: string) {
  const name = (error as Error).name;
  if (name === 'UnauthorizedError') {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError,
      { status: 401 },
    );
  }
  if (name === 'ForbiddenError') {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError,
      { status: 403 },
    );
  }
  console.error(`${where} error:`, error);
  return NextResponse.json(
    { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } } satisfies ApiError,
    { status: 500 },
  );
}

/**
 * GET - every vouch for this campaign, plus how many documents it has.
 *
 * The document count is here and not in a separate call because the two are
 * only meaningful together: "verified, and nobody uploaded anything" is the
 * fact an administrator needs before approving a payout on a vouched
 * campaign, and a screen that shows one without the other misleads them.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { campaignId } = await params;
  try {
    await requireRole(['admin']);
    const [vouches, documents] = await Promise.all([
      listCampaignVouches(campaignId),
      countCampaignDocuments(campaignId),
    ]);
    return NextResponse.json({
      ok: true,
      data: {
        vouches: vouches.map((v) => ({
          ...v,
          createdAt: v.createdAt.toISOString(),
          revokedAt: v.revokedAt?.toISOString() ?? null,
        })),
        documents,
      },
    });
  } catch (error) {
    return authErrors(error, requestId, 'Campaign vouch GET');
  }
}

/** POST - record a vouch, which verifies the campaign if nothing else had. */
export async function POST(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { campaignId } = await params;
  try {
    const session = await requireRole(['admin']);

    const parsed = recordVouchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message || 'Invalid input',
            requestId,
          },
        } satisfies ApiError,
        { status: 400 },
      );
    }

    const result = await recordVouch({
      ...parsed.data,
      campaignId,
      recordedBy: session.user!.id!,
      actorIp: getClientIp(request.headers),
    });

    if (!result.ok) {
      return apiError(result.code, result.message, requestId);
    }

    return NextResponse.json(
      { ok: true, data: { vouchId: result.vouchId, liftedRaiseCap: result.liftedRaiseCap } },
      { status: 201 },
    );
  } catch (error) {
    return authErrors(error, requestId, 'Campaign vouch POST');
  }
}
