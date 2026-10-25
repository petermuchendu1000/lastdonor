import Link from 'next/link';

import { CheckCircleIcon, ClockIcon, ReviewedIcon, WarningIcon } from '@/components/ui/icon';
import { organiserJourney, type JourneyFacts, type JourneyStep, type StepState } from '@/lib/organiser-journey';
import { cn } from '@/lib/utils';

/**
 * The whole path to getting paid, on one screen.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 *
 * Nothing. There was no such screen. An organiser learned about ID checks by
 * noticing one grey line on `/dashboard`, and learned about the SECOND tier -
 * the one the withdrawal route actually requires - never. See
 * `src/lib/organiser-journey.ts` for the audit.
 *
 * ── WHY EVERY STEP SHOWS, INCLUDING THE ONES THEY CANNOT DO YET ─────────────
 *
 * A first-time organiser's question is not "what is my next click", it is
 * "what am I in for". Hiding the later steps answers the first question and
 * leaves the second one to be discovered one surprise at a time, which is
 * exactly how somebody ends up funded and unable to be paid.
 *
 * So the ladder is always the same six rows in the same order, and state is
 * carried by the icon and the words rather than by presence. `later` rows are
 * dimmed, never removed.
 */

const STATE_ICON = {
  done: CheckCircleIcon,
  now: ReviewedIcon,
  waiting: ClockIcon,
  later: ClockIcon,
  attention: WarningIcon,
} as const;

const STATE_TONE: Record<StepState, string> = {
  done: 'text-brand-green',
  now: 'text-primary',
  waiting: 'text-muted-foreground',
  later: 'text-muted-foreground/60',
  attention: 'text-brand-amber',
};

/** A short word beside the title, so the state is readable without colour. */
const STATE_LABEL: Record<StepState, string | null> = {
  done: 'Done',
  now: 'Your turn',
  waiting: 'With us',
  later: null,
  attention: 'Needs you',
};

function Row({ step }: { step: JourneyStep }) {
  const Icon = STATE_ICON[step.state];
  const dim = step.state === 'later';

  return (
    <li className="flex gap-3 py-3">
      <Icon size="sm" className={cn('mt-0.5 shrink-0', STATE_TONE[step.state])} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn('text-sm font-semibold', dim ? 'text-muted-foreground' : 'text-foreground')}>
            {step.title}
          </span>
          {/*
            The state as a word, not only as a colour. A colour-only state is
            unreadable to anybody who cannot distinguish the tones, and this
            screen is the one that explains how somebody gets their money.
          */}
          {STATE_LABEL[step.state] && (
            <span className={cn('text-xs font-medium', STATE_TONE[step.state])}>
              {STATE_LABEL[step.state]}
            </span>
          )}
        </div>

        <p className={cn('mt-0.5 text-sm', dim ? 'text-muted-foreground/70' : 'text-muted-foreground')}>
          {step.detail}
        </p>

        {/*
          The "why". Shown on anything not finished, because a step with no
          stated consequence reads as paperwork.
        */}
        {step.consequence && step.state !== 'done' && (
          <p className={cn('mt-0.5 text-xs', dim ? 'text-muted-foreground/60' : 'text-muted-foreground')}>
            {step.consequence}
          </p>
        )}

        {step.href && step.action && (
          <Link
            href={step.href}
            className={cn(
              'mt-1 inline-block text-sm font-semibold underline-offset-4 hover:underline',
              step.state === 'attention' ? 'text-brand-amber' : 'text-primary',
            )}
          >
            {step.action}
          </Link>
        )}
      </div>
    </li>
  );
}

export function JourneyChecklist({
  facts,
  className,
  heading = 'What happens next',
}: {
  facts: JourneyFacts;
  className?: string;
  heading?: string;
}) {
  const steps = organiserJourney(facts);

  return (
    <section className={cn('rounded-lg border p-4 sm:p-5', className)}>
      <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Everything between you and the money, in order.
      </p>
      <ul className="mt-2 divide-y">
        {steps.map((s) => (
          <Row key={s.id} step={s} />
        ))}
      </ul>
      <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
        {/*
          The guide existed and was linked from the footer, the terms, the
          refund policy, campaign-rules and transparency - from everywhere
          except the screens where somebody is doing the task.
        */}
        Want the detail?{' '}
        <Link href="/campaign-verification-policy" className="underline underline-offset-2">
          Read how we check campaigns
        </Link>
        , or email{' '}
        <a href="mailto:support@lastdonor.org" className="underline underline-offset-2">
          support@lastdonor.org
        </a>
        .
      </p>
    </section>
  );
}
