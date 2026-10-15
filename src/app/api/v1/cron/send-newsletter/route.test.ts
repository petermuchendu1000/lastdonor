/**
 * Newsletter cron — two P0s and one P1 fixed 2026-10-15.
 *
 *  1. The CAN-SPAM footer hardcoded `1234 Main St, Suite 100, Washington, DC
 *     20001` and presented it as the sender's physical address. The address is
 *     now read from `MAILING_POSTAL_ADDRESS` with **no default**, and the run
 *     is skipped when it is unset.
 *  2. `sent++` ran unconditionally after `await resend.emails.send(...)`. The
 *     Resend SDK never throws — it resolves `{ data: null, error }` — so a run
 *     in which every send failed logged a 100% success rate and the `catch`
 *     was unreachable (docs/29 P0-4, src/lib/utils/retry.ts:6-12).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'test-newsletter-unsubscribe-secret-0123456789';
const ADDRESS = 'LastDonor Ltd, PO Box 9, Anytown, ST 00000';

const state = vi.hoisted(() => ({
  /** Queued results for each `db.select()` chain, in call order. */
  selects: [] as unknown[][],
  audits: [] as Record<string, unknown>[],
  sendResults: [] as { data: unknown; error: unknown }[],
  sendCalls: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/cron-auth', () => ({ verifyCronAuth: () => true }));

vi.mock('@/lib/locks', () => ({
  CRON_LOCKS: { 'send-newsletter': { name: 'send-newsletter' } },
  acquireCronLock: async () => ({ ok: true, lock: { release: async () => {} } }),
  lockSkipPayload: () => ({ ok: true, data: { skipped: true, reason: 'held' } }),
}));

vi.mock('@/lib/ai/prompts/generate-newsletter', () => ({
  buildGenerateNewsletterPrompt: () => ({ systemPrompt: 's', userPrompt: 'u' }),
}));

vi.mock('@/lib/ai/call-ai', () => ({
  callAI: async () => ({
    subject: 'This week on LastDonor',
    preheader: 'p',
    featuredHtml: '<p>featured</p>',
    impactHtml: '<p>impact</p>',
    contextHtml: '<p>context</p>',
  }),
}));

vi.mock('@/lib/errors', () => ({ logError: () => {} }));

vi.mock('@/lib/resend', () => ({
  resend: {
    emails: {
      send: async (args: Record<string, unknown>) => {
        state.sendCalls.push(args);
        return state.sendResults.shift() ?? { data: { id: 'ok' }, error: null };
      },
    },
  },
}));

vi.mock('@/db', () => {
  const chain = () => {
    const rows = state.selects.shift() ?? [];
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = async () => rows;
    // Awaiting the chain without `.limit()` (the subscriber list) resolves too.
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return c;
  };
  return {
    db: {
      select: chain,
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          state.audits.push(v);
          const p = Promise.resolve();
          return Object.assign(p, { catch: () => Promise.resolve() });
        },
      }),
    },
  };
});

const { GET } = await import('./route');

const ACTIVE_CAMPAIGN = [{
  title: 'Help Ada', subjectName: 'Ada', category: 'medical',
  raisedAmount: 1000, goalAmount: 5000, slug: 'help-ada', donorCount: 3,
}];
const COMPLETED_CAMPAIGN = [{ subjectName: 'Bo', raisedAmount: 9000, donorCount: 12 }];

/** The four selects the happy path performs, in order. */
function queueHappyPath(subscribers: { id: string; email: string }[]) {
  state.selects = [
    ACTIVE_CAMPAIGN,
    COMPLETED_CAMPAIGN,
    [{ count: subscribers.length }],
    subscribers,
  ];
}

