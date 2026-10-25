import type { BeneficiaryRelation } from '@/lib/validators/user-campaign';

/**
 * What an organiser agreed to when they submitted, and when.
 *
 * ## The defect this exists for
 *
 * **[VERIFIED 2026-10-25]** The wizard shows a clickwrap notice - *"By
 * submitting this campaign you agree to LastDonor's Terms of Service and
 * Privacy Policy, and confirm that the information you've provided is
 * accurate"* - and, when the campaign is for somebody else, a second line
 * confirming that person knows about it.
 *
 * The agreement was real. **The record was not.** The client posted
 * `agreedToTerms: true`, `confirmedTruthful: true` and
 * `beneficiaryConsent: true` as hard-coded literals, the validator demanded
 * `z.literal(true)` - a gate that can never fail, because the client is what
 * sets it - and `POST /api/v1/user-campaigns` persisted **none of them**.
 * There was no column for any of it.
 *
 * So the platform could not show, for any campaign, that its organiser
 * accepted the terms, when, or which terms. For a platform that has now
 * decided to act as a payment intermediary (`docs/113`), that is the exact
 * record it would be asked for.
 *
 * ## Timestamps, not booleans
 *
 * `docs/41` settled this for mail consent and `docs/82` followed it for SMS:
 * a consent is **when it was given**, not whether. A boolean cannot answer
 * "before or after we changed the terms", and that is the only question that
 * ever matters afterwards.
 *
 * ## ⛔ The server stamps the time, never the client
 *
 * A client-supplied consent timestamp is a field an attacker types. The
 * route calls `consentRecord` with its own clock.
 */

/**
 * Which version of the terms the notice refers to.
 *
 * ⚠️ Nothing enforces bumping this when `/terms` changes - it is a human
 * step, and a stale value is worse than none because it would attest to the
 * wrong document. Whoever edits the terms page bumps this in the same
 * commit. A date is used rather than a number so the value is meaningful on
 * its own in an audit.
 */
export const TERMS_VERSION = '2026-10-25';

/**
 * Does this campaign need the beneficiary's say-so?
 *
 * ⚠️ **One source of truth for both ends.** The wizard decides whether to
 * SHOW the second notice from this, and the route decides whether to RECORD
 * it from this. Duplicating the condition is how `docs/109` happened - two
 * ends that were each right and a line between them that went stale - and
 * here the failure would be worse than a 404: recording a consent the
 * organiser was never shown is a fabricated record.
 *
 * `self` means the organiser is the beneficiary, so there is nobody else to
 * ask.
 */
export function requiresBeneficiaryConsent(
  relation: BeneficiaryRelation | string | null | undefined,
): boolean {
  return Boolean(relation) && relation !== 'self';
}

export interface ConsentRecord {
  termsAcceptedAt: Date;
  termsVersion: string;
  /** Null when the organiser is the beneficiary - nobody else was named. */
  beneficiaryConsentAt: Date | null;
}

/**
 * The consent columns for a campaign being created.
 *
 * `now` is passed in rather than read here so a test can execute the rule
 * against a fixed clock, and so the route's single `new Date()` stamps every
 * column in one transaction consistently.
 */
export function consentRecord(input: {
  relation: BeneficiaryRelation | string | null | undefined;
  now: Date;
}): ConsentRecord {
  return {
    termsAcceptedAt: input.now,
    termsVersion: TERMS_VERSION,
    beneficiaryConsentAt: requiresBeneficiaryConsent(input.relation) ? input.now : null,
  };
}
