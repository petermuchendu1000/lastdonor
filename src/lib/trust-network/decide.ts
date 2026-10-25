/**
 * The decisions behind an institutional vouch, with no database in them.
 *
 * ── WHAT A VOUCH IS FOR ─────────────────────────────────────────────────────
 *
 * A hospital, a church, a university or a registered nonprofit says: we know
 * this family, this crisis is real. The platform then does not make that
 * family wait in the document queue. `docs/108` has the reasoning.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 * ⛔ A vouch grants exactly `identity_verified` and can never grant
 * `fully_verified`, because `fully_verified` RELEASES MONEY - the admin
 * verification route writes `total_released_amount` in the same transaction
 * that sets it. So a vouch lifts the pre-verification raise cap (`docs/101`)
 * and does nothing else. A payout still needs an administrator's own
 * decision, taken on a screen that says no document was ever uploaded.
 *
 * That boundary is the whole safety argument, so it is a constant here and a
 * test of its own (`vouch-boundary.test.ts`), not a line of prose.
 *
 * ── AND IT IS NOT THE PUBLICATION REVIEW ────────────────────────────────────
 *
 * ⛔ A vouch does NOT publish a campaign. `docs/78` and `docs/79` made "every
 * campaign is reviewed by a person before it goes live" true, and the claim
 * appears in roughly 44 lines across 23 files including the site title. A
 * vouch bypasses the VERIFICATION queue (`/admin/verification`), which is
 * what it is for; `campaigns.status` is untouched by everything in this
 * directory.
 */

/** The only status a vouch may grant. See the header. */
export const VOUCH_GRANTS_STATUS = 'identity_verified' as const;

/**
 * Statuses a vouch may be recorded over.
 *
 * `identity_verified` and `fully_verified` are absent for opposite reasons:
 * the first already has what a vouch grants, and the second has MORE, so
 * writing the grant would be a downgrade. `rejected` is absent because a
 * campaign a person refused is not something a third party overrides;
 * un-rejecting is an admin action with its own audit trail.
 */
export const VOUCHABLE_VERIFICATION_STATUSES = [
  'unverified',
  'pending',
  'documents_uploaded',
  'submitted_for_review',
  'info_requested',
] as const;

/**
 * Campaign states a vouch may be recorded against.
 *
 * `under_review` is INCLUDED: a vouched campaign still waits for a person to
 * publish it (`docs/79`), and recording the vouch while it waits is the point
 * - it is what the reviewer reads. `draft` is included because an organiser
 * may be assembling the appeal while the institution writes in.
 */
export const VOUCHABLE_CAMPAIGN_STATUSES = [
  'draft',
  'under_review',
  'active',
  'last_donor_zone',
  'paused',
] as const;

/** Rolling window the vouch budget is measured over. */
export const VOUCH_WINDOW_DAYS = 30;

export type RefusalCode =
  | 'INSTITUTION_SUSPENDED'
  | 'INSTITUTION_BUDGET_SPENT'
  | 'CAMPAIGN_STATE'
  | 'VERIFICATION_STATE'
  | 'ALREADY_VOUCHED';

export type VouchCheck =
  | { ok: true }
  | { ok: false; code: RefusalCode; message: string };

export interface InstitutionFacts {
  status: 'active' | 'suspended';
  monthlyVouchLimit: number;
  /** Vouches recorded by this institution inside the window, revoked included. */
  vouchesInWindow: number;
}

/**
 * May this institution record another vouch?
 *
 * ⚠️ The window count includes REVOKED vouches on purpose. The budget is a
 * containment limit on how much damage one compromised or careless
 * institution can do, and an attacker who could reclaim budget by revoking
 * their own vouches would have no limit at all. It is a rate of ASSERTIONS,
 * not a count of live ones.
 */
export function canInstitutionVouch(institution: InstitutionFacts): VouchCheck {
  if (institution.status !== 'active') {
    return {
      ok: false,
      code: 'INSTITUTION_SUSPENDED',
      message: 'This organisation is suspended and cannot vouch for campaigns.',
    };
  }
  if (institution.vouchesInWindow >= institution.monthlyVouchLimit) {
    return {
      ok: false,
      code: 'INSTITUTION_BUDGET_SPENT',
      message:
        `This organisation has used all ${institution.monthlyVouchLimit} of its ` +
        `vouches for the last ${VOUCH_WINDOW_DAYS} days. Raise its limit if that is right.`,
    };
  }
  return { ok: true };
}

