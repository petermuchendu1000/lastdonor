import Link from 'next/link';
import Image from 'next/image';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { donations, campaigns } from '@/db/schema';
import { eq, desc, sql, and, or } from 'drizzle-orm';
import { centsToDollars, centsToDollarsWhole } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/dates';
import { NextStepRow } from '@/components/dashboard/NextStepRow';
import { ProgressBar } from '@/components/campaign/ProgressBar';
import {
  ExclamationTriangleIcon,
  ArrowRightIcon,
  CheckBadgeIcon,
} from '@heroicons/react/24/solid';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { IdentityReturnNotice } from '@/components/dashboard/IdentityReturnNotice';

export const metadata: Metadata = {
  title: 'Dashboard - LastDonor.org',
  robots: { index: false },
};

async function getDashboardData(userId: string, userEmail: string) {
  const donorMatch = or(eq(donations.userId, userId), eq(donations.donorEmail, userEmail))!;
  const realDonationFilter = and(donorMatch, eq(donations.source, 'real'), eq(donations.refunded, false));

  // Run independent queries in parallel
  const [donationStatsResult, myCampaigns, recentDonations] = await Promise.all([
    db
      .select({
        totalDonated: sql<number>`COALESCE(SUM(${donations.amount}), 0)::int`,
        totalCount: sql<number>`count(${donations.id})::int`,
      })
      .from(donations)
      .where(realDonationFilter),

    db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        status: campaigns.status,
        goalAmount: campaigns.goalAmount,
        raisedAmount: campaigns.raisedAmount,
        donorCount: campaigns.donorCount,
        verificationStatus: campaigns.verificationStatus,
        // Needed to name the raise cap in the organiser's own money.
        currency: campaigns.currency,
        heroImageUrl: campaigns.heroImageUrl,
        updatedAt: campaigns.updatedAt,
      })
      .from(campaigns)
      .where(eq(campaigns.creatorId, userId))
      .orderBy(desc(campaigns.createdAt)),

    db
      .select({
        id: donations.id,
        amount: donations.amount,
        createdAt: donations.createdAt,
        campaignTitle: campaigns.title,
        campaignSlug: campaigns.slug,
      })
      .from(donations)
      .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
      .where(realDonationFilter)
      .orderBy(desc(donations.createdAt))
      .limit(3),
  ]);

  const donationStats = donationStatsResult[0];

  /*
    The URGENT banner: verification you are being chased for, because money
    is waiting on it.

    Kept narrow on purpose - nagging somebody to prove their identity
    before a single person has donated is noise. What was wrong was that
    this was the ONLY door. Both of its conditions are currently
    unsatisfiable (`docs/79` moved every campaign to `under_review`, and
    `docs/72` means no campaign can ever have a donor), so the link never
    rendered and the whole verification flow was unreachable without
    knowing the URL. The per-campaign entry point below is the fix; this
    stays as the escalation. See docs/83.
  */
  const needsVerification = myCampaigns.filter(
    (c) =>
      (c.status === 'active' || c.status === 'last_donor_zone') &&
      c.donorCount > 0 &&
      (c.verificationStatus === 'unverified' || c.verificationStatus === 'info_requested'),
  );

  return {
    totalDonated: donationStats?.totalDonated ?? 0,
    totalDonations: donationStats?.totalCount ?? 0,
    myCampaigns,
    recentDonations,
    needsVerification,
  };
}

