/**
 * The registration page must not be an account-existence oracle (audit A4).
 *
 * `POST /api/auth/register` answers a duplicate address with the SAME status
 * and the SAME body as a creation (commit 9a14dc6). This page used to hand
 * that back: it auto-signed-in after the 201 and branched on the result, so a
 * fresh address was pushed to the callback URL and a registered one to
 * `/login`. Submitting an address with a junk password and reading which
 * screen came back re-opened the oracle one request later.
 *
 * These tests drive the real page against the two API responses that the route
 * can actually return — they differ only in `data.id`, which the route
 * randomises on the duplicate path — and assert the rendered result is
 * byte-identical, with no navigation and no credentials sign-in on either.
 *
 * They also pin the behaviour that must NOT be collapsed: a submission that
 * fails validation still gets its own specific message, because that describes
 * the caller's own input rather than the state of someone else's account.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '@/app/register/page';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
const nextAuth = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('next-auth/react', () => ({ signIn: nextAuth.signIn }));

/** Every request the page made, in order. */
let calls: { url: string; method: string; body: Record<string, unknown> }[] = [];

function mockApi(response: { status: number; body: unknown }) {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    };
  }) as unknown as typeof fetch;
}

const EMAIL = 'someone@example.com';
const GOOD_PASSWORD = 'CorrectHorse1';

/**
 * The 201 the route sends when the address was FREE: a real row id.
 * (`route.ts` → `newUser.id`)
 */
const CREATED_RESPONSE = {
  status: 201,
  body: { ok: true, data: { id: 'created-user-id', email: EMAIL, name: 'Someone' } },
};

/**
 * The 201 the route sends when the address was ALREADY REGISTERED: same shape,
 * same status, a throwaway UUID in place of the existing account's id.
 * (`route.ts` → `randomUUID()`)
 */
const DUPLICATE_RESPONSE = {
  status: 201,
  body: {
    ok: true,
    data: {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: EMAIL,
      name: 'Someone',
    },
  },
};

async function submitRegistration(opts: {
  email?: string;
  password?: string;
  name?: string;
} = {}) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Name'), opts.name ?? 'Someone');
  await user.type(screen.getByLabelText('Email'), opts.email ?? EMAIL);
  await user.type(screen.getByLabelText('Password'), opts.password ?? GOOD_PASSWORD);
  await user.click(screen.getByRole('button', { name: /create account/i }));
}

/** Render the page against one API response and return its final markup. */
async function outcomeFor(response: { status: number; body: unknown }) {
  mockApi(response);
  const { container, unmount } = render(<RegisterPage />);
  await submitRegistration();
  await screen.findByRole('status');
  const html = container.innerHTML;
  const text = container.textContent ?? '';
  unmount();
  return { html, text };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
});

