import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { desc, sql } from 'drizzle-orm';
import { UsersList } from '@/components/admin/UsersList';
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
        totalDonated: users.totalDonated,
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
          createdAt: u.createdAt.toISOString(),
        }))}
        roleBreakdown={roleBreakdown}
        totalUsers={totalUsers}
      />
    </>
  );
}
