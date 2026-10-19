import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchNewsDataArticles,
  isNewsDataConfigured,
  countryGroupForRun,
  MAX_REQUESTS_PER_RUN,
} from './newsdata-client';

vi.mock('./keyword-rotation', () => ({
  selectNextKeyword: async (_c: string, keywords: string[]) => keywords[0],
}));

/*
  Everything asserted here was measured against the live API with a real
  key on 2026-10-19, not taken from the vendor's pages. See docs/92.

    free page size                10 results
    X-API-Limit-Remaining         199 after one call -> 200 credits/day
    content                       "ONLY AVAILABLE IN PAID PLANS"
    six country values            422 FilterLimitExceed
    q over 100 chars              422 UnsupportedQueryLength
*/

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const ARTICLE = {
  title: 'Family loses home in Nairobi floods',
  link: 'https://nation.africa/kenya/news/family-loses-home',
  description: 'A family of five is appealing for help after flooding.',
  pubDate: '2026-10-18 13:35:00',
  image_url: 'https://nation.africa/img/hero.jpg',
  source_name: 'Daily Nation',
};

describe('configuration', () => {
  const original = process.env.NEWSDATA_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.NEWSDATA_API_KEY;
    else process.env.NEWSDATA_API_KEY = original;
    vi.restoreAllMocks();
  });

  it('reports configured only when a key is present', () => {
    delete process.env.NEWSDATA_API_KEY;
    expect(isNewsDataConfigured()).toBe(false);
    process.env.NEWSDATA_API_KEY = 'pub_x';
    expect(isNewsDataConfigured()).toBe(true);
  });
});

describe('the request budget is the design constraint', () => {
  const original = process.env.NEWSDATA_API_KEY;
  beforeEach(() => {
    process.env.NEWSDATA_API_KEY = 'pub_test';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEWSDATA_API_KEY;
    else process.env.NEWSDATA_API_KEY = original;
    vi.restoreAllMocks();
  });

  it('never issues more than the per-run cap, whatever it is asked for', async () => {
    /*
      200 credits a day against 48 `ingest-news` runs is ~4 per run.
      The GNews client made exactly this mistake in the other
      direction - one request per category, 23 per run, 1,104 a day
      against a 100/day quota - and it was invisible because the key
      was never set. This is the test that would have caught it.
    */
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [ARTICLE] }));
    vi.stubGlobal('fetch', fetchMock);

    // Ask for all 23 categories.
    await fetchNewsDataArticles();
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_REQUESTS_PER_RUN);
  });

  it('sends at most five countries, because six is a 422', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchNewsDataArticles(['medical']);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('country')!.split(',').length).toBeLessThanOrEqual(5);
  });

  it('never sends a q over 100 characters, because that is a 422 and costs a credit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchNewsDataArticles(['medical']);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get('q')!.length).toBeLessThanOrEqual(100);
  });
});

describe('country rotation reaches markets a global query would not', () => {
  it('advances with the clock and wraps', () => {
    // 30-minute steps, because `ingest-news` is `*/30`.
    const step = 30 * 60 * 1000;
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      seen.add(countryGroupForRun(new Date(i * step)).join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
    // Deterministic: same instant, same group.
    expect(countryGroupForRun(new Date(0))).toEqual(countryGroupForRun(new Date(0)));
  });

  it('covers sub-Saharan Africa somewhere in the rotation', () => {
    // The entire reason for preferring NewsData over GNews, whose
    // country list has Egypt as its only African entry (docs/90).
    const step = 30 * 60 * 1000;
    const all = new Set<string>();
    for (let i = 0; i < 10; i++) {
      for (const c of countryGroupForRun(new Date(i * step))) all.add(c);
    }
    expect(all.has('ke')).toBe(true);
    expect(all.has('ng')).toBe(true);
    expect(all.has('za')).toBe(true);
  });
});

describe('mapping a result onto what the pipeline needs', () => {
  const original = process.env.NEWSDATA_API_KEY;
  beforeEach(() => {
    process.env.NEWSDATA_API_KEY = 'pub_test';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEWSDATA_API_KEY;
    else process.env.NEWSDATA_API_KEY = original;
    vi.restoreAllMocks();
  });

  it('keeps the real publisher link, which is what the body fetcher needs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results: [ARTICLE] })));
    const [item] = await fetchNewsDataArticles(['medical']);
    expect(item.url).toBe('https://nation.africa/kenya/news/family-loses-home');
    expect(item.url).not.toContain('newsdata.io');
  });

  it('parses pubDate as UTC, not as the server\'s local zone', async () => {
    /*
      `pubDate` arrives as "2026-10-18 13:35:00", which `new Date()`
      reads as LOCAL time. On a non-UTC machine every article would be
      hours off and the 14-day freshness filter would drift with the
      deployment region.
    */
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results: [ARTICLE] })));
    const [item] = await fetchNewsDataArticles(['medical']);
    expect(item.publishedAt?.toISOString()).toBe('2026-10-18T13:35:00.000Z');
  });

  it('survives a row with no usable title or link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ results: [{ description: 'orphan' }, ARTICLE] })),
    );
    const items = await fetchNewsDataArticles(['medical']);
    expect(items).toHaveLength(1);
  });

  it('uses description as the summary, because content is paid-only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ results: [{ ...ARTICLE, content: 'ONLY AVAILABLE IN PAID PLANS' }] }),
      ),
    );
    const [item] = await fetchNewsDataArticles(['medical']);
    expect(item.summary).toBe(ARTICLE.description);
    expect(item.summary).not.toContain('PAID PLANS');
  });
});

describe('an outage is distinguishable from a quiet news cycle', () => {
  const original = process.env.NEWSDATA_API_KEY;
  beforeEach(() => {
    process.env.NEWSDATA_API_KEY = 'pub_test';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEWSDATA_API_KEY;
    else process.env.NEWSDATA_API_KEY = original;
    vi.restoreAllMocks();
  });

  it('throws when every request fails', async () => {
    // The pipeline's blackout detector keys on this rejecting. GNews's
    // equivalent was dead code until docs/90 because it swallowed
    // every error and returned [].
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENETDOWN')));
    await expect(fetchNewsDataArticles(['medical'])).rejects.toThrow(/all 1 requests failed/);
  });

  it('throws on a 401, rather than reporting an empty news day', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'error' }), { status: 401 }),
      ),
    );
    await expect(fetchNewsDataArticles(['medical'])).rejects.toThrow(/HTTP 401/);
  });

  it('does not throw when some requests succeed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValue(jsonResponse({ results: [ARTICLE] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchNewsDataArticles()).resolves.toBeInstanceOf(Array);
  });

  it('throws without a key rather than silently fetching nothing', async () => {
    delete process.env.NEWSDATA_API_KEY;
    await expect(fetchNewsDataArticles(['medical'])).rejects.toThrow(/NEWSDATA_API_KEY/);
  });
});
