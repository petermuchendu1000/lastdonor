/**
 * What a donor is told about an institutional vouch (`docs/108`).
 *
 * ── WHY THE DONOR IS TOLD AT ALL ────────────────────────────────────────────
 *
 * Before a vouch, `/campaigns/[slug]` shows an amber banner: "We have not
 * checked this organiser's ID yet. This campaign can raise up to X until we
 * do." After a vouch, that banner disappears, because the cap is gone.
 *
 * Saying nothing in its place would not be a false claim, but it would let a
 * donor assume the usual check happened. It did not: a hospital's word did.
 * CLAUDE.md's rule is that trust copy is a factual assertion, so the honest
 * replacement is the fact itself, with the organisation named - which is also
 * the thing a donor most wants to know.
 *
 * ⛔ The copy must never say "verified by LastDonor" or imply a document was
 * seen. `src/components/campaigns/TrustBadge.tsx` carries the wording and a
 * test pins it.
 *
 * ── AND WHY THIS COSTS NOTHING FOR EVERY OTHER CAMPAIGN ─────────────────────
 *
 * `/campaigns/[slug]` is the hottest public page and its query budget is
 * spent (docs/87): three sequential reads, deliberately not a `Promise.all`.
 * So the caller runs this ONLY when `campaigns.verification_source` is
 * already `institution_vouch` - a column it has in hand - which means no
 * campaign that was not vouched for pays for this at all.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { institutionVouches, trustedInstitutions } from '@/db/schema';

export interface VouchDisclosure {
  institutionName: string;
  institutionKind: string;
  institutionCountry: string;
  /** Null when the organisation has no website on file. */
  institutionWebsite: string | null;
}

/**
 * The organisations with a LIVE vouch for this campaign.
 *
 * A revoked vouch is deliberately absent: it is history for an admin, not a
 * reason for a donor to trust anything now.
 */
export async function getVouchDisclosure(campaignId: string): Promise<VouchDisclosure[]> {
  return db
    .select({
      institutionName: trustedInstitutions.name,
      institutionKind: trustedInstitutions.kind,
      institutionCountry: trustedInstitutions.country,
      institutionWebsite: trustedInstitutions.website,
    })
    .from(institutionVouches)
    .innerJoin(trustedInstitutions, eq(trustedInstitutions.id, institutionVouches.institutionId))
    .where(
      and(
        eq(institutionVouches.campaignId, campaignId),
        isNull(institutionVouches.revokedAt),
      ),
    )
    .orderBy(trustedInstitutions.name)
    .limit(5);
}