describe('registration outcome is identical whether or not the address exists', () => {
  it('renders the same markup for a created account and an existing one', async () => {
    const created = await outcomeFor(CREATED_RESPONSE);
    const duplicate = await outcomeFor(DUPLICATE_RESPONSE);

    expect(duplicate.html).toBe(created.html);
    expect(duplicate.text).toBe(created.text);
  });

  it('shows the check-your-email screen on both paths', async () => {
    for (const response of [CREATED_RESPONSE, DUPLICATE_RESPONSE]) {
      mockApi(response);
      const { unmount } = render(<RegisterPage />);
      await submitRegistration();

      expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
      expect(screen.getByText(EMAIL)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Go to sign-in' })).toHaveAttribute(
        'href',
        '/login',
      );
      unmount();
    }
  });

  it('never redirects, so the destination cannot encode the outcome', async () => {
    for (const response of [CREATED_RESPONSE, DUPLICATE_RESPONSE]) {
      mockApi(response);
      const { unmount } = render(<RegisterPage />);
      await submitRegistration();
      await screen.findByRole('status');
      unmount();
    }

    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('never attempts a credentials sign-in, which is what used to leak', async () => {
    for (const response of [CREATED_RESPONSE, DUPLICATE_RESPONSE]) {
      mockApi(response);
      const { unmount } = render(<RegisterPage />);
      await submitRegistration();
      await screen.findByRole('status');
      unmount();
    }

    expect(nextAuth.signIn).not.toHaveBeenCalled();
  });

  it('makes the same single request on both paths', async () => {
    mockApi(CREATED_RESPONSE);
    const first = render(<RegisterPage />);
    await submitRegistration();
    await screen.findByRole('status');
    const onCreate = calls;
    first.unmount();

    calls = [];
    mockApi(DUPLICATE_RESPONSE);
    render(<RegisterPage />);
    await submitRegistration();
    await screen.findByRole('status');

    expect(calls).toHaveLength(1);
    expect(calls).toEqual(onCreate);
    expect(calls[0].url).toBe('/api/auth/register');
    expect(calls[0].method).toBe('POST');
  });

  it('does not render the account id the API returns', async () => {
    const duplicate = await outcomeFor(DUPLICATE_RESPONSE);

    expect(duplicate.html).not.toContain('f47ac10b');
    expect(duplicate.html).not.toContain('created-user-id');
  });

  it('keeps the sign-in link pointing at the submitted callback, not the outcome', async () => {
    // The link target comes from the URL, so it is the same on both paths.
    mockApi(DUPLICATE_RESPONSE);
    render(<RegisterPage />);
    await submitRegistration();
    await screen.findByRole('status');

    expect(screen.getByRole('link', { name: 'Go to sign-in' })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});

/**
 * Which state the live password checklist shows for one rule.
 *
 * Verified, not assumed: the password field renders no `errors.password`
 * message at all (unlike name and email). This checklist, which updates as the
 * user types and is re-rendered on submit, is the whole of the weak-password
 * feedback, so it is what a test of that path has to read. The met/unmet
 * signal is carried only by the class, so the class is what is asserted.
 */
function passwordRuleState(label: string): 'met' | 'unmet' {
  return screen.getByText(label).className.includes('text-brand-green')
    ? 'met'
    : 'unmet';
}

describe('genuinely invalid submissions still get a specific error', () => {
  it('rejects a malformed address client-side without calling the API', async () => {
    // `someone@example` is deliberate: it satisfies the browser's own
    // `type="email"` constraint (jsdom enforces that one and would swallow the
    // submit event entirely for something like `not-an-email`, so the page
    // code would never run), while zod's stricter `.email()` rejects it. That
    // is the path where the page's own message is the only feedback.
    mockApi(CREATED_RESPONSE);
    render(<RegisterPage />);
    await submitRegistration({ email: 'someone@example' });

    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument();
  });

  it('refuses a weak password and still names the rule that failed', async () => {
    mockApi(CREATED_RESPONSE);
    render(<RegisterPage />);
    await submitRegistration({ password: 'short1A' });

    // Blocked before any request, so the page cannot have claimed to send mail.
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument();

    // And the feedback is still per-rule, not a single generic refusal.
    expect(passwordRuleState('At least 10 characters')).toBe('unmet');
    expect(passwordRuleState('One uppercase letter')).toBe('met');
    expect(passwordRuleState('One lowercase letter')).toBe('met');
    expect(passwordRuleState('One digit')).toBe('met');
  });

  it('rejects a missing name', async () => {
    mockApi(CREATED_RESPONSE);
    render(<RegisterPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), EMAIL);
    await user.type(screen.getByLabelText('Password'), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('surfaces a server-side 400 verbatim and does not claim an email was sent', async () => {
    mockApi({
      status: 400,
      body: {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'This password has appeared in a known data breach. Please choose a different one.',
          field: 'password',
        },
      },
    });
    render(<RegisterPage />);
    await submitRegistration();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'This password has appeared in a known data breach. Please choose a different one.',
    );
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument();
    expect(nextAuth.signIn).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the API returns no message', async () => {
    mockApi({ status: 500, body: { ok: false } });
    render(<RegisterPage />);
    await submitRegistration();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Registration failed. Please try again.');
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument();
  });
});
