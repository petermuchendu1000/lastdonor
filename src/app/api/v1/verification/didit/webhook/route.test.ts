/**
 * The Didit webhook: what it acts on, and what it refuses to act on.
 *
 * The route has no shared secret by design (docs/81) — it reads only a
 * session id from the body, then asks Didit what the decision is over an
 * authenticated call of its own. These tests pin the consequences of that
 * choice, including the one that was wrong on first deploy.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const CAMPAIGN_ID = '22222222-2222-2222-2222-222222222222';
const CREATOR_ID = '11111111-1111-1111-1111-111111111111';
const SESSION = 'sess-abc';

const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
}));

const decide = vi.hoisted(() => vi.fn());

vi.mock('@/lib/didit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/didit')>('@/lib/didit');
  return { ...actual, getDiditDecision: (id: string) => decide(id) };
});

vi.mock('@/db', () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(state.selects.shift() ?? []),
  };
  return {
    db: {
      select: () => chain,
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { state.updates.push(v); } }) }),
      insert: () => ({ values: async (v: Record<string, unknown>) => { state.audits.push(v); } }),
    },
  };
});

const approved = vi.fn(async (_p?: Record<string, unknown>) => undefined);
const rejected = vi.fn(async (_p?: Record<string, unknown>) => undefined);
vi.mock('@/lib/notifications', () => ({
  notifyCreatorVerificationApproved: (p: Record<string, unknown>) => approved(p),
  notifyCreatorVerificationRejected: (p: Record<string, unknown>) => rejected(p),
}));

const { DiditApiError } = await import('@/lib/didit');
const { POST } = await import('./route');

function post(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

/** Queue the campaign row, then the creator lookup. */
function givenCampaign(verificationStatus: string) {
  state.selects = [
    [{ id: CAMPAIGN_ID, title: 'Help Grace', slug: 'help-grace', creatorId: CREATOR_ID, verificationStatus }],
    [{ email: 'organiser@example.com', name: 'Grace' }],
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.selects = [];
  state.updates = [];
  state.audits = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requests it declines to act on', () => {
  it('ignores a body with no session id', async () => {
    const res = await POST(post({ hello: 'world' }));
    expect(res.status).toBe(200);
    expect(decide).not.toHaveBeenCalled();
  });

  /*
    Caught on the deployed route by posting a zeroed uuid: it answered
    500, because the DiditApiError fell through to the generic handler.
    A provider that receives a 5xx retries, and retrying cannot turn an
    unknown session id into a known one.
  */
  it('ignores a session Didit does not recognise, rather than inviting retries', async () => {
    decide.mockRejectedValue(new DiditApiError(404, 'Not found'));
    const res = await POST(post({ session_id: 'nope' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { ignored: 'unknown session' } });
  });

  it('ignores a session that is not ours', async () => {
    decide.mockResolvedValue({ sessionId: SESSION, status: 'Approved', vendorData: null });
    state.selects = [[]];

    const res = await POST(post({ session_id: SESSION }));
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(0);
  });

  /* Didit was reachable and we could not read it. That IS worth a retry. */
  it('asks for a retry when Didit itself is failing', async () => {
    decide.mockRejectedValue(new DiditApiError(503, 'upstream down'));
    const res = await POST(post({ session_id: SESSION }));
    expect(res.status).toBe(500);
  });
});

describe('decisions it acts on', () => {
  it('marks the campaign identity_verified on Approved', async () => {
    decide.mockResolvedValue({ sessionId: SESSION, status: 'Approved', vendorData: CAMPAIGN_ID });
    givenCampaign('pending');

    const res = await POST(post({ session_id: SESSION }));
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ verificationStatus: 'identity_verified' });
    expect(approved).toHaveBeenCalledTimes(1);
    expect(rejected).not.toHaveBeenCalled();
  });

  it('marks it rejected on Declined', async () => {
    decide.mockResolvedValue({ sessionId: SESSION, status: 'Declined', vendorData: CAMPAIGN_ID });
    givenCampaign('pending');

    await POST(post({ session_id: SESSION }));
    expect(state.updates[0]).toMatchObject({ verificationStatus: 'rejected' });
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  /*
    "In Review" is Didit's MANUAL queue: a person there has not finished.
    Treating it as a pass would publish an identity nobody checked.
  */
  it('does nothing while Didit is still deciding, including In Review', async () => {
    for (const status of ['Not Started', 'In Progress', 'In Review']) {
      vi.clearAllMocks();
      state.updates = [];
      decide.mockResolvedValue({ sessionId: SESSION, status, vendorData: CAMPAIGN_ID });
      givenCampaign('pending');

      await POST(post({ session_id: SESSION }));
      expect(state.updates, `status ${status}`).toHaveLength(0);
      expect(approved, `status ${status}`).not.toHaveBeenCalled();
    }
  });

  it('is idempotent: a repeated webhook does not re-email or re-log', async () => {
    decide.mockResolvedValue({ sessionId: SESSION, status: 'Approved', vendorData: CAMPAIGN_ID });
    givenCampaign('identity_verified');

    const res = await POST(post({ session_id: SESSION }));
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
    expect(approved).not.toHaveBeenCalled();
  });

  it('never downgrades a fully verified campaign', async () => {
    decide.mockResolvedValue({ sessionId: SESSION, status: 'Declined', vendorData: CAMPAIGN_ID });
    givenCampaign('fully_verified');

    await POST(post({ session_id: SESSION }));
    expect(state.updates).toHaveLength(0);
  });

  it('records the decision in the audit log', async () => {
    decide.mockResolvedValue({ sessionId: SESSION, status: 'Approved', vendorData: CAMPAIGN_ID });
    givenCampaign('pending');

    await POST(post({ session_id: SESSION }));
    expect(state.audits[0]).toMatchObject({
      eventType: 'identity_verification_decided',
      details: { provider: 'didit', diditStatus: 'Approved' },
    });
  });

  it('accepts either spelling of the id Didit has used', async () => {
    decide.mockResolvedValue({ sessionId: SESSION, status: 'Approved', vendorData: CAMPAIGN_ID });
    givenCampaign('pending');

    await POST(post({ sessionId: SESSION }));
    expect(decide).toHaveBeenCalledWith(SESSION);
  });
});
