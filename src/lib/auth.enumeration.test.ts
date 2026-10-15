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
 * Also covered here, because they are the same control reached by other doors:
 *
 *   - `POST /api/auth/register` used to answer 409 "An account with this email
 *     already exists" to any anonymous caller, which handed back the exact
 *     oracle the login form had been stripped of.
 *   - `POST /api/v1/auth/reset-password` did not clear the lockout counters,
 *     reported success on an UPDATE that matched zero rows, and let a user
 *     reset *to* a known-breached password.
 *   - `POST /api/v1/admin/settings/security-question` compared a raw password
 *     against a peppered hash, so it could only ever answer "incorrect".
 *   - `src/instrumentation-client.ts` shipped the password-reset URL — token
 *     and address — to Sentry.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { createHmac } from 'crypto';
import type { NextRequest } from 'next/server';

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
  /** Values passed to each `db.update().set(...)`. */
  updateValues: [] as unknown[],
  /** Queue of rows returned by successive `db.update()...returning()` calls. */
  updateReturning: [] as unknown[][],
  /** Values passed to each `db.insert().values(...)`. */
  inserts: [] as unknown[],
  /** Queue of rows returned by successive `db.insert()...returning()` calls. */
  insertReturning: [] as unknown[][],
  deletes: 0,
  /** Arguments of every `resend.emails.send()` the code under test made. */
  emailSends: [] as Record<string, unknown>[],
  config: undefined as { providers: Array<{ authorize?: (c: unknown) => Promise<unknown> }> } | undefined,
}));

const password = vi.hoisted(() => ({
  verify: vi.fn(async () => false),
  verifyLegacy: vi.fn(async () => false),
  hash: vi.fn(async () => '$2a$12$stub-hash-of-the-peppered-prehash'),
  pwned: vi.fn(async () => false),
}));

/** `auth()` from the NextAuth mock, so `requireRole` can be driven. */
const nextAuth = vi.hoisted(() => ({ auth: vi.fn() }));

/** Options handed to `Sentry.init` by `src/instrumentation-client.ts`. */
const sentry = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
}));

vi.mock('next-auth', () => {
  class CredentialsSignin extends Error {
    code = 'credentials';
  }
  const NextAuth = (config: typeof state.config) => {
    state.config = config;
    return { handlers: {}, auth: nextAuth.auth, signIn: vi.fn(), signOut: vi.fn() };
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
  /**
   * `where()` has to be both awaitable (auth.ts awaits it directly) and
   * chainable into `.returning()` (reset-password now checks the row count),
   * so it returns a thenable that also carries `returning`.
   */
  const updateChain = {
    set: (values: unknown) => ({
      where: () => {
        state.updates++;
        state.updateValues.push(values);
        const rows = state.updateReturning.shift() ?? [{ id: 'user-1' }];
        return {
          returning: async () => rows,
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve(undefined).then(onFulfilled, onRejected),
        };
      },
    }),
  };
  const insertChain = {
    values: (values: unknown) => {
      state.inserts.push(values);
      const rows = state.insertReturning.shift() ?? [{ id: 'inserted-user' }];
      return {
        returning: async () => rows,
        then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          Promise.resolve(undefined).then(onFulfilled, onRejected),
      };
    },
  };
  return {
    db: {
      select: selectChain,
      update: () => updateChain,
      insert: () => insertChain,
      delete: () => ({
        where: async () => {
          state.deletes++;
        },
      }),
    },
  };
});

// Spread the real module so shared constants (BREACHED_PASSWORD_MESSAGE) are
// the real ones and cannot drift from what the routes send.
vi.mock('@/lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/password')>();
  return {
    ...actual,
    verifyPassword: password.verify,
    verifyLegacyPassword: password.verifyLegacy,
    hashPassword: password.hash,
    checkPwnedPassword: password.pwned,
  };
});

/**
 * Registration now sends one transactional email on BOTH branches (docs/39),
 * so the register route reaches `@/lib/resend`. Mocked here for the reason
 * every other suite mocks it - the real client throws "Missing API key" with
 * no key in the environment, and `retryWithBackoff` then slept through three
 * attempts per registration test. The sends are captured instead, because
 * their symmetry is part of the control being tested.
 */
vi.mock('@/lib/resend', () => {
  const emails = {
    send: async (args: Record<string, unknown>) => {
      state.emailSends.push(args);
      return { data: { id: 'sent' }, error: null };
    },
  };
  return { resend: { emails }, getResend: () => ({ emails }) };
});

