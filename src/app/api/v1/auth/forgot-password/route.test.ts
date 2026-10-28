/**
 * `POST /api/v1/auth/forgot-password` — three outcomes, one response.
 *
 * Two of the three branches used to send nothing at all, so the route's
 * reassuring "if an account with that email exists, a password reset link
 * has been sent" was, for those two, not true of any inbox. The case it
 * failed hardest is a real account holder who signed in with Google: they
 * were told nothing, every time, with no way to find out why.
 *
 * The constraint that makes this non-trivial is `docs/32`: the HTTP response
 * must stay an unusable oracle. So these tests assert BOTH halves — that the
 * right person is told the right thing by email, and that the response is
 * byte-for-byte identical whichever branch ran.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextRequest } from 'next/server';

const USER_ID = '11111111-1111-1111-1111-111111111111';

/** Queue of row-sets returned by successive `db.select()` chains. */
const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  inserts: [] as unknown[],
  deletes: 0,
  /** What `claimResetSend` answers. `false` models "mailed inside the last minute". */
  maySend: true,
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
      insert: () => ({
        values: (v: unknown) => {
          state.inserts.push(v);
          return Promise.resolve();
        },
      }),
      delete: () => ({
        where: () => {
          state.deletes += 1;
          return Promise.resolve();
        },
      }),
    },
  };
});

const notify = vi.fn();
vi.mock('@/lib/notifications', () => ({
  notifyPasswordResetOutcome: (...args: unknown[]) => notify(...args),
}));

/*
  The token lifecycle and the per-address cooldown live in
  `src/lib/password-reset-tokens.ts` and are executed for real against a
  Postgres in `password-reset-tokens.integration.test.ts` - a mock cannot race
  itself, so it could never show the property that module exists for
  (`docs/124`, `docs/126`). Here they are mocked because what this file tests
  is the route's BRANCHING and the `docs/32` response property.
*/
vi.mock('@/lib/password-reset-tokens', () => ({
  RESET_TOKEN_TTL_MS: 60 * 60 * 1000,
  claimResetSend: async () => state.maySend,
  issueResetToken: async (email: string, token: string) => {
    state.deletes += 1;
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    state.inserts.push({ identifier: `reset:${email}`, token, expires });
    return { token, expires };
  },
}));

const { POST } = await import('./route');

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.selects = [];
  state.inserts = [];
  state.deletes = 0;
  state.maySend = true;
});

describe('the address has a password', () => {
  beforeEach(() => {
    state.selects.push([{ id: USER_ID, passwordHash: '$2a$10$abcdefghijklmnopqrstuv' }]);
  });

  it('emails a reset link', async () => {
    await POST(request({ email: 'has@example.com' }));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      email: 'has@example.com',
      outcome: 'reset_link',
    });
  });

  it('mints a single-use token that expires in an hour', async () => {
    const before = Date.now();
    await POST(request({ email: 'has@example.com' }));

    // The old token for this address is cleared before the new one lands.
    expect(state.deletes).toBe(1);
    expect(state.inserts).toHaveLength(1);

    const row = state.inserts[0] as { identifier: string; token: string; expires: Date };
    expect(row.identifier).toBe('reset:has@example.com');
    expect(row.token).toMatch(/^[0-9a-f-]{36}$/);
    const ttl = row.expires.getTime() - before;
    expect(ttl).toBeGreaterThan(59 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000 + 5_000);
  });

  it('puts that exact token in the link it emails', async () => {
    await POST(request({ email: 'has@example.com' }));

    const { token } = state.inserts[0] as { token: string };
    const { resetUrl } = notify.mock.calls[0][0] as { resetUrl: string };
    expect(resetUrl).toContain(`token=${token}`);
    expect(resetUrl).toContain('email=has%40example.com');
  });
});

describe('the address has no account', () => {
  it('says so, to the address, and mints nothing', async () => {
    state.selects.push([]);
    await POST(request({ email: 'nobody@example.com' }));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      email: 'nobody@example.com',
      outcome: 'no_account',
    });
    expect(state.inserts).toHaveLength(0);
  });
});

describe('the account signs in through a provider', () => {
  it('names the provider so the email can say which button to press', async () => {
    state.selects.push([{ id: USER_ID, passwordHash: null }]);
    state.selects.push([{ provider: 'google' }]);

    await POST(request({ email: 'oauth@example.com' }));

    expect(notify.mock.calls[0][0]).toMatchObject({
      email: 'oauth@example.com',
      outcome: 'oauth_only',
      provider: 'google',
    });
    expect(state.inserts).toHaveLength(0);
  });

  it('still sends when no linked provider row can be found', async () => {
    state.selects.push([{ id: USER_ID, passwordHash: null }]);
    state.selects.push([]);

    await POST(request({ email: 'oauth@example.com' }));

    expect(notify.mock.calls[0][0]).toMatchObject({
      outcome: 'oauth_only',
      provider: null,
    });
  });
});

