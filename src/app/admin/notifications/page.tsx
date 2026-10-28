import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/db';
import { notifications } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { NotificationsClient } from '@/app/notifications/NotificationsClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Notifications - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AdminNotificationsPage() {
  /*
    ⛔ `['admin']`, not `['admin', 'editor']`. Its nav group is `adminOnly`, so
    an editor was never shown this link and was served it anyway by URL - the
    two statements contradicted each other (`docs/132`).

    ⚠️ Resolved in the page's favour costing an editor NOTHING: this screen
    reads `notifications WHERE user_id = <the caller>`, i.e. the caller's OWN
    inbox, and `/notifications` serves that same `NotificationsClient` to any
    signed-in user ([VERIFIED] `src/app/notifications/page.tsx:17-19` gates on
    a session alone). So an editor keeps their notifications; they just read
    them where everyone else does.
  */
  const session = await requireRole(['admin']);
  const userId = session.user?.id;
  if (!userId) redirect('/login');

  const [items, [countRow], [unreadRow]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        link: notifications.link,
        read: notifications.read,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(200),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(eq(notifications.userId, userId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false))),
  ]);

  const serialized = items.map((n) => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  }));

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          {countRow.count} total &middot; {unreadRow.count} unread
        </p>
      </div>
      <NotificationsClient
        notifications={serialized}
        totalCount={countRow.count}
        unreadCount={unreadRow.count}
      />
    </>
  );
}
