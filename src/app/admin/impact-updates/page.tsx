import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { impactUpdates, campaigns } from '@/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { ImpactUpdateQueue, type ImpactUpdateRow } from '@/components/admin/ImpactUpdateQueue';
import { IMPACT_UPDATE_STATUS_LABEL as STATUS_LABEL } from '@/lib/impact-update-labels';
import { REPORTING_TIMEZONE, reportingTimezoneLabel } from '@/lib/reporting-timezone';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Impact Updates - Admin - LastDonor.org',
  robots: { index: false },
};

const CAP = 200;

/*
  ─────────────────────────────────────────────────────────────────────────
  THE ADMIN QUEUE FOR IMPACT UPDATES.                             docs/139
  ─────────────────────────────────────────────────────────────────────────

  Two API routes for this existed and had zero callers, so an organiser
  could submit a report on how a family's money was spent and no admin had
  any way to see it. This is the door.

  ⚠️ Gated here, and the sidebar group it sits in (`Trust & Verification`)
  is already `adminOnly` - both halves, because `docs/132` found the two
  drifting in opposite directions and its ratchet fails the build either
  way. Hiding a link is not access control; a group of admin-only pages
  that is not flagged offers links that bounce.

  ⚠️ Two queries, plus the layout's `auth()` - at the `docs/87` cap of
  three, not over it. The tiles come from a `GROUP BY`, which is what
  `docs/88` F8 did rather than tallying a capped list in JS and reporting a
  total that disagrees with it.
*/
export default async function AdminImpactUpdatesPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    redirect('/admin');
  }

  const rows = await db
    .select({
      id: impactUpdates.id,
      campaignId: impactUpdates.campaignId,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      campaignStatus: campaigns.status,
      campaignPublishedAt: campaigns.publishedAt,
      title: impactUpdates.title,
      status: impactUpdates.status,
      submittedAt: impactUpdates.submittedAt,
      reviewedAt: impactUpdates.reviewedAt,
    })
    .from(impactUpdates)
    .innerJoin(campaigns, eq(impactUpdates.campaignId, campaigns.id))
    .orderBy(desc(impactUpdates.submittedAt), desc(impactUpdates.createdAt))
    .limit(CAP);

  const tiles = await db
    .select({ status: impactUpdates.status, n: sql<number>`count(*)::int` })
    .from(impactUpdates)
    .groupBy(impactUpdates.status);

  const total = tiles.reduce((sum, t) => sum + t.n, 0);
  const waiting = tiles.find((t) => t.status === 'submitted')?.n ?? 0;

  const serialised: ImpactUpdateRow[] = rows.map((r) => ({
    ...r,
    campaignPublishedAt: r.campaignPublishedAt ? r.campaignPublishedAt.toISOString() : null,
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Impact Updates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An organiser sends one of these to show the people who gave how the
          money was used. Approving it publishes it on the campaign. Either way
          the organiser is told what you decided.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/*
          One label scheme, not two. The tiles used to pass a written-out
          label for the first and the RAW status for the rest, under a
          `capitalize` class meant for the raw ones - so the written label
          rendered as "Waiting For A Review". `docs/139`.
        */}
        <Tile label={STATUS_LABEL.submitted} value={waiting} />
        {tiles
          .filter((t) => t.status !== 'submitted')
          .map((t) => (
            <Tile key={t.status} label={STATUS_LABEL[t.status] ?? t.status} value={t.n} />
          ))}
      </div>

      {/*
        The zone is resolved HERE, on the server, and passed down -
        `REPORTING_TIMEZONE` reads `process.env`, which is undefined in a
        client bundle (docs/139).
      */}
      <ImpactUpdateQueue
        rows={serialised}
        total={total}
        loaded={rows.length}
        timeZone={REPORTING_TIMEZONE}
        timeZoneLabel={reportingTimezoneLabel()}
      />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