export default async function DashboardPage() {
  const session = (await auth())!;

  const {
    totalDonated,
    totalDonations,
    myCampaigns,
    recentDonations,
    needsVerification,
  } = await getDashboardData(session.user!.id!, session.user!.email ?? '');

  const activeCampaigns = myCampaigns.filter(
    (c) => c.status === 'active' || c.status === 'last_donor_zone',
  );
  const hasUrgentActions = needsVerification.length > 0;
  const firstName = (session.user.name ?? 'User').split(' ')[0];

  return (
    <div className="flex gap-8">
      <div className="min-w-0 flex-1 space-y-8">
        {/*
          Didit sends the organiser back to /dashboard?verification=<slug>
          when the ID check is finished. Nothing read that parameter, so they
          completed it and landed on an unchanged dashboard. See docs/110.
        */}
        <Suspense fallback={null}>
          <IdentityReturnNotice />
        </Suspense>

        {/* Urgent actions */}
        {hasUrgentActions && (
          <div className="space-y-2">
            {needsVerification.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/campaigns/${c.id}/verification`}
                className="flex items-center gap-3 rounded-xl border border-brand-amber/30 bg-brand-amber/10 p-3.5 text-sm transition-colors hover:bg-brand-amber/20"
              >
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-brand-amber" />
                <span className="flex-1 text-foreground">
                  <strong>{c.title}</strong> -{' '}
                  {c.verificationStatus === 'info_requested'
                    ? 'Additional info needed for verification.'
                    : 'Verify your identity to receive your funds.'}
                </span>
                <ArrowRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}

        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-[26px]">
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what&apos;s happening with your campaigns.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Total Donated"
            value={centsToDollars(totalDonated)}
            sub="Across all campaigns"
          />
          <StatCard
            label="Active Campaigns"
            value={activeCampaigns.length.toString()}
            sub="Running right now"
          />
          <StatCard
            label="Total Donations"
            value={totalDonations.toString()}
            sub="Total contributions"
          />
        </div>

        {/* My Campaigns */}
        {myCampaigns.length > 0 && (
          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-foreground">My Campaigns</h2>
              <Link
                href="/dashboard/campaigns"
                className="text-sm font-semibold text-primary transition-colors hover:underline"
              >
                View all
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {myCampaigns.slice(0, 4).map((c) => {
                const pct =
                  c.goalAmount > 0
                    ? Math.min(100, Math.round((c.raisedAmount / c.goalAmount) * 100))
                    : 0;
                const statusLabel =
                  c.status === 'last_donor_zone'
                    ? 'Last Donor Zone'
                    : c.status.charAt(0).toUpperCase() + c.status.slice(1);

                return (
                  <div
                    key={c.id}
                    className="group rounded-xl border border-border bg-card p-4 shadow-[--shadow-elevation-1] transition-all hover:shadow-[--shadow-elevation-2]"
                  >
                    <div className="flex gap-4">
                      {c.heroImageUrl ? (
                        <div className="relative h-16 w-[88px] shrink-0 overflow-hidden rounded-lg bg-muted">
                          <Image
                            src={c.heroImageUrl}
                            alt={c.title}
                            fill
                            className="object-cover"
                            sizes="88px"
                            unoptimized
                          />
                        </div>
                      ) : (
                        <div className="flex h-16 w-[88px] shrink-0 items-center justify-center rounded-lg bg-muted">
                          <span className="font-display text-lg font-bold text-muted-foreground/40">{c.title.charAt(0)}</span>
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/campaigns/${c.id}`}
                            className="truncate text-sm font-semibold text-card-foreground transition-colors hover:text-primary"
                          >
                            {c.title}
                          </Link>
                          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                            {statusLabel}
                          </span>
                        </div>

                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                          <span className="font-mono font-semibold text-foreground">
                            {centsToDollarsWhole(c.raisedAmount)}
                          </span>{' '}
                          raised of {centsToDollarsWhole(c.goalAmount)}
                        </p>

                        {/*
                          The one thing waiting on this organiser.

                          docs/83 put a verification link here, which was the
                          product's ONLY prompt and covered one step of six.
                          It now renders the whole journey's next action, from
                          `organiser-journey.ts`, so this row and
                          /dashboard/campaigns cannot disagree. See docs/110.
                        */}
                        <NextStepRow
                          facts={{
                            campaignId: c.id,
                            status: c.status,
                            verificationStatus: c.verificationStatus,
                            currency: c.currency,
                          }}
                        />

                        <div className="mt-2">
                          <ProgressBar
                            raisedAmount={c.raisedAmount}
                            goalAmount={c.goalAmount}
                            compact
                          />
                          <div className="mt-1.5 flex items-center justify-between">
                            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                              {pct}% funded
                            </span>
                            {c.status === 'completed' && c.updatedAt && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <CheckBadgeIcon className="h-3.5 w-3.5 text-brand-green" />
                                Completed {formatDate(c.updatedAt)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
                          <Link
                            href={`/campaigns/${c.slug}`}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            View
                          </Link>
                          <Link
                            href={`/dashboard/campaigns/${c.id}`}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-colors hover:underline"
                          >
                            Manage
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {myCampaigns.length === 0 && (
          <section className="rounded-2xl border border-border bg-card p-8 text-center shadow-[--shadow-elevation-1]">
            <p className="text-sm font-semibold text-card-foreground">
              No campaigns yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Start your first campaign to raise funds for what matters.
            </p>
            <Link
              href="/share-your-story"
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Create Campaign
            </Link>
          </section>
        )}
      </div>

      {/* Right sidebar */}
      <aside className="hidden w-[280px] shrink-0 xl:block">
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[15px] font-bold text-foreground">
                Recent Donations
              </h3>
              <Link
                href="/dashboard/finances"
                className="text-xs font-semibold text-primary transition-colors hover:underline"
              >
                View all
              </Link>
            </div>

            <div className="mt-3 space-y-2.5">
              {recentDonations.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">No donations yet.</p>
              ) : (
                recentDonations.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-xl border border-border bg-card p-3.5 shadow-[--shadow-elevation-1]"
                  >
                    <p className="truncate text-[13px] font-medium text-card-foreground">
                      {d.campaignTitle}
                    </p>
                    <div className="mt-0.5 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(d.createdAt)}
                      </span>
                      <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                        {centsToDollars(d.amount)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="font-display text-[15px] font-bold text-foreground">Quick Links</h3>
            <div className="mt-3 space-y-0.5">
              {[
                { href: '/dashboard/finances', label: 'Finances' },
                { href: '/dashboard/settings', label: 'Account' },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[--shadow-elevation-1]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-[24px] font-bold tabular-nums text-card-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
