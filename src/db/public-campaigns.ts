import { and, eq, inArray, isNotNull, notInArray, or, type SQL } from 'drizzle-orm';
import { campaigns } from '@/db/schema';
import { GENERAL_FUND_CAMPAIGN_ID } from '@/lib/constants';
import { COMPLETED_STATUSES } from '@/lib/campaign-visibility';

/**
 * Which campaigns a PUBLIC LISTING may show.
 *
 * ── ⛔ ELIGIBILITY AND LISTING ARE DIFFERENT QUESTIONS ──────────────────────
 *
 * Before this module there was one predicate for both:
 * `or(eq(status,'active'), eq(status,'last_donor_zone'))`, rebuilt by hand in
 * eight places. It answers *"may this campaign take money"*, and eight
 * surfaces were using it to answer *"should this campaign appear in a list of
 * appeals"*.
 *
 * Those came apart the moment the platform's own **general fund** had to
 * exist. `/donate` collects into a real `campaigns` row - that is what the
 * donations FK, the composite `(campaign_id, currency)` FK (`docs/92`), the
 * raise cap (`docs/101`) and `payhero_payment_requests` are all keyed on - and
 * `payhero/initiate/route.ts:99-119` will only accept a campaign that is
 * `active` or `last_donor_zone`. So the fund must hold a listed status to
 * collect at all, and would then appear:
 *
 *   - as a card on the homepage grid, in the top six by amount raised
 *   - in `/campaigns`, counted in its "Active N" figure
 *   - on its category page, in search, in the blog link graph
 *   - as the newsletter's featured campaign
 *   - in `sitemap.xml`, which filters on STATUS ALONE - so with
 *     `published_at` NULL it would advertise a URL that 404s (`docs/131`)
 *
 * The platform's own fund is not an appeal for a named person, and this site
 * tells donors every listed campaign was read by a person before going live.
 * A card for "General Fund" among fourteen families is a claim-adjacent
 * defect, not a cosmetic one.
 *
 * ⛔ **So this is a filter, not an exclusion list bolted onto each query.**
 * A per-site `ne(id, …)` is the shape this codebase has found broken four
 * times - `docs/119` (`_hasCampaigns`), `docs/124` (the scrub list),
 * `docs/144` (`TOP_CATEGORIES`), `docs/146` (the completed pair) - always for
 * the same reason: a hand-maintained list is only as good as whoever
 * remembered to extend it. `public-campaigns.ratchet.test.ts` discovers every
 * public surface that filters `campaigns.status` and requires it to use this
 * module or to be named as an ELIGIBILITY site.
 *
 * ⚠️ The eligibility sites keep the raw pair deliberately, and that is not an
 * oversight to tidy up later. `create-checkout`, `create-intent`,
 * `payhero/initiate`, `/campaigns/[slug]` and its donate page, its og card
 * and its message route all ask about ONE campaign the caller already named.
 * Putting this filter there would make the general fund unable to take the
 * donation `/donate` exists to collect.
 */

/**
 * The statuses a public listing shows.
 *
 * ⚠️ NOT the same list as `PUBLICLY_VIEWABLE_STATUSES` in
 * `src/lib/campaign-visibility.ts`, which is wider on purpose: a `suspended`
 * or `archived` campaign still SERVES a page so a donor following an old link
 * is told what happened (`docs/118` §9), and is still not something to put in
 * front of a new visitor.
 */
export const LISTED_CAMPAIGN_STATUSES = ['active', 'last_donor_zone'] as const;

/**
 * Campaigns that can take money but are never listed as appeals.
 *
 * One entry today. It is an array rather than a single id because the next
 * one - a disaster relief pool, a matching fund - would otherwise be added as
 * a second `ne(…)` beside this one at every call site, which is the defect
 * this module exists to prevent.
 */
export const PLATFORM_FUND_CAMPAIGN_IDS: readonly string[] = [
  GENERAL_FUND_CAMPAIGN_ID,
];

/** Is this campaign the platform's own fund rather than somebody's appeal? */
export function isPlatformFund(campaignId: string): boolean {
  return PLATFORM_FUND_CAMPAIGN_IDS.includes(campaignId);
}

/**
 * The one predicate a public listing filters campaigns by.
 *
 * Combine it with the surface's own conditions:
 *
 *   .where(and(listedCampaignFilter(), eq(campaigns.category, category)))
 *
 * ⚠️ It is a FUNCTION, not a constant. A drizzle `SQL` object is built from
 * its operands, and sharing one instance across concurrent queries is a
 * subtlety nobody should have to think about at a call site.
 */
export function listedCampaignFilter(): SQL {
  return and(
    or(
      eq(campaigns.status, 'active'),
      eq(campaigns.status, 'last_donor_zone'),
    )!,
    excludePlatformFunds(),
  )!;
}

/**
 * "This row is the platform's own fund, not an appeal", on its own.
 *
 * ⛔ THIS IS THE PIECE `listedCampaignFilter()` USED TO HIDE, and hiding it
 * cost a surface. That function bundles two decisions - *is this taking
 * money* (status) and *is this somebody's appeal* (id) - so a listing that
 * needs a DIFFERENT status set cannot reuse it, and `/completed-campaigns`
 * therefore filtered on `COMPLETED_STATUSES` alone and lost the fund
 * exclusion in silence. `docs/165`.
 *
 * ⚠️ `docs/147` enumerated nine listing surfaces and this was a tenth,
 * because its sweep looks for files naming the RAW ACTIVE STATUS and a page
 * filtering on `completed` names nothing it searches for.
 */
export function excludePlatformFunds(): SQL {
  return notInArray(campaigns.id, [...PLATFORM_FUND_CAMPAIGN_IDS]) as SQL;
}

/**
 * The one predicate a public COMPLETED listing - or its count - filters by.
 *
 * ⛔ Used by BOTH, and that is not tidiness: `docs/146`'s invariant is that
 * *the predicate that COUNTS a group must be the predicate that LISTS it*,
 * because a count rendered as a link is a promise about what is behind the
 * link. Excluding the fund from the listing alone would have made the
 * `/campaigns` tab read "Completed 1" over an empty page, which is the exact
 * defect `docs/146` was reported for.
 *
 * ⚠️ `isNotNull(publishedAt)` is here because a card in a public listing is a
 * LINK, and `docs/131` made `published_at` the record of approval that the
 * public page requires - so a row without it is a card whose href 404s.
 * [VERIFIED by execution: the fund, seeded `completed` with `published_at`
 * NULL as production holds it, rendered a card on `?sort=newest` whose href
 * answered 404 against a real completed campaign's 200.] The two predicates
 * answer different questions and both belong to "would a visitor be able to
 * open this?", which is what a public listing and its count both mean.
 */
export function completedCampaignFilter(): SQL {
  return and(
    inArray(campaigns.status, [...COMPLETED_STATUSES]),
    excludePlatformFunds(),
    isNotNull(campaigns.publishedAt),
  )!;
}
