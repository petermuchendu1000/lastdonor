import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import AccountPageClient from '@/components/user/AccountPageClient';
import { BadgeDisplay } from '@/components/user/BadgeDisplay';
import { PhoneVerificationCard } from '@/components/user/PhoneVerificationCard';
import type { UserBadge } from '@/types';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account - Dashboard - LastDonor.org',
  robots: { index: false },
};

export default async function DashboardSettingsPage() {
  const session = (await auth())!;

  const [user] = await db
    .select({
      name: users.name,
      email: users.email,
      location: users.location,
      avatarUrl: users.avatarUrl,
      badges: users.badges,
    })
    .from(users)
    .where(eq(users.id, session.user!.id!))
    .limit(1);

  if (!user) redirect('/login');

  const badges = (user.badges ?? []) as UserBadge[];

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-foreground">Account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your profile, preferences, and account
      </p>

      {badges.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-muted-foreground">Earned Badges</h2>
          <div className="mt-2">
            <BadgeDisplay badges={badges} />
          </div>
        </section>
      )}

      <div className="mt-6">
        <AccountPageClient
          profile={{
            name: user.name ?? '',
            email: user.email,
            location: user.location,
            avatarUrl: user.avatarUrl,
          }}
        />
      </div>

      <div className="mt-6">
        <PhoneVerificationCard />
      </div>
    </>
  );
}
