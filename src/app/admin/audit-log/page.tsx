import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { AuditLogViewer } from '@/components/admin/AuditLogViewer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Audit Log - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AuditLogPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') redirect('/admin');

  const [entries, eventTypesResult] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.timestamp))
      .limit(50),
    db
      .selectDistinct({ eventType: auditLogs.eventType })
      .from(auditLogs)
      .orderBy(auditLogs.eventType),
  ]);

  const eventTypes = eventTypesResult.map((r) => r.eventType);
  const lastEntry = entries[entries.length - 1];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          Security and administrative event history
        </p>
      </div>
      <AuditLogViewer
        entries={entries.map((e) => ({
          id: e.id,
          timestamp: e.timestamp.toISOString(),
          eventType: e.eventType,
          actorId: e.actorId,
          actorRole: e.actorRole,
          targetType: e.targetType,
          targetId: e.targetId,
          severity: e.severity,
          details: e.details as Record<string, unknown> | null,
        }))}
        eventTypes={eventTypes}
        hasMore={entries.length === 50}
        cursor={lastEntry?.id ?? null}
      />
    </>
  );
}
