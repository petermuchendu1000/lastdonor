/**
 * Offset pagination, as pure arithmetic.
 *
 * ── WHY THIS IS A MODULE ────────────────────────────────────────────────────
 *
 * `/campaigns` could only ever show its first page. It read no `page` param
 * (`page.tsx` declared `category, sort, q, location, close_to_target, status`
 * and nothing else) and its query carried `.limit(PAGE_SIZE + 1)` with **no
 * `.offset()`**, so `?page=1`, `?page=2` and `?page=99` all returned the same
 * twelve rows - [VERIFIED live against production, with `sort=newest` vs
 * `sort=most_funded` differing by 4 slugs as the control proving the probe
 * could see a change]. The only "more" control was a `<button>`, so the rows
 * past the first page existed in no HTML any crawler could read.
 *
 * The arithmetic lives here, away from the route, because that is what lets a
 * test execute it (`docs/107`, `docs/126`, `docs/130` - a decision inside a
 * server component is a decision no test can reach).
 *
 * ⛔ It builds no URLs and knows no param names. `/campaigns` has its own
 * canonical param order (`browse-params.ts`), and a second caller will have a
 * different one; a model that emitted hrefs would have to know both.
 */

/** One entry in the rendered number strip. */
export type PaginationItem =
  | { kind: 'page'; page: number; isCurrent: boolean }
  | { kind: 'ellipsis'; after: number };

export interface PaginationModel {
  /** The page actually served, always within `[1, totalPages]`. */
  page: number;
  totalPages: number;
  /** Rows to skip. Feed this straight to `.offset()`. */
  offset: number;
  pageSize: number;
  prevPage: number | null;
  nextPage: number | null;
  /**
   * True when the request asked for a page past the last one.
   *
   * ⛔ The page is NOT clamped, and that is a decision. Clamping would serve
   * page 2's rows under the URL `?page=99`, and `generateMetadata` cannot tell
   * that it happened without re-running the count - which would put a FOURTH
   * concurrent query on the busiest public route and break `docs/87`'s cap of
   * three. So the offset is honoured literally, the listing comes back empty,
   * and the caller says so.
   *
   * ⚠️ The empty listing must NOT fall through to the stock "No active
   * campaigns at the moment. Check back soon." That is `docs/45`'s exact
   * defect - an empty state blaming the platform when the real cause is the
   * visitor's own URL.
   */
  beyondEnd: boolean;
  items: PaginationItem[];
}

/** Pages either side of the current one that always get a number. */
const SIBLINGS = 1;

/** At or below this many pages, every page gets a number and no ellipsis. */
const MAX_UNABBREVIATED = 7;

/**
 * Read a `page` query param.
 *
 * Anything that is not a whole number at or above 1 - absent, empty, `0`,
 * `-3`, `abc`, `2.5`, `1e9` - reads as page 1. A listing has no meaningful
 * "page 0", and refusing the request would turn a junk URL into an error page.
 *
 * ⚠️ Next hands a repeated param (`?page=2&page=5`) through as an ARRAY, so
 * this takes the same `string | string[] | undefined` shape `browse-params.ts`
 * does and reads the first value.
 */
export function parsePageParam(raw: string | string[] | undefined): number {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return 1;
  const trimmed = first.trim();
  // `parseInt` would accept "2abc" and "2.9"; this requires the whole string.
  if (!/^\d+$/.test(trimmed)) return 1;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 1) return 1;
  return n;
}

/**
 * Resolve a page request against a known total.
 *
 * `total` is the number of rows matching the CURRENT filter set, which
 * `/campaigns` already has without issuing another query - the unfiltered
 * count comes from the tab-count FILTER aggregate and the filtered one from
 * the count query that only runs when a filter is active. ⛔ Do not add a
 * query for it: that route is at the three-concurrent-query cap (`docs/87`).
 */
export function paginationModel(input: {
  total: number;
  pageSize: number;
  requestedPage: number;
}): PaginationModel {
  const pageSize = Math.max(1, Math.trunc(input.pageSize));
  const total = Math.max(0, Math.trunc(input.total));
  const requested = Math.max(1, Math.trunc(input.requestedPage));

  // An empty result set is still ONE page - the page that says so. Zero pages
  // would make `page` 0 and the strip render nothing for a visitor who is
  // looking at a real, if empty, listing.
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = requested;
  const beyondEnd = page > totalPages;

  return {
    page,
    totalPages,
    offset: (page - 1) * pageSize,
    pageSize,
    /*
      Past the end, "previous" is the LAST REAL page, not `page - 1`. From
      `?page=99` of a two-page listing, offering page 98 would be one dead URL
      pointing at another.
    */
    prevPage: beyondEnd ? totalPages : page > 1 ? page - 1 : null,
    nextPage: page < totalPages ? page + 1 : null,
    beyondEnd,
    items: numberStrip(page, totalPages),
  };
}

/** First, last, and a window around the current page, with gaps marked. */
function numberStrip(page: number, totalPages: number): PaginationItem[] {
  const wanted = new Set<number>();
  if (totalPages <= MAX_UNABBREVIATED) {
    for (let p = 1; p <= totalPages; p++) wanted.add(p);
  } else {
    wanted.add(1);
    wanted.add(totalPages);
    for (let p = page - SIBLINGS; p <= page + SIBLINGS; p++) {
      if (p >= 1 && p <= totalPages) wanted.add(p);
    }
  }

  const sorted = [...wanted].sort((a, b) => a - b);
  const items: PaginationItem[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous !== 0 && p - previous > 1) items.push({ kind: 'ellipsis', after: previous });
    items.push({ kind: 'page', page: p, isCurrent: p === page });
    previous = p;
  }
  return items;
}
