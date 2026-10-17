import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { auditLogs, users } from '@/db/schema';
import { desc, eq, gte, sql, inArray } from 'drizzle-orm';
import { ActivityCenter } from '@/components/admin/ActivityCenter';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Activity Center - Admin - LastDonor.org',
  robots: { index: false },
};

// High-priority event types to surface as alerts
const ALERT_EVENTS = [
  'donation.failed', 'donation.refunded', 'reconcile.discrepancy',
  'campaign.completed', 'campaign.submitted', 'user.role_changed', 'user.deleted',
];

export default async function AdminActivityPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') redirect('/admin');

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [recentActivity, severityCounts, alerts] = await Promise.all([
    // Recent activity (last 100 entries)
    db
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
      .orderBy(desc(auditLogs.timestamp))
      .limit(100),
    // Last 24h severity counts
    db
      .select({
        severity: auditLogs.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLogs)
      .where(gte(auditLogs.timestamp, twentyFourHoursAgo))
      .groupBy(auditLogs.severity),
    // Recent alerts (high-priority events)
    db
      .select({
        id: auditLogs.id,
        timestamp: auditLogs.timestamp,
        eventType: auditLogs.eventType,
        severity: auditLogs.severity,
        details: auditLogs.details,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
      })
      .from(auditLogs)
      .where(inArray(auditLogs.eventType, ALERT_EVENTS))
      .orderBy(desc(auditLogs.timestamp))
      .limit(20),
  ]);

  const summary: Record<string, number> = { info: 0, warning: 0, error: 0, critical: 0 };
  for (const row of severityCounts) {
    summary[row.severity] = row.count;
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Activity Center</h1>
        <p className="text-sm text-muted-foreground">
          System events, alerts, and activity feed
        </p>
      </div>
      <ActivityCenter
        activity={recentActivity.map((a) => ({
          ...a,
          timestamp: a.timestamp.toISOString(),
          details: a.details as Record<string, unknown>,
        }))}
        summary={summary}
        alerts={alerts.map((a) => ({
          ...a,
          timestamp: a.timestamp.toISOString(),
          details: a.details as Record<string, unknown>,
        }))}
      />
    </>
  );
}
