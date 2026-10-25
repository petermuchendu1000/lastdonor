import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { campaigns, donations, campaignUpdates, impactUpdates } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { centsToDollars } from '@/lib/utils/currency';
import { hasPublicPage } from '@/lib/campaign-visibility';
import { JourneyChecklist } from '@/components/dashboard/JourneyChecklist';
import { CampaignTeamPanel } from '@/components/collaborators/CampaignTeamPanel';
import { campaignStatusLabel, verificationStatusLabel } from '@/lib/campaign-labels';
import { formatDate } from '@/lib/utils/dates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import type { Metadata } from 'next';


export async function generateMetadata({ params: _params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return {
    title: 'Campaign Management - Dashboard - LastDonor.org',
    robots: { index: false },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/campaigns');

  const [campaign] = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      category: campaigns.category,
      goalAmount: campaigns.goalAmount,
      raisedAmount: campaigns.raisedAmount,
      donorCount: campaigns.donorCount,
      verificationStatus: campaigns.verificationStatus,
      currency: campaigns.currency,
      beneficiaryRelation: campaigns.beneficiaryRelation,
      creatorId: campaigns.creatorId,
      createdAt: campaigns.createdAt,
      publishedAt: campaigns.publishedAt,
      totalReleasedAmount: campaigns.totalReleasedAmount,
    })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);

  if (!campaign) notFound();
  if (campaign.creatorId !== session.user.id && !['editor', 'admin'].includes(session.user.role as string)) {
    redirect('/dashboard/campaigns');
  }

  const pct = campaign.goalAmount > 0
    ? Math.min(100, Math.round((campaign.raisedAmount / campaign.goalAmount) * 100))
    : 0;

  // Recent donors
  const recentDonors = await db
    .select({
      id: donations.id,
      donorName: donations.donorName,
      amount: donations.amount,
      message: donations.message,
      anonymous: donations.isAnonymous,
      phaseAtTime: donations.phaseAtTime,
      createdAt: donations.createdAt,
    })
    .from(donations)
    .where(and(eq(donations.campaignId, id), eq(donations.source, 'real')))
    .orderBy(desc(donations.createdAt))
    .limit(5);

  // Recent updates
  const recentUpdates = await db
    .select({
      id: campaignUpdates.id,
      title: campaignUpdates.title,
      updateType: campaignUpdates.updateType,
      createdAt: campaignUpdates.createdAt,
    })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, id))
    .orderBy(desc(campaignUpdates.createdAt))
    .limit(5);

  // Impact update
  const [impactUpdate] = await db
    .select({
      status: impactUpdates.status,
      dueDate: impactUpdates.dueDate,
      submittedAt: impactUpdates.submittedAt,
    })
    .from(impactUpdates)
    .where(eq(impactUpdates.campaignId, id))
    .limit(1);

  const isEditable = ['draft', 'active'].includes(campaign.status);

  return (
    <>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold text-foreground">{campaign.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={campaign.status === 'active' || campaign.status === 'last_donor_zone' ? 'default' : 'secondary'}>
              {campaignStatusLabel(campaign.status)}
            </Badge>
            <span className="capitalize text-muted-foreground">{campaign.category}</span>
            {campaign.publishedAt && (
              <span className="text-muted-foreground">Published {formatDate(campaign.publishedAt)}</span>
            )}
          </div>
        </div>
        {/*
          ⛔ Gated. This was the THIRD ungated link to `/campaigns/<slug>`
          (docs/109 found the wizard redirect and the dashboard "View"
          button). A campaign in the review queue has no public page, so
          this handed the organiser a 404 for their own campaign.
        */}
        {hasPublicPage(campaign.status) && (
          <Link
            href={`/campaigns/${campaign.slug}`}
            target="_blank"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View public page
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Raised</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-bold text-brand-teal">{centsToDollars(campaign.raisedAmount)}</p>
            <p className="text-xs text-muted-foreground">of {centsToDollars(campaign.goalAmount)} goal</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-bold text-foreground">{pct}%</p>
            <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand-teal" style={{ width: `${pct}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Donors</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-bold text-foreground">{campaign.donorCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Funds Released</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-bold text-foreground">
              {centsToDollars(campaign.totalReleasedAmount ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/*
        The whole path to being paid, before the grid of links.

        An organiser had no screen that said what was required of them -
        see `src/lib/organiser-journey.ts` for the audit and docs/110.
      */}
      <JourneyChecklist
        className="mt-6"
        facts={{
          campaignId: id,
          status: campaign.status,
          verificationStatus: campaign.verificationStatus,
          currency: campaign.currency,
        }}
      />

      {/*
        Team management. The panel fetches its own list rather than being
        handed one, so this server component issues no extra query - the page
        is already inside the three-concurrent-query ceiling (`docs/87`) and
        adding a fourth read here would have put it over.
      */}
      <div className="mt-6">
        <CampaignTeamPanel campaignId={id} />
      </div>

      {/* Quick Actions */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isEditable && (
          <Link
            href={`/dashboard/campaigns/${id}/edit`}
            className="flex items-center rounded-lg border border-border p-3 text-sm font-medium transition-colors hover:border-primary hover:bg-muted/40"
          >
            Edit Campaign
          </Link>
        )}
        <Link
          href={`/dashboard/campaigns/${id}/updates`}
          className="flex items-center rounded-lg border border-border p-3 text-sm font-medium transition-colors hover:border-primary hover:bg-muted/40"
        >
          Updates ({recentUpdates.length})
        </Link>
        <Link
          href={`/dashboard/campaigns/${id}/donors`}
          className="flex items-center rounded-lg border border-border p-3 text-sm font-medium transition-colors hover:border-primary hover:bg-muted/40"
        >
          Donors ({campaign.donorCount})
        </Link>
        <Link
          href={`/dashboard/campaigns/${id}/verification`}
          className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm font-medium transition-colors hover:border-primary hover:bg-muted/40"
        >
          Verification
          {/*
            No raw enum. This used to render `documents_uploaded` at an
            organiser, which is a database value, not a sentence. The
            checklist above says what the state means and what it blocks.
          */}
          <Badge variant="outline" className="text-xs">
            {verificationStatusLabel(campaign.verificationStatus)}
          </Badge>
        </Link>
        <Link
          href={`/dashboard/campaigns/${id}/impact-update`}
          className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm font-medium transition-colors hover:border-primary hover:bg-muted/40"
        >
          Impact Update
          {impactUpdate && (
            <Badge variant="outline" className="text-xs">{impactUpdate.status}</Badge>
          )}
        </Link>
      </div>

      {/* Two-column layout: Donors + Updates */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Recent Donors */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-foreground">Recent Donors</h2>
            <Link href={`/dashboard/campaigns/${id}/donors`} className="text-sm font-medium text-brand-teal hover:underline">
              View all
            </Link>
          </div>
          {recentDonors.length === 0 ? (
            <Card className="mt-3">
              <CardContent className="py-6 text-center">
                <p className="text-sm text-muted-foreground">No donations yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="mt-3 space-y-2">
              {recentDonors.map((d) => (
                <Card key={d.id}>
                  <CardContent className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {d.anonymous ? 'Anonymous' : d.donorName ?? 'Donor'}
                      </p>
                      {d.message && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{d.message}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold text-foreground">{centsToDollars(d.amount)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(d.createdAt)}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Recent Updates */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-foreground">Recent Updates</h2>
            <Link href={`/dashboard/campaigns/${id}/updates`} className="text-sm font-medium text-brand-teal hover:underline">
              View all
            </Link>
          </div>
          {recentUpdates.length === 0 ? (
            <Card className="mt-3">
              <CardContent className="py-6 text-center">
                <p className="text-sm text-muted-foreground">No updates posted yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="mt-3 space-y-2">
              {recentUpdates.map((upd) => (
                <Card key={upd.id}>
                  <CardContent className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{upd.title}</p>
                      <Badge variant="outline" className="mt-1 text-xs">{upd.updateType}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(upd.createdAt)}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Impact Update */}
      {impactUpdate && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-bold text-foreground">Impact Update</h2>
          <Card className="mt-3">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Status</span>
                <Badge variant="outline">{impactUpdate.status}</Badge>
              </div>
              {impactUpdate.dueDate && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Due by {new Date(impactUpdate.dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              )}
              {impactUpdate.status === 'pending' && (
                <Link
                  href={`/dashboard/campaigns/${id}/impact-update`}
                  className="mt-3 inline-block text-sm font-medium text-brand-teal hover:underline"
                >
                  Submit your impact update
                </Link>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </>
  );
}
