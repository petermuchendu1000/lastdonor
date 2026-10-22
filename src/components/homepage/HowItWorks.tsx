'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CheckBadgeIcon,
  LockClosedIcon,
  CameraIcon,
} from '@heroicons/react/24/outline';

/**
 * How it works: one interactive section, replacing two static ones.
 *
 * ## What this merged (2026-10-16, docs/63)
 *
 * The homepage carried BOTH an "What LastDonor Does" answer block and a
 * "3 Steps to Give with Confidence" list. They did the same job - explain
 * the product - and between them restated what the rest of the page already
 * says. "0% platform fees" appeared four times on one page: the trust bar,
 * this step list, the fee band, and the FAQ.
 *
 * Both were also just grey text in columns. Three generic outline icons at
 * 20px, a number, and two lines of prose each. Nothing to look at and
 * nothing to do.
 *
 * ## What replaced them
 *
 * A stepper that shows the actual product. Each step drives a preview panel
 * built from the same primitives the real pages use - a reviewed campaign
 * card, the donate control, an impact update with a receipt - so the section
 * demonstrates rather than asserts.
 *
 * GoFundMe's equivalent (help-centre-era homepage, section 2) pairs numbered
 * steps with a video and a progress ring that advances with it. The device
 * worth taking is that the steps DRIVE something; the video is not worth
 * taking, because a 1.5MB autoplaying asset is exactly what let us beat them
 * on LCP in the first place (docs/49).
 *
 * ## The SEO payload is preserved
 *
 * `#ai-answer` is named in the homepage JSON-LD `speakable` selector, so the
 * element has to survive the merge. The paragraph moved here intact in
 * meaning and keeps every target term - "medical", "emergency", "disaster
 * relief", "0% platform fees on fundraisers", "visible donation tracking" -
 * in 25 words instead of 43, and without saying "fundraising" three times in
 * one sentence.
 *
 * ## Accessibility
 *
 * A real tabs pattern: `tablist`/`tab`/`tabpanel`, roving tabindex, arrow and
 * Home/End keys. Auto-advance stops permanently the moment anyone selects a
 * step, and never starts for `prefers-reduced-motion`.
 */

const AUTO_ADVANCE_MS = 6000;

