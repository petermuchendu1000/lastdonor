/**
 * Refusing a campaign at review: the organiser is told, and the reason is
 * required.
 *
 * ── WHAT THIS COVERS ────────────────────────────────────────────────────────
 *
 * Until 2026-10-25 a refused campaign notified NOBODY (`docs/93`, left open
 * as a policy call; owner decision: email the organiser with a typed reason).
 * The silence was not an omission anybody could see, and that is the point:
 *
 *   - The refusal path called `notifyCampaignSuspended`, which iterates
 *     SUBSCRIBED DONORS. A campaign that was never published has none, so it
 *     sent zero emails, returned normally, and looked like it had worked.
 *   - The one admin screen with a Suspend button posted `publicReason` to a
 *     schema requiring `reason`, so every click answered 400. Typecheck could
 *     not see it - the body is `Record<string, unknown>`.
 *
 * So the assertions below are about WHICH audience is addressed, not merely
 * that something was sent. A test asserting "a notification happened" would
 * have passed against the defect.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextRequest } from 'next/server';

const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({
  revalidatePath: cacheMock.revalidatePath,
  revalidateTag: vi.fn(),
}));

const CAMPAIGN_ID = '22222222-2222-2222-2222-222222222222';
const CREATOR_ID = '11111111-1111-1111-1111-111111111111';

const state = vi.hoisted(() => ({
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

const notifyRefused = vi.fn(async (_p?: Record<string, unknown>) => undefined);
const notifySuspended = vi.fn(async (_p?: Record<string, unknown>) => undefined);
vi.mock('@/lib/notifications', () => ({
  notifyCampaignRefused: (p: Record<string, unknown>) => notifyRefused(p),
  notifyCampaignSuspended: (p: Record<string, unknown>) => notifySuspended(p),
}));

const { POST } = await import('./suspend/route');

const params = Promise.resolve({ campaignId: CAMPAIGN_ID });
const body = (b: unknown): NextRequest => ({ json: async () => b } as unknown as NextRequest);

/** Queue the campaign row, then the creator lookup. */
function given(campaign: Record<string, unknown>) {
  state.selects = [
    [{
      id: CAMPAIGN_ID,
      title: 'Help Grace',
      slug: 'help-grace',
      creatorId: CREATOR_ID,
      ...campaign,
    }],
    [{ email: 'organiser@example.com', name: 'Grace' }],
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.updates = [];
  state.audits = [];
});

describe('refusing a campaign that is still under review', () => {
  beforeEach(() => given({ status: 'under_review' }));

  it('⛔ emails the ORGANISER, not donors', async () => {
    /*
      The whole defect in one assertion. `notifyCampaignSuspended` addresses
      subscribed donors; an unpublished campaign has none, so calling it here
      mailed nobody while returning 200.
    */
    const res = await POST(body({ reason: 'The hospital bill does not name the person in the story.' }), { params });
    expect(res.status).toBe(200);

    expect(notifyRefused).toHaveBeenCalledTimes(1);
    expect(notifySuspended).not.toHaveBeenCalled();
  });

  it('passes the admin’s reason through to the organiser', async () => {
    const reason = 'The hospital bill does not name the person in the story.';
    await POST(body({ reason }), { params });
    expect(notifyRefused.mock.calls[0][0]).toMatchObject({
      creatorId: CREATOR_ID,
      creatorEmail: 'organiser@example.com',
      campaignTitle: 'Help Grace',
      reason,
    });
  });

  it('records it as a refusal, not a suspension', async () => {
    // `submitted -> published` or `submitted -> refused`: the queue has to be
    // auditable end to end, and "suspended" does not distinguish a refusal
    // from an investigation of a live campaign.
    await POST(body({ reason: 'Not enough detail about who needs the money.' }), { params });
    expect(state.audits[0].eventType).toBe('campaign.refused');
    expect(state.audits[0].details).toMatchObject({ previousStatus: 'under_review' });
  });

  it('stores the reason on the campaign, and never stamps it as published', async () => {
    // The second half is inherited from `approve.test.ts`, which asserted it
    // of the PATCH path this change closed. The concern is real and had to
    // move rather than disappear: a refused campaign must never acquire a
    // `publishedAt`, because the homepage, `/campaigns` and the sitemap all
    // order on that column (docs/78).
    const reason = 'Not enough detail about who needs the money.';
    await POST(body({ reason }), { params });
    expect(state.updates[0]).toMatchObject({ status: 'suspended', suspendedReason: reason });
    expect(state.updates[0]).not.toHaveProperty('publishedAt');
  });

  it('⛔ refuses to act without a reason, because there would be nothing to send', async () => {
    for (const bad of [{}, { reason: '' }, { reason: '  ' }, { reason: 'no' }, null]) {
      vi.clearAllMocks();
      given({ status: 'under_review' });
      const res = await POST(body(bad), { params });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(notifyRefused, JSON.stringify(bad)).not.toHaveBeenCalled();
      expect(state.updates).toEqual([]);
    }
  });
});

