import Link from 'next/link';
import { CheckCircleIcon, ReviewedIcon } from '@/components/ui/icon';

/**
 * The organiser's permanent way into identity verification.
 *
 * Added 2026-10-17. The verification page and the Didit integration behind
 * it both worked; the only link to them was an "urgent action" banner on
 * the dashboard, gated on the campaign being `active` AND having at least
 * one donor. After `docs/79` no campaign is active until an admin approves
 * it, and after `docs/72` no campaign can have a donor at all, so that
 * banner could not render and the flow was reachable only by typing the
 * URL. See `docs/83`.
 *
 * This renders on every campaign row, in every state, so the door is open
 * before anyone is being chased through it.
 */

/** `verification_status` values, mapped to what the organiser needs to know. */
const PRESENTATION: Record<
  string,
  { label: string; action: string | null; tone: 'done' | 'progress' | 'todo' | 'attention' }
> = {
  unverified: { label: 'Not verified', action: 'Verify identity', tone: 'todo' },
  pending: { label: 'Verification in progress', action: 'Continue', tone: 'progress' },
  submitted_for_review: { label: 'With our reviewers', action: 'View', tone: 'progress' },
  documents_uploaded: { label: 'Documents received', action: 'View', tone: 'progress' },
  identity_verified: { label: 'Identity verified', action: 'View', tone: 'done' },
  fully_verified: { label: 'Fully verified', action: null, tone: 'done' },
  info_requested: { label: 'More information needed', action: 'Respond', tone: 'attention' },
  rejected: { label: 'Verification did not pass', action: 'Try again', tone: 'attention' },
  suspended: { label: 'Verification suspended', action: 'Contact support', tone: 'attention' },
  verified: { label: 'Verified', action: null, tone: 'done' },
};

const TONE_CLASS: Record<string, string> = {
  done: 'text-brand-green',
  progress: 'text-muted-foreground',
  todo: 'text-muted-foreground',
  attention: 'text-brand-amber',
};

export function VerificationRow({
  campaignId,
  status,
}: {
  campaignId: string;
  status: string;
}) {
  /*
    An unrecognised status is shown as itself rather than hidden. A new
    enum value appearing here should look odd, not silently remove the
    organiser's only route to verification - the exact failure this
    component exists to fix.
  */
  const view = PRESENTATION[status] ?? {
    label: status.replace(/_/g, ' '),
    action: 'View',
    tone: 'progress' as const,
  };

  /*
    `ReviewedIcon` is the brand mark docs/70 drew for "a person read this
    before it went live", which is exactly what verification is. Not a
    shield: a shield claims "protected", and nothing here is protecting
    anybody.
  */
  const Icon = view.tone === 'done' ? CheckCircleIcon : ReviewedIcon;

  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <Icon size="sm" className={`shrink-0 ${TONE_CLASS[view.tone]}`} />
      <span className={TONE_CLASS[view.tone]}>{view.label}</span>
      {view.action && (
        <Link
          href={`/dashboard/campaigns/${campaignId}/verification`}
          className="font-semibold text-primary transition-colors hover:underline"
        >
          {view.action}
        </Link>
      )}
    </div>
  );
}
