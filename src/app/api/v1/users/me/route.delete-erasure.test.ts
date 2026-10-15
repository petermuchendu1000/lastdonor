/**
 * Account deletion must erase mailing state, not just unlink it.
 *
 * Two defects this pins, both verified against the pre-fix code on 2026-10-15:
 *
 *  1. `donor_campaign_subscriptions` had only its `userId` nulled, leaving
 *     `donor_email` holding the deleted person's REAL address. That table is a
 *     send target: `bulk-email-recipients.ts` resolves `subscribed_donors`
 *     straight off `donor_email`, and the campaign-update digest reads the
 *     same rows. So deleting an account did not stop campaign email.
 *
 *  2. `newsletter_subscribers` was never touched at all, so the row kept
 *     `unsubscribed_at IS NULL` and the weekly newsletter cron kept sending
 *     indefinitely.
 *
 * Commit 224e069's message asserted deletion "clears the address from mailing
 * state in the same transaction"; it did not. These tests are the thing that
 * would have caught that, so they assert the WRITES, not the 200.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETED_DONOR_PLACEHOLDER, DELETED_DONOR_NAME } from '@/lib/constants';

type Op =
  | { kind: 'update'; table: string; values: Record<string, unknown> }
  | { kind: 'delete'; table: string }
  | { kind: 'insert'; table: string };

const state = vi.hoisted(() => ({
  session: null as unknown,
  ops: [] as Op[],
}));

vi.mock('@/lib/auth', () => ({ auth: async () => state.session }));

vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: async () => ({ data: { id: 'ok' }, error: null }) } },
}));

// Drizzle is mocked at the table-identity level: each schema export is a
// distinct sentinel object, so an op can be attributed to the right table
// without a real database. Anything the route starts to touch that is not
// named here shows up as 'unknown', which is itself a useful signal.
vi.mock('@/db/schema', () => ({
  users: { __table: 'users' },
  donations: { __table: 'donations' },
  campaigns: { __table: 'campaigns' },
  campaignMessages: { __table: 'campaign_messages' },
  donorCampaignSubscriptions: { __table: 'donor_campaign_subscriptions' },
  newsletterSubscribers: { __table: 'newsletter_subscribers' },
  supportConversations: { __table: 'support_conversations' },
  auditLogs: { __table: 'audit_logs' },
}));

function nameOf(table: unknown): string {
  return (table as { __table?: string } | null)?.__table ?? 'unknown';
}

vi.mock('@/db', () => {
  const tx = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.ops.push({ kind: 'update', table: nameOf(table), values });
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        state.ops.push({ kind: 'delete', table: nameOf(table) });
      },
    }),
    insert: (table: unknown) => ({
      values: async () => {
        state.ops.push({ kind: 'insert', table: nameOf(table) });
      },
    }),
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
  };
});

const { DELETE } = await import('./route');

function del(): NextRequest {
  return new NextRequest('https://lastdonor.org/api/v1/users/me', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
}

beforeEach(() => {
  state.session = { user: { id: 'u-1', email: 'ada@example.com' } };
  state.ops = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('account deletion erases mailing state', () => {
  it('deletes the campaign-update subscriptions rather than only unlinking them', async () => {
    const res = await DELETE(del());
    expect(res.status).toBe(200);

    const subOps = state.ops.filter((o) => o.table === 'donor_campaign_subscriptions');
    expect(subOps).toHaveLength(1);
    expect(subOps[0].kind).toBe('delete');

    // The regression: an `update` here means the row (and the real address in
    // it) survived deletion and remains a live send target.
    expect(subOps.some((o) => o.kind === 'update')).toBe(false);
  });

  it('deletes the newsletter subscription, which deletion used to ignore entirely', async () => {
    await DELETE(del());

    const news = state.ops.filter((o) => o.table === 'newsletter_subscribers');
    expect(news).toHaveLength(1);
    expect(news[0].kind).toBe('delete');
  });

  it('still scrubs donations to the tombstone instead of deleting donation history', async () => {
    await DELETE(del());

    const donationOps = state.ops.filter((o) => o.table === 'donations');
    expect(donationOps).toHaveLength(1);
    expect(donationOps[0].kind).toBe('update');
    expect((donationOps[0] as { values: Record<string, unknown> }).values).toMatchObject({
      donorEmail: DELETED_DONOR_PLACEHOLDER,
      donorName: DELETED_DONOR_NAME,
      userId: null,
    });
  });

  it('deletes the user row and writes one audit entry', async () => {
    await DELETE(del());

    expect(state.ops.filter((o) => o.kind === 'delete' && o.table === 'users')).toHaveLength(1);
    expect(state.ops.filter((o) => o.table === 'audit_logs')).toHaveLength(1);
  });

  it('still erases subscriptions when the session carries no email', async () => {
    // userId is the only join available then; the newsletter table has no
    // userId at all, so that delete is correctly skipped rather than issued
    // with an undefined predicate (which would match every row).
    state.session = { user: { id: 'u-1', email: null } };

    const res = await DELETE(del());
    expect(res.status).toBe(200);

    expect(
      state.ops.filter((o) => o.table === 'donor_campaign_subscriptions' && o.kind === 'delete'),
    ).toHaveLength(1);
    expect(state.ops.filter((o) => o.table === 'newsletter_subscribers')).toHaveLength(0);
  });

  it('touches no table outside the known set', async () => {
    await DELETE(del());
    expect(state.ops.filter((o) => o.table === 'unknown')).toEqual([]);
  });
});
