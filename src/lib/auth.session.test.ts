/**
 * Audit P1-4 — admin JWTs lived 30 days and role revocation never took effect.
 *
 * `docs/31` item 2.5: "a demoted editor is denied on the next privileged
 * request", plus an explicit `maxAge` and removal of the dead
 * `expires: new Date(0)` code.
 *
 * Pre-fix behaviour these tests pin down:
 *   - `session.maxAge` was unset, so `@auth/core`'s 30-day default applied.
 *   - The `jwt` callback read the role from the database only when `user` was
 *     defined, i.e. only at sign-in, so a demotion never reached a live token.
 *   - The "expiry" was a `session.expires = new Date(0)` that nothing reads;
 *     the JWT itself stayed valid.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import type { JWT } from 'next-auth/jwt';
import type { Session } from 'next-auth';
import type { UserRole } from '@/types';

interface AuthConfig {
  session?: { strategy?: string; maxAge?: number };
  jwt?: { maxAge?: number };
  callbacks: {
    jwt: (params: { token: JWT; user?: { id?: string } }) => Promise<JWT | null>;
    session: (params: { session: Session; token: JWT }) => Promise<Session>;
  };
  providers: Array<{ authorize?: (c: unknown) => Promise<unknown> }>;
}

const captured = vi.hoisted(() => ({
  config: undefined as AuthConfig | undefined,
  auth: undefined as ReturnType<typeof vi.fn> | undefined,
}));

vi.mock('next-auth', () => {
  class CredentialsSignin extends Error {}
  captured.auth = vi.fn();
  const NextAuth = (config: AuthConfig) => {
    captured.config = config;
    return { handlers: {}, auth: captured.auth, signIn: vi.fn(), signOut: vi.fn() };
  };
  return { default: NextAuth, CredentialsSignin };
});
vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: () => ({}) }));
vi.mock('@/db', () => {
  // The expiry/revocation rules take an injected role lookup, so the only
  // database access under test is the sign-in-time role read.
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = async () => [{ role: 'donor' }];
  return { db: { select: () => chain } };
});

const authModule = await import('@/lib/auth');
const { resolveSessionToken, requireRole, ForbiddenError, UnauthorizedError } = authModule;

const NOW = 1_760_000_000; // fixed clock, seconds
const HOUR = 3600;

function token(overrides: Partial<JWT> = {}): JWT {
  return { id: 'user-1', role: 'admin', authAt: NOW, roleCheckedAt: NOW, ...overrides } as JWT;
}

/** A role lookup that answers from the database's point of view. */
function lookup(role: UserRole | null | undefined) {
  return vi.fn(async () => role);
}

beforeEach(() => {
  captured.auth?.mockReset();
});

describe('session configuration (audit P1-4)', () => {
  it('sets an explicit maxAge instead of inheriting the 30-day default', () => {
    const maxAge = captured.config?.session?.maxAge;
    expect(typeof maxAge).toBe('number');
    // 30 days was the defect. Anything at or above it is the same defect.
    expect(maxAge!).toBeLessThan(30 * 24 * HOUR);
    expect(maxAge!).toBeLessThanOrEqual(7 * 24 * HOUR);
    expect(captured.config?.jwt?.maxAge).toBe(maxAge);
  });

  it('keeps the stateless JWT strategy (CLAUDE.md / docs/26 §1)', () => {
    expect(captured.config?.session?.strategy).toBe('jwt');
  });

  it('no longer contains the dead `expires: new Date(0)` expiry', () => {
    const source = readFileSync(path.resolve(__dirname, 'auth.ts'), 'utf8');
    expect(source).not.toContain('new Date(0)');
  });
});

describe('absolute, role-scoped expiry (audit P1-4)', () => {
  it('rejects a token with no authAt claim (minted before this fix)', async () => {
    const stale = { id: 'user-1', role: 'admin', roleCheckedAt: NOW } as JWT;
    expect(await resolveSessionToken(stale, NOW, lookup('admin'))).toBeNull();
  });

  it('expires an admin token after 8 hours', async () => {
    const fresh = token({ authAt: NOW - 7 * HOUR, roleCheckedAt: NOW });
    expect(await resolveSessionToken(fresh, NOW, lookup('admin'))).not.toBeNull();

    const old = token({ authAt: NOW - 9 * HOUR, roleCheckedAt: NOW });
    expect(await resolveSessionToken(old, NOW, lookup('admin'))).toBeNull();
  });

  it('expires an editor token after 24 hours and a donor token after 7 days', async () => {
    expect(
      await resolveSessionToken(token({ role: 'editor', authAt: NOW - 25 * HOUR }), NOW, lookup('editor')),
    ).toBeNull();
    expect(
      await resolveSessionToken(token({ role: 'editor', authAt: NOW - 23 * HOUR }), NOW, lookup('editor')),
    ).not.toBeNull();
    expect(
      await resolveSessionToken(token({ role: 'donor', authAt: NOW - 8 * 24 * HOUR }), NOW, lookup('donor')),
    ).toBeNull();
  });

  it('does not grant the donor lifetime to a token claiming an unknown role', async () => {
    const forged = token({ role: 'superuser' as unknown as UserRole, authAt: NOW - 8 * 24 * HOUR });
    expect(await resolveSessionToken(forged, NOW, lookup('donor'))).toBeNull();
  });
});

