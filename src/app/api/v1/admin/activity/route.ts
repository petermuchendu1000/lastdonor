import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { auditLogs, users } from '@/db/schema';
import { desc, eq, and, gte, sql, inArray } from 'drizzle-orm';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth';
import { randomUUID } from 'crypto';
import type { ApiError } from '@/types/api';

// Event categories for filtering
const EVENT_CATEGORIES: Record<string, string[]> = {
  donations: ['donation.recorded', 'donation.failed', 'donation.refunded'],
  campaigns: [
    'campaign.phase_transition', 'campaign.completed', 'campaign.auto_published', 'campaign.auto_drafted',
    'campaign.created',
  ],
  users: ['user.login', 'user.deleted', 'user.role_changed'],
  system: [
    'cron.send_newsletter', 'cron.simulate_donations', 'cron.publish_campaigns',
    'cron.fetch_news', 'cron.ingest_news', 'cron.reconcile',
    'admin.seed_purge', 'admin.seed_messages_generated', 'audit_log.viewed',
  ],
  alerts: ['donation.failed', 'reconcile.discrepancy'],
};

/**
 * GET /api/v1/admin/activity
 * Query params: category, severity, limit, cursor
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  try {
    await requireRole(['admin']);

    const { searchParams } = request.nextUrl;
    const category = searchParams.get('category');
    const severity = searchParams.get('severity');
    const limitParam = parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 200);
    const cursor = searchParams.get('cursor');
    const offset = cursor ? parseInt(cursor, 10) : 0;

    // Build conditions
    const conditions = [];

    if (category && EVENT_CATEGORIES[category]) {
      conditions.push(inArray(auditLogs.eventType, EVENT_CATEGORIES[category]));
    }

    if (severity && ['info', 'warning', 'error', 'critical'].includes(severity)) {
      conditions.push(eq(auditLogs.severity, severity as 'info' | 'warning' | 'error' | 'critical'));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const entries = await db
      .select({
        id: auditLogs.id,
        timestamp: auditLogs.timestamp,
        eventType: auditLogs.eventType,
        actorId: auditLogs.actorId,
        actorRole: auditLogs.actorRole,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        details: auditLogs.details,
        severity: auditLogs.severity,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.timestamp))
      .offset(offset)
      .limit(limit + 1);

    const hasMore = entries.length > limit;
    const data = hasMore ? entries.slice(0, limit) : entries;

    // Summary stats: recent counts by severity (last 24h)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const severityCounts = await db
      .select({
        severity: auditLogs.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLogs)
      .where(gte(auditLogs.timestamp, twentyFourHoursAgo))
      .groupBy(auditLogs.severity);

    const summary: Record<string, number> = { info: 0, warning: 0, error: 0, critical: 0 };
    for (const row of severityCounts) {
      summary[row.severity] = row.count;
    }

    return NextResponse.json({
      ok: true,
      data,
      meta: {
        hasMore,
        cursor: hasMore ? String(offset + limit) : undefined,
      },
      summary,
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
        { ok: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions', requestId } } satisfies ApiError,
        { status: 403 },
      );
    }
    console.error('[GET /api/v1/admin/activity]', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch activity', requestId } } satisfies ApiError,
      { status: 500 },
    );
  }
}