describe('suspending a campaign that IS published', () => {
  beforeEach(() => given({ status: 'active' }));

  it('still tells donors their money is safe', async () => {
    // The other situation wearing the same status. This half must not
    // regress: a live campaign has donors, and they are the ones who need
    // telling.
    await POST(body({ reason: 'Under investigation after a report.' }), { params });
    expect(notifySuspended).toHaveBeenCalledTimes(1);
    expect(notifyRefused).not.toHaveBeenCalled();
  });

  it('records it as a suspension', async () => {
    await POST(body({ reason: 'Under investigation after a report.' }), { params });
    expect(state.audits[0].eventType).toBe('campaign.suspended');
  });
});

describe('the reasonless door is closed', () => {
  const ROOT = resolve(__dirname, '../../../../../../..');

  it('⛔ PATCH cannot move a campaign from under_review to suspended', () => {
    /*
      PATCH takes `{ status }` and nothing else, so every refusal through it
      was reasonless AND silent. Removing the transition is what makes the
      owner's decision hold: there is now exactly one refusal path, and it
      requires a reason.
    */
    const src = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');
    const map = src.slice(
      src.indexOf('const ALLOWED_TRANSITIONS'),
      src.indexOf('};', src.indexOf('const ALLOWED_TRANSITIONS')),
    );
    expect(map.length).toBeGreaterThan(100);
    // The line itself, with comments stripped so the explanation above it
    // cannot satisfy the assertion.
    const code = map.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/under_review:\s*\['active'\]/);
    expect(code).not.toMatch(/under_review:\s*\[[^\]]*'suspended'/);
  });

  it('names the endpoint that does take a reason', () => {
    const src = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/suspend with a reason/i);
  });

  it('⛔ the admin screen posts the field the schema requires', () => {
    /*
      `CampaignDetail` sent `publicReason` while `suspendCampaignSchema`
      requires `reason`, so the Suspend button answered 400 every time it was
      ever pressed. An unknown key is ignored by the schema and the required
      one was absent.
    */
    const ui = readFileSync(
      resolve(ROOT, 'src/components/admin/CampaignDetail.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(ui).not.toMatch(/body\.publicReason/);
    expect(ui).toMatch(/action === 'suspend'\) body\.reason =/);
  });

  it('the list sends a refusal to the suspend endpoint, with a reason', () => {
    /*
      ⚠️ This asserted the literal `/suspend\`` until 2026-10-27, and the
      assertion is what drifted, not the behaviour.

      `docs/120` §10 found that the list ALSO offered `paused`, a target the
      server's `ALLOWED_TRANSITIONS` has no entry for, so those menu items
      always answered 400 - the same class as the defect this file exists for.
      Pausing has its own route with the same reason shape, so the fetch now
      builds the path from the target (`.../${dedicatedRoute}`) and the literal
      is gone. What matters is unchanged: a refusal goes to `suspend`, carries
      a reason, and the admin is told who reads it.
    */
    const ui = readFileSync(
      resolve(ROOT, 'src/components/admin/CampaignsList.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // `suspended` resolves to the suspend endpoint, whatever the path is built from.
    expect(ui).toMatch(/newStatus === 'suspended' \? 'suspend'/);
    // And that resolution is what selects the non-PATCH request.
    expect(ui).toMatch(/dedicatedRoute\s*$/m);
    expect(ui).toMatch(/admin\/campaigns\/\$\{statusTarget\.campaign\.id\}\/\$\{dedicatedRoute\}/);
    expect(ui).toMatch(/refusalReason/);
    // A refusal cannot be sent without a reason.
    expect(ui).toMatch(/dedicatedRoute && reason\.length < 3/);
    // And the admin is told who reads what they write.
    expect(ui).toMatch(/emailed to the organiser/i);
  });
});
