import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { users, campaigns, donations, newsletterSubscribers, siteSettings } from '@/db/schema';
import { sql, eq, like } from 'drizzle-orm';
import { SystemSettings } from '@/components/admin/SystemSettings';
import { getAllSettings } from '@/lib/settings.server';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings - Admin - LastDonor.org',
  robots: { index: false },
};

const CRON_JOBS = [
  { name: 'Ingest News', schedule: '*/30 * * * *' },
  { name: 'Update Phases', schedule: '*/5 * * * *' },
  { name: 'Process Donations', schedule: '*/15 * * * *' },
  { name: 'Reconcile', schedule: '0 4 * * *' },
  { name: 'Fetch News', schedule: '0 */6 * * *' },
  { name: 'Send Newsletter', schedule: '0 14 * * 4' },
  { name: 'Publish Campaigns', schedule: '*/30 * * * *' },
];

export default async function AdminSettingsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    redirect('/admin');
  }

  const [
    [userCount],
    [campaignCount],
    [donationCount],
    [subscriberCount],
    currentSettings,
    [currentUser],
    dbEnvKeys,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(users),
    db.select({ count: sql<number>`count(*)::int` }).from(campaigns),
    db.select({ count: sql<number>`count(*)::int` }).from(donations),
    db.select({ count: sql<number>`count(*)::int` }).from(newsletterSubscribers),
    getAllSettings(),
    db.select({ securityQuestion: users.securityQuestion }).from(users).where(eq(users.id, session.user.id)).limit(1),
    db.select({ key: siteSettings.key }).from(siteSettings).where(like(siteSettings.key, 'env.%')),
  ]);

  // Check env availability: DB override OR process.env
  const dbKeySet = new Set(dbEnvKeys.map((r) => r.key.replace('env.', '')));

  const stats = {
    totalUsers: userCount.count,
    totalCampaigns: campaignCount.count,
    totalDonations: donationCount.count,
    totalNewsletterSubscribers: subscriberCount.count,
    cronJobs: CRON_JOBS,
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
      <SystemSettings initialSettings={currentSettings} hasSecurityQuestion={!!currentUser?.securityQuestion} stats={stats} environment={environment} />
    </>
  );
}
