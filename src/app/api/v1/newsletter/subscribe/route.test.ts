/**
 * Newsletter subscribe — P0 (legal) and P1 fixed 2026-10-15.
 *
 *  - The welcome email is a marketing message and shipped with **no**
 *    unsubscribe link and **no** `List-Unsubscribe` header.
 *  - The send sat in a completely empty `catch {}`, and the Resend SDK never
 *    throws (it resolves `{ data: null, error }`), so a total outage was
 *    invisible (docs/29 P0-4, src/lib/utils/retry.ts:6-12).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-tokens';

const SECRET = 'test-newsletter-unsubscribe-secret-0123456789';
const NEW_ID = '22222222-2222-4222-8222-222222222222';

const state = vi.hoisted(() => ({
  existing: [] as unknown[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  returnedId: '' as string,
  sendResults: [] as { data: unknown; error: unknown }[],
  sendCalls: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/resend', () => ({
  resend: {
    emails: {
      send: async (args: Record<string, unknown>) => {
        state.sendCalls.push(args);
        return state.sendResults.shift() ?? { data: { id: 'ok' }, error: null };
      },
    },
  },
}));

vi.mock('@/db', () => ({
  db: {
    select: () => {
      const c: Record<string, unknown> = {};
      c.from = () => c;
      c.where = () => c;
      c.limit = async () => state.existing;
      return c;
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.inserted.push(v);
        return { returning: async () => [{ id: state.returnedId }] };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => { state.updated.push(v); },
      }),
    }),
  },
}));

const { POST } = await import('./route');

function post(body: unknown): NextRequest {
  return new NextRequest('https://lastdonor.org/api/v1/newsletter/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = 'https://lastdonor.org';
  state.existing = [];
  state.inserted = [];
  state.updated = [];
  state.returnedId = NEW_ID;
  state.sendResults = [];
  state.sendCalls = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('welcome email opt-out (P0, legal)', () => {
  it('includes a verifiable signed unsubscribe link in the body', async () => {
    await POST(post({ email: 'new@example.com', source: 'homepage' }));

    expect(state.sendCalls).toHaveLength(1);
    /*
      ⚠️ `html`, not `text`. The body used to be a hand-written `text:`
      string in the route, which put it outside both email sweeps; it now
      renders through the one shell (`docs/123`). The assertion is the same
      one - the link must carry a token this process can verify - read from
      the field the body is actually in.

      The capture stops at a quote and an ampersand because this is markup
      now: `[^\s]+` would swallow the rest of the anchor's style attribute.
    */
    const html = state.sendCalls[0].html as string;
    expect(state.sendCalls[0].text).toBeUndefined();
    const match = html.match(/token=([^"\s&]+)/);
    expect(match).not.toBeNull();
    expect(verifyUnsubscribeToken(decodeURIComponent(match![1]))).toBe(NEW_ID);
  });

  it('sets List-Unsubscribe and RFC 8058 List-Unsubscribe-Post headers', async () => {
    await POST(post({ email: 'new@example.com' }));

    const headers = state.sendCalls[0].headers as Record<string, string>;
    expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/lastdonor\.org\/api\/v1\/newsletter\/unsubscribe\?token=/);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('falls back to a mailto opt-out rather than a dead link when the token secret is unset', async () => {
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;

    const res = await POST(post({ email: 'new@example.com' }));

    expect(res.status).toBe(201);
    const headers = state.sendCalls[0].headers as Record<string, string>;
    expect(headers['List-Unsubscribe']).toBe('<mailto:support@lastdonor.org?subject=Unsubscribe>');
    expect(headers).not.toHaveProperty('List-Unsubscribe-Post');
    expect(state.sendCalls[0].html as string).toContain('mailto:support@lastdonor.org');
  });
});

describe('Resend error handling (P1)', () => {
  it('logs a resolved { error } instead of swallowing it in an empty catch', async () => {
    state.sendResults = [
      { data: null, error: { message: 'domain not verified' } },
      { data: null, error: { message: 'domain not verified' } },
      { data: null, error: { message: 'domain not verified' } },
    ];

    const res = await POST(post({ email: 'new@example.com' }));

    expect(res.status).toBe(201); // subscription still succeeds
    expect(console.error).toHaveBeenCalledWith(
      '[newsletter/subscribe] Resend API error sending welcome email:',
      { message: 'domain not verified' },
    );
  });

  it('retries a result-shaped failure, then succeeds quietly', async () => {
    state.sendResults = [
      { data: null, error: { message: 'transient' } },
      { data: { id: 'ok' }, error: null },
    ];

    await POST(post({ email: 'new@example.com' }));

    expect(state.sendCalls).toHaveLength(2);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('never fails the subscription because of a send error', async () => {
    state.sendResults = [
      { data: null, error: { message: 'x' } },
      { data: null, error: { message: 'x' } },
      { data: null, error: { message: 'x' } },
    ];

    const body = await (await POST(post({ email: 'new@example.com' }))).json();
    expect(body).toEqual({ ok: true, data: { status: 'subscribed' } });
  });
});

describe('idempotent paths send no mail', () => {
  it('already_subscribed sends nothing', async () => {
    state.existing = [{ id: 'sub-1', unsubscribedAt: null, source: 'footer' }];

    const body = await (await POST(post({ email: 'dup@example.com' }))).json();

    expect(body.data.status).toBe('already_subscribed');
    expect(state.sendCalls).toHaveLength(0);
  });

  it('resubscribed sends nothing', async () => {
    state.existing = [{ id: 'sub-1', unsubscribedAt: new Date(), source: 'footer' }];

    const body = await (await POST(post({ email: 'back@example.com' }))).json();

    expect(body.data.status).toBe('resubscribed');
    expect(state.sendCalls).toHaveLength(0);
  });
});
