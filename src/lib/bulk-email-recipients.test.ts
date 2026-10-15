/**
 * Bulk-email recipient resolution (P0, 2026-10-15).
 *
 * Pins the two properties the old code violated:
 *
 *  - the preview count and the send list come from the same predicate, so
 *    "Send to N recipient(s)" cannot drift from the real audience;
 *  - every resolution consults all three opt-out sources the platform holds.
 *    The old send route consulted none.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  /** Rows returned per table, keyed by the table the query selected from. */
  donations: [] as Row[],
  subscriptions: [] as Row[],
  /** Per-call override for the `subscriptions` table, consumed in query order. */
  subscriptionsQueue: [] as Row[][],
  newsletter: [] as Row[],
  users: [] as Row[],
  audits: [] as Row[],
  /** Predicate text captured per select, for assertions about the predicate. */
  calls: [] as string[],
  /** Conditions passed to `.where()`, per table, for predicate assertions. */
  wheres: [] as { table: string; cond: unknown }[],
}));

vi.mock('@/db/schema', () => ({
  donations: { __table: 'donations' },
  donorCampaignSubscriptions: { __table: 'subscriptions' },
  newsletterSubscribers: { __table: 'newsletter' },
  users: { __table: 'users' },
  auditLogs: { __table: 'audits' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  eq: (col: unknown, value: unknown) => ({ op: 'eq', col, value }),
  ne: (col: unknown, value: unknown) => ({ op: 'ne', col, value }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  inArray: (col: unknown, values: unknown[]) => ({ op: 'inArray', col, values }),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ op: 'sql', strings, vals }),
}));

vi.mock('@/db', () => {
  const makeChain = (projection: Row) => {
    const c: Record<string, unknown> = {};
    let table = '';
    c.from = (t: Row) => {
      table = String(t.__table);
      state.calls.push(table);
      return c;
    };
    c.where = (cond: unknown) => {
      state.wheres.push({ table, cond });
      return c;
    };
    c.orderBy = () => c;
    c.limit = async () => rowsFor(table);
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(rowsFor(table)).then(resolve);
    void projection;
    return c;
  };
  const rowsFor = (table: string): Row[] => {
    switch (table) {
      case 'donations': return state.donations;
      case 'subscriptions':
        return state.subscriptionsQueue.length ? state.subscriptionsQueue.shift()! : state.subscriptions;
      case 'newsletter': return state.newsletter;
      case 'users': return state.users;
      case 'audits': return state.audits;
      default: return [];
    }
  };
  return { db: { select: (projection: Row) => makeChain(projection) } };
});

const {
  resolveBulkEmailRecipients,
  countBulkEmailRecipients,
  loadPersistedRecipientFilter,
  bulkEmailRecipientCeiling,
  isRecipientFilter,
  DEFAULT_BULK_EMAIL_CEILING,
} = await import('./bulk-email-recipients');

const CAMPAIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const originalEnv = { ...process.env };

beforeEach(() => {
  state.donations = [];
  state.subscriptions = [];
  state.subscriptionsQueue = [];
  state.newsletter = [];
  state.users = [];
  state.audits = [];
  state.calls = [];
  state.wheres = [];
});

afterEach(() => {
  process.env = { ...originalEnv };
});

function donation(email: string, name = 'Donor', amount = 1000): Row {
  return { donorEmail: email, donorName: name, amount };
}

describe('deduplication', () => {
  it('returns one recipient per address, keeping the largest donation', async () => {
    state.donations = [donation('a@x.com', 'Ada', 500), donation('a@x.com', 'Ada', 7500)];

    const out = await resolveBulkEmailRecipients('all_donors', CAMPAIGN);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ email: 'a@x.com', name: 'Ada', donationAmount: 7500 });
  });
});