describe('role revocation (audit P1-4)', () => {
  it('re-reads the role from the database once the revalidation interval elapses', async () => {
    const lookupRole = lookup('donor');
    const result = await resolveSessionToken(
      token({ role: 'editor', authAt: NOW - HOUR, roleCheckedAt: NOW - 120 }),
      NOW,
      lookupRole,
    );

    expect(lookupRole).toHaveBeenCalledWith('user-1');
    expect(result?.role).toBe('donor');
    expect(result?.roleCheckedAt).toBe(NOW);
  });

  it('does not hit the database on every request inside the interval', async () => {
    const lookupRole = lookup('donor');
    const result = await resolveSessionToken(
      token({ role: 'editor', authAt: NOW - HOUR, roleCheckedAt: NOW - 5 }),
      NOW,
      lookupRole,
    );

    expect(lookupRole).not.toHaveBeenCalled();
    expect(result?.role).toBe('editor');
  });

  it('ends the session when the user row is gone (deleted / GDPR erasure)', async () => {
    expect(
      await resolveSessionToken(token({ roleCheckedAt: NOW - 120 }), NOW, lookup(null)),
    ).toBeNull();
  });

  it('keeps the existing claim, without advancing the checkpoint, when the database is unreachable', async () => {
    const result = await resolveSessionToken(
      token({ role: 'admin', roleCheckedAt: NOW - 120 }),
      NOW,
      lookup(undefined),
    );

    expect(result?.role).toBe('admin');
    // Not advanced: the next request retries rather than trusting a guess.
    expect(result?.roleCheckedAt).toBe(NOW - 120);
  });

  /**
   * The acceptance criterion from docs/31 item 2.5, end to end: a live token
   * that still claims `editor`, a database that says `donor`, and a privileged
   * check that must now refuse. Pre-fix the role was only ever read at
   * sign-in, so this chain returned the stale `editor` and the check passed.
   */
  it('denies a demoted editor on the next privileged request', async () => {
    const live = token({ role: 'editor', authAt: NOW - HOUR, roleCheckedAt: NOW - 120 });

    const refreshed = await resolveSessionToken(live, NOW, lookup('donor'));
    expect(refreshed).not.toBeNull();

    const session = await captured.config!.callbacks.session({
      session: { user: { id: 'user-1', role: 'editor' }, expires: '' } as unknown as Session,
      token: refreshed!,
    });
    expect(session.user.role).toBe('donor');

    captured.auth!.mockResolvedValue(session);
    await expect(requireRole(['editor', 'admin'])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('still allows an editor whose role is unchanged', async () => {
    const live = token({ role: 'editor', authAt: NOW - HOUR, roleCheckedAt: NOW - 120 });
    const refreshed = await resolveSessionToken(live, NOW, lookup('editor'));

    const session = await captured.config!.callbacks.session({
      session: { user: { id: 'user-1', role: 'editor' }, expires: '' } as unknown as Session,
      token: refreshed!,
    });

    captured.auth!.mockResolvedValue(session);
    await expect(requireRole(['editor', 'admin'])).resolves.toBeTruthy();
  });

  it('refuses a privileged request with no session at all', async () => {
    captured.auth!.mockResolvedValue(null);
    await expect(requireRole(['admin'])).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('sign-in stamps the claims the expiry rules depend on', () => {
  it('mints authAt and roleCheckedAt', async () => {
    const result = await captured.config!.callbacks.jwt({
      token: {} as JWT,
      user: { id: 'user-1' },
    });

    expect(result).not.toBeNull();
    expect(typeof result!.authAt).toBe('number');
    expect(typeof result!.roleCheckedAt).toBe('number');
    expect(result!.id).toBe('user-1');
  });
});
