/**
 * Audit P1-6 — campaign subscribe/unsubscribe were unauthenticated
 * third-party writes.
 *
 * `PUBLIC_API_PREFIXES` matched `/api/v1/campaigns` with `startsWith`, so this
 * sub-route inherited the campaign listing's public status; `POST` and
 * `DELETE` then acted on whatever email was in the request body.
 *
 * `docs/31` item 2.7: "an unauthenticated subscribe for someone else's email
 * fails."
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';

const SECRET = 'test-campaign-unsubscribe-secret-0123456789';
const CAMPAIGN_ID = '11111111-2222-3333-4444-555555555555';

const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  inserts: [] as unknown[],
  updates: [] as unknown[],
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
      insert: () => ({
        values: (values: unknown) => ({
          onConflictDoUpdate: async () => {
            state.inserts.push(values);
          },
        }),
      }),
      update: () => ({
        set: (values: unknown) => ({
          where: async () => {
            state.updates.push(values);
          },
        }),
      }),
    },
  };
});

const { GET, POST, DELETE } = await import('./route');

const params = { params: Promise.resolve({ slug: 'a-campaign' }) };
const freshParams = () => ({ params: Promise.resolve({ slug: 'a-campaign' }) });

function unsubscribeToken(campaignId: string, email: string, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(`campaign-unsubscribe:v1:${campaignId}:${email}`)
    .digest('hex');
}

function jsonRequest(method: string, url: string, body: unknown): NextRequest {
  return new NextRequest(`https://lastdonor.org${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const CAMPAIGN_ROW = [{ id: CAMPAIGN_ID }];

beforeEach(() => {
  process.env.CAMPAIGN_UNSUBSCRIBE_SECRET = SECRET;
  state.rows = [];
  state.inserts = [];
  state.updates = [];
  sessionMock.auth.mockReset();
  sessionMock.auth.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST subscribe — no third-party opt-in (P1-6)', () => {
  it('refuses an anonymous caller subscribing someone else', async () => {
    state.rows = [CAMPAIGN_ROW];
    const response = await POST(
      jsonRequest('POST', '/api/v1/campaigns/a-campaign/subscribe', { email: 'victim@example.com' }),
      freshParams(),
    );

    expect(response.status).toBe(401);
    expect(state.inserts).toEqual([]);
  });

  it('refuses a signed-in caller subscribing someone else', async () => {
    sessionMock.auth.mockResolvedValue({ user: { id: 'u1', email: 'attacker@example.com' } });
    state.rows = [CAMPAIGN_ROW];

    const response = await POST(
      jsonRequest('POST', '/api/v1/campaigns/a-campaign/subscribe', { email: 'victim@example.com' }),
      freshParams(),
    );

    expect(response.status).toBe(403);
    expect(state.inserts).toEqual([]);
  });

  it('lets a signed-in user subscribe their own address', async () => {
    sessionMock.auth.mockResolvedValue({ user: { id: 'u1', email: 'owner@example.com' } });
    state.rows = [CAMPAIGN_ROW];

    const response = await POST(
      jsonRequest('POST', '/api/v1/campaigns/a-campaign/subscribe', { email: 'owner@example.com' }),
      freshParams(),
    );

    expect(response.status).toBe(201);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({ donorEmail: 'owner@example.com', campaignId: CAMPAIGN_ID });
  });

  it('writes the session address, not the body address, on a case mismatch', async () => {
    sessionMock.auth.mockResolvedValue({ user: { id: 'u1', email: 'Owner@Example.com' } });
    state.rows = [CAMPAIGN_ROW];

    const response = await POST(
      jsonRequest('POST', '/api/v1/campaigns/a-campaign/subscribe', { email: 'OWNER@example.com' }),
      freshParams(),
    );

    expect(response.status).toBe(201);
    expect(state.inserts[0]).toMatchObject({ donorEmail: 'owner@example.com' });
  });
});

describe('DELETE unsubscribe — signed token or own session (P1-6)', () => {
  it('refuses an anonymous caller with neither token nor session', async () => {
    state.rows = [CAMPAIGN_ROW];
    const response = await DELETE(
      jsonRequest('DELETE', '/api/v1/campaigns/a-campaign/subscribe', { email: 'victim@example.com' }),
      freshParams(),
    );

    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it('refuses a signed-in caller unsubscribing someone else', async () => {
    sessionMock.auth.mockResolvedValue({ user: { id: 'u1', email: 'attacker@example.com' } });
    state.rows = [CAMPAIGN_ROW];

    const response = await DELETE(
      jsonRequest('DELETE', '/api/v1/campaigns/a-campaign/subscribe', { email: 'victim@example.com' }),
      freshParams(),
    );

    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it('accepts a valid signed token with no session (the email-link flow)', async () => {
    state.rows = [CAMPAIGN_ROW];
    const email = 'subscriber@example.com';

    const response = await DELETE(
      jsonRequest(
        'DELETE',
        `/api/v1/campaigns/a-campaign/subscribe?token=${unsubscribeToken(CAMPAIGN_ID, email)}`,
        { email },
      ),
      freshParams(),
    );

    expect(response.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ subscribed: false });
  });

  it('accepts the token in the request body as well as the query string', async () => {
    state.rows = [CAMPAIGN_ROW];
    const email = 'subscriber@example.com';

    const response = await DELETE(
      jsonRequest('DELETE', '/api/v1/campaigns/a-campaign/subscribe', {
        email,
        token: unsubscribeToken(CAMPAIGN_ID, email),
      }),
      freshParams(),
    );

    expect(response.status).toBe(200);
    expect(state.updates).toHaveLength(1);
  });

  it('rejects a token minted for a different address', async () => {
    state.rows = [CAMPAIGN_ROW];

    const response = await DELETE(
      jsonRequest(
        'DELETE',
        `/api/v1/campaigns/a-campaign/subscribe?token=${unsubscribeToken(CAMPAIGN_ID, 'someone-else@example.com')}`,
        { email: 'victim@example.com' },
      ),
      freshParams(),
    );

    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it('rejects a token minted for a different campaign', async () => {
    state.rows = [CAMPAIGN_ROW];
    const email = 'subscriber@example.com';

    const response = await DELETE(
      jsonRequest(
        'DELETE',
        `/api/v1/campaigns/a-campaign/subscribe?token=${unsubscribeToken('99999999-9999-9999-9999-999999999999', email)}`,
        { email },
      ),
      freshParams(),
    );

    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it('rejects a token signed with the wrong secret', async () => {
    state.rows = [CAMPAIGN_ROW];
    const email = 'subscriber@example.com';

    const response = await DELETE(
      jsonRequest(
        'DELETE',
        `/api/v1/campaigns/a-campaign/subscribe?token=${unsubscribeToken(CAMPAIGN_ID, email, 'wrong')}`,
        { email },
      ),
      freshParams(),
    );

    expect(response.status).toBe(403);
  });

  it('rejects every token when no signing secret is configured', async () => {
    delete process.env.CAMPAIGN_UNSUBSCRIBE_SECRET;
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    state.rows = [CAMPAIGN_ROW];
    const email = 'subscriber@example.com';

    const response = await DELETE(
      jsonRequest(
        'DELETE',
        `/api/v1/campaigns/a-campaign/subscribe?token=${unsubscribeToken(CAMPAIGN_ID, email)}`,
        { email },
      ),
      freshParams(),
    );

    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it('lets a signed-in user unsubscribe their own address without a token', async () => {
    sessionMock.auth.mockResolvedValue({ user: { id: 'u1', email: 'owner@example.com' } });
    state.rows = [CAMPAIGN_ROW];

    const response = await DELETE(
      jsonRequest('DELETE', '/api/v1/campaigns/a-campaign/subscribe', { email: 'owner@example.com' }),
      freshParams(),
    );

    expect(response.status).toBe(200);
    expect(state.updates).toHaveLength(1);
  });
});

describe('GET subscription status is unchanged and discloses nothing', () => {
  it('answers false for an anonymous caller without touching the campaign', async () => {
    const response = await GET(
      new NextRequest('https://lastdonor.org/api/v1/campaigns/a-campaign/subscribe'),
      params,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { subscribed: false } });
  });

  it('reports the signed-in caller\'s own state', async () => {
    sessionMock.auth.mockResolvedValue({ user: { id: 'u1', email: 'owner@example.com' } });
    state.rows = [CAMPAIGN_ROW, [{ subscribed: true }]];

    const response = await GET(
      new NextRequest('https://lastdonor.org/api/v1/campaigns/a-campaign/subscribe'),
      freshParams(),
    );

    expect(await response.json()).toEqual({ ok: true, data: { subscribed: true } });
  });
});
