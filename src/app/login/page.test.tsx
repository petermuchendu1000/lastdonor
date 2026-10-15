/**
 * A wrong password and a broken database must not render the same sentence.
 *
 * Observed live 2026-10-15: `/login` with a correct email and a wrong password
 * rendered one generic failure message, and during a database outage the
 * SAME string appeared for CORRECT credentials - the sign-in callback
 * returned `code=invalid_credentials` in the first case and @auth/core's
 * default `code=credentials` in the second. One sentence therefore carried two
 * opposite instructions: "you typed it wrong" and "our database is down". A
 * user who mistyped retyped the same password or burned a password reset they
 * did not need.
 *
 * What these tests must NOT allow back in is the oracle docs/32 closed.
 * `src/lib/auth.ts` emits one `invalid_credentials` code for unknown address,
 * wrong password, OAuth-only account and lockout alike, and spends a decoy
 * bcrypt on the miss. The split asserted here is on the SERVER'S failure mode,
 * which an enumerator cannot steer per address, never on the state of an
 * account - so the cases below pin that the credential message is identical
 * for every one of those four, and that nothing in the rendered output,
 * navigation or request sequence differs between them.
 *
 * See docs/46 and `src/lib/auth.enumeration.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '@/app/login/page';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
const nextAuth = vi.hoisted(() => ({ signIn: vi.fn() }));
const search = vi.hoisted(() => ({ params: new URLSearchParams('') }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => search.params,
}));
vi.mock('next-auth/react', () => ({ signIn: nextAuth.signIn }));

const CREDENTIAL_MESSAGE =
  'Incorrect email or password. Check both, or continue with Google.';
const TRANSIENT_MESSAGE =
  "We couldn't sign you in right now. Please try again shortly.";

async function submitLogin(email = 'someone@example.com', password = 'whatever1') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

/** What `signIn('credentials', { redirect: false })` resolves to. */
function resolveSignIn(result: { error?: string; code?: string; ok?: boolean }) {
  nextAuth.signIn.mockImplementation(async (provider: string) => {
    if (provider !== 'credentials') return undefined;
    return { ok: false, status: 401, url: null, ...result };
  });
}

function alertText(): string {
  return screen.getByRole('alert').textContent ?? '';
}

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
  nextAuth.signIn.mockReset();
  search.params = new URLSearchParams('');
});

describe('a wrong password says the password is wrong', () => {
  it('renders the credential message for invalid_credentials', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'invalid_credentials' });
    render(<LoginPage />);
    await submitLogin();

    expect(alertText()).toContain(CREDENTIAL_MESSAGE);
    expect(alertText()).not.toContain(TRANSIENT_MESSAGE);
  });

  it('offers a password reset on that path, since the password may be lost', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'invalid_credentials' });
    render(<LoginPage />);
    await submitLogin();

    const reset = screen.getByRole('link', { name: 'Reset your password' });
    expect(reset).toHaveAttribute('href', '/login/forgot-password');
  });

  it('does not navigate away from the form', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'invalid_credentials' });
    render(<LoginPage />);
    await submitLogin();

    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('a server fault says the server is at fault', () => {
  /**
   * `credentials` is @auth/core's own default `CredentialsSignin` code,
   * emitted when `authorize()` returns null - which is what `src/lib/auth.ts`
   * does when its own try/catch swallows a database error. This is the exact
   * code seen in production during the outage.
   */
  it('renders the transient message for @auth/core default code credentials', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'credentials' });
    render(<LoginPage />);
    await submitLogin();

    expect(alertText()).toContain(TRANSIENT_MESSAGE);
    expect(alertText()).not.toContain(CREDENTIAL_MESSAGE);
  });

  it('renders the transient message when no code comes back at all', async () => {
    resolveSignIn({ error: 'CredentialsSignin' });
    render(<LoginPage />);
    await submitLogin();

    expect(alertText()).toContain(TRANSIENT_MESSAGE);
  });

  it('renders the transient message for a code added in a later version', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'something_new' });
    render(<LoginPage />);
    await submitLogin();

    expect(alertText()).toContain(TRANSIENT_MESSAGE);
  });

  it('renders the transient message when the sign-in request itself throws', async () => {
    nextAuth.signIn.mockRejectedValue(new Error('network down'));
    render(<LoginPage />);
    await submitLogin();

    expect(alertText()).toContain(TRANSIENT_MESSAGE);
  });

  it('does not push the user towards a password reset they do not need', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'credentials' });
    render(<LoginPage />);
    await submitLogin();

    // The permanent "Forgot password?" link in the form stays, but the error
    // block must not add a reset call to action for a server fault.
    expect(alertText()).not.toContain('Reset your password');
  });

  it('never blames the site for a wrong password', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'invalid_credentials' });
    render(<LoginPage />);
    await submitLogin();

    expect(alertText()).not.toMatch(/unexpected|went wrong|error occurred/i);
  });
});

