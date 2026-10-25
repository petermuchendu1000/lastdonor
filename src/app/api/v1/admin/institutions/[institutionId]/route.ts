/**
 * Changing a trusted institution: suspending it, and its vouch budget.
 *
 * ── SUSPENDING DOES NOT REVOKE ──────────────────────────────────────────────
 *
 * Suspension stops NEW vouches and leaves existing ones standing. That is
 * deliberate and it is the conservative direction: a suspension is often
 * precautionary ("their email was compromised, hold on"), and cascading it
 * into every past vouch would un-verify a set of live campaigns - putting
 * them back under the raise cap mid-appeal - on a suspicion.
 *
 * Revoking is per vouch, with a reason, on its own route. If every vouch from
 * an institution needs revoking, that is a decision taken one campaign at a
 * time, each with its own audit row. `docs/108` §6.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { auditLogs, trustedInstitutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getClientIp } from '@/lib/rate-limit';
import { updateInstitutionSchema } from '@/lib/validators/trust-network';
import type { ApiError } from '@/types/api';

interface Params {
  params: Promise<{ institutionId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const requestId = randomUUID();
  const { institutionId } = await params;

  try {
    const session = await requireRole(['admin']);

    const parsed = updateInstitutionSchema.safeParse(await request.json());
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

    const input = parsed.data;
    const now = new Date();

    const [before] = await db
      .select({
        id: trustedInstitutions.id,
        name: trustedInstitutions.name,
        status: trustedInstitutions.status,
        monthlyVouchLimit: trustedInstitutions.monthlyVouchLimit,
      })
      .from(trustedInstitutions)
      .where(eq(trustedInstitutions.id, institutionId))
      .limit(1);

    if (!before) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Organisation not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    const changes: Partial<typeof trustedInstitutions.$inferInsert> = { updatedAt: now };
    if (input.status) {
      changes.status = input.status;
      // Both directions are recorded: a reactivated institution must not keep
      // reading as suspended on the screen that decides whether to trust it.
      changes.suspendedAt = input.status === 'suspended' ? now : null;
      changes.suspendedReason = input.status === 'suspended' ? (input.suspendedReason ?? null) : null;
    }
    if (input.monthlyVouchLimit !== undefined) changes.monthlyVouchLimit = input.monthlyVouchLimit;
    if (input.website !== undefined) changes.website = input.website;
    if (input.verificationNotes !== undefined) changes.verificationNotes = input.verificationNotes;
    if (input.registrationVerified !== undefined) {
      changes.registrationVerifiedAt = input.registrationVerified ? now : null;
    }

    await db.update(trustedInstitutions).set(changes).where(eq(trustedInstitutions.id, institutionId));

    await db.insert(auditLogs).values({
      eventType: input.status === 'suspended' ? 'institution.suspended' : 'institution.updated',
      actorId: session.user!.id!,
      actorRole: 'admin',
      actorIp: getClientIp(request.headers),
      targetType: 'institution',
      targetId: institutionId,
      severity: 'warning',
      details: sql`${JSON.stringify({
        name: before.name,
        statusBefore: before.status,
        statusAfter: input.status ?? before.status,
        limitBefore: before.monthlyVouchLimit,
        limitAfter: input.monthlyVouchLimit ?? before.monthlyVouchLimit,
        suspendedReason: input.suspendedReason ?? null,
        registrationVerified: input.registrationVerified ?? null,
      })}::jsonb`,
    });

    return NextResponse.json({ ok: true, data: { id: institutionId } });
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
    console.error('Admin institution PATCH error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
