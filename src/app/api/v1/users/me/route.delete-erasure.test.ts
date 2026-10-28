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
  // CRM rows, which go with the person. Added 2026-10-27 when the erasure
  // moved into `src/lib/account-erasure.ts`; without them `eq()` dereferences
  // undefined and the route 500s, which is the 'unknown' guard below working.
  interactionLogs: { __table: 'interaction_logs' },
  donorRelationships: { __table: 'donor_relationships' },
  /*
    Password-reset rows: `verification_tokens.identifier` holds the address as
    plaintext (`reset:<email>`, `reset-cooldown:<email>`) and nothing else
    deletes them. Added 2026-10-28 for the same reason as the two above - and
    the fact that this mock needed updating at all is the `docs/124` lesson
    restated: a mock has to be told what the real code touches, which is
    exactly why it can never find what the real code gets wrong. `docs/127`.
  */
  verificationTokens: { __table: 'verification_tokens' },
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

  it('⛔ ANONYMISES the user row instead of deleting it, and writes one audit entry', async () => {
    /*
      ⚠️ Corrected 2026-10-27, not satisfied. This asserted a `delete` on
      `users`, and it passed the whole time, because drizzle is mocked at the
      table-identity level below and **a mock cannot raise a foreign-key
      violation**. Against a real Postgres that statement failed for anyone
      holding one of the 25 references the transaction did not name - three of
      nine production users - and the route answered 500 "Please try again".
      `docs/124`, and the behaviour is executed for real in
      `src/lib/account-erasure.integration.test.ts`.
    */
    await DELETE(del());

    expect(state.ops.filter((o) => o.kind === 'delete' && o.table === 'users')).toHaveLength(0);
    const userUpdates = state.ops.filter((o) => o.kind === 'update' && o.table === 'users');
    expect(userUpdates).toHaveLength(1);
    const values = (userUpdates[0] as { values: Record<string, unknown> }).values;
    expect(values.email).toBe('deleted-u-1@lastdonor.org');
    expect(values.name).toBe(DELETED_DONOR_NAME);
    expect(values.passwordHash).toBeNull();
    // The two NOT NULL columns the admin path set to null, which made its
    // own UPDATE throw every time it ran.
    expect(values.badges).toEqual([]);
    expect(values.preferences).toEqual({});

    expect(state.ops.filter((o) => o.table === 'audit_logs')).toHaveLength(1);
  });

  it('⛔ refuses an administrator, who must be removed by another administrator', async () => {
    /*
      `/api/v1/admin/users/[id]` has always refused an admin deleting their
      own account; this route did not. Until the fix above, a foreign-key
      violation stopped it by ACCIDENT - the one production admin holds six
      `site_settings.updated_by` rows - and removing that accident is what
      makes the refusal have to be deliberate.
    */
    state.session = { user: { id: 'u-1', email: 'a@example.invalid', role: 'admin' } };

    const res = await DELETE(del());
    expect(res.status).toBe(403);
    // Nothing was written at all.
    expect(state.ops).toEqual([]);
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

  it('⚠️ and leaves the campaign link alone, which it used to null', async () => {
    /*
      The null was only ever there to get past the foreign key. Nothing needs
      it now the row survives, and `docs/119` found 13 of 14 live campaigns
      already have no organiser - one that cannot be traced, reminded or paid.
    */
    await DELETE(del());
    expect(state.ops.filter((o) => o.table === 'campaigns')).toEqual([]);
  });
});