interface Step {
  n: string;
  title: string;
  blurb: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'Find a campaign you trust',
    blurb: 'A real person reviews every campaign before it goes live.',
    icon: CheckBadgeIcon,
  },
  {
    n: '02',
    title: 'Give in seconds',
    blurb: 'Any card, no account needed. Nothing is added to your gift.',
    icon: LockClosedIcon,
  },
  {
    n: '03',
    title: 'See what it paid for',
    blurb: 'Organizers post photos and receipts as the money is spent.',
    icon: CameraIcon,
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);
  /** Set once the visitor takes control; auto-advance never resumes. */
  const [userDriven, setUserDriven] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  useEffect(() => {
    if (userDriven) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const t = setInterval(
      () => setActive((i) => (i + 1) % STEPS.length),
      AUTO_ADVANCE_MS,
    );
    return () => clearInterval(t);
  }, [userDriven]);

  const select = useCallback((i: number) => {
    setUserDriven(true);
    setActive(i);
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    const last = STEPS.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = active === last ? 0 : active + 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = active === 0 ? last : active - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section className="bg-background py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="text-balance font-display text-[1.75rem] font-bold leading-[1.15] tracking-tight text-foreground sm:text-[2rem] lg:text-[2.25rem]">
            How it works
          </h2>
          {/*
            Carries the `speakable` selector named in the homepage JSON-LD.
            Do not rename the id without updating that graph in page.tsx.
          */}
          <p
            id="ai-answer"
            data-speakable="true"
            className="mt-3 text-[15px] leading-relaxed text-muted-foreground sm:mt-4 sm:text-base"
          >
            LastDonor is reviewed crowdfunding for <strong className="font-semibold text-foreground">medical</strong>,{' '}
            <strong className="font-semibold text-foreground">emergency</strong> and{' '}
            <strong className="font-semibold text-foreground">disaster relief fundraising</strong>,
            with <strong className="font-semibold text-foreground">0% platform fees on fundraisers</strong> and{' '}
            <strong className="font-semibold text-foreground">visible donation tracking</strong> from
            contribution to impact.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:mt-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:gap-14">
          {/* ── Steps ─────────────────────────────────────────────────── */}
          {/*
            A `div`, not an `<ol>`/`<li>` - and the reason is that ARIA
            roles REPLACE native semantics rather than adding to them.

            This was `<ol role="tablist">` with each `role="tab"` button
            wrapped in an `<li>`, which reads as a list in the source and
            looked like the more semantic choice. It is invalid, and axe
            flagged it three ways from one mistake:

              - `aria-required-children` on the `ol`: a `tablist` may only
                own `tab` elements, and its children were `listitem`s.
              - `aria-required-parent` on each button: a `tab` must be owned
                by a `tablist`, and each one's parent was an `<li>`.
              - `listitem` on each `<li>`: a `listitem` must sit in a list,
                and `role="tablist"` had stopped the `ol` being one.

            So the markup announced a list of three items containing nothing
            navigable, and the tabs pattern the comment above promises was
            not actually exposed. Putting the tabs directly inside the
            tablist is both valid HTML and the pattern APG specifies; the
            ordering the `<ol>` was reaching for is carried by the visible
            "01/02/03" and by DOM order, which is what a screen reader
            announces as "tab 2 of 3" anyway.

            Found by `e2e-11-a11y-seo.spec.ts` once it could finally reach a
            rendered homepage (docs/99). Do not re-add a list wrapper here.
          */}
          <div
            role="tablist"
            aria-label="How LastDonor works"
            aria-orientation="vertical"
            onKeyDown={onKeyDown}
            className="space-y-2 lg:self-center"
          >
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              const on = i === active;
              return (
                <button
                  key={step.n}
                  ref={(el) => { tabRefs.current[i] = el; }}
                  role="tab"
                  id={`${baseId}-tab-${i}`}
                  aria-selected={on}
                  aria-controls={`${baseId}-panel-${i}`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => select(i)}
                  className={`flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-colors duration-200 ${
                    on
                      ? 'border-primary/30 bg-primary/[0.06]'
                      : 'border-transparent hover:bg-muted/60'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums transition-colors duration-200 ${
                      on
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {step.n}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Icon
                        className={`h-[18px] w-[18px] shrink-0 ${on ? 'text-primary' : 'text-muted-foreground'}`}
                        strokeWidth={1.8}
                        aria-hidden="true"
                      />
                      <span className="font-display text-[17px] font-bold leading-tight text-foreground">
                        {step.title}
                      </span>
                    </span>
                    <span className="mt-1 block text-[14px] leading-snug text-muted-foreground">
                      {step.blurb}
                    </span>
                    {/*
                      Without this the section advances on its own and the
                      visitor has no idea why the panel changed. Keyed on
                      `active` so the animation restarts each time, and
                      rendered only while the section is still driving
                      itself - once someone picks a step, the countdown is
                      over and showing one would be a lie.
                    */}
                    {on && !userDriven && (
                      <span
                        key={active}
                        aria-hidden="true"
                        className="mt-2.5 block h-0.5 w-full overflow-hidden rounded-full bg-primary/15"
                      >
                        <span className="step-progress block h-full w-full rounded-full bg-primary" />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Preview ───────────────────────────────────────────────── */}
          {/*
            All three panels occupy the SAME grid cell, so the container is
            always as tall as the tallest and switching tabs shifts nothing.
            Measured before this: 238px, 267px and 290px, a 52px jump on
            every change.

            Inactive panels are hidden with `invisible`, not the `hidden`
            attribute, because `hidden` removes them from layout and the
            container would collapse back to the active one. `visibility:
            hidden` still reserves the space while correctly removing the
            content from the accessibility tree and the tab order, which is
            the behaviour the tabs pattern wants anyway.
          */}
          <div className="grid lg:self-center">
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                role="tabpanel"
                id={`${baseId}-panel-${i}`}
                aria-labelledby={`${baseId}-tab-${i}`}
                className={`col-start-1 row-start-1 ${
                  i === active ? '' : 'invisible pointer-events-none'
                }`}
              >
                <StepPreview index={i} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The panel each step drives.
 *
 * Deliberately built from markup rather than screenshots: a screenshot of a
 * product goes stale the first time the product changes, and nobody notices
 * until a visitor does.
 */
function StepPreview({ index }: { index: number }) {
  const shell =
    'rounded-2xl border border-border bg-card p-5 shadow-elevation-1 sm:p-6';

  if (index === 0) {
    return (
      <div className={shell}>
        <div className="flex gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/10">
            <CameraIcon className="h-6 w-6 text-primary/50" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              <CheckBadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Reviewed
            </span>
            <p className="mt-2 font-display text-[15px] font-bold leading-snug text-card-foreground">
              After the tornado, a family rebuilds
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">Prattville, Alabama</p>
          </div>
        </div>
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          {['Identity checked', 'Documents seen', 'Payout account verified'].map((t) => (
            <p key={t} className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <CheckBadgeIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {t}
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className={shell}>
        <p className="text-[13px] font-medium text-muted-foreground">Choose an amount</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {['$25', '$50', '$100'].map((a, i) => (
            <div
              key={a}
              className={`rounded-lg border py-2.5 text-center font-sans text-[15px] font-bold tabular-nums ${
                i === 1
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {a}
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-full bg-accent py-3 text-center text-[15px] font-bold text-accent-foreground">
          Donate $50
        </div>
        <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-[13px]">
          <p className="flex justify-between text-muted-foreground">
            <span>Platform fee</span>
            <span className="font-sans font-bold tabular-nums text-brand-green">$0.00</span>
          </p>
          <p className="flex justify-between text-muted-foreground">
            <span>Account required</span>
            <span className="font-semibold text-foreground">No</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-brand-live" aria-hidden="true" />
        <p className="text-[13px] font-bold text-card-foreground">Impact update</p>
        <p className="ml-auto text-[12px] text-muted-foreground">Day 12</p>
      </div>
      <div className="mt-3 flex h-24 items-center justify-center rounded-xl bg-gradient-to-br from-brand-green/30 to-brand-green/10">
        <CameraIcon className="h-7 w-7 text-brand-green/50" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <p className="mt-3 text-[14px] leading-snug text-card-foreground">
        &ldquo;The roof is on. Here is the invoice from the contractor.&rdquo;
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[13px]">
        <span className="text-muted-foreground">Receipt attached</span>
        <span className="font-sans font-bold tabular-nums text-foreground">$4,180</span>
      </div>
      <Link
        href="/transparency"
        className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
      >
        How tracking works
        <span aria-hidden="true">&rarr;</span>
      </Link>
    </div>
  );
}
