/**
 * DELETE must destroy a draft and nothing else (docs/88 F13).
 *
 * The docblock on this route claimed "only allowed for draft campaigns"
 * and no such check existed. Proven against production on 2026-10-17 with
 * throwaway rows: `draft`, `active`, `completed` AND `under_review` each
 * returned 200 and left zero rows behind. `CampaignsList` offered Delete
 * on every row, so the review queue  - appeals naming real people  - was two
 * clicks from permanent destruction.
 *
 * The first describe below fails against the pre-fix route, which is the
 * point of it.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const CAMPAIGN_ID = '33333333-3333-3333-3333-333333333333';

const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
  /** Tables passed to db.delete(), in order. */
  deletes: [] as string[],
}));

vi.mock('@/lib/auth', () => ({
  requireRole: async () => ({ user: { id: 'admin-1', role: 'admin' } }),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}));

vi.mock('@/lib/notifications', () => ({
  notifyWelcomeCampaigner: async () => undefined,
  notifyCampaignStatusChange: async () => undefined,
}));

vi.mock('@/db', () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(state.selects.shift() ?? []),
    then: (r: (v: unknown) => unknown) => Promise.resolve(state.selects.shift() ?? []).then(r),
  };
  return {
    db: {
      select: () => chain,
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: async () => {
            state.updates.push(v);
          },
        }),
      }),
      insert: () => ({ values: async (v: Record<string, unknown>) => { state.audits.push(v); } }),
      delete: () => ({ where: async () => { state.deletes.push('row'); } }),
    },
  };
});

const { DELETE } = await import('./route');
const params = Promise.resolve({ campaignId: CAMPAIGN_ID });

/** A campaign in `status`, with `donations` donation rows. */
function given(status: string, donations = 0) {
  state.selects = [
    [{ id: CAMPAIGN_ID, title: 'Help Grace', status, raisedAmount: 0 }],
    [{ count: donations }],
    [{ slug: 'help-grace', goalAmount: 500_000 }],
    [{ email: 'organiser@example.com', name: 'Grace' }],
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.updates = [];
  state.audits = [];
  state.deletes = [];
});

/* The regression guard. Every one of these returned 200 + zero rows before. */
describe('a campaign that is not a draft is never destroyed', () => {
  it.each(['active', 'completed', 'under_review', 'paused', 'last_donor_zone', 'suspended', 'archived'])(
    'refuses to delete a %s campaign',
    async (status) => {
      given(status, 0);
      const res = await DELETE({} as NextRequest, { params });
      expect(res.status).toBe(409);
      expect(state.deletes).toHaveLength(0);
    },
  );

  it('names the status and points at archive, which is reversible', async () => {
    given('under_review', 0);
    const body = await (await DELETE({} as NextRequest, { params })).json();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('under_review');
    expect(body.error.message).toMatch(/archiv/i);
  });
});

describe('a draft with no donations is still deletable', () => {
  it('removes the campaign and its children', async () => {
    given('draft', 0);
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(200);
    // seed messages, updates, then the campaign itself
    expect(state.deletes).toHaveLength(3);
  });
});

/*
  The archive branch runs BEFORE the draft guard, so money is protected
  regardless of status - that ordering is deliberate.
*/
describe('anything with donations is archived, never destroyed', () => {
  it.each(['draft', 'active', 'under_review'])('archives a %s campaign that has donations', async (status) => {
    given(status, 3);
    const res = await DELETE({} as NextRequest, { params });
    expect(res.status).toBe(200);
    expect(state.deletes).toHaveLength(0);
    expect(state.updates[0].status).toBe('archived');
  });
});