describe('opt-out sources (P0 — the send route consulted none)', () => {
  it('drops an address whose newsletter row is unsubscribed', async () => {
    state.donations = [donation('a@x.com'), donation('b@x.com')];
    state.newsletter = [
      { id: 'n1', email: 'a@x.com', unsubscribedAt: new Date() },
      { id: 'n2', email: 'b@x.com', unsubscribedAt: null },
    ];

    const out = await resolveBulkEmailRecipients('all_donors', CAMPAIGN);

    expect(out.map((r) => r.email)).toEqual(['b@x.com']);
  });

  it('drops an address with subscribed=false for this campaign', async () => {
    state.donations = [donation('a@x.com'), donation('b@x.com')];
    state.subscriptions = [{ donorEmail: 'a@x.com' }];

    const out = await resolveBulkEmailRecipients('all_donors', CAMPAIGN);

    expect(out.map((r) => r.email)).toEqual(['b@x.com']);
  });

  it('drops a user with preferences.emailNotifications === false', async () => {
    state.donations = [donation('a@x.com'), donation('b@x.com')];
    state.users = [{ email: 'a@x.com', preferences: { emailNotifications: false } }];

    const out = await resolveBulkEmailRecipients('all_donors', CAMPAIGN);

    expect(out.map((r) => r.email)).toEqual(['b@x.com']);
  });

  it('drops a user with preferences.emailCampaignUpdates === false', async () => {
    state.donations = [donation('a@x.com'), donation('b@x.com')];
    state.users = [{ email: 'b@x.com', preferences: { emailCampaignUpdates: false } }];

    const out = await resolveBulkEmailRecipients('all_donors', CAMPAIGN);

    expect(out.map((r) => r.email)).toEqual(['a@x.com']);
  });

  it('keeps a user with no preferences set (opt-out must be explicit)', async () => {
    state.donations = [donation('a@x.com')];
    state.users = [{ email: 'a@x.com', preferences: {} }];

    expect(await resolveBulkEmailRecipients('all_donors', CAMPAIGN)).toHaveLength(1);
  });

  it('consults all three sources on every resolution', async () => {
    state.donations = [donation('a@x.com')];

    await resolveBulkEmailRecipients('all_donors', CAMPAIGN);

    expect(state.calls).toContain('newsletter');
    expect(state.calls).toContain('subscriptions');
    expect(state.calls).toContain('users');
  });

  it('attaches the newsletter subscriber id so a one-click link can be minted', async () => {
    state.donations = [donation('a@x.com')];
    state.newsletter = [{ id: 'n1', email: 'a@x.com', unsubscribedAt: null }];

    const [out] = await resolveBulkEmailRecipients('all_donors', CAMPAIGN);

    expect(out.subscriberId).toBe('n1');
  });

  it('leaves subscriberId null for an address with no newsletter row', async () => {
    state.donations = [donation('a@x.com')];

    const [out] = await resolveBulkEmailRecipients('all_donors', CAMPAIGN);

    expect(out.subscriberId).toBeNull();
  });
});

describe('count and send cannot diverge (P0)', () => {
  it('countBulkEmailRecipients equals the length of the resolved list', async () => {
    state.donations = [donation('a@x.com'), donation('b@x.com'), donation('c@x.com')];
    state.newsletter = [{ id: 'n1', email: 'c@x.com', unsubscribedAt: new Date() }];

    const count = await countBulkEmailRecipients('all_donors', CAMPAIGN);
    const list = await resolveBulkEmailRecipients('all_donors', CAMPAIGN);

    expect(count).toBe(2);
    expect(count).toBe(list.length);
  });
});

describe('subscribed_donors', () => {
  it('reads the subscription list, not the donation list', async () => {
    // 1st subscriptions query: the subscribed list. 2nd: the opt-out list.
    state.subscriptionsQueue = [[{ donorEmail: 'sub@x.com' }], []];
    state.donations = [donation('sub@x.com', 'Sue', 2500)];

    const out = await resolveBulkEmailRecipients('subscribed_donors', CAMPAIGN);

    expect(out.map((r) => r.email)).toEqual(['sub@x.com']);
    expect(out[0].donationAmount).toBe(2500);
  });

  it('yields nothing without a campaign rather than widening to every donor', async () => {
    state.donations = [donation('a@x.com'), donation('b@x.com')];

    expect(await resolveBulkEmailRecipients('subscribed_donors', null)).toEqual([]);
  });
});

