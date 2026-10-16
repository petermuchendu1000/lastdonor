/**
 * "Your impact" - what a sharer's links actually brought in.
 *
 * Built against GoFundMe's own specification rather than from imagination.
 * Their help-centre article "See your impact with unique share links"
 * (id 24972788571803, edited 2026-10-07, VERIFIED) describes the surface we
 * are matching:
 *
 *   - "your overall impact from all fundraisers you've donated to", AND
 *     "the impact you've had on individual fundraisers"  -> two levels
 *   - "the names and amounts of those you've inspired to donate"
 *     -> names and money, not a bare count
 *   - "anyone who chooses to donate as 'Anonymous' will also be 'Anonymous'
 *     on your impact dashboard"                          -> anonymity holds
 *
 * Where we go further, and why it is honest rather than decorative: we
 * already count link visits, so a sharer can see clicks AND donors. Their
 * article never mentions clicks. The difference matters to someone deciding
 * what to do next - a link nobody opened is a distribution problem, a link
 * opened fifty times with no donation is a campaign problem, and a bare
 * donor count cannot tell those apart.
 *
 * See `docs/58`.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaignShareLinks, campaigns, donations } from '@/db/schema';

/** Totals across every campaign this person has shared. */
export interface ImpactSummary {
  /** Donations that arrived through this person's links. */
  donorsBrought: number;
  /** Cents raised through them. Refunded donations are excluded. */
  amountBroughtCents: number;
  /** Campaigns they hold at least one link for. */
  campaignsShared: number;
  /** Visits across all their links. Visits, not unique visitors. */
  clicks: number;
}

export interface ImpactByCampaign {
  campaignId: string;
  campaignTitle: string;
  campaignSlug: string;
  token: string;
  clicks: number;
  donorsBrought: number;
  amountBroughtCents: number;
}

export interface AttributedDonor {
  /** Already resolved for anonymity: literally 'Anonymous' when hidden. */
  donorName: string;
  amountCents: number;
  createdAt: Date;
  campaignTitle: string;
  campaignSlug: string;
}

/**
 * Refunded donations are excluded everywhere in this module.
 *
 * A sharer should not be shown credit for money that went back. docs/41
 * made refund accounting single-writer precisely so `refunded` can be
 * trusted as the answer to "did this money stay".
 */
const COUNTS_AS_IMPACT = sql`${donations.refunded} = false`;

export async function getImpactSummary(userId: string): Promise<ImpactSummary> {
  /*
    Donations are folded to one row per link BEFORE the join, not aggregated
    across it.

    Joining links to donations directly and summing would be wrong in two
    ways at once, and both were in the first draft of this file:

      - `sum(clickCount)` over the joined rows multiplies each link's visits
        by its donation count (a link with 4 visits and 3 donations reports
        12 visits);
      - `sum(distinct clickCount)` - the attempted fix - is worse, because
        DISTINCT deduplicates the VALUES, so two links with 3 visits each
        report 3 rather than 6.

    Verified against the live database on 2026-10-16 inside BEGIN/ROLLBACK;
    see docs/58 for the fixture and the numbers each form produced.
  */
  const perLink = db
    .select({
      shareLinkId: donations.shareLinkId,
      donors: sql<number>`count(*)`.as('donors'),
      cents: sql<number>`sum(${donations.amount})`.as('cents'),
    })
    .from(donations)
    .where(COUNTS_AS_IMPACT)
    .groupBy(donations.shareLinkId)
    .as('per_link');

  const rows = await db
    .select({
      donorsBrought: sql<number>`coalesce(sum(${perLink.donors}), 0)::int`,
      amountBroughtCents: sql<number>`coalesce(sum(${perLink.cents}), 0)::int`,
      campaignsShared: sql<number>`count(distinct ${campaignShareLinks.campaignId})::int`,
      clicks: sql<number>`coalesce(sum(${campaignShareLinks.clickCount}), 0)::int`,
    })
    .from(campaignShareLinks)
    .leftJoin(perLink, eq(perLink.shareLinkId, campaignShareLinks.id))
    .where(eq(campaignShareLinks.userId, userId));

  return rows[0] ?? {
    donorsBrought: 0,
    amountBroughtCents: 0,
    campaignsShared: 0,
    clicks: 0,
  };
}

export async function getImpactByCampaign(userId: string): Promise<ImpactByCampaign[]> {
  return db
    .select({
      campaignId: campaignShareLinks.campaignId,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
      token: campaignShareLinks.token,
      clicks: campaignShareLinks.clickCount,
      donorsBrought: sql<number>`count(${donations.id})::int`,
      amountBroughtCents: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
    })
    .from(campaignShareLinks)
    .innerJoin(campaigns, eq(campaigns.id, campaignShareLinks.campaignId))
    .leftJoin(
      donations,
      and(eq(donations.shareLinkId, campaignShareLinks.id), COUNTS_AS_IMPACT),
    )
    .where(eq(campaignShareLinks.userId, userId))
    .groupBy(
      campaignShareLinks.campaignId,
      campaigns.title,
      campaigns.slug,
      campaignShareLinks.token,
      campaignShareLinks.clickCount,
    )
    .orderBy(desc(sql`count(${donations.id})`));
}

/**
 * The people a sharer brought in.
 *
 * `isAnonymous` is resolved in SQL rather than in the component, so there is
 * exactly one place a donor's wish to stay unnamed can be honoured or
 * broken. A caller cannot accidentally render the real name by reaching for
 * the wrong field, because the real name never leaves this function.
 */
export async function getAttributedDonors(
  userId: string,
  limit = 50,
): Promise<AttributedDonor[]> {
  return db
    .select({
      donorName: sql<string>`case when ${donations.isAnonymous} then 'Anonymous' else ${donations.donorName} end`,
      amountCents: donations.amount,
      createdAt: donations.createdAt,
      campaignTitle: campaigns.title,
      campaignSlug: campaigns.slug,
    })
    .from(donations)
    .innerJoin(campaignShareLinks, eq(donations.shareLinkId, campaignShareLinks.id))
    .innerJoin(campaigns, eq(campaigns.id, donations.campaignId))
    .where(and(eq(campaignShareLinks.userId, userId), COUNTS_AS_IMPACT))
    .orderBy(desc(donations.createdAt))
    .limit(limit);
}
