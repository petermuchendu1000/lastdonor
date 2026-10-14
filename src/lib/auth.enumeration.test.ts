/**
 * Audit A4 — the login form must not be an account-existence oracle.
 *
 * Pre-fix, `authorize()` threw four distinguishable `CredentialsSignin` codes
 * (`no_account`, `oauth_only`, `invalid_password`, `account_locked`). The code
 * is reflected to the caller as `result.code` and, on the redirect flow, lands
 * in the URL — so anyone could submit an email with a junk password and read
 * off whether that address has an account, and whether it uses Google.
 *
 * These tests drive the real `authorize` implementation captured from the
 * NextAuth config and assert that every pre-authentication outcome is
 * indistinguishable, while the distinguishing detail still reaches the server
 * log.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  passwordHash: string | null;
  role: string;
  failedLoginCount: number;
  failedLoginWindowStart: Date | null;
}

const state = vi.hoisted(() => ({
  /** Queue of rows returned by successive `db.select()` chains. */
  rows: [] as unknown[][],
  updates: 0,
  config: undefined as { providers: Array<{ authorize?: (c: unknown) => Promise<unknown> }> } | undefined,
}));

const password = vi.hoisted(() => ({
  verify: vi.fn(async () => false),
  verifyLegacy: vi.fn(async () => false),
}));

vi.mock('next-auth', () => {
  class CredentialsSignin extends Error {
    code = 'credentials';
  }
  const NextAuth = (config: typeof state.config) => {
    state.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  };
  return { default: NextAuth, CredentialsSignin };
});
vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: () => ({}) }));

vi.mock('@/db', () => {
  const selectChain = () => {
    const rows = state.rows.shift() ?? [];
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => rows,
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return chain;
  };
  const updateChain = {
    set: () => ({
      where: async () => {
        state.updates++;
      },
    }),
  };
  return { db: { select: selectChain, update: () => updateChain } };
});

vi.mock('@/lib/password', () => ({
  verifyPassword: password.verify,
  verifyLegacyPassword: password.verifyLegacy,
  hashPassword: vi.fn(),
}));

const { CredentialsSignin } = await import('next-auth');
await import('@/lib/auth');

const authorize = () => {
  const provider = state.config!.providers.find((p) => typeof p.authorize === 'function');
  return provider!.authorize!;
};

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-1',
    email: 'someone@example.com',
    name: 'Someone',
    avatarUrl: null,
    passwordHash: '$2a$12$abcdefghijklmnopqrstuv',
    role: 'donor',
    failedLoginCount: 0,
    failedLoginWindowStart: null,
    ...overrides,
  };
}

/** Rows the lockout pre-check consumes before the real user lookup. */
const NOT_LOCKED: unknown[] = [];

async function attempt(rows: unknown[][]): Promise<{ code?: string; error: unknown }> {
  state.rows = rows;
  state.updates = 0;
  try {
    const result = await authorize()({ email: 'someone@example.com', password: 'hunter2' });
    return { code: undefined, error: result };
  } catch (error) {
    return { code: (error as { code?: string }).code, error };
  }
}

