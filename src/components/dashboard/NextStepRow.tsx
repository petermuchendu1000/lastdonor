import Link from 'next/link';

import { CheckCircleIcon, ClockIcon, ReviewedIcon, WarningIcon } from '@/components/ui/icon';
import { nextOrganiserAction, type JourneyFacts } from '@/lib/organiser-journey';
import { cn } from '@/lib/utils';

/**
 * One line on a campaign row: the single thing waiting on this organiser.
 *
 * ── WHAT THIS REPLACES, AND WHY IT IS NOT JUST A RENAME ─────────────────────
 *
 * `VerificationRow` (added by `docs/83`) did the same job for ONE step. It was
 * right as far as it went and it was the only prompt in the product - but it
 * rendered on `/dashboard` only, never on `/dashboard/campaigns`, which is the
 * list the create-campaign wizard now lands on (`docs/109`). It also knew
 * nothing about the second verification tier, the payout account, or anything
 * else an organiser has to do.
 *
 * This renders `nextOrganiserAction`, so the two lists cannot disagree about
 * what somebody's next move is, and so a new step added to the journey appears
 * here without anybody remembering to come back.
 *
 * ⚠️ When nothing is waiting on the organiser it renders the WAITING state
 * rather than nothing at all. Silence on a campaign row is what the old UI
 * did, and silence is indistinguishable from "there is nothing to know".
 */

const TONE = {
  attention: 'text-brand-amber',
  now: 'text-primary',
  waiting: 'text-muted-foreground',
} as const;

export function NextStepRow({ facts, className }: { facts: JourneyFacts; className?: string }) {
  const next = nextOrganiserAction(facts);

  if (!next) {
    /*
      Nothing for them to do. Say which of the two silences this is: waiting
      on us, or finished. `fully_verified` on a live campaign is the only
      genuinely finished state, because the withdrawal route needs exactly
      that.
    */
    const finished =
      facts.verificationStatus === 'fully_verified' &&
      ['active', 'last_donor_zone', 'completed'].includes(facts.status);

    const Icon = finished ? CheckCircleIcon : ClockIcon;
    return (
      <p className={cn('mt-2 flex items-center gap-2 text-xs', className)}>
        <Icon size="sm" className={cn('shrink-0', finished ? 'text-brand-green' : 'text-muted-foreground')} aria-hidden />
        <span className={finished ? 'text-brand-green' : 'text-muted-foreground'}>
          {finished ? 'All checks done' : 'Nothing needed from you right now'}
        </span>
      </p>
    );
  }

  const Icon = next.state === 'attention' ? WarningIcon : ReviewedIcon;
  const tone = TONE[next.state as keyof typeof TONE] ?? 'text-muted-foreground';

  return (
    <p className={cn('mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', className)}>
      <Icon size="sm" className={cn('shrink-0', tone)} aria-hidden />
      <span className={tone}>
        <span className="font-semibold">{next.title}</span>
        {next.consequence ? ` - ${next.consequence}` : ''}
      </span>
      {next.href && next.action && (
        <Link
          href={next.href}
          className={cn('font-semibold underline-offset-4 hover:underline', tone)}
        >
          {next.action}
        </Link>
      )}
    </p>
  );
}
