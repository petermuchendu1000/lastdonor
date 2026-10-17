/**
 * The review gate.
 *
 * Until 2026-10-17 `POST /api/v1/user-campaigns` inserted
 * `status: 'active'` with `publishedAt` set, so a submission was public
 * the instant the button was pressed — while ~30 places across the site,
 * including the Organization JSON-LD and the `/compare` table against
 * GoFundMe, promised a human review before publication (docs/77).
 *
 * These tests pin the gate from the writing end. The thing that makes a
 * submission invisible is the pair (`status`, `publishedAt`), because
 * every public read filters on `status in ('active','last_donor_zone')`,
 * so both are asserted. See docs/78.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const CAMPAIGN_ID = '22222222-2222-2222-2222-222222222222';

const state = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  auditEvents: [] as Record<string, unknown>[],
  selects: [] as unknown[][],
}));

vi.mock('@/lib/auth', () => ({
  requireRole: async () => ({
    user: { id: USER_ID, email: 'organiser@example.com', name: 'Grace', role: 'donor' },
  }),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}));

vi.mock('@/db', () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => Promise.resolve(state.selects.shift() ?? []),
    then: (r: (v: unknown[]) => unknown) => r(state.selects.shift() ?? []),
  };
  const tx = {
    insert: (table: { _: { name?: string } } | unknown) => ({
      values: (v: Record<string, unknown>) => {
        state.inserted.push(v);
        return {
          returning: async () => [
            { id: CAMPAIGN_ID, slug: 'help-grace', title: v.title, status: v.status },
          ],
        };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => selectChain,
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      select: () => selectChain,
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          state.auditEvents.push(v);
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
  };
});

const notifyAdmins = vi.fn(async (_payload?: Record<string, unknown>) => undefined);
const notifySubmitted = vi.fn(async (_payload?: Record<string, unknown>) => undefined);
const notifyWelcome = vi.fn(async (_payload?: Record<string, unknown>) => undefined);
vi.mock('@/lib/notifications', () => ({
  notifyAdminsCampaignSubmitted: (payload: Record<string, unknown>) => notifyAdmins(payload),
  notifyCampaignSubmittedForReview: (payload: Record<string, unknown>) => notifySubmitted(payload),
  notifyWelcomeCampaigner: (payload: Record<string, unknown>) => notifyWelcome(payload),
}));

const { POST } = await import('./route');

const BODY = {
  subjectName: 'Grace Okonkwo',
  subjectHometown: 'Austin, TX',
  beneficiaryRelation: 'self',
  category: 'medical',
  beneficiaryConsent: true,
  title: 'Help Grace recover after the fire',
  story: 'A fire destroyed the family home last week and they need help rebuilding. '.repeat(4),
  goalAmount: 2_500_000,
  heroImageUrl: 'https://images.unsplash.com/photo-1234567890',
  agreedToTerms: true,
  confirmedTruthful: true,
};

function request(body: Record<string, unknown>): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

/** The row the route tried to write into `campaigns`. */
function campaignRow() {
  const row = state.inserted.find((r) => 'goalAmount' in r && 'slug' in r);
  if (!row) throw new Error('no campaign row inserted');
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.inserted = [];
  state.auditEvents = [];
  // slug-uniqueness probe, then anything else the route reads
  state.selects = [[], [], []];
});

describe('a submitted campaign is not published', () => {
  it('lands as under_review', async () => {
    await POST(request(BODY));
    expect(campaignRow().status).toBe('under_review');
  });

  it('carries no publishedAt, which is what keeps it out of every public read', async () => {
    await POST(request(BODY));
    expect(campaignRow().publishedAt).toBeNull();
  });

  it('is never written straight to active', async () => {
    await POST(request(BODY));
    expect(campaignRow().status).not.toBe('active');
    expect(campaignRow().status).not.toBe('last_donor_zone');
  });

  it('records it as submitted, not published', async () => {
    await POST(request(BODY));
    const types = state.auditEvents.map((e) => e.eventType);
    expect(types).toContain('campaign.submitted');
    expect(types).not.toContain('campaign.published');
  });
});

describe('who is told what, at submission', () => {
  it('asks admins to review it', async () => {
    await POST(request(BODY));
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it('sends the organiser a submission receipt', async () => {
    await POST(request(BODY));
    expect(notifySubmitted).toHaveBeenCalledTimes(1);
    expect(notifySubmitted.mock.calls[0][0]).toMatchObject({
      campaignerEmail: 'organiser@example.com',
      campaignTitle: BODY.title,
    });
  });

  /*
    The "Your Campaign Is Live!" email used to be sent here, which was only
    ever accurate because nothing was reviewed. It now belongs to the admin
    approval route.
  */
  it('does NOT tell the organiser the campaign is live', async () => {
    await POST(request(BODY));
    expect(notifyWelcome).not.toHaveBeenCalled();
  });
});

