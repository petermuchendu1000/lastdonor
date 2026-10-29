/**
 * Browse/filter parameter resolution shared by `/campaigns` and `/search`.
 *
 * Why this is a module and not inline in `page.tsx`: three surfaces have to
 * agree on what a browse URL means. `/search` forwards these params,
 * `/campaigns` applies them, and the tests pin the rules. See
 * `docs/45-BROWSE-FILTER-HONESTY-ADR.md`.
 *
 * The rule for a value we cannot apply is: never silently widen the result set.
 * An unapplied value is reported to the visitor and the listing is shown
 * deliberately unfiltered on that dimension, rather than being dropped in
 * silence (which reads as "all 12 of these match your filter").
 */
import { CAMPAIGN_CATEGORIES } from '@/lib/categories';
import type { CampaignCategory } from '@/types';

/** Every query param `/campaigns` understands, in canonical URL order. */
export const BROWSE_PARAM_KEYS = [
  'q',
  'category',
  'location',
  'sort',
  'close_to_target',
  'status',
] as const;

export type BrowseParamKey = (typeof BROWSE_PARAM_KEYS)[number];

export const VALID_CATEGORIES: readonly CampaignCategory[] = CAMPAIGN_CATEGORIES.map(
  (c) => c.value,
);

export const VALID_SORTS = ['newest', 'most_funded', 'least_funded', 'closing_soon'] as const;
export type SortOption = (typeof VALID_SORTS)[number];
export const DEFAULT_SORT: SortOption = 'most_funded';

/** Statuses this page lists. `status` is accepted but is a no-op for these. */
const ACTIVE_STATUSES = ['active', 'last_donor_zone'] as const;

/** Real statuses that exist but are served by `/completed-campaigns`. */
const COMPLETED_STATUSES = ['completed', 'archived'] as const;

/** `Disaster Relief` -> `disaster-relief` */
function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Display label slug -> enum value.
 *
 * The category menu renders `CAMPAIGN_CATEGORIES[].label` while the UI emits
 * `value`, so the two drift for every multi-word legacy label: the menu shows
 * "Disaster Relief" but the link carries `?category=disaster`. A visitor (or an
 * old link, or anyone hand-editing the URL) who guesses `disaster-relief` was
 * guessing the string the product itself displays, so resolve it instead of
 * reporting it as junk.
 */
export const CATEGORY_ALIASES: Readonly<Record<string, CampaignCategory>> = Object.freeze(
  Object.fromEntries(
    CAMPAIGN_CATEGORIES.filter((c) => slugifyLabel(c.label) !== c.value).map((c) => [
      slugifyLabel(c.label),
      c.value,
    ]),
  ) as Record<string, CampaignCategory>,
);

/** Resolve a raw `category` value to an enum value, via alias if needed. */
export function resolveCategory(value: string): CampaignCategory | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if ((VALID_CATEGORIES as readonly string[]).includes(normalized)) {
    return normalized as CampaignCategory;
  }
  return CATEGORY_ALIASES[normalized] ?? null;
}

/** A param that carried a value the listing could not apply. */
export interface UnappliedParam {
  key: 'category' | 'sort' | 'status';
  value: string;
}

export interface ResolvedBrowseParams {
  category: CampaignCategory | null;
  sort: SortOption;
  searchQuery: string;
  location: string;
  closeToTarget: boolean;
  /**
   * True when something narrows the result set. `sort` is excluded on purpose:
   * it reorders the same rows, so it can never explain an empty listing.
   */
  filtersActive: boolean;
  /** Values that were not recognized, reported to the visitor. */
  unapplied: UnappliedParam[];
  /** `status=completed|archived`: a real status, served by another page. */
  completedRequested: boolean;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return typeof value === 'string' ? value : '';
}

/** Free text is trimmed and capped at the DB-query length the page uses. */
function freeText(value: string | string[] | undefined): string {
  return first(value).trim().slice(0, 100);
}

