/**
 * The blog's public category vocabulary, and the one place that decides which
 * category a URL is asking for.
 *
 * ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
 *
 * `/blog` resolved its own filter with:
 *
 *     CATEGORIES.find((c) => c.value === params.category)?.value
 *
 * where the first entry was `{ label: 'All', value: null }`. An absent param
 * is `undefined`, and `null === undefined` is FALSE, so `find` never matched
 * the All entry - which produced TWO defects from one expression:
 *
 *  1. `isActive` compared `undefined === null`, so the **All pill was never
 *     highlighted on any URL**. [VERIFIED live: 0 active pills on `/blog`,
 *     1 on `/blog?category=news` as the control.]
 *  2. `find` also returns `undefined` for an UNRECOGNISED value, which is
 *     indistinguishable from "no filter" - so `/blog?category=garbage`
 *     silently showed every post, with no tab active and nothing saying the
 *     filter had been dropped.
 *
 * (2) is what `src/app/campaigns/browse-params.ts` forbids in its own header:
 * *"The rule for a value we cannot apply is: never silently widen the result
 * set."* That decision is `docs/45`, it was made for `/campaigns`, and it was
 * never swept over `/blog` or `GET /api/v1/blog`.
 *
 * ── WHY A DISCRIMINATED RESULT, NOT A VALUE ───────────────────────────────
 *
 * ⛔ The root cause is that ONE value had to mean two different things. A
 * resolver returning `BlogCategory | null` would reintroduce it, because
 * "the visitor asked for everything" and "the visitor asked for something we
 * do not have" would both be `null` again. `resolveBlogCategory` returns a
 * kind, so the caller cannot conflate them without saying so.
 *
 * ── WHY THE LABELS LIVE HERE ──────────────────────────────────────────────
 *
 * There were EIGHT hand-written copies of this three-value list across seven
 * files, none derived from `blogCategoryEnum`. This module holds the public
 * one; `src/components/admin/` keeps its own by the `docs/110` §4 precedent
 * (two audiences, two vocabularies), and `docs/164` §4 records the rest.
 *
 * ⛔ `BlogCategory` is `BlogPost['category']`, which `InferSelectModel`
 * derives from `blogCategoryEnum` - so a fourth enum value widens the union
 * and `Record<BlogCategory, string>` FAILS TO COMPILE until somebody gives it
 * a label. `/blog/[slug]` used `Record<string, string>`, which compiles with
 * a hole and renders `undefined` (`docs/144`'s lesson). The ORDERED runtime
 * list cannot be derived by the type system, so a test asserts it against
 * `blogCategoryEnum.enumValues` instead of restating it - the same shape
 * `src/lib/campaign-labels.ts` uses.
 */
import type { BlogPost } from '@/types';
import { reportedValue } from '@/lib/reported-value';

export type BlogCategory = BlogPost['category'];

/**
 * Public labels. Keyed by the union, so tsc enumerates the enum for us.
 */
export const BLOG_CATEGORY_LABELS: Readonly<Record<BlogCategory, string>> = Object.freeze({
  campaign_story: 'Campaign Story',
  impact_report: 'Impact Report',
  news: 'News',
});

/**
 * Tab order on `/blog`. Asserted complete against `blogCategoryEnum` by
 * `blog-categories.test.ts`.
 */
export const BLOG_CATEGORIES: readonly BlogCategory[] = Object.freeze([
  'campaign_story',
  'impact_report',
  'news',
] as const);

export function blogCategoryLabel(value: BlogCategory): string {
  return BLOG_CATEGORY_LABELS[value];
}

export function isBlogCategory(value: unknown): value is BlogCategory {
  return typeof value === 'string' && (BLOG_CATEGORIES as readonly string[]).includes(value);
}

/**
 * What a `?category=` value means.
 *
 * - `all`       - nothing was asked for (absent, empty, or whitespace).
 * - `category`  - a value we recognise and will apply.
 * - `unapplied` - a value we do NOT recognise. The caller must say so and
 *                 must not pretend the unfiltered list matches it.
 */
export type ResolvedBlogCategory =
  | { kind: 'all' }
  | { kind: 'category'; value: BlogCategory }
  | { kind: 'unapplied'; raw: string };

export function resolveBlogCategory(
  raw: string | string[] | undefined | null,
): ResolvedBlogCategory {
  // A repeated param (`?category=a&category=b`) arrives as an array; the
  // first entry is what `/campaigns` reads too, so the two agree.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim() === '') return { kind: 'all' };
  if (isBlogCategory(value)) return { kind: 'category', value };
  return { kind: 'unapplied', raw: value };
}

/**
 * ⛔ RE-EXPORTED, not defined here.
 *
 * This file used to own a `MAX_REPORTED_VALUE_LENGTH = 40` of its own while
 * `/completed-campaigns` capped at 60 and `/campaigns` at nothing — three
 * implementations of one rule, with three answers. One definition now lives
 * in `src/lib/reported-value.ts`; the alias is kept so existing importers
 * keep working.
 */
export { MAX_REPORTED_VALUE_LENGTH } from '@/lib/reported-value';

export interface BlogTab {
  href: string;
  label: string;
  isActive: boolean;
}

/**
 * The tab strip, decided here rather than in JSX.
 *
 * ⛔ This is a PURE FUNCTION on purpose. The defect was an inverted-by-
 * accident active test (`undefined === null`), and a rule that reads the page
 * as TEXT cannot see which way a branch points - `docs/162` §5.1 proved that
 * by inverting a decider and passing every structural rule. Executed, an
 * inversion is visible.
 *
 * ⚠️ `All` is active for BOTH `all` and `unapplied`, and that is the honest
 * answer rather than a convenience: in both states the unfiltered list is
 * what is on the screen, so that is the tab describing it. Keying it on
 * `all` alone would leave `/blog?category=garbage` with no tab active while
 * showing every post - a quieter version of the original defect.
 */
export function blogCategoryTabs(resolved: ResolvedBlogCategory): BlogTab[] {
  return [
    { href: '/blog', label: 'All', isActive: resolved.kind !== 'category' },
    ...BLOG_CATEGORIES.map((value) => ({
      href: `/blog?category=${value}`,
      label: blogCategoryLabel(value),
      isActive: resolved.kind === 'category' && resolved.value === value,
    })),
  ];
}

/**
 * What to say when the list is empty.
 *
 * ⚠️ "No posts published yet" is a claim about the WHOLE BLOG. With a
 * category applied it is false the moment any other category holds a post -
 * latent today (`docs/123`: `blog_posts` has 0 published rows ever) and wrong
 * by construction, so it is decided from the resolved filter. Pure for the
 * same reason as `blogCategoryTabs`.
 */
export function blogEmptyState(
  resolved: ResolvedBlogCategory,
): { message: string; showAllLink: boolean } {
  if (resolved.kind === 'category') {
    return {
      message: `No ${blogCategoryLabel(resolved.value).toLowerCase()} posts yet.`,
      showAllLink: true,
    };
  }
  return { message: 'No posts published yet. Check back soon.', showAllLink: false };
}

/**
 * The sentence shown to a visitor whose filter could not be applied.
 *
 * ⚠️ Deliberately the same shape as `/campaigns`' notice: name the value back
 * to them, and say what they are looking at instead. The value is rendered as
 * text by React, so it is escaped; it is still capped, and the surface that
 * renders it must let it WRAP — a cap alone leaves an unbroken 40-character
 * run that still overflows a phone. See `src/lib/reported-value.ts`.
 */
export function unappliedCategoryNotice(raw: string): string {
  return `We do not have a category called “${reportedValue(raw)}”. Showing every story instead.`;
}
