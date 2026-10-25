/**
 * The words an ORGANISER sees for a campaign's state. One copy.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Audited 2026-10-25 (`docs/110`). Seven separate status-label maps and three
 * verification-label maps existed across the codebase, and the organiser-facing
 * ones had drifted apart in ways that showed:
 *
 *   `CampaignsListClient`   9 statuses, correct
 *   `FinancesClient`        invented `pending_review` and `rejected`, which are
 *                           not campaign statuses at all, and was MISSING
 *                           `under_review`, `archived`, `paused` and
 *                           `cancelled` - so an organiser whose campaign was in
 *                           the queue read the raw enum `under_review`
 *   `/dashboard/campaigns/[id]`  no map at all; rendered the raw enum
 *   `CampaignVerificationDashboard`  showed "Identity Verified (Tier 1)",
 *                           exposing internal tier jargon, and called a
 *                           `rejected` check "Needs Review"
 *
 * ⚠️ A missing key is not a blank: every one of those maps falls back to the
 * raw value, so drift surfaces as `under_review` or `documents_uploaded`
 * printed at somebody in the middle of a crisis.
 *
 * ── SCOPE: ORGANISERS AND DONORS, NOT ADMINS ────────────────────────────────
 *
 * The admin maps in `src/components/admin/` are deliberately NOT consolidated
 * here. An administrator reading a verification queue is better served by
 * precision than by plain language, and `docs/88` shaped those screens for
 * that reader. Two audiences, two vocabularies, stated rather than blurred.
 *
 * `campaign-labels.test.ts` asserts these maps cover every value of the
 * database enums, so a new status cannot be added without a word for it.
 */

/** What a campaign's `status` means to the person who wrote it. */
export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  under_review: 'In review',
  active: 'Live',
  last_donor_zone: 'Nearly funded',
  completed: 'Funded',
  paused: 'Paused',
  archived: 'Closed',
  suspended: 'Stopped',
  cancelled: 'Cancelled',
};

/**
 * What a campaign's `verification_status` means to its organiser.
 *
 * ⛔ No tier numbers. "Identity Verified (Tier 1)" told an organiser they were
 * verified while the withdrawal route still refused them, because a payout
 * needs `fully_verified`. The two tiers are explained as STEPS in
 * `organiser-journey.ts`, where each one can say what it unblocks; a badge is
 * the wrong place to teach the distinction, so it must at least not claim the
 * job is finished.
 */
export const VERIFICATION_STATUS_LABEL: Record<string, string> = {
  unverified: 'Not started',
  pending: 'In progress',
  documents_uploaded: 'With us',
  submitted_for_review: 'With us',
  identity_verified: 'ID checked',
  fully_verified: 'Done',
  verified: 'Done',
  info_requested: 'Needs you',
  rejected: 'Did not pass',
  suspended: 'On hold',
};

/**
 * Label a campaign status, falling back to something readable.
 *
 * ⚠️ The fallback de-snakes rather than printing the raw value. A status this
 * file has not learned yet should read as odd English, never as a database
 * identifier - that is the failure mode being fixed, so the fallback must not
 * reproduce it.
 */
export function campaignStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return CAMPAIGN_STATUS_LABEL[status] ?? humanise(status);
}

/** Label a verification status. Same fallback rule as above. */
export function verificationStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Not started';
  return VERIFICATION_STATUS_LABEL[status] ?? humanise(status);
}

function humanise(value: string): string {
  const words = value.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
