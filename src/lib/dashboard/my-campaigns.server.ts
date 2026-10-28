import 'server-only';

import { and, desc, eq, exists, isNotNull, isNull, or } from 'drizzle-orm';

import { db } from '@/db';
import { campaignCollaborators, campaigns } from '@/db/schema';

/**
 * The campaigns a person can act on: the ones they started, AND the ones they
 * were invited to help with.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `/dashboard/campaigns` selected `where(eq(campaigns.creatorId, userId))` and
 * nothing else. A collaborator is not the creator, so after accepting an
 * invitation they were sent to that page and it said:
 *
 *     "You haven't created any campaigns yet. Start one now"
 *
 * [VERIFIED 2026-10-27 in a browser, three ways at the same moment] the
 * `campaign_collaborators` row read `accepted_at` set and `revoked_at` null;
 * `GET /api/v1/user-campaigns/<id>` answered 200 for that session; and a
 * sweep of ALL TWELVE signed-in dashboard routes found the campaign named on
 * NONE of them. The grant was real and entirely invisible. `docs/111` §5a
 * recorded the gap; this closes it.
 *
 * ── ⛔ WHY THIS IS *NOT* IN `src/lib/collaborators/` ─────────────────────────
 *
 * It was, and `collaborator-boundary.test.ts` rejected it:
 *
 *     my-campaigns.server.ts refers to `raisedAmount`
 *
 * That directory is SEALED - it may name no money, payout or verification
 * column at all, so that nothing inside the capability layer can grow into
 * ownership (`docs/111` §1). This module has to select `raisedAmount`,
 * `goalAmount` and `verificationStatus`, because it feeds a dashboard row
 * that renders them.
 *
 * The allowlist was NOT widened to let it through - that is exactly what
 * `docs/108` and `docs/111` forbid, and the seal is worth more than the
 * convenience. A read-only query for a SCREEN is not a capability, so it
 * lives with the other dashboard queries instead. The sealed directory still
 * owns the authorisation question (`canCollaborate`), and this module calls
 * no part of it.
 *
 * ── WHY ONE QUERY, AND WHY `exists` RATHER THAN A JOIN ──────────────────────
 *
 * ⚠️ Every route is capped at THREE concurrent database queries
 * (`src/db/pool-fanout.ratchet.test.ts`, pool `max: 5`, `docs/87`), and this
 * page already spends one. So membership is folded into the same statement
 * rather than fetched separately.
 *
 * ⛔ A `leftJoin` would have been the obvious shape and is WRONG here: the
 * partial unique index is on `(campaign_id, invited_email)` while live, so one
 * person who accepted two invitations sent to two different addresses of
 * theirs has TWO live rows on one campaign - and a join would then list that
 * campaign twice. `exists` cannot duplicate a row however many match.
 *
 * ⚠️ The role is computed in JS from `creatorId`, deliberately, so this module
 * contains no `sql` template at all. `docs/101`: interpolating a Column into
 * one renders it UNQUALIFIED, and inside a correlated subquery both sides then
 * resolve to the inner table and the predicate is silently never true. Typed
 * builders carry their qualification; the integration test runs the query
 * against real Postgres because that is the only thing that catches it.
 */

/**
 * Does this person have ANY campaign - created or helping with?
 *
 * ⛔ Deliberately the SAME predicate as `listMyCampaigns`, so the navigation
 * entry that opens that list cannot disagree with the list's own contents.
 * `dashboard/layout.tsx` used `where(eq(campaigns.creatorId, userId))`, which
 * is creator-only - so a pure collaborator had `hasCampaigns === false` and no
 * door to a list that `docs/117` had just taught to include them. `docs/119`.
 *
 * ⚠️ Still exactly ONE query, replacing the one the layout already ran
 * (`docs/87`, pool `max: 5`). `limit(1)` rather than `count(*)`: the question
 * is existence, and the planner can stop at the first row.
 */
export async function hasAnyCampaign(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(or(eq(campaigns.creatorId, userId), liveMembership(userId)))
    .limit(1);
  return rows.length > 0;
}

/** What this person is to a campaign. Never both - creator wins. */
export type CampaignRole = 'creator' | 'collaborator';

export interface MyCampaignRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  /** `docs/131`: the row's "View" button needs this, not just the status. */
  publishedAt: Date | null;
  category: string;
  goalAmount: number;
  raisedAmount: number;
  donorCount: number;
  heroImageUrl: string | null;
  verificationStatus: string;
  currency: string;
  createdAt: Date;
  /** `creator` for one they started, `collaborator` for one they help with. */
  role: CampaignRole;
}

/**
 * A live, accepted membership for this user on this campaign.
 *
 * Both predicates are required and neither is redundant - the same pair
 * `canCollaborate` uses. A PENDING invitation grants nothing (its `user_id` is
 * null until acceptance), and revocation takes effect immediately.
 */
function liveMembership(userId: string) {
  return exists(
    db
      .select({ id: campaignCollaborators.id })
      .from(campaignCollaborators)
      .where(
        and(
          eq(campaignCollaborators.campaignId, campaigns.id),
          eq(campaignCollaborators.userId, userId),
          isNotNull(campaignCollaborators.acceptedAt),
          isNull(campaignCollaborators.revokedAt),
        ),
      ),
  );
}

/** Campaigns this user created or helps with, newest first. */
export async function listMyCampaigns(userId: string): Promise<MyCampaignRow[]> {
  const rows = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      /*
        `docs/131`: the row's "View" button is gated on `hasPublicPage`, which
        needs the publication date - the status alone served campaigns a person
        had never approved. Same round trip, no extra query (`docs/87`).
      */
      publishedAt: campaigns.publishedAt,
      category: campaigns.category,
      goalAmount: campaigns.goalAmount,
      raisedAmount: campaigns.raisedAmount,
      donorCount: campaigns.donorCount,
      heroImageUrl: campaigns.heroImageUrl,
      verificationStatus: campaigns.verificationStatus,
      currency: campaigns.currency,
      createdAt: campaigns.createdAt,
      creatorId: campaigns.creatorId,
    })
    .from(campaigns)
    .where(or(eq(campaigns.creatorId, userId), liveMembership(userId)))
    .orderBy(desc(campaigns.createdAt));

  return rows.map(({ creatorId, ...c }) => ({
    ...c,
    status: String(c.status),
    category: String(c.category),
    verificationStatus: String(c.verificationStatus),
    role: creatorId === userId ? ('creator' as const) : ('collaborator' as const),
  }));
}

/**
 * What one person may do with one campaign, for a SCREEN to render from.
 *
 * ⛔ This is not an authorisation decision and must not be used as one. The
 * API routes keep their own checks - `canCollaborate` for the two delegated
 * surfaces, a bare `creatorId` comparison for everything in
 * `NEVER_DELEGATED`. This exists so a page can stop showing a collaborator
 * controls that would 403, and stop hiding the campaign they genuinely hold.
 *
 * Returns null when the person has no relationship to the campaign at all.
 */
export async function resolveCampaignRole(
  campaignId: string,
  userId: string,
): Promise<{ role: CampaignRole; creatorId: string | null } | null> {
  const [row] = await db
    .select({ creatorId: campaigns.creatorId, member: liveMembership(userId) })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!row) return null;
  if (row.creatorId === userId) return { role: 'creator', creatorId: row.creatorId };
  if (row.member) return { role: 'collaborator', creatorId: row.creatorId };
  return null;
}
