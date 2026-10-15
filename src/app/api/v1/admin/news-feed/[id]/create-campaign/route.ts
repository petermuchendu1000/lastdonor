import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { randomUUID } from 'crypto';
import { publishCampaignFromNewsItem } from '@/lib/news/campaign-publisher';
import type { ApiError } from '@/types/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * What an admin can do about each volume guard, and when it lifts.
 *
 * The publisher's own `message` already carries the limit and the current
 * count (`volume-guards.ts` formats e.g. "10/10 automated campaigns published
 * today"); these sentences add the part it cannot know: whether waiting helps.
 */
const GUARD_RESET_HINT: Record<string, string> = {
  daily_limit: 'The daily counter resets at 00:00 UTC.',
  max_concurrent:
    'A slot frees up when an active simulated campaign completes or is closed.',
  phase_out:
    'This is not a timed limit: it lifts only when fewer real campaigns are active, '
    + 'or when an operator changes the phase-out settings.',
};

/** Seconds until the next 00:00 UTC, for `Retry-After` on the daily counter. */
function secondsUntilUtcMidnight(now: Date): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();

  try {
    await requireRole(['admin']);
  } catch {
    const error: ApiError = {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Admin access required', requestId },
    };
    return NextResponse.json(error, { status: 403 });
  }

  const { id } = await params;

  try {
    const result = await publishCampaignFromNewsItem(id, {
      auditEventType: 'campaign.admin_published',
    });

    if (!result.ok) {
      // ── Volume guard refused ────────────────────────────────────────────
      //
      // Handled ahead of the generic mapping below because it is not a
      // failure: the daily limit, `simulation.max_concurrent` and the
      // phase-out floor are settings working as configured. Previously this
      // code had no arm here, so `statusMap[...] ?? 500` returned 500
      // INTERNAL_ERROR and told the admin the server had crashed.
      //
      // `RATE_LIMITED` is the closest member of the shared `ApiError` code
      // union (`src/types/api.ts`), and `src/lib/errors.ts` already pairs it
      // with 429. The union is deliberately NOT widened.
      if (result.error.code === 'VOLUME_LIMIT') {
        const hint = GUARD_RESET_HINT[result.error.guard] ?? '';
        const error: ApiError = {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: hint ? `${result.error.message} ${hint}` : result.error.message,
            requestId,
          },
        };

        // Only the daily counter has a knowable reset instant; for the other
        // two guards a number would be invented, so the header is omitted.
        const headers =
          result.error.guard === 'daily_limit'
            ? { 'Retry-After': String(secondsUntilUtcMidnight(new Date())) }
            : undefined;

        return NextResponse.json(error, { status: 429, headers });
      }

      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        ALREADY_CREATED: 409,
        NO_CATEGORY: 422,
        INVALID_ENTITY: 422,
        DUPLICATE_SUBJECT: 409,
        STORY_FAILED: 502,
        INTERNAL_ERROR: 500,
      };

      const error: ApiError = {
        ok: false,
        error: {
          code: result.error.code === 'ALREADY_CREATED' || result.error.code === 'DUPLICATE_SUBJECT'
            ? 'CONFLICT'
            : result.error.code === 'NOT_FOUND'
              ? 'NOT_FOUND'
              : result.error.code === 'NO_CATEGORY' || result.error.code === 'INVALID_ENTITY'
                ? 'VALIDATION_ERROR'
                : 'INTERNAL_ERROR',
          message: result.error.message,
          requestId,
        },
      };

      return NextResponse.json(error, { status: statusMap[result.error.code] ?? 500 });
    }

    return NextResponse.json({
      ok: true,
      data: result.data,
    });
  } catch (error) {
    const apiError: ApiError = {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
