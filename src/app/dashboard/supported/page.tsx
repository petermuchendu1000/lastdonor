import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { donations, campaigns } from '@/db/schema';
import { eq, sql, desc, and, or } from 'drizzle-orm';
import { Money } from '@/components/ui/Money';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Supported Campaigns - Dashboard - LastDonor.org',
  robots: { index: false },
};

export default async function SupportedCampaignsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/supported');

  const userEmail = session.user.email ?? '';
  const donorMatch = or(eq(donations.userId, session.user.id), eq(donations.donorEmail, userEmail))!;

  const supported = await db
    .select({
      campaignId: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      category: campaigns.category,
      goalAmount: campaigns.goalAmount,
      raisedAmount: campaigns.raisedAmount,
      // Selected because it is RENDERED: without it the figures below were
      // formatted as USD whatever currency the row is in (`docs/92`).
      currency: campaigns.currency,
      donorCount: campaigns.donorCount,
      heroImageUrl: campaigns.heroImageUrl,
      totalDonated: sql<number>`sum(${donations.amount})::int`,
      donationCount: sql<number>`count(${donations.id})::int`,
    })
    .from(donations)
    .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
    .where(
      and(
        donorMatch,
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    )
    .groupBy(
      campaigns.id,
      campaigns.title,
      campaigns.slug,
      campaigns.status,
      campaigns.category,
      campaigns.goalAmount,
      campaigns.raisedAmount,
      campaigns.donorCount,
      campaigns.heroImageUrl,
    )
    .orderBy(desc(sql`max(${donations.createdAt})`));

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-foreground">Supported Campaigns</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Campaigns you&apos;ve donated to ({supported.length})
      </p>

      {supported.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              You haven&apos;t supported any campaigns yet.{' '}
              <Link href="/campaigns" className="text-brand-teal underline">
                Browse campaigns
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {supported.map((c) => {
            const pct = c.goalAmount > 0 ? Math.min(100, Math.round((c.raisedAmount / c.goalAmount) * 100)) : 0;
            return (
              <Card key={c.campaignId} className="overflow-hidden">
                <CardContent className="p-0">
                  {c.heroImageUrl && (
                    <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                      <Image
                        src={c.heroImageUrl}
                        alt={c.title}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 33vw"
                        unoptimized
                      />
                    </div>
                  )}
                  <div className="p-4">
                    <Link
                      href={`/campaigns/${c.slug}`}
                      className="font-medium text-brand-teal hover:underline"
                    >
                      {c.title}
                    </Link>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={c.status === 'active' || c.status === 'last_donor_zone' ? 'default' : 'secondary'} className="text-xs">
                        {c.status === 'last_donor_zone' ? 'Last Donor Zone' : c.status}
                      </Badge>
                      <span className="capitalize">{c.category}</span>
                    </div>
                    <div className="mt-3 h-1.5 w-full rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand-teal" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        <Money minor={c.raisedAmount} currency={c.currency} precision="exact" /> of{' '}
                        <Money minor={c.goalAmount} currency={c.currency} precision="exact" />
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Your contribution</p>
                        {/*
                          What THIS donor gave to THIS campaign, so it is the
                          campaign's currency by database guarantee:
                          donations_campaign_currency_fk on
                          (campaign_id, currency).
                        */}
                        <p className="font-mono text-sm font-semibold text-brand-teal">
                          <Money minor={c.totalDonated} currency={c.currency} precision="exact" />
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Donations</p>
                        <p className="text-sm font-semibold text-foreground">{c.donationCount}</p>
                      </div>
                    </div>
                    <Link
                      href={`/campaigns/${c.slug}`}
                      className="mt-3 block rounded-md bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      Donate Again
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
