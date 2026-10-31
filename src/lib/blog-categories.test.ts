/**
 * The blog category vocabulary, and filter honesty on `/blog`.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * `/blog` resolved its filter with `CATEGORIES.find((c) => c.value ===
 * params.category)?.value` against a list whose first entry was
 * `{ label: 'All', value: null }`. An absent param is `undefined`, and
 * `null === undefined` is FALSE, so one expression produced two defects:
 * the All pill was never highlighted on any URL, and an UNRECOGNISED value
 * was indistinguishable from no filter, so the list widened in silence.
 *
 * [VERIFIED live on production before the fix] `/blog` served 0 active pills
 * while `/blog?category=news` served 1 - which is the control that makes the
 * first number a finding rather than a broken detector - and
 * `/blog?category=garbage-not-real` was served with 0 active pills and no
 * notice. `docs/164`.
 *
 * ── WHY THESE RULES ARE SHAPED THIS WAY ───────────────────────────────────
 *
 * Rule 1 DERIVES the expected vocabulary from `blogCategoryEnum`, the
 * database's own list, rather than restating three strings - the same shape
 * `campaign-labels.ts` uses, and what makes a fourth enum value fail here
 * instead of rendering `undefined` in production.
 *
 * Rules 4-6 read the two SURFACES from source, because the resolver being
 * correct proves nothing if a page keeps its own `find`. A rule that only
 * tested `resolveBlogCategory` would pass against the production defect.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { blogCategoryEnum } from '@/db/schema';
import {
  BLOG_CATEGORIES,
  BLOG_CATEGORY_LABELS,
  MAX_REPORTED_VALUE_LENGTH,
  blogCategoryLabel,
  blogCategoryTabs,
  blogEmptyState,
  isBlogCategory,
  resolveBlogCategory,
  unappliedCategoryNotice,
} from './blog-categories';

const ROOT = process.cwd();
const INDEX_PAGE = 'src/app/blog/(index)/page.tsx';
const API_ROUTE = 'src/app/api/v1/blog/route.ts';

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');
}

describe('the blog category vocabulary is the database enum', () => {
  it('ANTI-VACUITY: the enum is non-empty and is what we think it is', () => {
    expect(blogCategoryEnum.enumValues.length).toBeGreaterThan(0);
  });

  it('⛔ every enum value is listed and labelled, and nothing extra is', () => {
    // DERIVED: the expectation is the database's list, not a retyped one.
    expect([...BLOG_CATEGORIES].sort()).toEqual([...blogCategoryEnum.enumValues].sort());
    expect(Object.keys(BLOG_CATEGORY_LABELS).sort()).toEqual(
      [...blogCategoryEnum.enumValues].sort(),
    );
    for (const value of blogCategoryEnum.enumValues) {
      expect(blogCategoryLabel(value), `${value} has no label`).toBeTruthy();
    }
  });
});

describe('resolveBlogCategory tells absence from rejection', () => {
  it('⛔ an absent, empty or whitespace param is "all", never a filter', () => {
    for (const raw of [undefined, null, '', '   ']) {
      expect(resolveBlogCategory(raw), `${JSON.stringify(raw)}`).toEqual({ kind: 'all' });
    }
  });

  it('a recognised value resolves to itself', () => {
    for (const value of blogCategoryEnum.enumValues) {
      expect(resolveBlogCategory(value)).toEqual({ kind: 'category', value });
    }
  });

  it('⛔ an UNRECOGNISED value is "unapplied" and is NOT "all"', () => {
    /*
      This is the whole point. `undefined` meant both, which is how the
      silent widening happened - so the two must be distinguishable, and
      asserting `kind === 'unapplied'` alone would be satisfied by a resolver
      that called EVERYTHING unapplied. Hence the paired assertion with the
      recognised case above, and the explicit not-equal here.
    */
    const r = resolveBlogCategory('garbage-not-real');
    expect(r).toEqual({ kind: 'unapplied', raw: 'garbage-not-real' });
    expect(r).not.toEqual({ kind: 'all' });

    // Near-misses are rejected, not coerced.
    for (const raw of ['News', 'news ', 'campaign_stories', 'null', 'undefined']) {
      expect(resolveBlogCategory(raw).kind, raw).toBe('unapplied');
    }
  });

  it('a repeated param reads its first entry', () => {
    expect(resolveBlogCategory(['news', 'impact_report'])).toEqual({
      kind: 'category',
      value: 'news',
    });
  });

  it('isBlogCategory does not admit a non-string', () => {
    expect(isBlogCategory(undefined)).toBe(false);
    expect(isBlogCategory(null)).toBe(false);
    expect(isBlogCategory(1)).toBe(false);
    expect(isBlogCategory('news')).toBe(true);
  });

  it('⚠️ the reported value is bounded - a query string is attacker-controlled', () => {
    const long = 'x'.repeat(500);
    const notice = unappliedCategoryNotice(long);
    expect(notice).toContain('…');
    expect(notice.length).toBeLessThan(MAX_REPORTED_VALUE_LENGTH + 120);
    // CONTROL: a short value is reported in full, so the bound is a bound
    // and not a blanket truncation that hides what was asked for.
    expect(unappliedCategoryNotice('garbage')).toContain('garbage');
  });
});

