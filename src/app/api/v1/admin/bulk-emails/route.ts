import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { bulkEmails, auditLogs } from '@/db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { createBulkEmailSchema, bulkEmailQuerySchema } from '@/lib/validators/verification';
import {
  countBulkEmailRecipients,
  bulkEmailRecipientCeiling,
} from '@/lib/bulk-email-recipients';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';
import type { UserRole } from '@/types';

/**
 * GET /api/v1/admin/bulk-emails - List all bulk emails with pagination.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  try {
    await requireRole(['admin']);

    const url = new URL(request.url);
    const query = bulkEmailQuerySchema.parse({
      status: url.searchParams.get('status') ?? undefined,
      page: url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    });

    const { status, page, limit } = query;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (status) {
      conditions.push(eq(bulkEmails.status, status as 'draft' | 'sending' | 'completed' | 'failed'));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(bulkEmails)
        .where(where)
        .orderBy(desc(bulkEmails.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(bulkEmails)
        .where(where),
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        items: rows,
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
    console.error('[GET /api/v1/admin/bulk-emails]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list bulk emails', requestId } } satisfies ApiError, { status: 500 });
  }
}

/**
 * POST /api/v1/admin/bulk-emails - Create a new bulk email (draft).
 *
 * Counts recipients based on the filter and campaign, stores the draft.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  try {
    const session = await requireRole(['admin']);

    const body = await request.json().catch(() => null);
    const parsed = createBulkEmailSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body', requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const { templateName, campaignId, subject, bodyHtml, recipientFilter } = parsed.data;

    // Count recipients with the SAME helper the send uses, so the number the
    // confirmation dialog shows is the number that will actually be mailed.
    // (Previously the count used one predicate and the send used another.)
    const recipientCount = await countBulkEmailRecipients(recipientFilter, campaignId ?? null);

    const ceiling = bulkEmailRecipientCeiling();
    if (recipientCount > ceiling) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: `This filter matches ${recipientCount} recipients, above the ${ceiling} hard ceiling for a single bulk email. Narrow the filter or scope it to a campaign.`, requestId } } satisfies ApiError,
        { status: 400 },
      );
    }

    const [bulkEmail] = await db.insert(bulkEmails).values({
      sentBy: session.user?.id ?? '',
      templateName,
      subject,
      bodyHtml,
      recipientCount,
      campaignId: campaignId ?? null,
    }).returning();

    // `audit_logs.details.recipientFilter` is the ONLY durable home for the
    // chosen filter: `bulk_emails` has no `recipient_filter` column and
    // migrations are frozen (CLAUDE.md). The send route reads it back via
    // `loadPersistedRecipientFilter` and refuses to send when it is absent,
    // so this write is load-bearing, not decorative.
    await db.insert(auditLogs).values({
      eventType: 'bulk_email.created',
      actorId: session.user?.id ?? null,
      actorRole: session.user?.role as UserRole,
      targetType: 'bulk_email',
      targetId: bulkEmail.id,
      severity: 'info',
      details: { templateName, campaignId, recipientFilter, recipientCount },
    });

    return NextResponse.json(
      { ok: true, data: { ...bulkEmail, recipientFilter } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required', requestId } } satisfies ApiError, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin access required', requestId } } satisfies ApiError, { status: 403 });
    }
    console.error('[POST /api/v1/admin/bulk-emails]', error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create bulk email', requestId } } satisfies ApiError, { status: 500 });
  }
}
