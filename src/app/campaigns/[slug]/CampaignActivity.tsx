import { db } from '@/db';
import { donations, campaignUpdates, campaignMessages, impactUpdates } from '@/db/schema';
import { publicMessageSelect } from '@/db/public-select';
import { eq, and, desc } from 'drizzle-orm';
import { CampaignUpdates } from '@/components/campaign/CampaignUpdates';
import { ImpactUpdate } from '@/components/campaign/ImpactUpdate';
import { Skeleton } from '@/components/ui/skeleton';
import { CampaignCommunityClient } from './client';
import { type DonorFeedItem } from '@/components/campaign/DonorFeed';

/**
 * Everything below a campaign's story that needs its own queries.
 *
 * ── Why this is a separate component ─────────────────────────────────
 *
 * It exists to be the child of a `<Suspense>` boundary, and it exists
 * for two reasons at once.
 *
 * **The skeleton.** `campaigns/[slug]/loading.tsx` was deleted on
 * 2026-10-18 to fix the soft 404 (docs/80): a `loading.tsx` wraps the
 * whole route in an implicit Suspense boundary, React flushes the
 * shell - and the 200 status line - before the page finishes, so
 * `notFound()` could never set a 404. A boundary placed HERE, below
 * the lookup that decides 404, does not have that problem: the status
 * is already settled by the time anything streams. That is the
 * "explicit `<Suspense>` inside the page" docs/80 said would bring the
 * skeleton back, and this is it.
 *
 * It is also better than what was lost. The old `loading.tsx` blanked
 * the entire page, hero and all. This streams the real hero, title,
 * image, totals, story and donate button immediately, and skeletons
 * only the part that is genuinely still loading.
 *
 * **The pool.** The page used to issue FIVE concurrent queries in one
 * `Promise.all` on a `max: 5` pool - the condition docs/87 ties to
 * seven production wedges, and over the cap of three that CLAUDE.md
 * states. The AST ratchet missed it because it only counted helpers
 * contributing more than one query each, so five one-query helpers
 * scored zero (fixed in the same commit). The loads below are STAGED:
 * at most two queries are in flight at any moment.
 *
 * If you add a query here, add it to an existing batch only if that
 * keeps the batch at two or fewer, or start a third batch. Do not turn
 * this back into one wide `Promise.all`.
 */

async function getUpdates(campaignId: string) {
  return db
    .select({
      id: campaignUpdates.id,
      title: campaignUpdates.title,
      bodyHtml: campaignUpdates.bodyHtml,
      imageUrl: campaignUpdates.imageUrl,
      createdAt: campaignUpdates.createdAt,
    })
    .from(campaignUpdates)
    .where(eq(campaignUpdates.campaignId, campaignId))
    .orderBy(desc(campaignUpdates.createdAt))
    .limit(50);
}

async function getImpactUpdate(campaignId: string) {
  const [row] = await db
    .select({
      title: impactUpdates.title,
      bodyHtml: impactUpdates.bodyHtml,
      photos: impactUpdates.photos,
      receiptUrls: impactUpdates.receiptUrls,
      status: impactUpdates.status,
      submittedAt: impactUpdates.submittedAt,
      reviewedAt: impactUpdates.reviewedAt,
    })
    .from(impactUpdates)
    .where(eq(impactUpdates.campaignId, campaignId))
    .limit(1);

  return row ?? null;
}

async function getRecentDonors(campaignId: string): Promise<DonorFeedItem[]> {
  const rows = await db
    .select({
      id: donations.id,
      donorName: donations.donorName,
      donorLocation: donations.donorLocation,
      amount: donations.amount,
      // Minor units of THIS row's currency (`docs/92`); the feed renders it.
      currency: donations.currency,
      message: donations.message,
      isAnonymous: donations.isAnonymous,
      createdAt: donations.createdAt,
    })
    .from(donations)
    .where(eq(donations.campaignId, campaignId))
    .orderBy(desc(donations.createdAt))
    .limit(10);

  return rows.map((r) => ({
    id: r.id,
    // Anonymity is resolved here, on the server, not in the client
    // component - the name must never reach the browser at all.
    donorName: r.isAnonymous ? 'Anonymous' : r.donorName,
    donorLocation: r.isAnonymous ? null : r.donorLocation,
    amount: r.amount,
    currency: r.currency,
    message: r.message,
    isAnonymous: r.isAnonymous,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function getMessages(campaignId: string) {
  const rows = await db
    .select(publicMessageSelect)
    .from(campaignMessages)
    .where(
      and(
        eq(campaignMessages.campaignId, campaignId),
        eq(campaignMessages.hidden, false),
      ),
    )
    .orderBy(desc(campaignMessages.createdAt))
    .limit(20);

  return rows.map((m) => ({
    id: m.id,
    donorName: m.isAnonymous ? 'Anonymous' : m.donorName,
    donorLocation: m.isAnonymous ? null : m.donorLocation,
    message: m.message,
    isAnonymous: m.isAnonymous,
    createdAt: m.createdAt.toISOString(),
  }));
}

/**
 * What the visitor sees while the queries above are in flight.
 *
 * Shaped like the content it replaces - an updates block and a
 * community block - so the page does not jump when the real thing
 * arrives. `aria-hidden` because the live region that matters is the
 * content itself; a screen reader should not read a wall of
 * placeholder boxes.
 */
export function CampaignActivitySkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  );
}

export async function CampaignActivity({
  campaignId,
  campaignSlug,
  isDonatable,
}: {
  campaignId: string;
  campaignSlug: string;
  isDonatable: boolean;
}) {
  // Batch 1 of 2. Two queries, not five.
  const [updates, impactUpdate] = await Promise.all([
    getUpdates(campaignId),
    getImpactUpdate(campaignId),
  ]);

  /*
    Batch 2 runs only for a donatable campaign, because the community
    block is the only thing that reads it - a paused or cancelled
    campaign paid for two queries it never rendered.
  */
  const [recentDonors, initialMessages] = isDonatable
    ? await Promise.all([getRecentDonors(campaignId), getMessages(campaignId)])
    : [[], []];

  const formattedUpdates = updates.map((u) => ({
    id: u.id,
    title: u.title,
    bodyHtml: u.bodyHtml,
    imageUrl: u.imageUrl,
    createdAt: u.createdAt.toISOString(),
  }));

  const formattedImpactUpdate = impactUpdate
    ? {
        title: impactUpdate.title,
        bodyHtml: impactUpdate.bodyHtml,
        photos: (impactUpdate.photos ?? []) as string[],
        receiptUrls: (impactUpdate.receiptUrls ?? []) as string[],
        status: impactUpdate.status,
        submittedAt: impactUpdate.submittedAt?.toISOString() ?? null,
        reviewedAt: impactUpdate.reviewedAt?.toISOString() ?? null,
      }
    : null;

  return (
    <>
      {/* Impact update - below the story for transparency */}
      {formattedImpactUpdate && <ImpactUpdate impactUpdate={formattedImpactUpdate} />}

      {/* Updates */}
      {formattedUpdates.length > 0 && <CampaignUpdates updates={formattedUpdates} />}

      {/* Community: donors + messages (below story, not in sidebar) */}
      {isDonatable && (
        <CampaignCommunityClient
          campaignSlug={campaignSlug}
          initialDonors={recentDonors}
          initialMessages={initialMessages}
        />
      )}
    </>
  );
}
