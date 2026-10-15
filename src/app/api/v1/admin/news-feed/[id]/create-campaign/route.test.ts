/**
 * Admin "Create campaign" - a volume limit is a 429, not a 500.
 *
 * `publishCampaignFromNewsItem` gained a `VOLUME_LIMIT` outcome in df87a9b so
 * the daily campaign limit, `simulation.max_concurrent` and the phase-out
 * floor apply to every publish path. This route was not updated: its
 * `statusMap` had no `VOLUME_LIMIT` entry, so `statusMap[code] ?? 500`
 * returned 500, and the code ternary fell through to `INTERNAL_ERROR`. An
 * admin who clicked Create after the daily limit was reached was told the
 * server had crashed, with nothing to do about it.
 *
 * `RATE_LIMITED` is used because it is the closest member of the shared
 * `ApiError` code union in `src/types/api.ts` (which is NOT widened here), and
 * `src/lib/errors.ts` already pairs it with 429.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ID = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/auth', () => ({
  requireRole: async () => ({ user: { id: 'admin-1', role: 'admin' } }),
}));

const mockPublish = vi.fn();
vi.mock('@/lib/news/campaign-publisher', () => ({
  publishCampaignFromNewsItem: (...a: unknown[]) => mockPublish(...a),
}));

const { POST } = await import('./route');

const params = { params: Promise.resolve({ id: ID }) };

function post(): Request {
  return new Request(
    `https://lastdonor.org/api/v1/admin/news-feed/${ID}/create-campaign`,
    { method: 'POST' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/admin/news-feed/[id]/create-campaign - volume limits', () => {
  it('returns 429 RATE_LIMITED (not 500 INTERNAL_ERROR) when the daily limit is reached', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      error: {
        code: 'VOLUME_LIMIT',
        message:
          'Daily campaign creation limit reached (10/10 automated campaigns published today).',
        guard: 'daily_limit',
      },
    });

    const res = await POST(post(), params);
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.code).not.toBe('INTERNAL_ERROR');
  });

  it('names the guard, the current count and when it resets', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      error: {
        code: 'VOLUME_LIMIT',
        message:
          'Daily campaign creation limit reached (10/10 automated campaigns published today).',
        guard: 'daily_limit',
      },
    });

    const res = await POST(post(), params);
    const body = await res.json();

    expect(body.error.message).toContain('Daily campaign creation limit reached');
    expect(body.error.message).toContain('10/10');
    expect(body.error.message).toContain('00:00 UTC');
  });

  it('sets Retry-After to the seconds remaining until 00:00 UTC for the daily counter', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      error: { code: 'VOLUME_LIMIT', message: 'Daily limit reached (10/10).', guard: 'daily_limit' },
    });

    const res = await POST(post(), params);

    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(Number.isFinite(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(86400);
  });

  it('explains max_concurrent without inventing a reset time', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      error: {
        code: 'VOLUME_LIMIT',
        message: 'Max concurrent simulated campaigns reached (10/10 active).',
        guard: 'max_concurrent',
      },
    });

    const res = await POST(post(), params);
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toContain('10/10 active');
    expect(body.error.message).toMatch(/slot frees up/i);
    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it('says the phase-out floor is not a timed limit', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      error: {
        code: 'VOLUME_LIMIT',
        message: 'Phase-out threshold reached: enough real campaigns are active.',
        guard: 'phase_out',
      },
    });

    const res = await POST(post(), params);
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error.message).toMatch(/not a timed limit/i);
    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it('falls back to the publisher message when the guard name is unrecognised', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      error: { code: 'VOLUME_LIMIT', message: 'Some new guard refused.', guard: 'unknown_guard' },
    });

    const res = await POST(post(), params);
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toBe('Some new guard refused.');
  });
});

describe('POST /api/v1/admin/news-feed/[id]/create-campaign - other outcomes unchanged', () => {
  it('still maps NOT_FOUND to 404', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'News item not found' },
    });

    const res = await POST(post(), params);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('still maps ALREADY_CREATED to 409 CONFLICT', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      error: { code: 'ALREADY_CREATED', message: 'Already created', campaignId: 'c1' },
    });

    const res = await POST(post(), params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('still maps STORY_FAILED to 502 INTERNAL_ERROR', async () => {
    mockPublish.mockResolvedValue({
      ok: false,
      error: { code: 'STORY_FAILED', message: 'Story generation failed' },
    });

    const res = await POST(post(), params);
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns the campaign on success', async () => {
    mockPublish.mockResolvedValue({
      ok: true,
      data: { campaignId: 'c1', campaignSlug: 'jane-doe', campaignTitle: 'Help Jane Doe' },
    });

    const res = await POST(post(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.campaignSlug).toBe('jane-doe');
  });
});
