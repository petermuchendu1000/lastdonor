import {
  CurrencyDollarIcon,
  ShieldCheckIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';

/**
 * Trust bar: three objection-killers, directly under the hero.
 *
 * Each pre-empts one question a donor asks before scrolling:
 * "will they take a cut?", "was this checked?", "will I see where it went?".
 * It earns its place by being ABOVE the sections that answer those questions
 * at length, roughly 2,000px further down.
 *
 * ## Rebuilt 2026-10-16 (docs/64)
 *
 * It had to shrink, because its own sublabels became duplicates. After the
 * docs/63 merge, every line here was restated almost verbatim within the
 * next two sections:
 *
 *   "Reviewed before going live."        -> step 01 of How it works
 *   "Photos, receipts, transparency."    -> step 03 and its receipt panel
 *   "Standard Stripe ... fees apply."    -> the fee band's own ledger row
 *
 * So the sublabels went and the labels stayed. A trust strip is a set of
 * flags, not an explanation; the explanation is what the rest of the page is
 * for.
 *
 * ## The arithmetic it was costing
 *
 * At 390px: 3 icons x 44px (`h-11`) + 2 gaps x 32px (`gap-8`) + 48px
 * (`py-6`) = 244px, against a measured 245px. Twenty words at 12.3px of
 * scroll per word, where the fee band manages 8.8px. The gaps and the
 * oversized icon wells were the whole bill, so both are gone: three columns
 * in one row at every width.
 *
 * ## On the wording
 *
 * "0% platform fee" is deliberately precise rather than shortened to "no
 * fees". The word *platform* is what makes it true: Stripe's processing fee
 * still applies, and the fee band states it in full. Dropping "platform"
 * would turn a substantiated claim into a misleading one (see CLAUDE.md on
 * trust copy).
 *
 * Labels carry no trailing period. They are labels, not sentences.
 *
 * "Impact updates" rather than "Photos and receipts": at 390px the latter is
 * ~118px against a ~122px column and wrapped to two lines, which made the
 * third column drive the row height while the other two sat on one line.
 * "Impact updates" fits, and it is the name the product uses for the feature
 * everywhere else, including the step 03 preview panel.
 *
 * Server component, and `outline` icons to match every other section on the
 * page; it was `'use client'` with framer-motion and `solid` icons.
 */
const PROOF = [
  { icon: CurrencyDollarIcon, label: '0% platform fee' },
  { icon: ShieldCheckIcon, label: 'Human reviewed' },
  { icon: EyeIcon, label: 'Impact updates' },
];

export function TrustBar() {
  return (
    <section
      className="border-t border-border bg-background"
      aria-label="Platform trust indicators"
    >
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <ul className="grid grid-cols-3 gap-2 sm:gap-6">
          {PROOF.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="flex flex-col items-center gap-1.5 text-center sm:flex-row sm:justify-center sm:gap-2.5 sm:text-left"
            >
              <Icon
                className="h-5 w-5 shrink-0 text-primary"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <span className="text-[12.5px] font-semibold leading-tight text-foreground sm:text-sm">
                {label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