describe('the surfaces use the resolver', () => {
  it('⛔ neither surface keeps its own category list', () => {
    for (const rel of [INDEX_PAGE, API_ROUTE]) {
      const src = source(rel);
      /*
        The literal enum values must not reappear as a hand-written list.
        ⚠️ `/blog`'s tab hrefs are built from `BLOG_CATEGORIES`, so a value
        appearing here means somebody restated the vocabulary.
      */
      for (const value of blogCategoryEnum.enumValues) {
        expect(src, `${rel} restates the category "${value}"`).not.toContain(`'${value}'`);
        expect(src, `${rel} restates the category "${value}"`).not.toContain(`"${value}"`);
      }
    }
  });

  it('⛔ neither surface resolves its own filter', () => {
    for (const rel of [INDEX_PAGE, API_ROUTE]) {
      const src = source(rel);
      expect(src, `${rel} does not call resolveBlogCategory`).toMatch(
        /resolveBlogCategory\s*\(/,
      );
      /*
        The production defect, by shape: a `.find()` or `.includes()` over a
        local list deciding the filter. Either is how a surface comes to have
        a second opinion about what a URL means.
      */
      expect(src, `${rel} still decides the filter itself`).not.toMatch(
        /CATEGORIES\s*\.\s*(?:find|includes)\s*\(/,
      );
    }
  });

  it('⛔ BOTH surfaces report an unapplied value', () => {
    /*
      `docs/45`: never silently widen. The page renders a notice; the API
      puts it in `meta`. A rule covering only one of them would have passed
      against the half-fix - the API carried the identical defect and was
      found only by reading it.
    */
    expect(source(INDEX_PAGE), 'the page does not report an unapplied filter').toMatch(
      /unappliedCategoryNotice\s*\(/,
    );
    expect(source(API_ROUTE), 'the API does not report an unapplied filter').toMatch(
      /unappliedCategory/,
    );
  });

  it('⛔ the page renders the tabs and the empty state from the deciders', () => {
    /*
      The judgements are EXECUTED below. What source can usefully say is that
      the page asks them rather than keeping a second opinion in JSX - the
      `docs/147` lesson that a leftover import satisfies `includes`, so these
      match a CALL.
    */
    const src = source(INDEX_PAGE);
    expect(src, 'the page decides its own tabs').toMatch(/blogCategoryTabs\s*\(/);
    expect(src, 'the page decides its own empty state').toMatch(/blogEmptyState\s*\(/);
    // ⛔ No nullable category value may come back to be compared with `===`.
    expect(src, 'a nullable category value is back').not.toMatch(/value:\s*null/);
  });
});

describe('EXECUTED: the tab strip and the empty state', () => {
  function active(resolved: Parameters<typeof blogCategoryTabs>[0]): string[] {
    return blogCategoryTabs(resolved)
      .filter((t) => t.isActive)
      .map((t) => t.label);
  }

  it('ANTI-VACUITY: the strip has All plus every category', () => {
    const tabs = blogCategoryTabs({ kind: 'all' });
    expect(tabs).toHaveLength(blogCategoryEnum.enumValues.length + 1);
    expect(tabs[0].label).toBe('All');
    expect(tabs[0].href).toBe('/blog');
  });

  it('⛔ exactly ONE tab is active in every state', () => {
    /*
      This is the defect, measured. Before the fix `/blog` had ZERO active
      tabs - [VERIFIED live: 0 active pills, against 1 on
      `/blog?category=news` as the control].

      ⚠️ "exactly one" is asserted for EVERY state rather than All being
      asserted alone, because a strip that highlighted everything would
      satisfy "All is active".
    */
    expect(active({ kind: 'all' })).toEqual(['All']);
    expect(active({ kind: 'unapplied', raw: 'garbage' })).toEqual(['All']);
    for (const value of blogCategoryEnum.enumValues) {
      expect(active({ kind: 'category', value })).toEqual([BLOG_CATEGORY_LABELS[value]]);
    }
  });

  it('⛔ an unapplied filter highlights All, because that IS the list shown', () => {
    /*
      CONTROL on the quieter version of the same defect: keying All on
      `kind === 'all'` alone leaves `/blog?category=garbage` with no tab
      active while every post is on screen. The paired assertion is that a
      REAL category does not highlight All, so "always All" cannot pass.
    */
    expect(blogCategoryTabs({ kind: 'unapplied', raw: 'garbage' })[0].isActive).toBe(true);
    expect(blogCategoryTabs({ kind: 'category', value: 'news' })[0].isActive).toBe(false);
  });

  it('⛔ the empty state does not claim the whole blog is empty while filtered', () => {
    const all = blogEmptyState({ kind: 'all' });
    expect(all.message).toMatch(/No posts published yet/);
    expect(all.showAllLink).toBe(false);

    for (const value of blogCategoryEnum.enumValues) {
      const filtered = blogEmptyState({ kind: 'category', value });
      expect(
        filtered.message,
        `a ${value} filter claims the whole blog is empty`,
      ).not.toMatch(/No posts published yet/);
      expect(filtered.message).toContain(BLOG_CATEGORY_LABELS[value].toLowerCase());
      // A way out of a filter that matched nothing.
      expect(filtered.showAllLink).toBe(true);
    }
  });

  it('⚠️ an unapplied value keeps the whole-blog copy, which is TRUE there', () => {
    /*
      Not an oversight: the filter was not applied, so the list really is
      every post, and the notice above it already names the value that was
      rejected. Pinned so nobody "fixes" it into a claim about a category
      that does not exist.
    */
    expect(blogEmptyState({ kind: 'unapplied', raw: 'garbage' }).message).toMatch(
      /No posts published yet/,
    );
  });
});