export function resolveBrowseParams(
  raw: Record<string, string | string[] | undefined>,
): ResolvedBrowseParams {
  const unapplied: UnappliedParam[] = [];

  const rawCategory = first(raw.category).trim();
  const category = rawCategory ? resolveCategory(rawCategory) : null;
  if (rawCategory && !category) {
    unapplied.push({ key: 'category', value: rawCategory });
  }

  const rawSort = first(raw.sort).trim();
  const sort: SortOption = (VALID_SORTS as readonly string[]).includes(rawSort.toLowerCase())
    ? (rawSort.toLowerCase() as SortOption)
    : DEFAULT_SORT;
  if (rawSort && sort !== rawSort.toLowerCase()) {
    unapplied.push({ key: 'sort', value: rawSort });
  }

  const rawStatus = first(raw.status).trim().toLowerCase();
  const completedRequested = (COMPLETED_STATUSES as readonly string[]).includes(rawStatus);
  if (
    rawStatus &&
    !completedRequested &&
    !(ACTIVE_STATUSES as readonly string[]).includes(rawStatus)
  ) {
    unapplied.push({ key: 'status', value: first(raw.status).trim() });
  }

  const searchQuery = freeText(raw.q);
  const location = freeText(raw.location);
  const closeToTarget = first(raw.close_to_target) === '1';

  return {
    category,
    sort,
    searchQuery,
    location,
    closeToTarget,
    filtersActive: Boolean(category) || Boolean(searchQuery) || Boolean(location) || closeToTarget,
    unapplied,
    completedRequested,
  };
}

/**
 * Build a `/campaigns` URL from raw param values, in canonical key order.
 * Empty values are dropped, so an all-empty set yields a bare `/campaigns`.
 */
export function campaignsHref(values: Partial<Record<BrowseParamKey, string>>): string {
  const search = new URLSearchParams();
  for (const key of BROWSE_PARAM_KEYS) {
    const value = values[key];
    if (typeof value === 'string' && value.trim() !== '') {
      search.set(key, value.trim());
    }
  }
  const qs = search.toString();
  return qs ? `/campaigns?${qs}` : '/campaigns';
}

/**
 * The pagination param.
 *
 * ⛔ Deliberately NOT in `BROWSE_PARAM_KEYS`. That list is what `campaignsHref`
 * carries between FILTER links, and a filter change must reset to page 1 -
 * otherwise changing the category from page 4 lands you past the end of a
 * one-page result. It is also what `/search` forwards, which has no pagination
 * of its own. Pagination is positional, not a filter.
 */
export const PAGE_PARAM = 'page';

/**
 * Build the URL for one page of the CURRENT listing.
 *
 * ⚠️ It reads the RAW params, not the resolved ones, so a value the listing
 * could not apply (`?category=nonsense`) survives the hop. `docs/45`'s rule is
 * that an unapplied value is reported rather than dropped; if pagination
 * dropped it, the "not applied" notice would vanish on page 2 and the visitor
 * would silently be shown a different result set than page 1. Keys outside
 * `BROWSE_PARAM_KEYS` are still discarded, so the URL stays canonical.
 *
 * ⛔ Page 1 carries NO `page` param, so the first page of every sequence is the
 * bare URL and `/campaigns` and `/campaigns?page=1` are never two addresses for
 * one document.
 */
export function campaignsPageHref(
  raw: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const key of BROWSE_PARAM_KEYS) {
    const value = first(raw[key]).trim();
    if (value !== '') search.set(key, value);
  }
  if (page > 1) search.set(PAGE_PARAM, String(page));
  const qs = search.toString();
  return qs ? `/campaigns?${qs}` : '/campaigns';
}

/** Human label for a param, used in the "not applied" notice. */
export const PARAM_LABELS: Readonly<Record<UnappliedParam['key'], string>> = Object.freeze({
  category: 'category',
  sort: 'sort order',
  status: 'status',
});
