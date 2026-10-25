/**
 * Trusted institutions: the list, and creating one (`docs/108`).
 *
 * ⛔ There is NO public counterpart to this route, and that is the security
 * model, not an omission. A row in `trusted_institutions` lets its holder lift
 * the pre-verification raise cap (`docs/101`) on any campaign it vouches for,
 * so a self-serve registration endpoint would hand that to the internet. An
 * institution exists because a LastDonor admin checked it and said how.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { auditLogs, institutionVouches, trustedInstitutions, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { getClientIp } from '@/lib/rate-limit';
import { VOUCH_WINDOW_DAYS } from '@/lib/trust-network/decide';
import { createInstitutionSchema } from '@/lib/validators/trust-network';
import type { ApiError } from '@/types/api';

/** Keeps every catch block in this file honest about which status it owes. */
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

const PAGE_LIMIT = 200;

/**
 * GET /api/v1/admin/institutions
 *
 * Every institution, with its live vouch count and how much of its rolling
 * budget is spent - which is the only form in which the list is useful.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  try {
    await requireRole(['admin']);

    const windowStart = new Date(Date.now() - VOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    /*
      One query, not three (docs/87): the two counts are correlated scalar
      subqueries rather than a second and third round trip.
    */
    const rows = await db
      .select({
        id: trustedInstitutions.id,
        name: trustedInstitutions.name,
        kind: trustedInstitutions.kind,
        country: trustedInstitutions.country,
        website: trustedInstitutions.website,
        registrationId: trustedInstitutions.registrationId,
        registrationVerifiedAt: trustedInstitutions.registrationVerifiedAt,
        status: trustedInstitutions.status,
        verifiedAt: trustedInstitutions.verifiedAt,
        verificationNotes: trustedInstitutions.verificationNotes,
        monthlyVouchLimit: trustedInstitutions.monthlyVouchLimit,
        suspendedAt: trustedInstitutions.suspendedAt,
        suspendedReason: trustedInstitutions.suspendedReason,
        verifiedByEmail: users.email,
        liveVouches: db
          .$count(
            institutionVouches,
            and(
              eq(institutionVouches.institutionId, trustedInstitutions.id),
              isNull(institutionVouches.revokedAt),
            ),
          )
          .as('live_vouches'),
        vouchesInWindow: db
          .$count(
            institutionVouches,
            and(
              eq(institutionVouches.institutionId, trustedInstitutions.id),
              gte(institutionVouches.createdAt, windowStart),
            ),
          )
          .as('vouches_in_window'),
      })
      .from(trustedInstitutions)
      .leftJoin(users, eq(users.id, trustedInstitutions.verifiedBy))
      .orderBy(desc(trustedInstitutions.createdAt))
      .limit(PAGE_LIMIT);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(trustedInstitutions);

    return NextResponse.json({
      ok: true,
      data: {
        institutions: rows.map((r) => ({
          ...r,
          liveVouches: Number(r.liveVouches),
          vouchesInWindow: Number(r.vouchesInWindow),
          verifiedAt: r.verifiedAt.toISOString(),
          registrationVerifiedAt: r.registrationVerifiedAt?.toISOString() ?? null,
          suspendedAt: r.suspendedAt?.toISOString() ?? null,
        })),
        loaded: rows.length,
        total,
        windowDays: VOUCH_WINDOW_DAYS,
      },
    });
  } catch (error) {
    void request;
    return errorResponse(error, requestId, 'Admin institutions GET');
  }
}

/**
 * POST /api/v1/admin/institutions
 *
 * Record an institution an admin has checked. `verificationNotes` is required
 * and must say how they checked - an institution with no account of that is
 * an institution nobody checked.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const session = await requireRole(['admin']);

    const parsed = createInstitutionSchema.safeParse(await request.json());
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

    /*
      The unique index on (lower(name), country) is the real guard - two rows
      for one organisation is not a cosmetic duplicate, because each carries
      its own vouch budget, so a duplicate silently doubles it. This catch
      turns the constraint violation into a message an admin can act on.
    */
    let created: { id: string } | undefined;
    try {
      [created] = await db
        .insert(trustedInstitutions)
        .values({
          name: input.name,
          kind: input.kind,
          country: input.country,
          website: input.website ?? null,
          registrationId: input.registrationId ?? null,
          verificationNotes: input.verificationNotes,
          monthlyVouchLimit: input.monthlyVouchLimit ?? 10,
          verifiedBy: session.user!.id!,
        })
        .returning({ id: trustedInstitutions.id });
    } catch (e) {
      if (String((e as { code?: string }).code) === '23505') {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'CONFLICT',
              message: `${input.name} is already recorded for ${input.country}.`,
              requestId,
            },
          } satisfies ApiError,
          { status: 409 },
        );
      }
      throw e;
    }

    await db.insert(auditLogs).values({
      eventType: 'institution.created',
      actorId: session.user!.id!,
      actorRole: 'admin',
      actorIp: getClientIp(request.headers),
      targetType: 'institution',
      targetId: created!.id,
      severity: 'warning',
      details: sql`${JSON.stringify({
        name: input.name,
        kind: input.kind,
        country: input.country,
        monthlyVouchLimit: input.monthlyVouchLimit ?? 10,
        registrationIdGiven: Boolean(input.registrationId),
      })}::jsonb`,
    });

    return NextResponse.json({ ok: true, data: { id: created!.id } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId, 'Admin institutions POST');
  }
}
