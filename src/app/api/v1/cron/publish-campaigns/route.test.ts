/**
 * `publish-campaigns` - a volume limit must not abort or fail the batch.
 *
 * The job runs every 30 minutes (`vercel.json`) against a daily campaign
 * limit, so `VOLUME_LIMIT` from `publishCampaignFromNewsItem` is the expected
 * steady state for most of each day, not a fault. The first version of this
 * handling counted the refusal, pushed it into `errors` (which flips the audit
 * row to severity 'warning') and `break`-ed out of the loop, so one
 * rate-limited item dropped the rest of the batch and every rate-limited run
 * looked like a failing cron.
 *
 * These tests pin: the batch continues, the refusal stays out of `errors`, and
 * it is reported on its own axis (`volumeLimited` / `rateLimited`).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockVerifyCronAuth = vi.fn().mockReturnValue(true);
vi.mock('@/lib/cron-auth', () => ({
  verifyCronAuth: (...a: unknown[]) => mockVerifyCronAuth(...a),
}));

const mockRelease = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/locks', () => ({
  acquireCronLock: async () => ({
    ok: true,
    degraded: false,
    lock: { key: 'k', distributed: true, release: mockRelease },
  }),
  CRON_LOCKS: { 'publish-campaigns': { name: 'publish-campaigns', ttlSeconds: 300 } },
  lockSkipPayload: () => ({ ok: true, data: { skipped: true, reason: 'locked' } }),
}));

vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));

const state = vi.hoisted(() => ({
  /** Queued resolutions for each `.limit()` in call order. */
  queries: [] as unknown[][],
  audits: [] as Record<string, unknown>[],
}));

vi.mock('@/db', () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = async () => state.queries.shift() ?? [];
    return c;
  };
  return {
    db: {
      select: () => chain(),
      insert: () => ({
        values: async (v: Record<string, unknown>) => { state.audits.push(v); },
      }),
    },
  };
});

vi.mock('@/db/schema', () => ({
  newsItems: { id: 'id', campaignCreated: 'campaign_created', relevanceScore: 'relevance_score' },
  campaigns: { title: 'title', publishedAt: 'published_at' },
  auditLogs: {},
}));

const mockPublish = vi.fn();
vi.mock('@/lib/news/campaign-publisher', () => ({
  publishCampaignFromNewsItem: (...a: unknown[]) => mockPublish(...a),
  // The candidate-selection logic is not under test here; keep the order the
  // route was given so each queued publisher outcome lines up with an item.
  selectBalancedCandidates: <T,>(items: readonly T[]) => [...items],
}));

const { GET } = await import('./route');

function request() {
  return { headers: { get: () => 'Bearer whatever' } } as never;
}

function item(n: number) {
  return {
    id: `news-${n}`,
    title: `Item ${n}`,
    source: 'AP',
    category: 'medical',
    relevanceScore: 90,
    campaignCreated: false,
  };
}

/** Queue the two selects the route performs: candidates, then recent titles. */
function seedQueries(items: unknown[]) {
  state.queries = [items, [{ title: 'An earlier campaign' }]];
}

const okResult = (id: string) => ({
  ok: true,
  data: { campaignId: id, campaignSlug: id, campaignTitle: id },
});

const volumeLimited = {
  ok: false,
  error: {
    code: 'VOLUME_LIMIT',
    message: 'Daily campaign creation limit reached (10/10 automated campaigns published today).',
    guard: 'daily_limit',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCronAuth.mockReturnValue(true);
  state.queries = [];
  state.audits = [];
});

describe('GET /api/v1/cron/publish-campaigns - volume-limited items', () => {
  it('does not abort the batch when one item is rate-limited', async () => {
    seedQueries([item(1), item(2), item(3)]);
    mockPublish
      .mockResolvedValueOnce(okResult('c1'))
      .mockResolvedValueOnce(volumeLimited)
      .mockResolvedValueOnce(okResult('c3'));

    const res = await GET(request());
    const body = await res.json();

    // Every candidate was attempted - the old `break` stopped at item 2.
    expect(mockPublish).toHaveBeenCalledTimes(3);
    expect(body.data.qualifiedItems).toBe(3);
    expect(body.data.published).toBe(2);
    expect(body.data.volumeLimited).toBe(1);
  });

  it('does not log a rate-limited item as a failure', async () => {
    seedQueries([item(1), item(2)]);
    mockPublish
      .mockResolvedValueOnce(volumeLimited)
      .mockResolvedValueOnce(okResult('c2'));

    const res = await GET(request());
    const body = await res.json();

    expect(body.data.errors).toEqual([]);
    expect(state.audits[0].severity).toBe('info');
  });

  it('reports rate-limited items in the summary, distinct from errors', async () => {
    seedQueries([item(1), item(2)]);
    mockPublish
      .mockResolvedValueOnce(volumeLimited)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'STORY_FAILED', message: 'Story generation failed' },
      });

    const res = await GET(request());
    const body = await res.json();

    expect(body.data.volumeLimited).toBe(1);
    expect(body.data.rateLimited).toHaveLength(1);
    expect(body.data.rateLimited[0]).toContain('Daily campaign creation limit reached');
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0]).toContain('Story generation failed');

    const details = state.audits[0].details as Record<string, unknown>;
    expect(details.rateLimited).toHaveLength(1);
    expect(details.volumeLimited).toBe(1);
    expect(state.audits[0].severity).toBe('warning'); // the real failure, not the limit
  });

  it('stays a 200 ok run when every item is rate-limited', async () => {
    seedQueries([item(1), item(2), item(3)]);
    mockPublish.mockResolvedValue(volumeLimited);

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.published).toBe(0);
    expect(body.data.volumeLimited).toBe(3);
    expect(body.data.errors).toEqual([]);
    expect(state.audits[0].severity).toBe('info');
    expect(mockPublish).toHaveBeenCalledTimes(3);
    expect(mockRelease).toHaveBeenCalled();
  });

  it('still keeps dedup outcomes out of errors and real failures in', async () => {
    seedQueries([item(1), item(2)]);
    mockPublish
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'DUPLICATE_SUBJECT', message: 'exists', campaignId: 'c9' },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'NO_CATEGORY', message: 'News item has no category' },
      });

    const res = await GET(request());
    const body = await res.json();

    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0]).toContain('no category');
    expect(body.data.volumeLimited).toBe(0);
    expect(body.data.rateLimited).toEqual([]);
  });

  it('still refuses without cron authorization', async () => {
    mockVerifyCronAuth.mockReturnValue(false);

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
