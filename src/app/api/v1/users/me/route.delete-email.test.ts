/**
 * Account-deletion confirmation email — P1, fixed 2026-10-15.
 *
 * This email is the only signal a user gets that their account was deleted; if
 * it was not them, it is their only chance to raise it. The send sat in a bare
 * `try { ... } catch {}` and the Resend SDK never throws — it resolves
 * `{ data: null, error }` — so a silent, total delivery outage was
 * indistinguishable from success (docs/29 P0-4, src/lib/utils/retry.ts:6-12).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  session: null as unknown,
  sendCalls: [] as Record<string, unknown>[],
  sendResults: [] as { data: unknown; error: unknown }[],
  txFails: false,
}));

vi.mock('@/lib/auth', () => ({ auth: async () => state.session }));

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

vi.mock('@/db', () => {
  const tx = {
    update: () => ({ set: () => ({ where: async () => {} }) }),
    delete: () => ({ where: async () => {} }),
    insert: () => ({ values: async () => {} }),
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => Promise<void>) => {
        if (state.txFails) throw new Error('db down');
        return fn(tx);
      },
    },
  };
});

const { DELETE } = await import('./route');

function del(body: unknown = { confirm: true }): NextRequest {
  return new NextRequest('https://lastdonor.org/api/v1/users/me', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = { user: { id: 'u-1', email: 'ada@example.com' } };
  state.sendCalls = [];
  state.sendResults = [];
  state.txFails = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Resend error handling', () => {
  it('logs a resolved { error } instead of swallowing it', async () => {
    state.sendResults = [
      { data: null, error: { message: 'domain not verified' } },
      { data: null, error: { message: 'domain not verified' } },
      { data: null, error: { message: 'domain not verified' } },
    ];

    const res = await DELETE(del());

    expect(res.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith(
      '[DELETE /api/v1/users/me] Resend API error sending deletion confirmation:',
      { message: 'domain not verified' },
    );
  });

  it('retries a result-shaped failure rather than making one attempt', async () => {
    state.sendResults = [
      { data: null, error: { message: 'transient' } },
      { data: { id: 'ok' }, error: null },
    ];

    await DELETE(del());

    expect(state.sendCalls).toHaveLength(2);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('still reports the deletion as successful when the email fails', async () => {
    state.sendResults = [
      { data: null, error: { message: 'x' } },
      { data: null, error: { message: 'x' } },
      { data: null, error: { message: 'x' } },
    ];

    const body = await (await DELETE(del())).json();
    expect(body).toEqual({ ok: true, data: null });
  });

  it('sends nothing when the deletion transaction fails', async () => {
    state.txFails = true;

    const res = await DELETE(del());

    expect(res.status).toBe(500);
    expect(state.sendCalls).toHaveLength(0);
  });
});

describe('preconditions', () => {
  it('401s without a session', async () => {
    state.session = null;
    expect((await DELETE(del())).status).toBe(401);
  });

  it('400s without { confirm: true }', async () => {
    expect((await DELETE(del({}))).status).toBe(400);
  });
});
