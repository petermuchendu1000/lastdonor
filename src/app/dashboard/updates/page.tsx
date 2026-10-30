import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { donations, campaigns, campaignUpdates } from '@/db/schema';
import { eq, desc, sql, and, or } from 'drizzle-orm';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/dates';
import type { Metadata } from 'next';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { publicCampaignPath } from '@/lib/campaign-links';

export const metadata: Metadata = {
  title: 'Campaign Updates - Dashboard - LastDonor.org',
  robots: { index: false },
};

export default async function DashboardUpdatesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/dashboard/updates');

  // Get updates from all campaigns user has donated to
  const userEmail = session.user.email ?? '';
  const donorMatch = or(eq(donations.userId, session.user.id), eq(donations.donorEmail, userEmail))!;

  const campaignIdSubquery = db
    .selectDistinct({ id: campaigns.id })
    .from(campaigns)
    .innerJoin(donations, eq(donations.campaignId, campaigns.id))
    .where(
      and(
        donorMatch,
        eq(donations.source, 'real'),
        eq(donations.refunded, false),
      ),
    );

  const updates = await db
    .select({
      id: campaignUpdates.id,
      title: campaignUpdates.title,
      bodyHtml: campaignUpdates.bodyHtml,
      updateType: campaignUpdates.updateType,
      createdAt: campaignUpdates.createdAt,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      /*
        Selected ONLY to gate the link below. An update you are reading arrived
        from a campaign you gave to, and that campaign can be archived or
        reverted to draft afterwards (`docs/118` §2.5) - the update survives in
        this list while its page stops being served. Added to a select that
        already runs (`docs/87`). `docs/154`.
      */
      campaignStatus: campaigns.status,
      campaignPublishedAt: campaigns.publishedAt,
    })
    .from(campaignUpdates)
    .innerJoin(campaigns, eq(campaignUpdates.campaignId, campaigns.id))
    .where(sql`${campaignUpdates.campaignId} IN (${campaignIdSubquery})`)
    .orderBy(desc(campaignUpdates.createdAt))
    .limit(50);

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-foreground">Campaign Updates</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Updates from campaigns you&apos;ve supported
      </p>

      {updates.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No updates yet. Donate to a campaign to see updates here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {updates.map((upd) => {
            const publicHref = publicCampaignPath({
              slug: upd.campaignSlug,
              status: upd.campaignStatus,
              publishedAt: upd.campaignPublishedAt,
            });
            return (
            <Card key={upd.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{upd.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {publicHref ? (
                        <Link
                          href={publicHref}
                          className="text-sm text-brand-teal hover:underline"
                        >
                          {upd.campaignTitle}
                        </Link>
                      ) : (
                        <span className="text-sm text-foreground">{upd.campaignTitle}</span>
                      )}
                      <Badge variant="outline" className="text-xs">{upd.updateType}</Badge>
                    </div>
                    {upd.bodyHtml && (
                      <div
                        className="prose prose-sm mt-3 max-w-none text-muted-foreground line-clamp-3 dark:prose-invert"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(upd.bodyHtml) }}
                      />
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(upd.createdAt)}
                  </span>
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
