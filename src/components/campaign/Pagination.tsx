import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icon';
import type { PaginationModel } from '@/lib/pagination';

/**
 * Crawlable pagination: real `<a href>`s, server-rendered, no JavaScript.
 *
 * ⛔ That is the whole point, so do not make this a client component and do not
 * swap the links for buttons. `/campaigns` already had a "more" control - a
 * `<button type="button">` in `CampaignGrid` - and a button is not a link: the
 * rows past the first page appeared in no HTML a crawler could read, and
 * [VERIFIED live] the listing served the same twelve slugs for `?page=1`,
 * `?page=2` and `?page=99`. See `docs/145`.
 *
 * ⚠️ `<Link>` prefetches on hover by default, which is fine here (these are
 * cheap listing pages) and is also why a broken href shows up as an
 * unexplained console 404 during a walk rather than on click - the signal
 * `docs/120` §11.3 was found by.
 */
export function Pagination({
  model,
  hrefForPage,
  label = 'Campaign listing pages',
}: {
  model: PaginationModel;
  /** Built by the caller, which owns its own canonical param order. */
  hrefForPage: (page: number) => string;
  label?: string;
}) {
  // One page is not a sequence. Rendering "1" on its own is furniture that
  // says nothing and takes vertical space the listing was tuned for
  // (`docs/71`).
  if (model.totalPages <= 1) return null;

  return (
    <nav aria-label={label} className="mt-10 flex items-center justify-center gap-1 sm:gap-2">
      {model.prevPage !== null ? (
        <Link
          href={hrefForPage(model.prevPage)}
          rel="prev"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
        >
          <ChevronLeftIcon size="sm" />
          {/*
            ⛔ `sr-only`, NOT `hidden`. With `hidden sm:inline` the only child
            of this link on a phone is an `aria-hidden` icon, so the link had
            NO ACCESSIBLE NAME - axe `link-name` / `focusable-no-name`,
            serious, on Mobile Chrome only. Keeping the real text in the
            accessibility tree also keeps the accessible name identical to the
            visible label, which an `aria-label` would not.
          */}
          <span className="sr-only sm:not-sr-only">Previous</span>
        </Link>
      ) : (
        /*
          Rendered, not omitted: dropping it shifts the whole strip sideways
          between pages. `aria-hidden` because a disabled control a keyboard
          user can land on but never use is worse than no control.

          ⛔ `text-muted-foreground`, NOT `text-muted-foreground/40`. The faded
          version measured **1.72:1** against AA's 4.5:1 (#c1c6cb on white) and
          failed the WCAG run on this page - and `aria-hidden` does NOT exempt
          it, because the text is still there for a sighted reader. This is
          `docs/91` word for word: the signals that carry "inert" are semantic
          (no href, not focusable, hidden from assistive tech), so the colour
          does not have to, and dimming below the legibility floor is not a way
          to signal state. The missing border and background still read as
          inactive.
        */
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-muted-foreground"
        >
          <ChevronLeftIcon size="sm" />
          <span className="hidden sm:inline">Previous</span>
        </span>
      )}

      <ol className="flex items-center gap-1">
        {model.items.map((item) =>
          item.kind === 'ellipsis' ? (
            <li
              key={`gap-${item.after}`}
              aria-hidden="true"
              className="px-1.5 text-sm text-muted-foreground"
            >
              &hellip;
            </li>
          ) : (
            <li key={item.page}>
              {item.isCurrent ? (
                /*
                  The current page is NOT a link to itself. `aria-current="page"`
                  is what states it - the same correction `docs/71` made to this
                  page's status strip, where a `role="tab"` on a `<Link>`
                  replaced the native link semantics while still navigating.
                */
                <span
                  aria-current="page"
                  className="inline-flex min-w-[2.25rem] justify-center rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                >
                  {item.page}
                </span>
              ) : (
                <Link
                  href={hrefForPage(item.page)}
                  aria-label={`Page ${item.page}`}
                  className="inline-flex min-w-[2.25rem] justify-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
                >
                  {item.page}
                </Link>
              )}
            </li>
          ),
        )}
      </ol>

      {model.nextPage !== null ? (
        <Link
          href={hrefForPage(model.nextPage)}
          rel="next"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
        >
          <span className="sr-only sm:not-sr-only">Next</span>
          <ChevronRightIcon size="sm" />
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-muted-foreground"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRightIcon size="sm" />
        </span>
      )}
    </nav>
  );
}
