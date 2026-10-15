/**
 * Browse param resolution (docs/45).
 *
 * A live audit of production found three silent failures in these rules:
 *   - `/campaigns?category=bogus` and `?category=disaster-relief` both returned
 *     all 12 campaigns under the normal header, so an unrecognized value read
 *     as an endorsement of everything on the page.
 *   - `?sort=bogus` and `?status=completed` were dropped with no trace.
 *   - `disaster-relief` is the string the category menu DISPLAYS while the UI
 *     emits `?category=disaster`, so it is the value a visitor would guess.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveBrowseParams,
  resolveCategory,
  campaignsHref,
  CATEGORY_ALIASES,
  BROWSE_PARAM_KEYS,
  DEFAULT_SORT,
} from './browse-params';

describe('resolveBrowseParams', () => {
  describe('category', () => {
    it('accepts a canonical enum value', () => {
      const result = resolveBrowseParams({ category: 'medical' });
      expect(result.category).toBe('medical');
      expect(result.unapplied).toEqual([]);
      expect(result.filtersActive).toBe(true);
    });

    it('resolves the displayed label slug "disaster-relief" to "disaster"', () => {
      const result = resolveBrowseParams({ category: 'disaster-relief' });
      expect(result.category).toBe('disaster');
      expect(result.unapplied).toEqual([]);
    });

    it('reports an unrecognized category instead of dropping it', () => {
      const result = resolveBrowseParams({ category: 'bogus' });
      expect(result.category).toBeNull();
      expect(result.unapplied).toEqual([{ key: 'category', value: 'bogus' }]);
      // Nothing narrows the list, so the listing is deliberately unfiltered.
      expect(result.filtersActive).toBe(false);
    });

    it('does not report an absent category', () => {
      expect(resolveBrowseParams({}).unapplied).toEqual([]);
    });

    it('is case and whitespace tolerant', () => {
      expect(resolveBrowseParams({ category: ' Medical ' }).category).toBe('medical');
      expect(resolveBrowseParams({ category: 'Disaster-Relief' }).category).toBe('disaster');
    });
  });

  describe('sort', () => {
    it('accepts every supported sort', () => {
      for (const sort of ['newest', 'most_funded', 'least_funded', 'closing_soon']) {
        const result = resolveBrowseParams({ sort });
        expect(result.sort).toBe(sort);
        expect(result.unapplied).toEqual([]);
      }
    });

    it('reports an unrecognized sort and falls back to the default', () => {
      const result = resolveBrowseParams({ sort: 'bogus' });
      expect(result.sort).toBe(DEFAULT_SORT);
      expect(result.unapplied).toEqual([{ key: 'sort', value: 'bogus' }]);
    });

    it('does not count sort as a narrowing filter', () => {
      // Sort reorders the same rows, so it can never explain an empty list.
      expect(resolveBrowseParams({ sort: 'newest' }).filtersActive).toBe(false);
    });
  });

  describe('status', () => {
    it('treats the statuses this page lists as a no-op', () => {
      for (const status of ['active', 'last_donor_zone']) {
        const result = resolveBrowseParams({ status });
        expect(result.unapplied).toEqual([]);
        expect(result.completedRequested).toBe(false);
      }
    });

    it('flags status=completed as served by another page', () => {
      const result = resolveBrowseParams({ status: 'completed' });
      expect(result.completedRequested).toBe(true);
      expect(result.unapplied).toEqual([]);
    });

    it('flags status=archived the same way', () => {
      expect(resolveBrowseParams({ status: 'archived' }).completedRequested).toBe(true);
    });

    it('reports an unrecognized status', () => {
      const result = resolveBrowseParams({ status: 'bogus' });
      expect(result.completedRequested).toBe(false);
      expect(result.unapplied).toEqual([{ key: 'status', value: 'bogus' }]);
    });
  });

  it('reports every unapplied param at once', () => {
    const result = resolveBrowseParams({ category: 'nope', sort: 'nah', status: 'neither' });
    expect(result.unapplied.map((u) => u.key)).toEqual(['category', 'sort', 'status']);
  });

  describe('free text and toggles', () => {
    it('trims and caps q and location at 100 characters', () => {
      const long = 'x'.repeat(250);
      const result = resolveBrowseParams({ q: `  ${long}  `, location: `  ${long}  ` });
      expect(result.searchQuery).toHaveLength(100);
      expect(result.location).toHaveLength(100);
    });

    it('treats q, location and close_to_target as narrowing filters', () => {
      expect(resolveBrowseParams({ q: 'fire' }).filtersActive).toBe(true);
      expect(resolveBrowseParams({ location: 'Memphis' }).filtersActive).toBe(true);
      expect(resolveBrowseParams({ close_to_target: '1' }).filtersActive).toBe(true);
      expect(resolveBrowseParams({ close_to_target: '0' }).closeToTarget).toBe(false);
    });

    it('takes the first value of a repeated param', () => {
      expect(resolveBrowseParams({ q: ['fire', 'flood'] }).searchQuery).toBe('fire');
    });
  });
});

describe('CATEGORY_ALIASES', () => {
  it('maps the multi-word labels the category menu displays', () => {
    expect(CATEGORY_ALIASES['disaster-relief']).toBe('disaster');
    expect(resolveCategory('disaster-relief')).toBe('disaster');
  });

  it('never aliases a slug onto a different canonical value', () => {
    for (const [alias, value] of Object.entries(CATEGORY_ALIASES)) {
      expect(alias).not.toBe(value);
      expect(resolveCategory(alias)).toBe(value);
    }
  });
});

describe('campaignsHref', () => {
  it('returns a bare path when nothing is set', () => {
    expect(campaignsHref({})).toBe('/campaigns');
    expect(campaignsHref({ q: '   ' })).toBe('/campaigns');
  });

  it('keeps every supported param and encodes values', () => {
    const href = campaignsHref({
      q: 'house fire',
      category: 'medical',
      location: 'Memphis, TN',
      sort: 'newest',
      close_to_target: '1',
      status: 'active',
    });
    const search = new URLSearchParams(href.split('?')[1]);
    expect(search.get('q')).toBe('house fire');
    expect(search.get('category')).toBe('medical');
    expect(search.get('location')).toBe('Memphis, TN');
    expect(search.get('sort')).toBe('newest');
    expect(search.get('close_to_target')).toBe('1');
    expect(search.get('status')).toBe('active');
    expect([...search.keys()]).toHaveLength(BROWSE_PARAM_KEYS.length);
  });
});
