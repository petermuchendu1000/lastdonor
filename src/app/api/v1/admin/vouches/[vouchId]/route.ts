/**
 * Revoking one institutional vouch (`docs/108`).
 *
 * ── WHY THIS IS A POST AND NOT A DELETE ─────────────────────────────────────
 *
 * Nothing is deleted. A revoked vouch stays on the record with who revoked it
 * and why, because the fact that an organisation once asserted something - and
 * that it was withdrawn - is exactly the history an abuse investigation needs.
 * A DELETE verb on a route that keeps the row would be a lie about what it
 * does, and it also could not carry the required reason in a body.
 */

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth';
import { apiError } from '@/lib/errors';
import { getClientIp } from '@/lib/rate-limit';
import { revokeVouch } from '@/lib/trust-network/vouch';
import { revokeVouchSchema } from '@/lib/validators/trust-network';
import type { ApiError } from '@/types/api';

interface Params {
  params: Promise<{ vouchId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { vouchId } = await params;

  try {
    const session = await requireRole(['admin']);

    const parsed = revokeVouchSchema.safeParse(await request.json());
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

    const result = await revokeVouch({
      vouchId,
      revokedBy: session.user!.id!,
      reason: parsed.data.reason,
      actorIp: getClientIp(request.headers),
    });

    if (!result.ok) {
      // Status comes from the central registry in `src/lib/errors.ts`.
      return apiError(result.code, result.message, requestId);
    }

    // Revoking changes the public page too, in the other direction. See the
    // note on the vouch route.
    if (result.slug) revalidatePath(`/campaigns/${result.slug}`);

    return NextResponse.json({
      ok: true,
      data: { campaignId: result.campaignId, unverified: result.unverified, effect: result.effect },
    });
  } catch (error) {
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
    console.error('Vouch revoke error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