function req(): NextRequest {
  return new NextRequest('https://lastdonor.org/api/v1/cron/send-newsletter', {
    method: 'GET',
    headers: { authorization: 'Bearer test' },
  });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = 'https://lastdonor.org';
  process.env.MAILING_POSTAL_ADDRESS = ADDRESS;
  state.selects = [];
  state.audits = [];
  state.sendResults = [];
  state.sendCalls = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('postal address (P0, legal)', () => {
  it('refuses to send when MAILING_POSTAL_ADDRESS is unset', async () => {
    delete process.env.MAILING_POSTAL_ADDRESS;
    queueHappyPath([{ id: 'sub-1', email: 'a@example.com' }]);

    const body = await (await GET(req())).json();

    expect(body.ok).toBe(true);
    expect(body.data.skipped).toBe(true);
    expect(body.data.sent).toBe(0);
    expect(body.data.reason).toMatch(/MAILING_POSTAL_ADDRESS/);
    expect(state.sendCalls).toHaveLength(0);
  });

  it('records the skip in the audit log as a warning', async () => {
    delete process.env.MAILING_POSTAL_ADDRESS;
    queueHappyPath([{ id: 'sub-1', email: 'a@example.com' }]);

    await GET(req());

    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ eventType: 'cron.send_newsletter', severity: 'warning' });
    expect((state.audits[0].details as Record<string, unknown>).skipped).toBe(true);
  });

  it('prints the configured address and never the old hardcoded placeholder', async () => {
    queueHappyPath([{ id: 'sub-1', email: 'a@example.com' }]);

    await GET(req());

    const html = state.sendCalls[0].html as string;
    expect(html).toContain(ADDRESS);
    expect(html).not.toContain('1234 Main St');
    expect(html).not.toContain('Washington, DC 20001');
  });

  it('HTML-escapes the operator-supplied address', async () => {
    process.env.MAILING_POSTAL_ADDRESS = '<script>x</script> & Co';
    queueHappyPath([{ id: 'sub-1', email: 'a@example.com' }]);

    await GET(req());

    const html = state.sendCalls[0].html as string;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; Co');
  });
});

describe('send accounting (P1 — Resend never throws)', () => {
  it('does not count a resolved { error } as sent', async () => {
    queueHappyPath([{ id: 'sub-1', email: 'a@example.com' }]);
    // maxRetries: 2 => up to 3 attempts, all failing.
    state.sendResults = [
      { data: null, error: { message: 'rate limited' } },
      { data: null, error: { message: 'rate limited' } },
      { data: null, error: { message: 'rate limited' } },
    ];

    const body = await (await GET(req())).json();

    expect(body.data.sent).toBe(0);
    expect(body.data.failed).toBe(1);
  });

  it('writes the real counts to the audit log instead of an inflated success count', async () => {
    queueHappyPath([
      { id: 'sub-1', email: 'a@example.com' },
      { id: 'sub-2', email: 'b@example.com' },
    ]);
    state.sendResults = [
      { data: { id: '1' }, error: null },
      { data: null, error: { message: 'bounced' } },
      { data: null, error: { message: 'bounced' } },
      { data: null, error: { message: 'bounced' } },
    ];

    await GET(req());

    const details = state.audits.at(-1)!.details as Record<string, unknown>;
    expect(details.sent).toBe(1);
    expect(details.failed).toBe(1);
    expect(state.audits.at(-1)!.severity).toBe('warning');
  });

  it('retries a result-shaped failure rather than giving up after one attempt', async () => {
    queueHappyPath([{ id: 'sub-1', email: 'a@example.com' }]);
    state.sendResults = [
      { data: null, error: { message: 'transient' } },
      { data: { id: 'ok' }, error: null },
    ];

    const body = await (await GET(req())).json();

    expect(state.sendCalls.length).toBe(2);
    expect(body.data.sent).toBe(1);
    expect(body.data.failed).toBe(0);
  });

  it('counts a clean run as sent with zero failures', async () => {
    queueHappyPath([{ id: 'sub-1', email: 'a@example.com' }]);

    const body = await (await GET(req())).json();

    expect(body.data).toMatchObject({ sent: 1, failed: 0, totalSubscribers: 1 });
    expect(state.audits.at(-1)!.severity).toBe('info');
  });
});

describe('unsubscribe link', () => {
  it('carries a signed token plus RFC 8058 headers', async () => {
    queueHappyPath([{ id: 'sub-1', email: 'a@example.com' }]);

    await GET(req());

    const call = state.sendCalls[0];
    const headers = call.headers as Record<string, string>;
    expect(headers['List-Unsubscribe']).toMatch(/\/api\/v1\/newsletter\/unsubscribe\?token=sub-1\./);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(call.html as string).toContain('/api/v1/newsletter/unsubscribe?token=sub-1.');
  });
});
