import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users, campaigns, donations, newsletterSubscribers, siteSettings } from '@/db/schema';
import { sql, like } from 'drizzle-orm';
import { SystemSettings } from '@/components/admin/SystemSettings';
import { getAllSettings } from '@/lib/settings.server';
import { cronScheduleRows } from '@/lib/cron-schedule-display';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings - Admin - LastDonor.org',
  robots: { index: false },
};

/*
  The schedule shown to the operator is DERIVED from the one the Worker
  runs. A hand-written list of seven used to sit here; it matched neither
  `CRON_JOBS` (twelve) nor `vercel.json` (nine, inert on Fly - docs/65), and
  one of its rows named the one job this project deliberately does not
  schedule. See `cron-schedule-display.ts` and `docs/138`.
*/

export default async function AdminSettingsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    redirect('/admin');
  }

  /*
    docs/87 amendment 5. This was SEVEN queries in one `Promise.all`
    against a pool of five, and it was reproduced leaving backends
    stuck in `active` / `Client/ClientRead` on 2026-10-17. The four
    table counts are now one round trip of scalar subqueries, which
    the planner handles as four cheap aggregates, and the rest runs in
    one batch that leaves room for the layout's `auth()`.
  */
  const [[counts], currentSettings, dbEnvKeys] = await Promise.all([
    db
      .select({
        users: sql<number>`(select count(*) from ${users})::int`,
        campaigns: sql<number>`(select count(*) from ${campaigns})::int`,
        donations: sql<number>`(select count(*) from ${donations})::int`,
        subscribers: sql<number>`(select count(*) from ${newsletterSubscribers})::int`,
        securityQuestion: sql<string | null>`(select security_question from ${users} where id = ${session.user.id})`,
      })
      .from(sql`(select 1) as _`),
    getAllSettings(),
    db.select({ key: siteSettings.key }).from(siteSettings).where(like(siteSettings.key, 'env.%')),
  ]);

  // Check env availability: DB override OR process.env
  const dbKeySet = new Set(dbEnvKeys.map((r) => r.key.replace('env.', '')));

  const stats = {
    totalUsers: counts.users,
    totalCampaigns: counts.campaigns,
    totalDonations: counts.donations,
    totalNewsletterSubscribers: counts.subscribers,
    cronJobs: cronScheduleRows(),
  };

  const environment = {
    hasStripeKey: dbKeySet.has('STRIPE_SECRET_KEY') || !!process.env.STRIPE_SECRET_KEY,
    hasResendKey: dbKeySet.has('RESEND_API_KEY') || !!process.env.RESEND_API_KEY,
    hasDatabaseUrl: dbKeySet.has('DATABASE_URL') || !!process.env.DATABASE_URL,
    hasOpenRouterKey: dbKeySet.has('OPENROUTER_API_KEY') || !!process.env.OPENROUTER_API_KEY,
    hasSentryDsn: dbKeySet.has('SENTRY_DSN') || !!process.env.SENTRY_DSN,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">System Settings</h1>
        <p className="text-sm text-muted-foreground">Manage platform configuration, environment status, and cron jobs.</p>
      </div>
      <SystemSettings initialSettings={currentSettings} hasSecurityQuestion={!!counts.securityQuestion} stats={stats} environment={environment} />
    </>
  );
}
