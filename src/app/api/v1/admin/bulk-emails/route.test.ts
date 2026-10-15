/**
 * Bulk email draft creation — P0, fixed 2026-10-15.
 *
 * `recipientFilter` was used only for a preview count and an audit field.
 * `bulk_emails` has no `recipient_filter` column, so the choice was thrown
 * away and the send route applied a different, fixed predicate — which made
 * the confirmation dialog's "Send to N recipient(s)" actively misleading.
 *
 * The count now comes from the same helper the send uses, and the filter is
 * persisted in `audit_logs.details` (the only durable home available without a
 * migration) for the send route to read back.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const CAMPAIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const state = vi.hoisted(() => ({
  recipients: [] as Record<string, unknown>[],
  resolveArgs: [] as unknown[][],
  inserted: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
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

vi.mock('@/lib/bulk-email-recipients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bulk-email-recipients')>();
  return {
    ...actual,
    countBulkEmailRecipients: async (filter: string, campaignId: string | null) => {
      state.resolveArgs.push([filter, campaignId]);
      return state.recipients.length;
    },
  };
});

vi.mock('@/db', () => ({
  db: {
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const isBulk = 'templateName' in v;
        if (isBulk) {
          state.inserted.push(v);
          return { returning: async () => [{ id: 'bulk-1', ...v }] };
        }
        state.audits.push(v);
        void table;
        return Promise.resolve();
      },
    }),
  },
}));

const { POST } = await import('./route');

function post(body: unknown): NextRequest {
  return new NextRequest('https://lastdonor.org/api/v1/admin/bulk-emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID = {
  templateName: 'custom',
  campaignId: CAMPAIGN,
  subject: 'An update',
  bodyHtml: '<p>Hello {{donor_name}}</p>',
  recipientFilter: 'guest_donors',
};

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.BULK_EMAIL_MAX_RECIPIENTS;
  state.recipients = [{ email: 'a@x.com' }, { email: 'b@x.com' }];
  state.resolveArgs = [];
  state.inserted = [];
  state.audits = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('preview count', () => {
  it('counts with the chosen filter, through the shared helper', async () => {
    await POST(post(VALID));

    expect(state.resolveArgs).toEqual([['guest_donors', CAMPAIGN]]);
    expect(state.inserted[0].recipientCount).toBe(2);
  });

  it('passes null, not undefined, for an unscoped draft', async () => {
    const { campaignId: _omitted, ...noCampaign } = VALID;

    await POST(post(noCampaign));

    expect(state.resolveArgs).toEqual([['guest_donors', null]]);
  });

  it('defaults the filter to all_donors when omitted', async () => {
    const { recipientFilter: _omitted, ...noFilter } = VALID;

    await POST(post(noFilter));

    expect(state.resolveArgs[0][0]).toBe('all_donors');
  });
});

describe('filter persistence (no recipient_filter column available)', () => {
  it('writes recipientFilter into the bulk_email.created audit row', async () => {
    await POST(post(VALID));

    const audit = state.audits.at(-1)!;
    expect(audit.eventType).toBe('bulk_email.created');
    expect(audit.targetId).toBe('bulk-1');
    expect((audit.details as Record<string, unknown>).recipientFilter).toBe('guest_donors');
  });

  it('echoes the filter back to the caller so the UI can show what was stored', async () => {
    const body = await (await POST(post(VALID))).json();

    expect(body.data.recipientFilter).toBe('guest_donors');
  });
});

describe('ceiling at create time', () => {
  it('refuses a draft whose filter already exceeds the ceiling', async () => {
    process.env.BULK_EMAIL_MAX_RECIPIENTS = '1';

    const res = await POST(post(VALID));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toMatch(/hard ceiling/);
    expect(state.inserted).toHaveLength(0);
  });
});

describe('validation', () => {
  it('rejects an unknown recipient filter', async () => {
    const res = await POST(post({ ...VALID, recipientFilter: 'everyone' }));
    expect(res.status).toBe(400);
  });

  it('rejects a malformed body', async () => {
    const res = await POST(post({ templateName: 'custom' }));
    expect(res.status).toBe(400);
  });
});
