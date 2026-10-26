/**
 * Who may send a campaign's money to an institution, and what that decision
 * is NOT allowed to do (`docs/113` §11).
 *
 * ── THE ONE-LINE SAFETY ARGUMENT ────────────────────────────────────────────
 *
 * A designation names a DESTINATION. It grants no verification, releases no
 * money, publishes nothing and lifts no cap. The only thing it changes about
 * money is **negative**: it takes away the organiser's ability to withdraw,
 * because the donor was told the money does not pass through their account.
 *
 * That asymmetry is the whole design. Every other feature in this codebase
 * that touches money had to argue it was safe to ADD a capability
 * (`docs/108` vouches, `docs/111` collaborators). This one only removes one,
 * which is why it can exist before a disbursement rail does.
 *
 * ⛔ Nothing here may begin to grant something. If a change needs a
 * designation to verify, publish, release or raise a cap, that reopens
 * `docs/113` §11.1 - do not widen a list to let it through.
 *
 * ── NO DATABASE IN THIS FILE ────────────────────────────────────────────────
 *
 * Same reason as `src/lib/trust-network/decide.ts` and
 * `src/lib/verification-reminders.ts` (`docs/107`): a rule a test cannot
 * execute is a rule nobody has checked. Callers read rows and pass plain
 * values in.
 */

/**
 * What a designation NEVER does, stated as data so a test can read it.
 *
 * ⚠️ This is the `docs/111` `NEVER_DELEGATED` shape, and the same warning
 * applies: it is not documentation. Moving an entry out of this list reopens
 * the decision.
 */
export const NEVER_GRANTED = [
  'verify_identity',
  'verify_fully',
  'publish_campaign',
  'release_funds',
  'lift_raise_cap',
  'bypass_review',
] as const;

export type NeverGranted = (typeof NEVER_GRANTED)[number];

/**
 * Campaign statuses in which an organiser may choose a destination.
 *
 * `under_review` is included deliberately: the wizard asks during creation
 * (`docs/113` §11, screen B1) and after `docs/78`/`docs/79` everything a
 * person submits sits in that state. Excluding it would make the screen
 * unreachable for every campaign on the platform - the `docs/83` failure,
 * where a surface stopped being reachable because of work in another file.
 */
export const DESIGNATABLE_CAMPAIGN_STATUSES = [
  'draft',
  'under_review',
  'active',
  'paused',
  'last_donor_zone',
] as const;

/** Terminal or punitive states. Choosing a destination here is meaningless. */
export type DesignationRefusal =
  | 'campaign_status_forbids'
  | 'already_designated'
  | 'locked_money_already_sent'
  | 'currency_mismatch'
  | 'account_not_active'
  | 'institution_not_active';

export interface DesignationInput {
  campaignStatus: string;
  campaignCurrency: string;
  /** An existing ACTIVE designation on this campaign, if any. */
  existing: { lockedAt: Date | null } | null;
  account: {
    currency: string;
    status: 'active' | 'retired';
    institutionStatus: 'active' | 'suspended';
  };
}

export type DesignationDecision =
  | { allowed: true }
  | { allowed: false; reason: DesignationRefusal };

/**
 * May this campaign be pointed at this payout account?
 *
 * Order matters for the message the organiser reads: the lock is reported
 * ahead of "already designated", because "you cannot change this now" is a
 * different sentence from "you already chose".
 */
export function decideDesignation(input: DesignationInput): DesignationDecision {
  if (input.existing?.lockedAt) {
    return { allowed: false, reason: 'locked_money_already_sent' };
  }
  if (input.existing) {
    return { allowed: false, reason: 'already_designated' };
  }
  if (!(DESIGNATABLE_CAMPAIGN_STATUSES as readonly string[]).includes(input.campaignStatus)) {
    return { allowed: false, reason: 'campaign_status_forbids' };
  }
  if (input.account.institutionStatus !== 'active') {
    return { allowed: false, reason: 'institution_not_active' };
  }
  if (input.account.status !== 'active') {
    return { allowed: false, reason: 'account_not_active' };
  }
  /*
    A campaign has exactly one currency (`docs/92`) and two currencies are
    never added together. Sending a KES ledger to a USD account would
    reinterpret the integer, which is the ~130x class of bug the PayHero
    guards exist for. The composite FK in the schema makes this unstorable;
    this check is what produces a readable refusal instead of a 500.
  */
  if (input.account.currency !== input.campaignCurrency) {
    return { allowed: false, reason: 'currency_mismatch' };
  }
  return { allowed: true };
}

/**
 * May the ORGANISER withdraw this campaign's money to their own account?
 *
 * ⛔ This is the invariant the donor-facing claim rests on. `docs/113` §11.3
 * puts *"It does not pass through the family's own account"* on the campaign
 * page. If the withdrawal route still paid the caller, that sentence would be
 * false in the one direction that costs a family their money.
 *
 * Returns the refusal reason, or `null` when withdrawal may proceed. A null
 * designation - the overwhelmingly common case, and every campaign today -
 * returns `null`, so this is inert until somebody designates.
 */
export function organiserWithdrawalBlockedBy(
  designation: { status: string; revokedAt: Date | null } | null,
): 'designated_to_institution' | null {
  if (!designation) return null;
  if (designation.revokedAt) return null;
  if (designation.status !== 'active') return null;
  return 'designated_to_institution';
}

/**
 * Once money has gone to the institution, the destination is fixed.
 *
 * Before any payment leaves, a wrong choice is an edit. After, changing it
 * would mean the campaign's money went to two places while the page claimed
 * one - and we cannot pull the first payment back (`docs/113` §11.1 #6).
 */
export function isDesignationLocked(designation: { lockedAt: Date | null } | null): boolean {
  return Boolean(designation?.lockedAt);
}
