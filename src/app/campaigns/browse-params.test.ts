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
  campaignsPageHref,
  PAGE_PARAM,
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

    /*
      ⛔ CORRECTED 2026-10-29 (docs/146). This used to assert
      `completedRequested === true` for `archived`, i.e. that
      `/campaigns?status=archived` should tell the visitor that value is
      served by `/completed-campaigns`. That page has NEVER listed archived
      campaigns, so the old assertion pinned a statement the product could not
      honour - the test drifted, not the code. `archived` is a real status
      that neither page lists, which is exactly what the "not applied" notice
      is for (`docs/45`).
    */
    it('reports status=archived as NOT applied, because no page lists it', () => {
      const result = resolveBrowseParams({ status: 'archived' });
      expect(result.completedRequested).toBe(false);
      expect(result.unapplied).toEqual([{ key: 'status', value: 'archived' }]);
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

/**
 * Pagination URLs (docs/145).
 *
 * `page` is positional, not a filter, and the distinction is load-bearing:
 * `campaignsHref` is what FILTER links are built from and what `/search`
 * forwards, so a `page` in `BROWSE_PARAM_KEYS` would carry page 4 across a
 * category change and land the visitor past the end of a one-page result.
 */
describe('campaignsPageHref', () => {
  it('⛔ page is NOT a browse param', () => {
    // The whole reason there are two builders.
    expect(BROWSE_PARAM_KEYS as readonly string[]).not.toContain(PAGE_PARAM);
  });

  it('a filter link drops any page, so changing a filter resets to page 1', () => {
    // campaignsHref only knows BROWSE_PARAM_KEYS, so this is true by
    // construction - asserted because the obvious "improvement" is to teach
    // it about pages.
    expect(campaignsHref({ category: 'medical' })).toBe('/campaigns?category=medical');
  });

  it('page 1 is the bare URL, never ?page=1', () => {
    // Otherwise /campaigns and /campaigns?page=1 are two addresses for one
    // document.
    expect(campaignsPageHref({}, 1)).toBe('/campaigns');
    expect(campaignsPageHref({ category: 'medical' }, 1)).toBe('/campaigns?category=medical');
  });

  it('page 2 and beyond carry the param', () => {
    expect(campaignsPageHref({}, 2)).toBe('/campaigns?page=2');
    expect(campaignsPageHref({}, 17)).toBe('/campaigns?page=17');
  });

  it('preserves every active filter across the hop', () => {
    const href = campaignsPageHref(
      { q: 'house fire', category: 'medical', location: 'Memphis', sort: 'newest', close_to_target: '1' },
      3,
    );
    const search = new URLSearchParams(href.split('?')[1]);
    expect(search.get('q')).toBe('house fire');
    expect(search.get('category')).toBe('medical');
    expect(search.get('location')).toBe('Memphis');
    expect(search.get('sort')).toBe('newest');
    expect(search.get('close_to_target')).toBe('1');
    expect(search.get('page')).toBe('3');
  });

  it('⚠️ preserves a value the listing could NOT apply', () => {
    // docs/45: an unapplied value is reported, not dropped. If pagination
    // dropped it, the "not applied" notice would vanish on page 2 and the
    // visitor would silently see a different result set.
    expect(campaignsPageHref({ category: 'nonsense' }, 2)).toContain('category=nonsense');
  });

  it('discards keys outside the canonical set, so the URL cannot sprawl', () => {
    const href = campaignsPageHref({ utm_source: 'x', category: 'medical' }, 2);
    expect(href).not.toContain('utm_source');
    expect(href).toContain('category=medical');
  });

  it('reads the first value of a repeated param', () => {
    expect(campaignsPageHref({ category: ['medical', 'memorial'] }, 2)).toContain('category=medical');
  });

  it('puts page last, so the stable part of the URL is the prefix', () => {
    const href = campaignsPageHref({ q: 'fire', category: 'medical' }, 2);
    expect(href.endsWith('page=2')).toBe(true);
  });
});
