/**
 * `preferences.emailCampaignUpdates` — P1, fixed 2026-10-15.
 *
 * The toggle has existed in the account UI since launch and was read NOWHERE:
 * `getSubscribedDonors` returned every subscribed donor, so the campaign
 * update digest mailed people who had switched campaign updates off. A toggle
 * that lies is a consent record that does not match behaviour.
 *
 * Campaign *status* notices (paused / resumed / suspended) are deliberately
 * NOT suppressed by this preference — they concern money the donor has already
 * given — so that path is pinned here too.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  /** `donor_campaign_subscriptions` rows for the campaign. */
  subscribers: [] as Row[],
  /** `users` rows: { id, email, name, preferences }. */
  users: [] as Row[],
  sendCalls: [] as Row[],
  notificationInserts: [] as Row[],
}));

vi.mock('@/lib/resend', () => ({
  resend: {
    emails: {
      send: async (args: Row) => {
        state.sendCalls.push(args);
        return { data: { id: 'ok' }, error: null };
      },
    },
  },
}));

vi.mock('@/db', () => {
  /** Dispatch on the projection's KEYS — each query in this path is distinct. */
  const rowsFor = (keys: string): Row[] => {
    switch (keys) {
      case 'donorEmail,userId':            // getSubscribedDonors
        return state.subscribers;
      case 'id,preferences':               // the emailCampaignUpdates gate
        return state.users.map((u) => ({ id: u.id, preferences: u.preferences }));
      case 'email,name':                   // resolveDonorNames (users)
        return state.users.map((u) => ({ email: u.email, name: u.name }));
      case 'donorEmail,donorName':         // resolveDonorNames (donations)
        return [];
      case 'preferences':                  // wantsEmail
        return state.users.map((u) => ({ preferences: u.preferences }));
      default:
        return [];
    }
  };

  return {
    db: {
      select: (projection: Row) => {
        const keys = Object.keys(projection ?? {}).sort().join(',');
        const c: Record<string, unknown> = {};
        c.from = () => c;
        c.where = () => c;
        c.limit = async () => rowsFor(keys);
        c.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve(rowsFor(keys)).then(resolve);
        return c;
      },
      insert: () => ({
        values: (v: Row) => ({
          returning: async () => {
            state.notificationInserts.push(v);
            return [{ id: 'notif-1' }];
          },
        }),
      }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    },
  };
});

const { notifyCampaignUpdateDigest, notifyCampaignPaused } = await import('./notifications');

const CAMPAIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const DIGEST = {
  campaignId: CAMPAIGN,
  campaignTitle: 'Help Ada',
  campaignSlug: 'help-ada',
  campaignStatus: 'active',
  campaignPublishedAt: new Date('2026-10-01T00:00:00Z'),
  updateTitle: 'Surgery scheduled',
  updateExcerpt: 'Good news this week.',
  progressPercent: 42,
  currency: 'KES',
  raisedCents: 4200,
  goalCents: 10000,
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://lastdonor.org';
  state.subscribers = [];
  state.users = [];
  state.sendCalls = [];
  state.notificationInserts = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notifyCampaignUpdateDigest', () => {
  it('skips a registered donor who switched campaign updates off', async () => {
    state.subscribers = [{ donorEmail: 'off@x.com', userId: 'u-off' }];
    state.users = [{ id: 'u-off', email: 'off@x.com', name: 'Olive', preferences: { emailCampaignUpdates: false } }];

    await notifyCampaignUpdateDigest(DIGEST);

    expect(state.sendCalls).toHaveLength(0);
    expect(state.notificationInserts).toHaveLength(0);
  });

  it('still mails a registered donor who left the toggle on', async () => {
    state.subscribers = [{ donorEmail: 'on@x.com', userId: 'u-on' }];
    state.users = [{ id: 'u-on', email: 'on@x.com', name: 'Otto', preferences: { emailCampaignUpdates: true } }];

    await notifyCampaignUpdateDigest(DIGEST);

    expect(state.sendCalls).toHaveLength(1);
    expect(state.sendCalls[0].to).toBe('on@x.com');
  });

  it('treats an unset preference as opted in', async () => {
    state.subscribers = [{ donorEmail: 'unset@x.com', userId: 'u-unset' }];
    state.users = [{ id: 'u-unset', email: 'unset@x.com', name: 'Uma', preferences: {} }];

    await notifyCampaignUpdateDigest(DIGEST);

    expect(state.sendCalls).toHaveLength(1);
  });

  it('still mails guest subscribers, whose opt-out is the subscription row itself', async () => {
    state.subscribers = [{ donorEmail: 'guest@x.com', userId: null }];
    state.users = [];

    await notifyCampaignUpdateDigest(DIGEST);

    expect(state.sendCalls).toHaveLength(1);
    expect(state.sendCalls[0].to).toBe('guest@x.com');
  });
});

describe('campaign status notices are NOT suppressed by emailCampaignUpdates', () => {
  it('mails a paused notice to a registered donor who switched campaign updates off', async () => {
    state.subscribers = [{ donorEmail: 'off@x.com', userId: 'u-off' }];
    state.users = [{ id: 'u-off', email: 'off@x.com', name: 'Olive', preferences: { emailCampaignUpdates: false } }];

    await notifyCampaignPaused({
      campaignId: CAMPAIGN,
      campaignTitle: 'Help Ada',
      campaignSlug: 'help-ada',
      campaignPublishedAt: new Date('2026-10-01T00:00:00Z'),
      reason: 'Documents under review',
      notifyDonors: true,
    });

    expect(state.sendCalls).toHaveLength(1);
  });
});