describe('ceiling', () => {
  it('defaults to DEFAULT_BULK_EMAIL_CEILING', () => {
    delete process.env.BULK_EMAIL_MAX_RECIPIENTS;
    expect(bulkEmailRecipientCeiling()).toBe(DEFAULT_BULK_EMAIL_CEILING);
  });

  it('honours BULK_EMAIL_MAX_RECIPIENTS', () => {
    process.env.BULK_EMAIL_MAX_RECIPIENTS = '12';
    expect(bulkEmailRecipientCeiling()).toBe(12);
  });

  it('ignores a non-numeric or non-positive override', () => {
    process.env.BULK_EMAIL_MAX_RECIPIENTS = 'lots';
    expect(bulkEmailRecipientCeiling()).toBe(DEFAULT_BULK_EMAIL_CEILING);
    process.env.BULK_EMAIL_MAX_RECIPIENTS = '0';
    expect(bulkEmailRecipientCeiling()).toBe(DEFAULT_BULK_EMAIL_CEILING);
  });
});

describe('filter persistence via the audit trail', () => {
  it('reads recipientFilter back from the bulk_email.created audit row', async () => {
    state.audits = [{ details: { recipientFilter: 'guest_donors' } }];
    expect(await loadPersistedRecipientFilter('id')).toBe('guest_donors');
  });

  it('returns null when no audit row exists, so the caller can fail closed', async () => {
    state.audits = [];
    expect(await loadPersistedRecipientFilter('id')).toBeNull();
  });

  it('returns null for a value that is not a known filter', async () => {
    state.audits = [{ details: { recipientFilter: 'everyone_everywhere' } }];
    expect(await loadPersistedRecipientFilter('id')).toBeNull();
  });

  it('isRecipientFilter guards the known set', () => {
    expect(isRecipientFilter('all_donors')).toBe(true);
    expect(isRecipientFilter('refunded_donors')).toBe(true);
    expect(isRecipientFilter('nope')).toBe(false);
    expect(isRecipientFilter(undefined)).toBe(false);
  });
});

describe('the account-deletion tombstone is never a recipient', () => {
  /**
   * Account deletion scrubs `donations.donor_email` to
   * DELETED_DONOR_PLACEHOLDER, so every deleted user's donations collapse onto
   * one synthetic address. Resolving it as a recipient would mail an address
   * that belongs to nobody, cannot consent, and hard-bounces - which is how a
   * sending domain gets blocked. Verified absent before the 2026-10-15 fix.
   *
   * The `@/db` mock's `where` does not apply predicates to the fixture rows, so
   * this asserts the predicate was built rather than its effect on rows. That
   * is the honest limit of this layer; the effect is Postgres's job.
   */
  function flattenConds(cond: unknown, out: Record<string, unknown>[] = []) {
    if (!cond || typeof cond !== 'object') return out;
    const c = cond as { op?: string; parts?: unknown[] };
    if (c.op === 'and' && Array.isArray(c.parts)) {
      for (const p of c.parts) flattenConds(p, out);
    } else {
      out.push(cond as Record<string, unknown>);
    }
    return out;
  }

  it.each(['all_donors', 'registered_donors', 'guest_donors', 'refunded_donors'] as const)(
    'excludes the tombstone address for the %s filter',
    async (filter) => {
      state.donations = [];
      await countBulkEmailRecipients(filter, null);

      const donationWheres = state.wheres.filter((w) => w.table === 'donations');
      expect(donationWheres.length).toBeGreaterThan(0);

      const conds = donationWheres.flatMap((w) => flattenConds(w.cond));
      expect(
        conds.some((c) => c.op === 'ne' && c.value === 'deleted@lastdonor.org'),
      ).toBe(true);
    },
  );
});
