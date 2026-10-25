/**
 * Approval is the other half of the review gate (docs/78).
 *
 * The risk this covers is specific: `publishedAt` used to be stamped only
 * on `draft -> active`, so once submissions started arriving as
 * `under_review`, approving one would have published it with a null
 * `publishedAt` — and the homepage orders featured campaigns by that
 * column, `/campaigns` sorts on it and the sitemap reads it. The campaign
 * would have been live and invisible in every ordered list.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

/*
  `revalidatePath` needs Next's static-generation store, which does not
  exist when a route handler is called directly like this. Mocked the
  same way `payment-service.test.ts` and `page.lookup.test.tsx` do.

  The spy is asserted below rather than merely silenced: approval is the
  one status transition that was missing its purge, and an approved
  campaign kept serving the cached 404 from while it was under review
  (observed on `nicholas-cabo`, 2026-10-19).
*/
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({
  revalidatePath: cacheMock.revalidatePath,
  revalidateTag: vi.fn(),
}));

const CAMPAIGN_ID = '22222222-2222-2222-2222-222222222222';
const CREATOR_ID = '11111111-1111-1111-1111-111111111111';

const state = vi.hoisted(() => ({
  /** Row-sets for successive select chains: campaign, then whatever follows. */
  selects: [] as unknown[][],
  updates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth', () => ({
  requireRole: async () => ({ user: { id: 'admin-1', role: 'admin' } }),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}));

vi.mock('@/db', () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(state.selects.shift() ?? []),
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
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          state.audits.push(v);
        },
      }),
    },
  };
});

const notifyWelcome = vi.fn(async (_payload?: Record<string, unknown>) => undefined);
const notifyStatusChange = vi.fn(async (_payload?: Record<string, unknown>) => undefined);
vi.mock('@/lib/notifications', () => ({
  notifyWelcomeCampaigner: (payload: Record<string, unknown>) => notifyWelcome(payload),
  notifyCampaignStatusChange: (payload: Record<string, unknown>) => notifyStatusChange(payload),
}));

const { PATCH } = await import('./route');

function patch(status: string): NextRequest {
  return { json: async () => ({ status }) } as unknown as NextRequest;
}
const params = Promise.resolve({ campaignId: CAMPAIGN_ID });

/** Queue the campaign row the route reads, then the creator lookup. */
function given(campaign: Record<string, unknown>) {
  state.selects = [
    [{ id: CAMPAIGN_ID, title: 'Help Grace', slug: 'help-grace', creatorId: CREATOR_ID, ...campaign }],
    [{ slug: 'help-grace', goalAmount: 500_000 }],
    [{ email: 'organiser@example.com', name: 'Grace' }],
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.updates = [];
  state.audits = [];
});

describe('approving a campaign that has never been published', () => {
  beforeEach(() => given({ status: 'under_review', publishedAt: null }));

  it('purges the cached page, which was serving a 404 from while it was under review', async () => {
    await PATCH(patch('active'), { params });
    // While under_review the detail query does not match the campaign, so
    // the page 404s and Next caches that. Without this purge the approved
    // campaign keeps serving 404 until the entry happens to age out.
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith('/campaigns/help-grace');
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith('/campaigns');
  });

  it('stamps publishedAt', async () => {
    const res = await PATCH(patch('active'), { params });
    expect(res.status).toBe(200);
    expect(state.updates[0].publishedAt).toBeInstanceOf(Date);
  });

  it('logs it as a publication, pairing with campaign.submitted', async () => {
    await PATCH(patch('active'), { params });
    expect(state.audits[0].eventType).toBe('campaign.published');
  });

  it('tells the organiser their campaign is live, now that it is', async () => {
    await PATCH(patch('active'), { params });
    expect(notifyWelcome).toHaveBeenCalledTimes(1);
    expect(notifyWelcome.mock.calls[0][0]).toMatchObject({
      campaignerEmail: 'organiser@example.com',
      campaignSlug: 'help-grace',
    });
  });
});

describe('returning an already-published campaign to active', () => {
  const FIRST_PUBLISH = new Date('2026-01-01T00:00:00Z');
  beforeEach(() => given({ status: 'suspended', publishedAt: FIRST_PUBLISH }));

  it('does not re-date it', async () => {
    await PATCH(patch('active'), { params });
    expect(state.updates[0]).not.toHaveProperty('publishedAt');
  });

  it('is a status change, not a publication', async () => {
    await PATCH(patch('active'), { params });
    expect(state.audits[0].eventType).toBe('campaign.status_changed');
  });

  it('does not re-send the "your campaign is live" email', async () => {
    await PATCH(patch('active'), { params });
    expect(notifyWelcome).not.toHaveBeenCalled();
  });
});

describe('a rejected submission', () => {
  beforeEach(() => given({ status: 'under_review', publishedAt: null }));

  it('⛔ cannot be refused through THIS endpoint, because a refusal needs a reason', async () => {
    /*
      CHANGED DELIBERATELY 2026-10-25, not deleted - `docs/93` asked for
      exactly that.

      This used to assert that PATCH *could* suspend an `under_review`
      campaign, and it could: reasonlessly and silently. That is how a
      refused campaign came to notify nobody. This endpoint takes
      `{ status }` and nothing else, so there was no reason to email the
      organiser, and `under_review -> suspended` was its only route to
      `suspended` at all.

      Refusal now goes through `.../suspend`, whose schema requires a reason.
      The concern this test carried - a refusal must never stamp
      `publishedAt` nor send the "your campaign is live" email - is asserted
      in `refuse.test.ts` against the path that now does the work.
    */
    const res = await PATCH(patch('suspended'), { params });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
    expect(notifyWelcome).not.toHaveBeenCalled();

    // And the error names where to go, rather than leaving an admin to
    // guess from "Allowed: active".
    const body = await res.json();
    expect(body.error.message).toMatch(/reason/i);
    expect(body.error.message).toMatch(/suspend/);
  });

  it('cannot jump straight to completed', async () => {
    const res = await PATCH(patch('completed'), { params });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});
