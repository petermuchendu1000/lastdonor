'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ProgressBar } from '@/components/campaign/ProgressBar';
import { Money } from '@/components/ui/Money';
import { cn } from '@/lib/utils';

interface StickyMobileDonateBarProps {
  raisedAmount: number;
  goalAmount: number;
  /**
   * The campaign's own currency.
   *
   * ⛔ Required, not defaulted. This bar used `centsToDollarsWhole`, which
   * hardcodes USD, while every amount column is in the MINOR UNITS OF ITS
   * ROW'S CURRENCY (`docs/92`). On a KES campaign it printed "$31,600 to go"
   * directly beneath a badge correctly reading "Ksh 50,000.00".
   *
   * `docs/112` recorded this class of defect as latent because the only
   * non-USD campaign was archived and unservable. KES is the only rail that
   * actually collects money (`docs/92`), so it was never going to stay
   * latent.
   */
  currency: string;
  donateHref: string;
  className?: string;
}

export function StickyMobileDonateBar({
  raisedAmount,
  goalAmount,
  currency,
  donateHref,
  className,
}: StickyMobileDonateBarProps) {
  const percent = goalAmount > 0
    ? Math.min(Math.round((raisedAmount / goalAmount) * 100), 100)
    : 0;
  const remaining = goalAmount > raisedAmount ? goalAmount - raisedAmount : 0;
  const isUnfunded = raisedAmount === 0;

  /*
    The space this bar takes out of the document.

    ── THE DEFECT ────────────────────────────────────────────────────────────

    The bar is `position: fixed`, so it is out of flow and nothing below it
    moves aside. You cannot scroll past the end of a document, so the LAST
    ~65px of every page carrying this bar were permanently behind it - and the
    phone is the only place it renders. `docs/163`.

    [VERIFIED in a browser at 390px on production] scrolled to the bottom of
    `/campaigns/harold-jennings`, the bar covered the footer's copyright line
    and its "Switch to dark mode" button, and a real click on that button
    TIMED OUT while the SAME click succeeded on `/campaigns` and `/about`,
    which render no fixed bar.

    ── WHY THE PADDING IS ON `body` AND NOT A SPACER HERE ────────────────────

    ⚠️ My first fix rendered an in-flow spacer right here and DID NOT WORK -
    proven by an A/B in one browser session that reported the identical
    `coveredCount` with the spacer at 65px and at 0px. The reason is where
    this component sits: it renders inside the page's content column, and the
    FOOTER is rendered after the page by the root layout, so a spacer here
    reserves room at the end of the PAGE and the document still ends with the
    footer. The space has to be reserved at the end of the DOCUMENT.

    ⛔ The height is MEASURED, never written down. A hardcoded `pb-20` is the
    obvious fix and it is a number that drifts: this bar's height is
    content-driven (the unfunded state is one line, the funded state is a
    progress bar plus a line), so any constant is either wrong today or wrong
    after the next copy change.

    ⚠️ The measurement also carries the breakpoint for free. Above `lg` the
    bar is `display: none`, so its height is 0 and the padding is 0 - there is
    no second place to keep `lg:hidden` in step.

    ⛔ And it lives HERE, not on the page. There is one render site today
    (`campaigns/[slug]/client.tsx`); a second one must not have to remember to
    reserve room (`docs/146`'s one-decider rule). The padding is removed on
    unmount, so a page without the bar is untouched.
  */
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const body = document.body;
    const previous = body.style.paddingBottom;

    const reserve = () => {
      body.style.paddingBottom = `${Math.ceil(el.getBoundingClientRect().height)}px`;
    };
    reserve();

    // A resize listener as well as the observer: `display: none` above `lg`
    // is a box change the observer does not report in every engine.
    window.addEventListener('resize', reserve);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reserve) : null;
    ro?.observe(el);

    return () => {
      window.removeEventListener('resize', reserve);
      ro?.disconnect();
      body.style.paddingBottom = previous;
    };
  }, []);

  return (
    <>
      <div
        ref={barRef}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 py-3 shadow-[--shadow-elevation-3] backdrop-blur lg:hidden',
          className,
        )}
      >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {/*
            The unfunded state, which this bar was missing.

            docs/47 established that a campaign with no money yet leads with
            what it is asking for, not with a figure that reads as a dead
            page, and the sidebar on this very page says "Be the first to
            donate". This bar still said "0% funded", which is the same
            sentence docs/47 removed, on the most prominent surface of the
            page: it is fixed to the bottom of every phone screen.

            An empty progress bar is dropped with it. Above zero the bar and
            the percentage both return unchanged. See docs/71.
          */}
          {isUnfunded ? (
            <p className="text-xs">
              <span className="font-semibold text-foreground">Be the first to donate</span>
              <span className="ml-1.5 font-sans tabular-nums text-muted-foreground">
                <Money minor={goalAmount} currency={currency} /> goal
              </span>
            </p>
          ) : (
            <>
              <ProgressBar
                raisedAmount={raisedAmount}
                goalAmount={goalAmount}
                compact
              />
              <p className="mt-1 flex items-center gap-1.5 text-xs tabular-nums">
                <span className="font-semibold text-foreground">{percent}%</span>
                <span className="text-muted-foreground">funded</span>
                {remaining > 0 && (
                  <>
                    <span aria-hidden="true" className="text-border">·</span>
                    <span className="font-semibold text-muted-foreground">
                      <Money minor={remaining} currency={currency} /> to go
                    </span>
                  </>
                )}
              </p>
            </>
          )}
        </div>
        <Link
          href={donateHref}
          className="btn-press shrink-0 rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-foreground shadow-md transition-all hover:bg-accent/90"
        >
          Donate
        </Link>
        </div>
      </div>
    </>
  );
}
