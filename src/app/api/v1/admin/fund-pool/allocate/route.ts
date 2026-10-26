import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { fundPoolAllocations, campaigns, auditLogs } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';

const allocateSchema = z.object({
  allocationIds: z.array(z.string().uuid()).min(1).max(100),
  targetCampaignId: z.string().uuid(),
  notes: z.string().max(1000).optional(),
});

/**
 * POST /api/v1/admin/fund-pool/allocate - Allocate pending funds to a real campaign.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const session = await requireRole(['admin']);
    const body = await request.json();
    const parsed = allocateSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0];
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: firstError.message, field: firstError.path.join('.'), requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const { allocationIds, targetCampaignId, notes } = parsed.data;

    // Validate target campaign exists and is NOT simulated
    const [targetCampaign] = await db
      .select({ id: campaigns.id, simulationFlag: campaigns.simulationFlag, title: campaigns.title, currency: campaigns.currency })
      .from(campaigns)
      .where(eq(campaigns.id, targetCampaignId))
      .limit(1);

    if (!targetCampaign) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Target campaign not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    if (targetCampaign.simulationFlag) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Cannot allocate funds to a simulated campaign', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    // Validate all allocation IDs exist and are pending
    /*
      `fund_pool_allocations` has NO currency column of its own: an
      allocation's `amount` is in the currency of the campaign the money came
      from, so the source campaign is joined to get it (`docs/92`).
    */
    const allocations = await db
      .select({
        id: fundPoolAllocations.id,
        status: fundPoolAllocations.status,
        sourceCurrency: campaigns.currency,
      })
      .from(fundPoolAllocations)
      .innerJoin(campaigns, eq(fundPoolAllocations.sourceCampaignId, campaigns.id))
      .where(inArray(fundPoolAllocations.id, allocationIds));

    if (allocations.length !== allocationIds.length) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'One or more allocation IDs not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const nonPending = allocations.filter(a => a.status !== 'pending');
    if (nonPending.length > 0) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `${nonPending.length} allocation(s) are not in pending status`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    /*
      ⛔ REFUSE A CROSS-CURRENCY ALLOCATION.

      Nothing stopped an admin moving an allocation that originated on a KES
      campaign onto a USD one. `amount` carries no currency, so the figure
      would simply be re-read as the target's currency - KES 5,000 becoming
      US$50 on a screen, a ~130x misstatement of the same shape as the
      `/transparency` defect (`docs/114` §1).

      ⚠️ Severity, traced before claiming it: allocations are inserted only
      behind `campaign.simulationFlag` (`payment-service.ts:335`), and
      `fund-pool/disburse` flips a status and writes an audit row WITHOUT
      crediting any campaign. So this is a reporting defect today. It becomes
      a payment one the moment disbursement credits a balance, which is
      exactly why the guard goes in before that happens.

      A 400 and not `assertSameCurrency` (which throws, and would be a 500):
      an admin choosing the wrong campaign in a picker is a user error, and
      this route already answers 400 for the simulated-target case.
    */
    const mismatched = allocations.filter((a) => a.sourceCurrency !== targetCampaign.currency);
    if (mismatched.length > 0) {
      const found = [...new Set(mismatched.map((a) => a.sourceCurrency))].sort().join(', ');
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message:
              `${mismatched.length} allocation(s) are in ${found}, but the target campaign is in ` +
              `${targetCampaign.currency}. Funds cannot be allocated across currencies.`,
            requestId,
          },
        } satisfies ApiError,
        { status: 400 },
      );
    }

    // Update all allocations atomically
    await db.transaction(async (tx) => {
      await tx
        .update(fundPoolAllocations)
        .set({
          targetCampaignId,
          status: 'allocated',
          allocatedAt: new Date(),
          notes: notes ?? null,
        })
        .where(
          and(
            inArray(fundPoolAllocations.id, allocationIds),
            eq(fundPoolAllocations.status, 'pending'),
          ),
        );

      await tx.insert(auditLogs).values({
        eventType: 'fund_pool.allocated',
        actorId: session.user.id,
        actorRole: session.user.role,
        targetType: 'fund_pool',
        severity: 'info',
        details: {
          allocationIds,
          targetCampaignId,
          targetCampaignTitle: targetCampaign.title,
          currency: targetCampaign.currency,
          count: allocationIds.length,
          notes,
        },
      });
    });

    return NextResponse.json({
      ok: true,
      data: { allocated: allocationIds.length, targetCampaignId },
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
        { ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error('[POST /api/v1/admin/fund-pool/allocate]', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