vi.mock('@sentry/nextjs', () => ({
  init: (options: Record<string, unknown>) => {
    sentry.options = options;
  },
  captureRouterTransitionStart: vi.fn(),
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
  password.hash.mockReset();
  password.hash.mockResolvedValue('$2a$12$stub-hash-of-the-peppered-prehash');
  password.pwned.mockReset();
  password.pwned.mockResolvedValue(false);
  nextAuth.auth.mockReset();
  state.updates = 0;
  state.updateValues = [];
  state.updateReturning = [];
  state.inserts = [];
  state.insertReturning = [];
  state.deletes = 0;
  state.emailSends = [];
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

// ───────────────────────────────────────────────────────────────────────────────
// Registration must not be an account-existence oracle (audit A4, P0)
// ───────────────────────────────────────────────────────────────────────────────

const VALID_REGISTRATION = {
  email: 'someone@example.com',
  password: 'CorrectHorse1',
  name: 'Someone',
};

const EXISTING_USER_ID = 'cafe1234-0000-0000-0000-000000000001';

async function postRegister(
  body: Record<string, unknown> = VALID_REGISTRATION,
  existing: unknown[] = [],
): Promise<{ status: number; body: Record<string, never> & { ok: boolean; data?: { id: string; email: string; name: string }; error?: { code: string; message: string } } }> {
  state.rows = [existing];
  state.insertReturning = [[{ id: 'created-user-id', email: body.email, name: body.name }]];
  state.inserts = [];
  const { POST } = await import('@/app/api/auth/register/route');
  const response = await POST({ json: async () => body } as unknown as NextRequest);
  return { status: response.status, body: await response.json() };
}

describe('registration does not disclose whether an account exists (audit A4)', () => {
  it('answers a duplicate address with the same status as a creation', async () => {
    const created = await postRegister(VALID_REGISTRATION, []);
    const duplicate = await postRegister(VALID_REGISTRATION, [{ id: EXISTING_USER_ID }]);

    expect(created.status).toBe(201);
    expect(duplicate.status).toBe(created.status);
  });

  it('answers a duplicate address with the same body shape as a creation', async () => {
    const created = await postRegister(VALID_REGISTRATION, []);
    const duplicate = await postRegister(VALID_REGISTRATION, [{ id: EXISTING_USER_ID }]);

    expect(duplicate.body.ok).toBe(true);
    expect(Object.keys(duplicate.body)).toEqual(Object.keys(created.body));
    expect(Object.keys(duplicate.body.data!)).toEqual(Object.keys(created.body.data!));
    expect(duplicate.body.data!.email).toBe(created.body.data!.email);
    expect(duplicate.body.data!.name).toBe(created.body.data!.name);
  });

  it('never echoes the existing account id', async () => {
    const duplicate = await postRegister(VALID_REGISTRATION, [{ id: EXISTING_USER_ID }]);

    expect(duplicate.body.data!.id).not.toBe(EXISTING_USER_ID);
    expect(duplicate.body.data!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('writes nothing for a duplicate address', async () => {
    await postRegister(VALID_REGISTRATION, [{ id: EXISTING_USER_ID }]);

    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toBe(0);
  });

  it('still inserts for an address that is free', async () => {
    const created = await postRegister(VALID_REGISTRATION, []);

    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      email: 'someone@example.com',
      role: 'donor',
    });
    expect(created.body.data!.id).toBe('created-user-id');
  });

  it('spends the same bcrypt work on a duplicate as on a creation', async () => {
    // The decoy-work pattern from `authorize()`: without the unconditional
    // hash, "already taken" returned in microseconds and the response time
    // restored the oracle the status code used to be.
    password.hash.mockClear();
    await postRegister(VALID_REGISTRATION, []);
    const onCreate = password.hash.mock.calls.length;

    password.hash.mockClear();
    await postRegister(VALID_REGISTRATION, [{ id: EXISTING_USER_ID }]);

    expect(password.hash.mock.calls.length).toBe(onCreate);
    expect(onCreate).toBe(1);
  });

  it('sends exactly one email on each path, so the send cannot encode the outcome', async () => {
    // The page can no longer tell the two outcomes apart (docs/39), so the
    // mail is what distinguishes them. That only holds if the *send* is
    // symmetric: one message to the submitted address either way, from the
    // same helper, before the response - no second round trip and no
    // suppressed send to time.
    state.emailSends = [];
    await postRegister(VALID_REGISTRATION, []);
    const onCreate = state.emailSends.length;

    state.emailSends = [];
    await postRegister(VALID_REGISTRATION, [{ id: EXISTING_USER_ID }]);

    expect(onCreate).toBe(1);
    expect(state.emailSends).toHaveLength(1);
    expect(state.emailSends[0].to).toBe('someone@example.com');
  });

  it('tells the inbox owner, and only the inbox owner, that the address was taken', async () => {
    state.emailSends = [];
    await postRegister(VALID_REGISTRATION, [{ id: EXISTING_USER_ID }]);
    const duplicateMail = state.emailSends[0];

    state.emailSends = [];
    await postRegister(VALID_REGISTRATION, []);
    const createdMail = state.emailSends[0];

    // The body is the one place the outcome may be disclosed.
    expect(duplicateMail.subject).not.toBe(createdMail.subject);
    expect(String(duplicateMail.html)).toMatch(/already have an account/i);

    // A notice, not a credential: nothing in it may let whoever submitted the
    // form into the existing account. Recovery goes through the reset flow,
    // which mints its own token for the owner.
    expect(String(duplicateMail.html)).not.toMatch(/token=/);
  });

  it('keeps the real reason in the server log only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const duplicate = await postRegister(VALID_REGISTRATION, [{ id: EXISTING_USER_ID }]);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reason=email_taken'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('someone@example.com'));
    expect(JSON.stringify(duplicate.body)).not.toMatch(/exists|taken|conflict/i);
  });

  it('no longer has a conflict response in the route source', async () => {
    const source = readFileSync(
      path.resolve(__dirname, '../app/api/auth/register/route.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/An account with this email already exists/);
    expect(source).not.toMatch(/status:\s*409/);
    expect(source).not.toMatch(/code:\s*'CONFLICT'/);
  });

  it('still rejects a breached password, before any existence lookup', async () => {
    password.pwned.mockResolvedValue(true);
    const { BREACHED_PASSWORD_MESSAGE } = await import('@/lib/password');

    const result = await postRegister(VALID_REGISTRATION, []);

    expect(result.status).toBe(400);
    expect(result.body.error!.message).toBe(BREACHED_PASSWORD_MESSAGE);
    expect(state.inserts).toHaveLength(0);
  });

  it('still rejects input that fails validation', async () => {
    const result = await postRegister({ email: 'not-an-email', password: 'x', name: '' }, []);

    expect(result.status).toBe(400);
    expect(result.body.error!.code).toBe('VALIDATION_ERROR');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Password reset: lockout, zero-row UPDATE, breach check (P1/P3)
// ───────────────────────────────────────────────────────────────────────────────

const VALID_RESET = {
  email: 'someone@example.com',
  token: 'a-valid-token',
  password: 'BrandNewPass1',
};

async function postReset(
  body: Record<string, unknown> = VALID_RESET,
  options: { tokenRow?: unknown[]; updated?: unknown[] } = {},
): Promise<{ status: number; body: { ok: boolean; data?: { message: string }; error?: { code: string; message: string } } }> {
  const tokenRow =
    options.tokenRow ??
    [{
      identifier: `reset:${body.email}`,
      token: body.token,
      expires: new Date(Date.now() + 60_000),
    }];
  state.rows = [tokenRow];
  state.updateReturning = [options.updated ?? [{ id: 'user-1' }]];
  state.updates = 0;
  const { POST } = await import('@/app/api/v1/auth/reset-password/route');
  const response = await POST({ json: async () => body } as unknown as NextRequest);
  return { status: response.status, body: await response.json() };
}

describe('password reset clears the lockout it would otherwise survive (P1)', () => {
  it('resets the failed-login counters in the same UPDATE as the password', async () => {
    const result = await postReset();

    expect(result.status).toBe(200);
    expect(state.updateValues).toHaveLength(1);
    expect(state.updateValues[0]).toMatchObject({
      failedLoginCount: 0,
      failedLoginWindowStart: null,
    });
    expect(state.updateValues[0]).toHaveProperty('passwordHash');
  });

  it('matches the counters `clearFailedAttempts` writes, so the lock really lifts', async () => {
    // `authorize()` runs `checkAccountLocked` BEFORE verifying the password and
    // only a successful sign-in clears the counters, so a reset that left them
    // set meant the new password was refused for the rest of the window.
    await postReset();

    const authSource = readFileSync(path.resolve(__dirname, 'auth.ts'), 'utf8');
    const cleared = state.updateValues[0] as Record<string, unknown>;
    for (const column of Object.keys(cleared).filter((k) => k !== 'passwordHash')) {
      expect(authSource).toMatch(new RegExp(`${column}:`));
    }
    expect(Object.keys(cleared).sort()).toEqual([
      'failedLoginCount',
      'failedLoginWindowStart',
      'passwordHash',
    ]);
  });
});

describe('password reset does not claim success it did not achieve (P3)', () => {
  it('fails when the UPDATE matched no row', async () => {
    const result = await postReset(VALID_RESET, { updated: [] });

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(result.body.data).toBeUndefined();
    expect(result.body.error!.message).not.toMatch(/successfully/i);
  });

  it('burns the orphaned token so it cannot be replayed', async () => {
    await postReset(VALID_RESET, { updated: [] });

    expect(state.deletes).toBeGreaterThan(0);
  });

  it('answers an orphaned token exactly as an unknown token', async () => {
    const orphaned = await postReset(VALID_RESET, { updated: [] });
    const unknown = await postReset(VALID_RESET, { tokenRow: [] });

    expect(orphaned.status).toBe(unknown.status);
    expect(orphaned.body.error!.message).toBe(unknown.body.error!.message);
  });

  it('still succeeds, and consumes the token, on the happy path', async () => {
    const result = await postReset();

    expect(result.status).toBe(200);
    expect(result.body.data!.message).toMatch(/reset successfully/i);
    expect(state.deletes).toBeGreaterThan(0);
  });
});

describe('password reset enforces the same breach check as registration (P3)', () => {
  it('rejects a known-breached password', async () => {
    password.pwned.mockResolvedValue(true);
    const { BREACHED_PASSWORD_MESSAGE } = await import('@/lib/password');

    const result = await postReset();

    expect(result.status).toBe(400);
    expect(result.body.error!.message).toBe(BREACHED_PASSWORD_MESSAGE);
  });

  it('changes nothing when the password is breached', async () => {
    password.pwned.mockResolvedValue(true);

    await postReset();

    expect(state.updates).toBe(0);
    expect(state.updateValues).toHaveLength(0);
  });

  it('checks only after the token is proven valid, so it is not an open HIBP proxy', async () => {
    password.pwned.mockResolvedValue(true);

    const result = await postReset(VALID_RESET, { tokenRow: [] });

    expect(result.status).toBe(400);
    expect(password.pwned).not.toHaveBeenCalled();
  });

  it('shares one helper with registration rather than two copies of the rule', async () => {
    const registerSource = readFileSync(
      path.resolve(__dirname, '../app/api/auth/register/route.ts'),
      'utf8',
    );
    const resetSource = readFileSync(
      path.resolve(__dirname, '../app/api/v1/auth/reset-password/route.ts'),
      'utf8',
    );

    for (const source of [registerSource, resetSource]) {
      expect(source).toMatch(/checkPwnedPassword/);
      expect(source).not.toMatch(/api\.pwnedpasswords\.com/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Admin security question: the password compare was always false (P1)
// ───────────────────────────────────────────────────────────────────────────────

describe('admin security question verifies the peppered password (P1)', () => {
  const STORED_HASH = '$2a$12$hash-of-the-peppered-prehash';
  const BODY = {
    question: 'What was the name of your first pet?',
    answer: 'Rex',
    currentPassword: 'CorrectHorse1',
  };

  async function postSecurityQuestion(body: Record<string, unknown> = BODY) {
    nextAuth.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });
    state.rows = [[{ passwordHash: STORED_HASH }]];
    const { POST } = await import('@/app/api/v1/admin/settings/security-question/route');
    const response = await POST({ json: async () => body } as unknown as NextRequest);
    return { status: response.status, body: await response.json() };
  }

  it('a bare bcrypt compare against a peppered hash can only ever be false', async () => {
    // The shape of the bug, proven against real bcrypt rather than a mock.
    const pepper = 'p'.repeat(32);
    const preHash = createHmac('sha256', pepper).update(BODY.currentPassword).digest('hex');
    const stored = await bcrypt.hash(preHash, 4);

    expect(await bcrypt.compare(BODY.currentPassword, stored)).toBe(false);
    expect(await bcrypt.compare(preHash, stored)).toBe(true);
  });

  it('accepts the correct password via verifyPassword', async () => {
    password.verify.mockResolvedValue(true);

    const result = await postSecurityQuestion();

    expect(result.status).toBe(200);
    expect(password.verify).toHaveBeenCalledWith(BODY.currentPassword, STORED_HASH);
    expect(state.updateValues[0]).toMatchObject({ securityQuestion: BODY.question });
  });

  it('still rejects a wrong password', async () => {
    password.verify.mockResolvedValue(false);

    const result = await postSecurityQuestion();

    expect(result.status).toBe(400);
    expect(result.body.error.message).toMatch(/Current password is incorrect/);
    expect(state.updateValues).toHaveLength(0);
  });

  it('no longer compares the raw password in the route source', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../app/api/v1/admin/settings/security-question/route.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/bcrypt\.compare\(\s*currentPassword/);
    expect(source).toMatch(/verifyPassword\(currentPassword, user\.passwordHash\)/);
  });

  it('leaves the self-consistent security-ANSWER compare alone', () => {
    const verifySource = readFileSync(
      path.resolve(__dirname, '../app/api/v1/admin/settings/verify-security/route.ts'),
      'utf8',
    );
    // The answer hash is written with a bare `bcrypt.hash` of the normalised
    // answer, so a bare `bcrypt.compare` there is correct. Changing it would
    // lock every admin out of their own recovery path.
    expect(verifySource).toMatch(/bcrypt\.compare\(/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Reset tokens must not be uploaded to Sentry (P0)
// ───────────────────────────────────────────────────────────────────────────────

describe('Sentry never receives a password-reset credential (P0)', () => {
  const TOKEN = '1f0c9a8e-dead-beef-0000-1234567890ab';
  const RESET_URL = `https://lastdonor.org/login/reset-password?token=${TOKEN}&email=victim%40example.com`;

  type Hook = (event: Record<string, unknown>, hint?: unknown) => Record<string, unknown> | null;

  async function sentryOptions(): Promise<Record<string, unknown>> {
    await import('@/instrumentation-client');
    expect(sentry.options).toBeDefined();
    return sentry.options!;
  }

  function fullEvent(): Record<string, unknown> {
    return {
      request: {
        url: RESET_URL,
        query_string: `token=${TOKEN}&email=victim%40example.com`,
        headers: { Referer: RESET_URL, 'User-Agent': 'test' },
      },
      transaction: `/login/reset-password?token=${TOKEN}`,
      message: `failed on ${RESET_URL}`,
      breadcrumbs: [
        { category: 'navigation', data: { from: '/login/forgot-password', to: RESET_URL } },
        { category: 'fetch', message: `GET ${RESET_URL}`, data: { url: RESET_URL } },
      ],
      contexts: { trace: { data: { 'http.url': RESET_URL } } },
      tags: { page: RESET_URL },
      extra: { nested: { deeper: [RESET_URL] } },
      exception: { values: [{ value: `TypeError at ${RESET_URL}` }] },
    };
  }

  it('wires scrubbing hooks into Sentry.init', async () => {
    const options = await sentryOptions();

    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeSendTransaction).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');
  });

  it('strips the token and the address from every part of an error event', async () => {
    const options = await sentryOptions();

    const scrubbed = (options.beforeSend as Hook)(fullEvent(), {});
    const serialised = JSON.stringify(scrubbed);

    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain('victim%40example.com');
    expect(serialised).not.toContain('victim@example.com');
    expect(serialised).toContain('[redacted]');
  });

  it('strips them from a transaction event too', async () => {
    const options = await sentryOptions();

    const scrubbed = (options.beforeSendTransaction as Hook)(fullEvent(), {});

    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
  });

  it('strips them from a navigation breadcrumb', async () => {
    const options = await sentryOptions();

    const scrubbed = (options.beforeBreadcrumb as Hook)({
      category: 'navigation',
      message: `navigated to ${RESET_URL}`,
      data: { from: '/login', to: RESET_URL },
    }, {});

    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
  });

  it('keeps the parameter name, so the event is still readable', async () => {
    const options = await sentryOptions();

    const scrubbed = (options.beforeSend as Hook)(fullEvent(), {}) as {
      request: { url: string };
    };

    expect(scrubbed.request.url).toBe(
      'https://lastdonor.org/login/reset-password?token=[redacted]&email=[redacted]',
    );
  });

  it('leaves unrelated URLs and parameters untouched', async () => {
    const options = await sentryOptions();

    const scrubbed = (options.beforeSend as Hook)(
      { request: { url: 'https://lastdonor.org/campaigns/some-slug?page=2&utm_source=x' } },
      {},
    ) as { request: { url: string } };

    expect(scrubbed.request.url).toBe(
      'https://lastdonor.org/campaigns/some-slug?page=2&utm_source=x',
    );
  });

  it('is idempotent, so a re-captured event does not double-redact', async () => {
    const options = await sentryOptions();

    const once = (options.beforeSend as Hook)(fullEvent(), {});
    const twice = (options.beforeSend as Hook)(JSON.parse(JSON.stringify(once)), {});

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe('the reset-password page is not indexable', () => {
  it('carries the same robots directive as the login page', async () => {
    const [resetLayout, loginLayout] = await Promise.all([
      import('@/app/login/reset-password/layout'),
      import('@/app/login/layout'),
    ]);

    expect(resetLayout.metadata.robots).toMatchObject({ index: false });
    expect(resetLayout.metadata.robots).toEqual(loginLayout.metadata.robots);
  });
});
