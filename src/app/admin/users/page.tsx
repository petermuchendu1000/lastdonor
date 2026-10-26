import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { desc, sql } from 'drizzle-orm';
import { UsersList } from '@/components/admin/UsersList';
import { donorTotalsForUsers } from '@/lib/admin/donation-totals.server';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Users - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AdminUsersPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  const [allUsers, roleCounts] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        campaignsSupported: users.campaignsSupported,
        lastDonorCount: users.lastDonorCount,
        createdAt: users.createdAt,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(200),

    db
      .select({
        role: users.role,
        count: sql<number>`count(*)::int`,
      })
      .from(users)
      .groupBy(users.role),
  ]);

  /*
    ⛔ `users.total_donated` is NOT rendered any more. It is one integer with
    no currency dimension - `payment-service.ts:307` adds every donation's
    raw amount to it whatever rail it came over - so for a donor across two
    currencies it is a number in neither, and this list printed it with a
    dollar sign (`docs/92`).

    Recomputed from `donations`, grouped by (user, currency), in ONE query for
    all 200 rows. Awaited after the batch so the page's concurrency is
    unchanged (`docs/87`).
  */
  const donorTotals = await donorTotalsForUsers(db, allUsers.map((u) => u.id));

  const roleBreakdown = Object.fromEntries(
    roleCounts.map((r) => [r.role, r.count]),
  ) as Record<string, number>;

  const totalUsers = Object.values(roleBreakdown).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          {totalUsers} registered users
        </p>
      </div>
      <UsersList
        initialUsers={allUsers.map((u) => ({
          ...u,
          donationTotals: donorTotals.get(u.id) ?? [],
          createdAt: u.createdAt.toISOString(),
        }))}
        roleBreakdown={roleBreakdown}
        totalUsers={totalUsers}
      />
    </>
  );
}
