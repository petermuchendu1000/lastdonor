/**
 * Keyword search coverage (docs/45).
 *
 * Measured against the 12 live active campaigns, the old four-column predicate
 * returned ZERO results for 9 of 12 realistic donor queries while relevant
 * campaigns existed: "veteran", "ambulance", "surgery", "hospital",
 * "disaster", "memorial", "paralyzed", "soldier", "crash". The words a donor
 * searches for live in the story body and the category.
 *
 * `story_html` is markup, so the fix cannot be a naive `ILIKE '%q%'` over it:
 * every seeded story carries
 * `<a href="https://example.invalid/lastdonor-seed/...">`, so "https", "href"
 * or "lastdonor-seed" would match all 12 and read as a broken search.
 *
 * The SQL strips tags and entity references with `regexp_replace` before
 * matching. These tests run the exported JS mirror of that expression, and
 * assert the emitted SQL uses the SAME pattern constants, so the two cannot
 * drift silently. End-to-end verification against Postgres belongs in the
 * integration suite, which needs a live database.
 */
import { describe, it, expect } from 'vitest';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { campaigns } from '@/db/schema';
import {
  campaignSearchCondition,
  categoriesMatchingText,
  plainTextForSearch,
  likePattern,
  normalizeSearchQuery,
  HTML_TAG_PATTERN,
  HTML_ENTITY_PATTERN,
  BODY_MATCH_MIN_LENGTH,
} from './campaign-search';

/* ------------------------------------------------------------------ */
/*  Fixtures: the shape the publisher actually writes                  */
/*  (src/lib/ai/prompts/generate-campaign.ts: sections, <p>, a source  */
/*  <a href> link)                                                     */
/* ------------------------------------------------------------------ */

const SEED_SOURCE_LINK =
  '<a href="https://example.invalid/lastdonor-seed/raleigh-house-fire" target="_blank" rel="noopener noreferrer">LastDonor Example</a>';

const STORY = `<section data-section="situation"><p>A <strong>house fire</strong> left the family without a home. The father was taken to the hospital for surgery after the crash of a burning beam.</p></section><section data-section="source"><p>Source: ${SEED_SOURCE_LINK}</p></section>`;

/** What `ILIKE '%q%'` does, over the same text the SQL compares. */
function storyMatches(html: string, query: string): boolean {
  return plainTextForSearch(html).toLowerCase().includes(query.toLowerCase());
}

/** The SQL the predicate emits, with its bound parameters. */
function emitted(query: string) {
  const condition = campaignSearchCondition(query);
  return new QueryBuilder().select().from(campaigns).where(condition).toSQL();
}

/* ------------------------------------------------------------------ */
/*  Story body                                                        */
/* ------------------------------------------------------------------ */

describe('story body matching', () => {
  it('matches a term that appears only in the story prose', () => {
    // None of these are in title, subject name, location or hometown.
    for (const term of ['hospital', 'surgery', 'crash', 'burning beam']) {
      expect(storyMatches(STORY, term)).toBe(true);
    }
  });

  it('does NOT match markup tokens present in every story', () => {
    for (const token of [
      'href',
      'https',
      'lastdonor-seed',
      'example.invalid',
      'data-section',
      'noopener',
      'section',
      'strong',
    ]) {
      expect(storyMatches(STORY, token)).toBe(false);
    }
  });

  it('does not match HTML entity names', () => {
    const html = '<p>Rent &amp; utilities&nbsp;are overdue.</p>';
    expect(storyMatches(html, 'amp')).toBe(false);
    expect(storyMatches(html, 'nbsp')).toBe(false);
    expect(storyMatches(html, 'utilities')).toBe(true);
  });

  it('still matches prose that sits next to a stripped tag', () => {
    expect(storyMatches('<p><strong>Maria</strong> needs an ambulance</p>', 'ambulance')).toBe(true);
    expect(storyMatches('<p><strong>Maria</strong> needs help</p>', 'Maria')).toBe(true);
  });

  it('includes the story predicate in the emitted SQL, built from the same patterns', () => {
    const { sql, params } = emitted('hospital');
    expect(sql).toContain('regexp_replace');
    expect(sql).toContain('story_html');
    expect(params).toContain(HTML_TAG_PATTERN);
    expect(params).toContain(HTML_ENTITY_PATTERN);
    expect(params).toContain('%hospital%');
  });

  it('leaves the story body out for queries below the minimum length', () => {
    expect(BODY_MATCH_MIN_LENGTH).toBe(3);
    const { sql } = emitted('TN');
    // `story_html` is in every select list, so assert on the predicate itself.
    expect(sql).not.toContain('regexp_replace');
    // Short queries still reach the short columns.
    expect(sql).toContain('"subject_hometown" ilike');
  });
});

/* ------------------------------------------------------------------ */
/*  Category                                                          */
/* ------------------------------------------------------------------ */

describe('category matching', () => {
  it('matches a term that is only the campaign category', () => {
    expect(categoriesMatchingText('disaster')).toContain('disaster');
    expect(categoriesMatchingText('veteran')).toContain('veterans');
    expect(categoriesMatchingText('memorial')).toContain('memorial');
  });

  it('reconciles the displayed label with the emitted value', () => {
    // The menu shows "Disaster Relief"; the UI emits ?category=disaster.
    expect(categoriesMatchingText('disaster relief')).toEqual(['disaster']);
    expect(categoriesMatchingText('disaster-relief')).toEqual(['disaster']);
    expect(categoriesMatchingText('first responders')).toEqual(['first-responders']);
  });

  it('emits an enum IN (...) rather than a text cast', () => {
    const { sql } = emitted('disaster');
    expect(sql).toContain('"category" in');
    expect(sql).not.toContain('::text');
  });

  it('ignores category matching for queries below the minimum length', () => {
    expect(categoriesMatchingText('me')).toEqual([]);
    expect(categoriesMatchingText('')).toEqual([]);
  });

  it('does not match a category for an unrelated term', () => {
    expect(categoriesMatchingText('hospital')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  The columns that already worked must keep working                  */
/* ------------------------------------------------------------------ */

describe('existing column matching', () => {
  it('keeps title, subject name, location and hometown in the predicate', () => {
    const { sql, params } = emitted('fire');
    expect(sql).toContain('"title"');
    expect(sql).toContain('"subject_name"');
    expect(sql).toContain('"location"');
    expect(sql).toContain('"subject_hometown"');
    expect(params.filter((p) => p === '%fire%').length).toBeGreaterThanOrEqual(4);
  });

  it('is undefined for an empty query, so the listing is not narrowed', () => {
    expect(campaignSearchCondition('')).toBeUndefined();
    expect(campaignSearchCondition('   ')).toBeUndefined();
    expect(campaignSearchCondition(undefined)).toBeUndefined();
  });

  it('trims and caps the query', () => {
    expect(normalizeSearchQuery('  fire  ')).toBe('fire');
    expect(normalizeSearchQuery('x'.repeat(250))).toHaveLength(100);
    expect(normalizeSearchQuery(['fire', 'flood'])).toBe('fire');
  });

  it('escapes LIKE wildcards so a query cannot widen itself', () => {
    expect(likePattern('100%')).toBe('%100\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
    expect(likePattern('fire')).toBe('%fire%');
  });
});
