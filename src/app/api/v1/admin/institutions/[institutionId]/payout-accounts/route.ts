/**
 * An institution's payment details (`docs/113` §11, screen A1).
 *
 * ⛔ THERE IS NO PUBLIC COUNTERPART, and that is the security model. A row
 * here is a destination a campaign's whole balance can be sent to. Anyone who
 * could create one could aim a family's money at an account they control, so
 * this is admin-only for the same reason `docs/108` refused a self-serve
 * institution signup.
 *
 * ⚠️ Recording a payee is a SEPARATE decision from trusting a voucher. An
 * institution can be one without the other, and the common case is exactly
 * that: a church that can confirm a funeral is not thereby somewhere to send
 * money. That is why these rows are not columns on `trusted_institutions`.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { auditLogs, institutionPayoutAccounts, trustedInstitutions } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getClientIp } from '@/lib/rate-limit';
import { createPayoutAccountSchema } from '@/lib/validators/trust-network';
import type { ApiError } from '@/types/api';

function errorResponse(error: unknown, requestId: string, where: string) {
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

/** GET — the accounts recorded for one institution, newest first. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ institutionId: string }> },
) {
  const requestId = randomUUID();
  try {
    await requireRole(['admin']);
    const { institutionId } = await params;

    const rows = await db
      .select({
        id: institutionPayoutAccounts.id,
        currency: institutionPayoutAccounts.currency,
        rail: institutionPayoutAccounts.rail,
        accountIdentifier: institutionPayoutAccounts.accountIdentifier,
        accountReferenceLabel: institutionPayoutAccounts.accountReferenceLabel,
        status: institutionPayoutAccounts.status,
        confirmedAt: institutionPayoutAccounts.confirmedAt,
        confirmationNotes: institutionPayoutAccounts.confirmationNotes,
      })
      .from(institutionPayoutAccounts)
      .where(eq(institutionPayoutAccounts.institutionId, institutionId))
      .orderBy(desc(institutionPayoutAccounts.confirmedAt));

    return NextResponse.json({ ok: true, data: { accounts: rows } });
  } catch (error) {
    return errorResponse(error, requestId, 'GET payout-accounts');
  }
}

/**
 * POST — record an account an admin has confirmed with the institution.
 *
 * ⚠️ Two queries, run in SEQUENCE, never concurrently: the pool is `max: 5`
 * and `docs/87` caps a request at three concurrent queries. The institution
 * lookup must finish before the insert anyway, since the insert depends on it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ institutionId: string }> },
) {
  const requestId = randomUUID();
  try {
    const session = await requireRole(['admin']);
    const { institutionId } = await params;

    const parsed = createPayoutAccountSchema.safeParse(await request.json());
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

    const [institution] = await db
      .select({ id: trustedInstitutions.id, status: trustedInstitutions.status })
      .from(trustedInstitutions)
      .where(eq(trustedInstitutions.id, institutionId))
      .limit(1);

    if (!institution) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Institution not found', requestId } } satisfies ApiError,
        { status: 404 },
      );
    }

    /*
      A suspended institution is one we have stopped trusting. Adding a way to
      pay it while it is suspended would be the one direction that matters.
    */
    if (institution.status !== 'active') {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'CONFLICT',
            message: 'This institution is suspended, so no payment account can be added to it.',
            requestId,
          },
        } satisfies ApiError,
        { status: 409 },
      );
    }

    const [created] = await db
      .insert(institutionPayoutAccounts)
      .values({
        institutionId,
        currency: input.currency,
        rail: input.rail,
        accountIdentifier: input.accountIdentifier,
        accountReferenceLabel: input.accountReferenceLabel,
        confirmationNotes: input.confirmationNotes,
        confirmedBy: session.user!.id!,
      })
      .returning({ id: institutionPayoutAccounts.id });

    /*
      `warning`, matching `institution.created`. This is not routine
      bookkeeping: it is the record of who said a shortcode belongs to a
      hospital, and it is the first thing anybody reads when money lands
      somewhere it should not have.
    */
    await db.insert(auditLogs).values({
      eventType: 'institution.payout_account_added',
      actorId: session.user!.id!,
      actorRole: 'admin',
      actorIp: getClientIp(request.headers),
      targetType: 'institution',
      targetId: institutionId,
      severity: 'warning',
      details: {
        payoutAccountId: created!.id,
        currency: input.currency,
        rail: input.rail,
        accountIdentifier: input.accountIdentifier,
      },
    });

    return NextResponse.json({ ok: true, data: { id: created!.id } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId, 'POST payout-accounts');
  }
}

/**
 * PATCH — retire an account.
 *
 * ⛔ Retire, never delete. A designation points at it, and a campaign that has
 * been paid must still be able to say where its money went.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ institutionId: string }> },
) {
  const requestId = randomUUID();
  try {
    const session = await requireRole(['admin']);
    const { institutionId } = await params;
    const body = (await request.json()) as { accountId?: string; reason?: string };

    if (!body.accountId || !body.reason || body.reason.trim().length < 3) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'An account id and a reason are required', requestId },
        } satisfies ApiError,
        { status: 400 },
      );
    }

    const [updated] = await db
      .update(institutionPayoutAccounts)
      .set({
        status: 'retired',
        retiredAt: new Date(),
        retiredReason: body.reason.trim(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(institutionPayoutAccounts.id, body.accountId),
          eq(institutionPayoutAccounts.institutionId, institutionId),
          eq(institutionPayoutAccounts.status, 'active'),
        ),
      )
      .returning({ id: institutionPayoutAccounts.id });

    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'NOT_FOUND', message: 'No active account with that id on this institution', requestId },
        } satisfies ApiError,
        { status: 404 },
      );
    }

    await db.insert(auditLogs).values({
      eventType: 'institution.payout_account_retired',
      actorId: session.user!.id!,
      actorRole: 'admin',
      actorIp: getClientIp(request.headers),
      targetType: 'institution',
      targetId: institutionId,
      severity: 'warning',
      details: { payoutAccountId: updated.id, reason: body.reason.trim() },
    });

    return NextResponse.json({ ok: true, data: { id: updated.id } });
  } catch (error) {
    return errorResponse(error, requestId, 'PATCH payout-accounts');
  }
}