describe('⛔ the per-address cooldown (docs/127)', () => {
  it('sends nothing and mints nothing when this address was mailed a moment ago', async () => {
    /*
      The whole endpoint's cost lands on a mailbox and on the shared Resend
      quota, neither of which is keyed by who asked - so the `auth` tier,
      which is per IP, never bounded it. [VERIFIED live: calls 1-10 answered
      400 and 11-13 answered 429, so ten a minute from one address is exactly
      what was permitted.]
    */
    state.maySend = false;
    state.selects.push([{ id: USER_ID, passwordHash: '$2a$10$abcdefghijklmnopqrstuv' }]);

    await POST(request({ email: 'has@example.com' }));

    expect(notify).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
    // ⛔ And nothing is deleted either: the live link in somebody's inbox is
    // what an attacker was able to destroy roughly every six seconds.
    expect(state.deletes).toBe(0);
  });

  it('⚠️ answers identically whether it sent or suppressed', async () => {
    /*
      A different status, body or shape here would be a NEW oracle - worse
      than the one `docs/32` closed, because "we mailed this address in the
      last minute" is a fact about somebody else's account.
    */
    state.selects.push([{ id: USER_ID, passwordHash: '$2a$10$abcdefghijklmnopqrstuv' }]);
    const sent = await POST(request({ email: 'probe@example.com' }));
    const sentBody = await sent.text();

    state.maySend = false;
    state.selects.push([{ id: USER_ID, passwordHash: '$2a$10$abcdefghijklmnopqrstuv' }]);
    const suppressed = await POST(request({ email: 'probe@example.com' }));

    expect(suppressed.status).toBe(sent.status);
    expect(await suppressed.text()).toBe(sentBody);
  });

  it('⚠️ the control: it still sends when nothing was sent recently', async () => {
    // Without this, "suppressed" would be satisfied by never sending at all,
    // which is a denial of password recovery rather than a control.
    state.selects.push([{ id: USER_ID, passwordHash: '$2a$10$abcdefghijklmnopqrstuv' }]);
    await POST(request({ email: 'has@example.com' }));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('⛔ claims the send BEFORE looking the account up', async () => {
    /*
      A sealed module is worthless if the caller works around it
      (`docs/111`). Read from source, because the ORDER is the property: a
      cooldown claimed after the branch would throttle only the accounts that
      have a password, leave every other address unprotected, and make the
      difference observable in how long the two paths take.
    */
    const source = readFileSync(
      resolve(__dirname, 'route.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');
    /*
      ⚠️ The CALL, not the name. The first version searched for
      `claimResetSend` and matched the IMPORT on line 9, which is above
      everything - so moving the call below the lookup left the check green.
      Gate 4: a check that cannot fail is not a check.
    */
    const claim = source.indexOf('await claimResetSend(');
    const lookup = source.indexOf('.select({ id: users.id');
    expect(claim, 'the route does not call claimResetSend at all').toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(claim, 'the cooldown is claimed after the account lookup').toBeLessThan(lookup);
  });
});

describe('the response is not an oracle (docs/32)', () => {
  async function responseFor(setup: () => void) {
    setup();
    const res = await POST(request({ email: 'probe@example.com' }));
    return { status: res.status, body: await res.text() };
  }

  it('answers identically whichever branch ran', async () => {
    const hasPassword = await responseFor(() =>
      state.selects.push([{ id: USER_ID, passwordHash: '$2a$10$abcdefghijklmnopqrstuv' }]),
    );
    const noAccount = await responseFor(() => state.selects.push([]));
    const oauthOnly = await responseFor(() => {
      state.selects.push([{ id: USER_ID, passwordHash: null }]);
      state.selects.push([{ provider: 'google' }]);
    });

    expect(hasPassword.status).toBe(200);
    expect(noAccount).toEqual(hasPassword);
    expect(oauthOnly).toEqual(hasPassword);
  });

  it('never names the branch in the body', async () => {
    state.selects.push([]);
    const body = await (await POST(request({ email: 'probe@example.com' }))).text();

    expect(body).not.toMatch(/no_account|oauth|google|not found|does not exist/i);
    expect(body).toMatch(/If an account with that email exists/);
  });

  it('rejects a malformed address before any lookup', async () => {
    const res = await POST(request({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(notify).not.toHaveBeenCalled();
  });
});
