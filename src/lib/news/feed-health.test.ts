import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RSS_FEEDS,
  fetchRssFeedWithOutcome,
  fetchAllRssFeedsWithHealth,
  fetchAllRssFeeds,
} from '@/lib/news/rss-parser';
import { isGNewsConfigured, fetchGNewsArticles } from '@/lib/news/gnews-client';

/*
  Measured from the production machine on 2026-10-18: of the 125
  configured RSS feeds, 72 answered with items, 5 answered 200 with
  none, and 48 were dead - both wire services and every feed in the
  first-responders category among them.

  None of that was visible from inside the application. `fetchRssFeed`
  returns `[]` on any failure and `fetchAllRssFeeds` settles and drops
  rejections, so a feed that has 404'd for years looks exactly like a
  feed with nothing new. These tests hold the two properties that make
  the next one visible: an outcome per feed, and a roll-up the pipeline
  can act on.
*/

const RSS = '<?xml version="1.0"?><rss><channel>'
  + '<item><title>A firefighter was hurt</title><link>https://example.test/a</link>'
  + '<description>Something happened</description>'
  + '<pubDate>Sat, 18 Oct 2026 01:00:00 GMT</pubDate></item>'
  + '</channel></rss>';

describe('feed outcomes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports ok when a feed answers 200 with items', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(RSS, { status: 200 })));
    const { items, outcome } = await fetchRssFeedWithOutcome({ url: 'https://x.test/f', source: 'X' });
    expect(items).toHaveLength(1);
    expect(outcome.verdict).toBe('ok');
    expect(outcome.status).toBe(200);
  });

  it('distinguishes 200-with-no-items from 200-with-items', async () => {
    // Five real feeds were in exactly this state: DW's `www.dw.com`
    // paths, ODMP's `/rss/all`, Korea Herald, the NZ Herald and
    // Chronicle Zimbabwe. A caller that only checks `response.ok`
    // cannot tell them from a quiet feed.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<rss><channel/></rss>', { status: 200 })));
    const { outcome } = await fetchRssFeedWithOutcome({ url: 'https://x.test/f', source: 'X' });
    expect(outcome.verdict).toBe('empty');
    expect(outcome.items).toBe(0);
  });

  it('records the status of an HTTP failure rather than swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    const { items, outcome } = await fetchRssFeedWithOutcome({ url: 'https://x.test/f', source: 'X' });
    expect(items).toEqual([]);
    expect(outcome.verdict).toBe('http-error');
    expect(outcome.status).toBe(404);
  });

  it('records a transport failure, which has no status at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')));
    const { outcome } = await fetchRssFeedWithOutcome({ url: 'https://x.test/f', source: 'X' });
    expect(outcome.verdict).toBe('transport-error');
    expect(outcome.status).toBe(0);
    expect(outcome.detail).toContain('ENOTFOUND');
  });

  it('still returns a plain item array from the old entry point', async () => {
    // `fetchAllRssFeeds` keeps its signature; the health version is
    // additive, so nothing that only wants articles has to change.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(RSS, { status: 200 })));
    const items = await fetchAllRssFeeds();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  it('rolls every feed up into one health report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 404 })));
    const { items, health } = await fetchAllRssFeedsWithHealth();
    expect(items).toEqual([]);
    expect(health.total).toBe(RSS_FEEDS.length);
    expect(health.ok).toBe(0);
    expect(health.failing).toHaveLength(RSS_FEEDS.length);
    expect(health.failing[0].verdict).toBe('http-error');
  });
});

describe('the configured feed list', () => {
  it('has no duplicate URLs', () => {
    const urls = RSS_FEEDS.map((f) => f.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('does not point at the two wire-service hosts that no longer resolve', () => {
    // `feeds.reuters.com` is NXDOMAIN and `feeds.apnews.com` has no A
    // record, checked by DNS from the production machine on
    // 2026-10-18. Both had been configured since the list was written.
    const urls = RSS_FEEDS.map((f) => f.url).join(' ');
    expect(urls).not.toContain('feeds.reuters.com');
    expect(urls).not.toContain('feeds.apnews.com');
  });

  it('keeps at least one working feed for first-responders', () => {
    // All five feeds in this category were dead while the platform ran
    // a `first-responders` campaign category. Whatever the list is
    // reshuffled to, it must not be empty here again.
    const sources = RSS_FEEDS.map((f) => f.source);
    const responderFeeds = sources.filter((s) =>
      /ODMP|USFA|Firefighter|Fallen Firefighters/i.test(s),
    );
    expect(responderFeeds.length).toBeGreaterThanOrEqual(3);
  });

  it('covers more than one African country', () => {
    // GNews's `country` parameter accepts 37 values and Egypt is the
    // only African one (its own OpenAPI spec, 2026-10-18), so RSS is
    // the whole of our African reach.
    const urls = RSS_FEEDS.map((f) => f.url).join(' ');
    const tlds = ['.co.ke', '.co.za', '.co.tz', 'ngr.com', 'punchng', 'co.ug'];
    expect(tlds.filter((t) => urls.includes(t)).length).toBeGreaterThanOrEqual(4);
  });
});

describe('GNews is optional, and absence is not failure', () => {
  const original = process.env.GNEWS_API_KEY;
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) delete process.env.GNEWS_API_KEY;
    else process.env.GNEWS_API_KEY = original;
  });

  it('reports configured only when a key is present', () => {
    delete process.env.GNEWS_API_KEY;
    expect(isGNewsConfigured()).toBe(false);
    process.env.GNEWS_API_KEY = 'k';
    expect(isGNewsConfigured()).toBe(true);
  });

  it('throws when every request fails, so an outage is distinguishable', async () => {
    // Before this, each per-keyword error was caught and logged and the
    // function returned whatever it had - `[]` for a total outage. The
    // pipeline's blackout detector keys on this function rejecting, so
    // for GNews it could never fire.
    process.env.GNEWS_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENETDOWN')));
    await expect(fetchGNewsArticles(['medical'])).rejects.toThrow(/all 1 requests failed/);
  });

  it('does not throw when some requests succeed', async () => {
    process.env.GNEWS_API_KEY = 'k';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ articles: [] }), { status: 200 })),
    );
    await expect(fetchGNewsArticles(['medical'])).resolves.toEqual([]);
  });
});
