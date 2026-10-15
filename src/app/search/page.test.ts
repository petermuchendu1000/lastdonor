/**
 * `/search` must not eat the query (docs/45).
 *
 * `src/app/layout.tsx` declares `/search?q={search_term_string}` as the site's
 * SearchAction target, so this URL is what Google's sitelinks search box,
 * bookmarks, shared links and emails hit. The page used to
 * `redirect('/campaigns')` with no query string, which landed the visitor on
 * an unfiltered listing with no search term, no chip and no "no results".
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: nav.redirect }));

const SearchPage = (await import('./page')).default;

/** Run the page and return the path it redirected to. */
async function redirectTarget(
  params: Record<string, string | string[] | undefined>,
): Promise<string> {
  await expect(SearchPage({ searchParams: Promise.resolve(params) })).rejects.toThrow(
    /NEXT_REDIRECT/,
  );
  return nav.redirect.mock.calls.at(-1)?.[0] as string;
}

beforeEach(() => {
  nav.redirect.mockClear();
});

describe('/search', () => {
  it('forwards the search term to /campaigns', async () => {
    const target = await redirectTarget({ q: 'fire' });
    expect(target).toBe('/campaigns?q=fire');
    expect(new URLSearchParams(target.split('?')[1]).get('q')).toBe('fire');
  });

  it('forwards every param /campaigns supports, not just q', async () => {
    const target = await redirectTarget({
      q: 'house fire',
      category: 'disaster-relief',
      location: 'Memphis',
      sort: 'newest',
      close_to_target: '1',
      status: 'completed',
      utm_source: 'newsletter',
    });
    const search = new URLSearchParams(target.split('?')[1]);
    expect(search.get('q')).toBe('house fire');
    expect(search.get('category')).toBe('disaster-relief');
    expect(search.get('location')).toBe('Memphis');
    expect(search.get('sort')).toBe('newest');
    expect(search.get('close_to_target')).toBe('1');
    expect(search.get('status')).toBe('completed');
    // Params the listing does not understand are not carried over.
    expect(search.get('utm_source')).toBeNull();
  });

  it('redirects to the bare listing when there is nothing to forward', async () => {
    expect(await redirectTarget({})).toBe('/campaigns');
    expect(await redirectTarget({ q: '   ' })).toBe('/campaigns');
  });

  it('takes the first value of a repeated param', async () => {
    const target = await redirectTarget({ q: ['fire', 'flood'] });
    expect(new URLSearchParams(target.split('?')[1]).get('q')).toBe('fire');
  });
});
