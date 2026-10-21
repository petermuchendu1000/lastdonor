/**
 * An admin who submits a campaign is not asked to review their own.
 *
 * `notifyAdminsCampaignSubmitted` mails every row with `role = 'admin'`.
 * Before this, an admin submitting a campaign received BOTH mails for the
 * single event: their own "Received:" receipt, and an "[Admin] Review
 * needed: <their own title>" telling them someone was waiting on them. On
 * a platform whose admin set is small that is most of the mail the event
 * produces, and it reads as the system repeating itself — which is how
 * this was found, from the owner reporting the submission mail as
 * repetitive.
 *
 * The skip is scoped to the submitter alone. Every OTHER admin still gets
 * the review request, so nothing stops being reviewed; that is the part
 * worth pinning, because "fixing" the duplicate by suppressing the admin
 * mail generally would leave `under_review` campaigns with nobody told.
 *
 * See `docs/93`.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  admins: [] as Row[],
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
  const selectChain = (keys: string) => {
    const rows =
      keys === 'id,email' ? state.admins
      : keys === 'preferences' ? [{ preferences: null }] // wantsEmail: default true
      : [];
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
      then: (res: (v: Row[]) => unknown) => Promise.resolve(rows).then(res),
    };
    return chain;
  };

  return {
    db: {
      select: (proj: Record<string, unknown>) => selectChain(Object.keys(proj ?? {}).join(',')),
      insert: () => ({
        values: (v: Row) => {
          state.notificationInserts.push(v);
          return { returning: async () => [{ id: `notif_${state.notificationInserts.length}` }] };
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
  };
});

const SUBMITTER = 'user_admin_submitter';
const OTHER_ADMIN = 'user_admin_other';

const payload = {
  campaignId: 'camp_1',
  campaignTitle: 'Help Amina Walk Again',
  creatorName: 'Peter',
  category: 'medical',
  goalAmount: 500_000,
};

beforeEach(() => {
  state.admins = [
    { id: SUBMITTER, email: 'peter@example.com' },
    { id: OTHER_ADMIN, email: 'reviewer@example.com' },
  ];
  state.sendCalls = [];
  state.notificationInserts = [];
});

describe('notifyAdminsCampaignSubmitted', () => {
  it('does not mail the submitting admin a request to review their own campaign', async () => {
    const { notifyAdminsCampaignSubmitted } = await import('./notifications');
    await notifyAdminsCampaignSubmitted({ ...payload, creatorId: SUBMITTER });

    const recipients = state.sendCalls.map((c) => c.to);
    expect(recipients).toEqual(['reviewer@example.com']);
    expect(recipients).not.toContain('peter@example.com');
  });

  it('still mails every other admin, so the queue is not left unattended', async () => {
    const { notifyAdminsCampaignSubmitted } = await import('./notifications');
    await notifyAdminsCampaignSubmitted({ ...payload, creatorId: SUBMITTER });

    expect(state.sendCalls).toHaveLength(1);
    expect(state.notificationInserts).toHaveLength(1);
    expect(state.notificationInserts[0]).toMatchObject({ userId: OTHER_ADMIN });
  });

  it('mails all admins when the submitter is not one of them', async () => {
    const { notifyAdminsCampaignSubmitted } = await import('./notifications');
    await notifyAdminsCampaignSubmitted({ ...payload, creatorId: 'user_ordinary_donor' });

    expect(state.sendCalls.map((c) => c.to).sort()).toEqual([
      'peter@example.com',
      'reviewer@example.com',
    ]);
  });

  it('mails all admins when no creatorId is supplied, preserving old behaviour', async () => {
    const { notifyAdminsCampaignSubmitted } = await import('./notifications');
    await notifyAdminsCampaignSubmitted(payload);

    expect(state.sendCalls).toHaveLength(2);
  });
});
