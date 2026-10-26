import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { refundBatches, campaigns } from '@/db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { refundBatchQuerySchema } from '@/lib/validators/verification';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';

/**
 * GET /api/v1/admin/refund-batches - List refund batches with pagination.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  try {
    await requireRole(['admin']);

    const url = new URL(request.url);
    const query = refundBatchQuerySchema.parse({
      status: url.searchParams.get('status') ?? undefined,
      campaignId: url.searchParams.get('campaignId') ?? undefined,
      page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    });

    const { status, campaignId, page, limit } = query;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (status) {
      conditions.push(eq(refundBatches.status, status as 'processing' | 'completed' | 'partial_failure'));
    }
    if (campaignId) {
      conditions.push(eq(refundBatches.campaignId, campaignId));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: refundBatches.id,
          campaignId: refundBatches.campaignId,
          campaignTitle: campaigns.title,
          // A batch belongs to ONE campaign, so its total is single-currency
          // - but the code still has to be carried (`docs/92`).
          currency: campaigns.currency,
          campaignSlug: campaigns.slug,
          reason: refundBatches.reason,
          totalDonations: refundBatches.totalDonations,
          totalAmount: refundBatches.totalAmount,
          refundedCount: refundBatches.refundedCount,
          failedCount: refundBatches.failedCount,
          status: refundBatches.status,
          startedAt: refundBatches.startedAt,
          completedAt: refundBatches.completedAt,
          createdAt: refundBatches.createdAt,
        })
        .from(refundBatches)
        .leftJoin(campaigns, eq(refundBatches.campaignId, campaigns.id))
        .where(where)
        .orderBy(desc(refundBatches.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(refundBatches)
        .where(where),
    ]);

    const serialized = rows.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({
      ok: true,
      data: {
        items: serialized,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[GET /api/v1/admin/refund-batches]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list refund batches', requestId } } satisfies ApiError, { status: 500 });
  }
}