beforeEach(() => {
  password.verify.mockReset();
  password.verify.mockResolvedValue(false);
  password.verifyLegacy.mockReset();
  password.verifyLegacy.mockResolvedValue(false);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('login failures are indistinguishable (audit A4)', () => {
  it('returns the same code when no account exists', async () => {
    const { code, error } = await attempt([NOT_LOCKED, []]);
    expect(error).toBeInstanceOf(CredentialsSignin);
    expect(code).toBe('invalid_credentials');
  });

  it('returns the same code for an OAuth-only account', async () => {
    const { code } = await attempt([NOT_LOCKED, [user({ passwordHash: null })]]);
    expect(code).toBe('invalid_credentials');
  });

  it('returns the same code for a wrong password', async () => {
    const { code } = await attempt([NOT_LOCKED, [user()], [user()]]);
    expect(code).toBe('invalid_credentials');
  });

  it('returns the same code for a locked-out account', async () => {
    // A lockout is only reachable for an address that exists (the failed-attempt
    // counter is never incremented for an unknown address), so a distinct
    // `account_locked` code was itself an existence oracle.
    const locked = [{ failedLoginCount: 9, failedLoginWindowStart: new Date() }];
    const { code } = await attempt([locked]);
    expect(code).toBe('invalid_credentials');
  });

  it('produces exactly one distinct code across every pre-auth outcome', async () => {
    const codes = new Set<string | undefined>();
    codes.add((await attempt([NOT_LOCKED, []])).code);
    codes.add((await attempt([NOT_LOCKED, [user({ passwordHash: null })]])).code);
    codes.add((await attempt([NOT_LOCKED, [user()], [user()]])).code);
    codes.add(
      (await attempt([[{ failedLoginCount: 9, failedLoginWindowStart: new Date() }]])).code,
    );

    expect([...codes]).toEqual(['invalid_credentials']);
  });

  it('never emits any of the codes that leaked account state', async () => {
    const leaky = ['no_account', 'oauth_only', 'invalid_password', 'account_locked'];
    const outcomes = [
      await attempt([NOT_LOCKED, []]),
      await attempt([NOT_LOCKED, [user({ passwordHash: null })]]),
      await attempt([NOT_LOCKED, [user()], [user()]]),
      await attempt([[{ failedLoginCount: 9, failedLoginWindowStart: new Date() }]]),
    ];

    for (const outcome of outcomes) {
      expect(leaky).not.toContain(outcome.code);
    }

    // And they are gone from the source, not merely unreachable.
    const source = readFileSync(path.resolve(__dirname, 'auth.ts'), 'utf8');
    for (const code of leaky) {
      expect(source).not.toMatch(new RegExp(`code\\s*=\\s*'${code}'`));
    }
  });
});

describe('timing does not restore the oracle (audit A4)', () => {
  it('still performs a password verification when the account does not exist', async () => {
    await attempt([NOT_LOCKED, []]);
    expect(password.verify).toHaveBeenCalledTimes(1);
  });

  it('still performs a password verification for an OAuth-only account', async () => {
    await attempt([NOT_LOCKED, [user({ passwordHash: null })]]);
    expect(password.verify).toHaveBeenCalledTimes(1);
  });
});

describe('server-side detail is preserved (audit A4)', () => {
  it('logs the real reason without sending it to the caller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await attempt([NOT_LOCKED, []]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reason=no_account'));

    warn.mockClear();
    await attempt([NOT_LOCKED, [user({ passwordHash: null })]]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reason=oauth_only'));

    warn.mockClear();
    await attempt([NOT_LOCKED, [user()], [user()]]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reason=invalid_password'));

    warn.mockClear();
    await attempt([[{ failedLoginCount: 9, failedLoginWindowStart: new Date() }]]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reason=account_locked'));
  });
});

describe('legitimate flows still work', () => {
  it('signs in with a correct password', async () => {
    password.verify.mockResolvedValue(true);
    const { code, error } = await attempt([NOT_LOCKED, [user()]]);
    expect(code).toBeUndefined();
    expect(error).toMatchObject({ id: 'user-1', email: 'someone@example.com' });
  });

  it('keeps the legacy-hash reset path distinguishable', async () => {
    // Reachable only by a caller who already supplied the CORRECT password, so
    // it discloses nothing to an enumerator — and collapsing it would leave
    // those users with no way to understand why they cannot get in.
    password.verify.mockResolvedValue(false);
    password.verifyLegacy.mockResolvedValue(true);
    const { code } = await attempt([NOT_LOCKED, [user()]]);
    expect(code).toBe('password_reset_required');
  });

  it('normalises the submitted address before looking it up', async () => {
    password.verify.mockResolvedValue(true);
    state.rows = [NOT_LOCKED, [user()]];
    const result = await authorize()({ email: '  SomeOne@Example.COM ', password: 'hunter2' });
    expect(result).toMatchObject({ id: 'user-1' });
  });
});
