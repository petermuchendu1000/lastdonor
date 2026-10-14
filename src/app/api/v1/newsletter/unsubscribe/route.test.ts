/**
 * Audit P1-6 — newsletter unsubscribe was an unauthenticated third-party write.
 *
 * Pre-fix, `POST { email }` unsubscribed that address with no authentication of
 * any kind, and the route exported no `GET` at all — so the signed link we
 * actually put in every newsletter (`?token=...`, a GET) answered 405 while the
 * forgeable path worked.
 *
 * `docs/31` item 2.7: "an unauthenticated subscribe for someone else's email
 * fails."
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';

const SECRET = 'test-newsletter-unsubscribe-secret-0123456789';

const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  updatedIds: [] as unknown[],
}));

const sessionMock = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: sessionMock.auth }));

vi.mock('@/db', () => {
  const selectChain = () => {
    const rows = state.rows.shift() ?? [];
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => rows,
    };
    return chain;
  };
  return {
    db: {
      select: selectChain,
      update: () => ({
        set: (values: unknown) => ({
          where: async () => {
            state.updatedIds.push(values);
          },
        }),
      }),
    },
  };
});

const { GET, POST } = await import('./route');

function token(subscriberId: string, secret = SECRET): string {
  return `${subscriberId}.${createHmac('sha256', secret).update(subscriberId).digest('hex')}`;
}

function get(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://lastdonor.org${url}`, { method: 'GET', headers });
}

function postJson(url: string, body: unknown): NextRequest {
  return new NextRequest(`https://lastdonor.org${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ACTIVE_SUBSCRIBER = [{ id: 'sub-1', unsubscribedAt: null }];

beforeEach(() => {
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = SECRET;
  state.rows = [];
  state.updatedIds = [];
  sessionMock.auth.mockReset();
  sessionMock.auth.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/v1/newsletter/unsubscribe — third-party writes (P1-6)', () => {
  it('refuses to unsubscribe an address supplied by an anonymous caller', async () => {
    state.rows = [ACTIVE_SUBSCRIBER];
    const response = await POST(postJson('/api/v1/newsletter/unsubscribe', { email: 'victim@example.com' }));

    expect(response.status).toBe(401);
    expect(state.updatedIds).toEqual([]);
  });

  it('refuses to unsubscribe someone else while signed in', async () => {
    sessionMock.auth.mockResolvedValue({ user: { id: 'u1', email: 'attacker@example.com' } });
    state.rows = [ACTIVE_SUBSCRIBER];

    const response = await POST(postJson('/api/v1/newsletter/unsubscribe', { email: 'victim@example.com' }));

    expect(response.status).toBe(403);
    expect(state.updatedIds).toEqual([]);
  });

  it('lets a signed-in user unsubscribe their own address', async () => {
    sessionMock.auth.mockResolvedValue({ user: { id: 'u1', email: 'Owner@Example.com' } });
    state.rows = [ACTIVE_SUBSCRIBER];

    const response = await POST(postJson('/api/v1/newsletter/unsubscribe', { email: 'owner@example.com' }));

    expect(response.status).toBe(200);
    expect(state.updatedIds).toHaveLength(1);
  });

  it('accepts a valid signed token with no session (RFC 8058 one-click)', async () => {
    state.rows = [ACTIVE_SUBSCRIBER];
    const response = await POST(
      postJson(`/api/v1/newsletter/unsubscribe?token=${token('sub-1')}`, {}),
    );

    expect(response.status).toBe(200);
    expect(state.updatedIds).toHaveLength(1);
  });

  it('rejects a token signed with the wrong secret', async () => {
    state.rows = [ACTIVE_SUBSCRIBER];
    const response = await POST(
      postJson(`/api/v1/newsletter/unsubscribe?token=${token('sub-1', 'wrong-secret')}`, {}),
    );

    expect(response.status).toBe(401);
    expect(state.updatedIds).toEqual([]);
  });

  it('rejects a token whose subscriber id has been swapped', async () => {
    const valid = token('sub-1');
    const signature = valid.slice(valid.indexOf('.') + 1);
    state.rows = [ACTIVE_SUBSCRIBER];

    const response = await POST(
      postJson(`/api/v1/newsletter/unsubscribe?token=sub-2.${signature}`, {}),
    );

    expect(response.status).toBe(401);
    expect(state.updatedIds).toEqual([]);
  });
});

describe('GET /api/v1/newsletter/unsubscribe — the link in the newsletter', () => {
  it('unsubscribes on a valid signed token', async () => {
    state.rows = [ACTIVE_SUBSCRIBER];
    const response = await GET(get(`/api/v1/newsletter/unsubscribe?token=${token('sub-1')}`));

    expect(response.status).toBe(200);
    expect(state.updatedIds).toHaveLength(1);
  });

  it('renders a confirmation page for a browser', async () => {
    state.rows = [ACTIVE_SUBSCRIBER];
    const response = await GET(
      get(`/api/v1/newsletter/unsubscribe?token=${token('sub-1')}`, { accept: 'text/html' }),
    );

    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('unsubscribed');
  });

  it('refuses a missing token', async () => {
    state.rows = [ACTIVE_SUBSCRIBER];
    const response = await GET(get('/api/v1/newsletter/unsubscribe'));

    expect(response.status).toBe(401);
    expect(state.updatedIds).toEqual([]);
  });

  it('refuses every token when the signing secret is not configured', async () => {
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    state.rows = [ACTIVE_SUBSCRIBER];

    const response = await GET(get(`/api/v1/newsletter/unsubscribe?token=${token('sub-1')}`));

    expect(response.status).toBe(401);
    expect(state.updatedIds).toEqual([]);
  });

  it('is idempotent for an address that already unsubscribed', async () => {
    state.rows = [[{ id: 'sub-1', unsubscribedAt: new Date() }]];
    const response = await GET(get(`/api/v1/newsletter/unsubscribe?token=${token('sub-1')}`));

    expect(response.status).toBe(200);
    expect(state.updatedIds).toEqual([]);
  });

  it('does not disclose whether the subscriber exists', async () => {
    state.rows = [[]];
    const response = await GET(get(`/api/v1/newsletter/unsubscribe?token=${token('sub-404')}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { status: 'unsubscribed' } });
  });
});