export interface CampaignFacts {
  status: string;
  verificationStatus: string;
  /** A live vouch from THIS institution already exists. */
  alreadyVouchedByThisInstitution: boolean;
}

/** May this campaign be vouched for? */
export function canCampaignBeVouched(campaign: CampaignFacts): VouchCheck {
  if (campaign.alreadyVouchedByThisInstitution) {
    return {
      ok: false,
      code: 'ALREADY_VOUCHED',
      message: 'This organisation has already vouched for this campaign.',
    };
  }
  if (!(VOUCHABLE_CAMPAIGN_STATUSES as readonly string[]).includes(campaign.status)) {
    return {
      ok: false,
      code: 'CAMPAIGN_STATE',
      message: `A campaign that is ${campaign.status.replace(/_/g, ' ')} cannot be vouched for.`,
    };
  }
  if (
    !(VOUCHABLE_VERIFICATION_STATUSES as readonly string[]).includes(campaign.verificationStatus)
  ) {
    return {
      ok: false,
      code: 'VERIFICATION_STATE',
      message:
        campaign.verificationStatus === 'identity_verified' ||
        campaign.verificationStatus === 'fully_verified'
          ? 'This campaign is already verified, so a vouch would add nothing.'
          : `A campaign whose verification is ${campaign.verificationStatus.replace(/_/g, ' ')} cannot be vouched for.`,
    };
  }
  return { ok: true };
}

export interface RevocationFacts {
  verificationStatus: string;
  /** `campaigns.verification_source`. NULL means unknown, never "documents". */
  verificationSource: 'documents' | 'institution_vouch' | null;
  /** Live vouches from OTHER institutions, after this one is revoked. */
  otherLiveVouches: number;
}

export interface RevocationOutcome {
  /** The status to write, or null to leave the campaign alone. */
  verificationStatus: 'unverified' | null;
  verificationSource: null;
  /** Plain-language note for the audit row and the admin screen. */
  reason: string;
}

/**
 * What happens to the campaign when a vouch is revoked.
 *
 * ── THE THREE CASES, AND WHY NONE OF THEM IS THE OBVIOUS ONE ────────────────
 *
 * The obvious rule - "revoking a vouch un-verifies the campaign" - is wrong
 * in two of the three cases that actually occur:
 *
 *   1. Another institution still vouches  -> the campaign keeps its status.
 *      Revoking one of two corroborating assertions does not remove the
 *      other.
 *   2. The campaign was verified by DOCUMENTS, or by anything other than this
 *      mechanism (`verification_source` is `documents`, or NULL because the
 *      verification predates the column) -> leave it alone. Revoking a vouch
 *      must never undo a person's document review, and a NULL source is
 *      UNKNOWN, so treating it as "this vouch's doing" would strip a status
 *      this code did not grant.
 *   3. Only this vouch verified it -> back to `unverified`, which puts the
 *      campaign back under the pre-verification raise cap (`docs/101`).
 *
 * Note that nothing here ever lowers `fully_verified`. Money has been
 * released at that point, and a revoked vouch is not a reason to rewrite a
 * payout's precondition after the fact - it is a reason for an admin to look.
 */
export function outcomeOfRevocation(facts: RevocationFacts): RevocationOutcome {
  if (facts.otherLiveVouches > 0) {
    return {
      verificationStatus: null,
      verificationSource: null,
      reason: `Another organisation still vouches for this campaign, so its verification is unchanged.`,
    };
  }
  if (facts.verificationStatus !== VOUCH_GRANTS_STATUS) {
    return {
      verificationStatus: null,
      verificationSource: null,
      reason: `The campaign's verification is ${facts.verificationStatus.replace(/_/g, ' ')}, which this vouch did not set, so it is unchanged.`,
    };
  }
  if (facts.verificationSource !== 'institution_vouch') {
    return {
      verificationStatus: null,
      verificationSource: null,
      reason:
        facts.verificationSource === 'documents'
          ? 'A person checked this campaign’s documents, so its verification is unchanged.'
          : 'It is not recorded that this vouch set the verification, so it is unchanged.',
    };
  }
  return {
    verificationStatus: 'unverified',
    verificationSource: null,
    reason: 'This was the only thing verifying the campaign, so it is unverified again and back under its raise cap.',
  };
}
