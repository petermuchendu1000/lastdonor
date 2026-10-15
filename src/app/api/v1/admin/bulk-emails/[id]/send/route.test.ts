/**
 * Bulk email send — P0 blast radius, fixed 2026-10-15.
 *
 * `campaignId` is optional on a draft and the old resolver simply dropped the
 * campaign predicate when it was absent, so a single POST mailed **every donor
 * who had ever donated** — no second confirmation, no cap, no opt-out source
 * consulted, no unsubscribe link, no `List-Unsubscribe` header. The chosen
 * recipient filter was also discarded at create time, so the send applied a
 * different predicate than the one the confirmation dialog counted.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECRET = 'test-newsletter-unsubscribe-secret-0123456789';

const state = vi.hoisted(() => ({
  email: null as Record<string, unknown> | null,
  persistedFilter: 'all_donors' as string | null,
  recipients: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
  sendCalls: [] as Record<string, unknown>[],
  sendResults: [] as { data: unknown; error: unknown }[],
}));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireRole: async () => ({ user: { id: 'admin-1', role: 'admin' } }),
  };
});

vi.mock('@/lib/concurrency-limiter', () => ({
  bulkOpSemaphore: { acquire: async () => () => {} },
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

vi.mock('@/lib/bulk-email-recipients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bulk-email-recipients')>();
  return {
    ...actual,
    loadPersistedRecipientFilter: async () => state.persistedFilter,
    resolveBulkEmailRecipients: async () => state.recipients,
  };
});

vi.mock('@/db', () => ({
  db: {
    select: () => {
      const c: Record<string, unknown> = {};
      c.from = () => c;
      c.where = () => c;
      c.limit = async () => (state.email ? [state.email] : []);
      return c;
    },
    update: () => ({
      set: (v: Record<string, unknown>) => {
        const where = async () => { state.updates.push(v); };
        return Object.assign(where(), { catch: () => Promise.resolve(), where });
      },
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => { state.audits.push(v); },
    }),
  },
}));

const { POST } = await import('./route');

function post(body: unknown = {}): NextRequest {
  return new NextRequest(`https://lastdonor.org/api/v1/admin/bulk-emails/${ID}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: ID }) };

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: 'draft',
    campaignId: CAMPAIGN,
    subject: 'Thank you {{donor_name}}',
    bodyHtml: '<p>Hello {{donor_name}}</p>',
    recipientCount: 1,
    ...overrides,
  };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = 'https://lastdonor.org';
  process.env.MAILING_POSTAL_ADDRESS = 'LastDonor Ltd, PO Box 9, Anytown, ST 00000';
  delete process.env.BULK_EMAIL_MAX_RECIPIENTS;
  state.email = draft();
  state.persistedFilter = 'all_donors';
  state.recipients = [{ email: 'a@x.com', name: 'Ada', donationAmount: 2500, subscriberId: 'n1' }];
  state.updates = [];
  state.audits = [];
  state.sendCalls = [];
  state.sendResults = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('blast radius gate (P0)', () => {
  it('refuses an unscoped draft without confirmAllDonors', async () => {
    state.email = draft({ campaignId: null });

    const res = await POST(post({}), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toMatch(/entire donor base/i);
    expect(state.sendCalls).toHaveLength(0);
  });

  it('does not even mark the draft as sending when it refuses', async () => {
    state.email = draft({ campaignId: null });

    await POST(post({}), params);

    expect(state.updates.some((u) => u.status === 'sending')).toBe(false);
  });

  it('allows an unscoped send when confirmAllDonors is explicitly true', async () => {
    state.email = draft({ campaignId: null });

    const res = await POST(post({ confirmAllDonors: true }), params);

    expect(res.status).toBe(200);
    expect(state.sendCalls).toHaveLength(1);
  });

  it('rejects a truthy-but-not-true confirmation', async () => {
    state.email = draft({ campaignId: null });

    const res = await POST(post({ confirmAllDonors: 'yes' }), params);

    expect(res.status).toBe(400);
    expect(state.sendCalls).toHaveLength(0);
  });

  it('needs no flag for a campaign-scoped draft', async () => {
    const res = await POST(post({}), params);
    expect(res.status).toBe(200);
  });
});

describe('recipient filter is applied, not discarded (P0)', () => {
  it('fails closed when the filter cannot be recovered', async () => {
    state.persistedFilter = null;

    const res = await POST(post({}), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toMatch(/recipient filter/i);
    expect(state.sendCalls).toHaveLength(0);
  });

  it('accepts an explicit filter in the body when none was persisted', async () => {
    state.persistedFilter = null;

    const res = await POST(post({ recipientFilter: 'guest_donors' }), params);

    expect(res.status).toBe(200);
  });

  it('rejects an unknown explicit filter rather than defaulting', async () => {
    state.persistedFilter = null;

    const res = await POST(post({ recipientFilter: 'everyone' }), params);

    expect(res.status).toBe(400);
    expect(state.sendCalls).toHaveLength(0);
  });

  it('records the filter actually used in the audit log', async () => {
    state.persistedFilter = 'registered_donors';

    await POST(post({}), params);

    const details = state.audits.at(-1)!.details as Record<string, unknown>;
    expect(details.recipientFilter).toBe('registered_donors');
  });
});

describe('hard ceiling', () => {
  it('refuses a send above the ceiling', async () => {
    process.env.BULK_EMAIL_MAX_RECIPIENTS = '2';
    state.recipients = [
      { email: 'a@x.com', name: 'A', subscriberId: null },
      { email: 'b@x.com', name: 'B', subscriberId: null },
      { email: 'c@x.com', name: 'C', subscriberId: null },
    ];

    const res = await POST(post({}), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toMatch(/hard ceiling/);
    expect(state.sendCalls).toHaveLength(0);
  });

  it('allows a send exactly at the ceiling', async () => {
    process.env.BULK_EMAIL_MAX_RECIPIENTS = '2';
    state.recipients = [
      { email: 'a@x.com', name: 'A', subscriberId: null },
      { email: 'b@x.com', name: 'B', subscriberId: null },
    ];

    const res = await POST(post({}), params);

    expect(res.status).toBe(200);
    expect(state.sendCalls).toHaveLength(2);
  });
});

describe('unsubscribe footer and headers (P0, legal)', () => {
  it('appends a one-click unsubscribe link for a known newsletter subscriber', async () => {
    await POST(post({}), params);

    const call = state.sendCalls[0];
    expect(call.html as string).toContain('/api/v1/newsletter/unsubscribe?token=n1.');
    const headers = call.headers as Record<string, string>;
    expect(headers['List-Unsubscribe']).toMatch(/\/api\/v1\/newsletter\/unsubscribe\?token=n1\./);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('falls back to a mailto opt-out when no newsletter row exists', async () => {
    state.recipients = [{ email: 'guest@x.com', name: 'Guest', subscriberId: null }];

    await POST(post({}), params);

    const headers = state.sendCalls[0].headers as Record<string, string>;
    expect(headers['List-Unsubscribe']).toBe('<mailto:support@lastdonor.org?subject=Unsubscribe>');
    expect(headers).not.toHaveProperty('List-Unsubscribe-Post');
    expect(state.sendCalls[0].html as string).toContain('mailto:support@lastdonor.org');
  });

  it('prints the configured postal address and never a placeholder', async () => {
    await POST(post({}), params);

    const html = state.sendCalls[0].html as string;
    expect(html).toContain('LastDonor Ltd, PO Box 9, Anytown, ST 00000');
    expect(html).not.toContain('1234 Main St');
  });

  it('omits the address line entirely when MAILING_POSTAL_ADDRESS is unset', async () => {
    delete process.env.MAILING_POSTAL_ADDRESS;

    await POST(post({}), params);

    const html = state.sendCalls[0].html as string;
    expect(html).not.toContain('1234 Main St');
    expect(html).toContain('Unsubscribe');
    const details = state.audits.at(-1)!.details as Record<string, unknown>;
    expect(details.postalAddressPresent).toBe(false);
  });

  it('keeps the admin body and its interpolation intact', async () => {
    await POST(post({}), params);

    expect(state.sendCalls[0].html as string).toContain('<p>Hello Ada</p>');
    expect(state.sendCalls[0].subject).toBe('Thank you Ada');
  });
});

describe('Resend error handling', () => {
  it('counts a resolved { error } as failed, after retrying', async () => {
    state.sendResults = [
      { data: null, error: { message: 'bounced' } },
      { data: null, error: { message: 'bounced' } },
      { data: null, error: { message: 'bounced' } },
    ];

    const body = await (await POST(post({}), params)).json();

    expect(state.sendCalls).toHaveLength(3);
    expect(body.data.sentCount).toBe(0);
    expect(body.data.failedCount).toBe(1);
  });
});

describe('preconditions still hold', () => {
  it('404s an unknown id', async () => {
    state.email = null;
    const res = await POST(post({}), params);
    expect(res.status).toBe(404);
  });

  it('refuses a non-draft', async () => {
    state.email = draft({ status: 'completed' });
    const res = await POST(post({}), params);
    expect(res.status).toBe(400);
  });

  it('400s a non-UUID id', async () => {
    const res = await POST(post({}), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
  });
});
