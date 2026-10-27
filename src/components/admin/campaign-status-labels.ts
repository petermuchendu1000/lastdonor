import type { CampaignStatus } from '@/types';

/**
 * The words the ADMIN panel uses for a campaign status.
 *
 * ── Why this is not `src/lib/campaign-labels.ts` ────────────────────────────
 *
 * `docs/110` §4 consolidated the organiser-facing status words into
 * `src/lib/campaign-labels.ts` and recorded, deliberately, that
 * `src/components/admin/` was NOT folded in with them: two audiences, two
 * vocabularies. An organiser reads "Waiting for review"; an administrator
 * reads "Under Review", because they are looking at a queue whose name is the
 * status.
 *
 * ── Why it is a module and not a constant in a component ────────────────────
 *
 * It was private to `CampaignsList.tsx`. `CampaignEditor` then needed the same
 * words to show a campaign's real status read-only (`docs/120`), and the
 * alternative was an eighth copy of the same map - `docs/110` found seven,
 * three of them wrong, and a missing key is not a blank: every one of these
 * maps falls back to the raw value, so drift reaches the reader as
 * `under_review`.
 *
 * `campaign-status-labels.test.ts` reads the completeness requirement from the
 * database enum rather than retyping the list, so a new status cannot be
 * added without a word for it here.
 */
export const ADMIN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  last_donor_zone: 'Last Donor Zone',
  completed: 'Completed',
  archived: 'Archived',
  paused: 'Paused',
  under_review: 'Under Review',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

/** The admin's word for a status, falling back to the raw value. */
export function adminStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return ADMIN_STATUS_LABELS[status as CampaignStatus] ?? status;
}
