/**
 * `runNewsPipeline` — blackout detection and run bounds.
 *
 * Two defects are locked down here.
 *
 * 1. The "all sources failed" critical alert could not fire. The pipeline
 *    derives `allFailed` from `Promise.allSettled` rejections, but
 *    `fema-client.ts` and `weather-alerts.ts` caught everything and returned
 *    `[]`, so they never rejected. A total news blackout therefore came back as
 *    HTTP 200, severity 'info', `fetched: 0` — indistinguishable from a quiet
 *    news day. The first test below drives the REAL clients with a dead network
 *    and no `GNEWS_API_KEY`; before the clients were changed to rethrow, it
 *    fails because no `pipeline.all_sources_failed` row is written.
 *
 * 2. The first real `fetch-rss` run was unbounded: 125 feeds x 25 items, then a
 *    full-body HTTP GET and an AI classification per article, with every thrown
 *    error appended to `result.errors` and the whole array written into one
 *    `audit_logs.details` JSONB row.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// ── DB: a universal chainable thenable ─────────────────────────────────────
//
// Every drizzle chain in this module terminates at a different depth
// (`.where()`, `.limit()`, `.returning()`, `.onConflictDoNothing()`), so one
// self-returning node that is also a promise covers all of them. Resolving to
// `[]` is the correct default for every read here: no existing URLs (so all
// articles are new), no settings row (so coded defaults apply), no recent
// campaigns, nothing deleted.
const insertedRows: { table: unknown; values: unknown }[] = [];

function chainNode(): Record<string, unknown> {
  const node: Record<string, unknown> = {};
  for (const method of [
    'from', 'where', 'orderBy', 'limit', 'set', 'returning', 'onConflictDoNothing',
  ]) {
    node[method] = () => node;
  }
  node.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve([]).then(resolve, reject);
  return node;
}

vi.mock('@/db', () => ({
  db: {
    select: () => chainNode(),
    update: () => chainNode(),
    delete: () => chainNode(),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertedRows.push({ table, values });
        return chainNode();
      },
    }),
  },
}));

vi.mock('@/db/schema', () => ({
  auditLogs: { __table: 'audit_logs' },
  newsItems: { __table: 'news_items', url: 'url', id: 'id', campaignCreated: 'campaign_created', fetchedAt: 'fetched_at', relevanceScore: 'relevance_score' },
  campaigns: { __table: 'campaigns', source: 'source', publishedAt: 'published_at', simulationFlag: 'simulation_flag', status: 'status', createdAt: 'created_at', title: 'title', subjectName: 'subject_name', category: 'category', location: 'location', id: 'id' },
  siteSettings: { __table: 'site_settings', key: 'key', value: 'value' },
  campaignSeedMessages: { __table: 'campaign_seed_messages' },
}));

// ── Heavy / networked collaborators ────────────────────────────────────────

const mockCallAI = vi.fn();
vi.mock('@/lib/ai/call-ai', () => ({ callAI: (...a: unknown[]) => mockCallAI(...a) }));

const mockFetchArticleBody = vi.fn().mockResolvedValue('body text');
vi.mock('./fetch-article-body', () => ({
  fetchArticleBody: (...a: unknown[]) => mockFetchArticleBody(...a),
}));

const mockFetchAllRssFeeds = vi.fn();
vi.mock('./rss-parser', () => ({
  fetchAllRssFeeds: () => mockFetchAllRssFeeds(),
}));

vi.mock('@/lib/news/image-validation', () => ({
  resolveHeroImage: vi.fn().mockResolvedValue('/images/categories/disaster-default.svg'),
}));

vi.mock('@/lib/seed/organizer-generator', () => ({
  generateOrganizerIdentity: vi.fn().mockResolvedValue({ name: 'A B', relation: 'friend', city: 'X' }),
}));

vi.mock('@/lib/settings.server', () => ({ getSetting: vi.fn().mockResolvedValue(10) }));

vi.mock('@/lib/seed/phase-out', () => ({
  calculateAutoVolume: vi.fn().mockResolvedValue(1.0),
}));

vi.mock('@/lib/news/volume-guards', () => ({
  DEFAULT_CAMPAIGN_DAILY_LIMIT: 10,
  DEFAULT_MAX_CONCURRENT_SIMULATED: 10,
}));

// NOTE: `./fema-client`, `./weather-alerts` and `./gnews-client` are
// deliberately NOT mocked — their failure signalling is the thing under test.

const { runNewsPipeline, MAX_NEW_ARTICLES_PER_RUN, MAX_PIPELINE_ERRORS } =
  await import('./news-pipeline');

// ── Helpers ────────────────────────────────────────────────────────────────

function auditRows(eventType: string) {
  return insertedRows
    .map((r) => r.values as Record<string, unknown>)
    .filter((v) => v && v.eventType === eventType);
}

function freshArticles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    title: `Article ${i}`,
    url: `https://example.com/story-${i}`,
    summary: 'Summary text',
    source: `Outlet ${i}`,
    publishedAt: new Date(),
    category: 'disaster' as const,
  }));
}

describe('runNewsPipeline', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GNEWS_API_KEY;

  beforeEach(() => {
    // The real FEMA/NWS clients log before rethrowing; that is intended
    // behaviour, not test noise worth reading 40 stack traces of.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    insertedRows.length = 0;
    mockCallAI.mockReset();
    mockFetchAllRssFeeds.mockReset();
    mockFetchArticleBody.mockReset().mockResolvedValue('body text');
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GNEWS_API_KEY;
    else process.env.GNEWS_API_KEY = originalKey;
  });

  describe('total blackout detection', () => {
    it('writes a critical pipeline.all_sources_failed row when all three sources fail', async () => {
      // GNews throws on the missing key; FEMA and NWS go through the real
      // clients onto a dead network.
      delete process.env.GNEWS_API_KEY;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENETDOWN')) as never;

      const result = await runNewsPipeline('ingest');

      const critical = auditRows('pipeline.all_sources_failed');
      expect(critical).toHaveLength(1);
      expect(critical[0].severity).toBe('critical');
      expect(result.errors.some((e) => e.includes('All news sources failed'))).toBe(true);
    });

    it('names each failed source in the critical row, so the cause is diagnosable', async () => {
      delete process.env.GNEWS_API_KEY;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENETDOWN')) as never;

      await runNewsPipeline('ingest');

      const details = auditRows('pipeline.all_sources_failed')[0].details as Record<string, unknown>;
      expect(details.gnews).toBeTruthy();
      expect(details.fema).toBeTruthy();
      expect(details.nws).toBeTruthy();
    });

    it('does not report a blackout at severity info', async () => {
      delete process.env.GNEWS_API_KEY;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENETDOWN')) as never;

      await runNewsPipeline('ingest');

      const infoRows = insertedRows
        .map((r) => r.values as Record<string, unknown>)
        .filter((v) => v?.severity === 'info');
      expect(infoRows).toHaveLength(0);
    });

    it('treats an empty RSS fetch as a blackout too, not a quiet news day', async () => {
      mockFetchAllRssFeeds.mockResolvedValue([]);

      const result = await runNewsPipeline('fetch-rss');

      const critical = auditRows('pipeline.all_sources_failed');
      expect(critical).toHaveLength(1);
      expect(critical[0].severity).toBe('critical');
      expect(result.fetched).toBe(0);
    });
  });

  describe('run bounds', () => {
    it('caps new articles per run and reports the remainder as deferred', async () => {
      const total = MAX_NEW_ARTICLES_PER_RUN * 3;
      mockFetchAllRssFeeds.mockResolvedValue(freshArticles(total));
      // Classification fails for every article: the breaker-tripped shape.
      mockCallAI.mockRejectedValue(new Error('AI breaker open'));

      const result = await runNewsPipeline('fetch-rss');

      expect(result.fetched).toBe(total);
      expect(result.deferred).toBe(total - MAX_NEW_ARTICLES_PER_RUN);
      // One body fetch per capped article, not per fetched article.
      expect(mockFetchArticleBody).toHaveBeenCalledTimes(MAX_NEW_ARTICLES_PER_RUN);
    });

    it('bounds result.errors and counts what it dropped', async () => {
      mockFetchAllRssFeeds.mockResolvedValue(freshArticles(MAX_NEW_ARTICLES_PER_RUN * 2));
      mockCallAI.mockRejectedValue(new Error('AI breaker open'));

      const result = await runNewsPipeline('fetch-rss');

      // Unbounded, this would be one string per classified article and go
      // straight into a single audit_logs.details JSONB row.
      expect(result.errors.length).toBeLessThanOrEqual(MAX_PIPELINE_ERRORS);
      expect(result.errorsOmitted).toBeGreaterThan(0);
    });

    it('leaves the over-cap articles uninserted, so the next run still sees them', async () => {
      mockFetchAllRssFeeds.mockResolvedValue(freshArticles(MAX_NEW_ARTICLES_PER_RUN + 5));
      mockCallAI.mockRejectedValue(new Error('AI breaker open'));

      await runNewsPipeline('fetch-rss');

      const newsInsert = insertedRows.find(
        (r) => (r.table as Record<string, unknown>)?.__table === 'news_items',
      );
      expect(Array.isArray(newsInsert?.values)).toBe(true);
      expect(newsInsert?.values as unknown[]).toHaveLength(MAX_NEW_ARTICLES_PER_RUN);
    });

    it('does not cap a run that is already under the limit', async () => {
      mockFetchAllRssFeeds.mockResolvedValue(freshArticles(5));
      mockCallAI.mockRejectedValue(new Error('AI breaker open'));

      const result = await runNewsPipeline('fetch-rss');

      expect(result.deferred).toBe(0);
      expect(mockFetchArticleBody).toHaveBeenCalledTimes(5);
    });
  });
});