describe('the forced-reset path keeps its own message', () => {
  it('tells a legacy-hash user to reset, with a link', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'password_reset_required' });
    render(<LoginPage />);
    await submitLogin();

    expect(alertText()).toContain('you must reset your password before logging in');
    expect(alertText()).not.toContain(CREDENTIAL_MESSAGE);
    expect(alertText()).not.toContain(TRANSIENT_MESSAGE);
    expect(screen.getByRole('link', { name: 'Reset your password' })).toHaveAttribute(
      'href',
      '/login/forgot-password',
    );
  });
});

describe('the credential message stays an account-existence dead end', () => {
  /**
   * `authorize()` collapses no_account, oauth_only, invalid_password and
   * account_locked into ONE `invalid_credentials` code (docs/32). The page can
   * therefore only ever see that one code for all four, and so renders one
   * byte-identical result. This test states the invariant that matters: the
   * rendered output is a pure function of the code, so no amount of probing
   * different addresses can produce a different screen.
   */
  it('renders byte-identical output for every reason behind invalid_credentials', async () => {
    const renders: string[] = [];

    for (const email of [
      'no-such-account@example.com',
      'google-only@example.com',
      'wrong-password@example.com',
      'locked-out@example.com',
    ]) {
      nextAuth.signIn.mockReset();
      router.push.mockReset();
      resolveSignIn({ error: 'CredentialsSignin', code: 'invalid_credentials' });
      const { container, unmount } = render(<LoginPage />);
      await submitLogin(email);
      renders.push(screen.getByRole('alert').innerHTML);
      expect(container.querySelector('form')).not.toBeNull();
      expect(router.push).not.toHaveBeenCalled();
      unmount();
    }

    expect(new Set(renders).size).toBe(1);
  });

  it('names neither the account nor the sign-in method it uses', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'invalid_credentials' });
    render(<LoginPage />);
    await submitLogin('google-only@example.com');

    const text = alertText();
    expect(text).not.toMatch(/no account|not found|does not exist|unknown/i);
    expect(text).not.toMatch(/locked|too many|registered with/i);
    expect(text).not.toContain('google-only@example.com');
  });

  it('sends exactly one credentials request whatever the reason', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'invalid_credentials' });
    render(<LoginPage />);
    await submitLogin('locked-out@example.com');

    const credentialCalls = nextAuth.signIn.mock.calls.filter(
      (c) => c[0] === 'credentials',
    );
    expect(credentialCalls).toHaveLength(1);
    expect(credentialCalls[0][1]).toMatchObject({ redirect: false });
  });

  it('keeps the Google path offered on the credential failure', async () => {
    resolveSignIn({ error: 'CredentialsSignin', code: 'invalid_credentials' });
    render(<LoginPage />);
    await submitLogin();

    // An OAuth-only user is inside this one message, so it has to leave them a
    // working door without saying which door is theirs.
    expect(alertText()).toContain('continue with Google');
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy();
  });
});

describe('the same split applies on the redirect path', () => {
  it('shows the credential message for ?error=CredentialsSignin&code=invalid_credentials', () => {
    search.params = new URLSearchParams(
      'error=CredentialsSignin&code=invalid_credentials',
    );
    render(<LoginPage />);
    expect(alertText()).toContain(CREDENTIAL_MESSAGE);
  });

  it('shows the transient message for ?error=CredentialsSignin&code=credentials', () => {
    search.params = new URLSearchParams('error=CredentialsSignin&code=credentials');
    render(<LoginPage />);
    expect(alertText()).toContain(TRANSIENT_MESSAGE);
  });

  it('still explains OAuthAccountNotLinked', () => {
    search.params = new URLSearchParams('error=OAuthAccountNotLinked');
    render(<LoginPage />);
    expect(alertText()).toContain('This email already has a LastDonor password');
  });

  it('renders no alert when there is no error param', () => {
    render(<LoginPage />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a successful sign-in is unaffected', () => {
  it('navigates to the callback url and refreshes', async () => {
    nextAuth.signIn.mockResolvedValue({ ok: true, error: undefined, url: '/dashboard' });
    render(<LoginPage />);
    await submitLogin();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(router.push).toHaveBeenCalledWith('/dashboard');
    expect(router.refresh).toHaveBeenCalled();
  });
});
