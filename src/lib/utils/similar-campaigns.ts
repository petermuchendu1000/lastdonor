/**
 * Re-engagement CTA engine - find similar verified campaigns for refund emails.
 *
 * Query logic (per spec Section 8.6):
 * 1. Same category as cancelled campaign → up to 3 campaigns
 * 2. If < 3 same category, fill with same location → up to 3 total
 * 3. If still < 3, fill with highest-activity verified campaigns
 * 4. Filter: ONLY fully_verified campaigns, status = active
 * 5. Sort by: fewest remaining to goal (most impactful donation)
 * 6. Exclude: simulation campaigns (simulationFlag = false)
 */

import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, ne, sql, desc } from 'drizzle-orm';
import { listedCampaignFilter } from '@/db/public-campaigns';
import type { CampaignCategory } from '@/types';

export interface SimilarCampaign {
  title: string;
  slug: string;
  raised: number;
  goal: number;
  /**
   * Each suggested campaign's OWN currency. These are other people's
   * campaigns, so one of them can be in a different currency from the one the
   * reader is being emailed about - rendering them all in the sender's
   * currency would misstate a stranger's total. `docs/125`.
   */
  currency: string;
  category: string;
  heroImageUrl: string;
}

/**
 * Find up to `limit` similar, verified, active campaigns for re-engagement.
 */
export async function findSimilarCampaigns(params: {
  excludeId: string;
  category: CampaignCategory;
  location?: string | null;
  limit?: number;
}): Promise<SimilarCampaign[]> {
  const { excludeId, category, location, limit = 3 } = params;

  const baseSelect = {
    id: campaigns.id,
    title: campaigns.title,
    slug: campaigns.slug,
    raised: campaigns.raisedAmount,
    goal: campaigns.goalAmount,
    currency: campaigns.currency,
    category: campaigns.category,
    heroImageUrl: campaigns.heroImageUrl,
    location: campaigns.location,
  };

  const baseConditions = [
    ne(campaigns.id, excludeId),
    eq(campaigns.simulationFlag, false),
    eq(campaigns.verificationStatus, 'fully_verified'),
    /*
      ⛔ A LISTING (docs/147): these rows are suggested to a donor whose
      campaign was cancelled, so the platform's own general fund must not be
      among them. The `fully_verified` requirement above happens to exclude it
      today - the fund is `unverified` - but that is a coincidence of the
      trust rule, not a decision about what a listing contains, and the
      coincidence disappears the day anybody verifies it.
    */
    listedCampaignFilter(),
  ];

  const results: SimilarCampaign[] = [];
  const seenIds = new Set<string>();

  // Step 1: Same category, sorted by closest to goal
  const sameCategoryRows = await db
    .select(baseSelect)
    .from(campaigns)
    .where(
      and(
        ...baseConditions,
        eq(campaigns.category, category),
      ),
    )
    .orderBy(sql`${campaigns.goalAmount} - ${campaigns.raisedAmount} ASC`)
    .limit(limit);

  for (const row of sameCategoryRows) {
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id);
      results.push({
        title: row.title,
        slug: row.slug,
        raised: row.raised,
        goal: row.goal,
        currency: row.currency,
        category: row.category,
        heroImageUrl: row.heroImageUrl,
      });
    }
    if (results.length >= limit) return results;
  }

  // Step 2: Same location (if provided and still need more)
  if (location && results.length < limit) {
    const sameLocationRows = await db
      .select(baseSelect)
      .from(campaigns)
      .where(
        and(
          ...baseConditions,
          eq(campaigns.location, location),
        ),
      )
      .orderBy(sql`${campaigns.goalAmount} - ${campaigns.raisedAmount} ASC`)
      .limit(limit - results.length + 3); // fetch a few extra to account for dedup

    for (const row of sameLocationRows) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        results.push({
          title: row.title,
          slug: row.slug,
          raised: row.raised,
          goal: row.goal,
          currency: row.currency,
          category: row.category,
          heroImageUrl: row.heroImageUrl,
        });
      }
      if (results.length >= limit) return results;
    }
  }

  // Step 3: Highest-activity verified campaigns (most donors)
  if (results.length < limit) {
    const highActivityRows = await db
      .select(baseSelect)
      .from(campaigns)
      .where(and(...baseConditions))
      .orderBy(desc(campaigns.donorCount))
      .limit(limit - results.length + 3);

    for (const row of highActivityRows) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        results.push({
          title: row.title,
          slug: row.slug,
          raised: row.raised,
          goal: row.goal,
          currency: row.currency,
          category: row.category,
          heroImageUrl: row.heroImageUrl,
        });
      }
      if (results.length >= limit) return results;
    }
  }

  return results;
}
