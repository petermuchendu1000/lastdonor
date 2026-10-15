/**
 * Email preference toggles in the account UI — P1, fixed 2026-10-15.
 *
 *  - `emailNotifications` is the gate `src/lib/notifications.ts` already reads
 *    for ~20 emails, and it had no toggle at all (nor a schema entry), so no
 *    user could switch notification email off. It is now exposed.
 *  - `emailNewCampaigns` was rendered but read nowhere and nothing sends that
 *    mail. The toggle is gone rather than recording consent nothing acts on.
 *  - `emailNewsletter` only ever wrote a JSON flag that no send site reads; the
 *    newsletter cron reads `newsletter_subscribers`. The toggle now writes
 *    through to that list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountPageClient from '@/components/user/AccountPageClient';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const PROFILE = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  location: null,
  avatarUrl: null,
};

/** Requests the component made, in order. */
let calls: { url: string; method: string; body: unknown }[] = [];

function mockFetch(prefs: Record<string, unknown>) {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (String(url) === '/api/v1/users/settings' && (init?.method ?? 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => ({ ok: true, data: prefs }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) };
  }) as unknown as typeof fetch;
}

async function renderAccount(prefs: Record<string, unknown> = {}) {
  mockFetch(prefs);
  render(<AccountPageClient profile={PROFILE} />);
  // The preferences card renders after the settings GET resolves.
  await screen.findByText('Email Notifications');
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
});

describe('which toggles exist', () => {
  it('exposes the global notification-email gate', async () => {
    await renderAccount();
    expect(screen.getByLabelText('Account and activity emails')).toBeInTheDocument();
  });

  it('no longer renders the inert "New campaign alerts" toggle', async () => {
    await renderAccount();
    expect(screen.queryByLabelText('New campaign alerts')).not.toBeInTheDocument();
  });

  it('keeps receipts, campaign updates and newsletter', async () => {
    await renderAccount();
    expect(screen.getByLabelText('Donation receipts')).toBeInTheDocument();
    expect(screen.getByLabelText('Campaign updates')).toBeInTheDocument();
    expect(screen.getByLabelText('Monthly newsletter')).toBeInTheDocument();
  });
});

describe('emailNotifications round-trips', () => {
  it('reflects a stored false value', async () => {
    await renderAccount({ emailNotifications: false });
    expect(screen.getByLabelText('Account and activity emails')).toHaveAttribute('aria-checked', 'false');
  });

  it('defaults to on when unset', async () => {
    await renderAccount({});
    expect(screen.getByLabelText('Account and activity emails')).toHaveAttribute('aria-checked', 'true');
  });

  it('PUTs the key to the settings endpoint when switched off', async () => {
    await renderAccount({ emailNotifications: true });

    await userEvent.click(screen.getByLabelText('Account and activity emails'));

    await waitFor(() => {
      const put = calls.find((c) => c.url === '/api/v1/users/settings' && c.method === 'PUT');
      expect(put).toBeDefined();
      expect((put!.body as Record<string, unknown>).emailNotifications).toBe(false);
    });
  });
});

describe('emailNewsletter writes through to the subscriber list', () => {
  it('subscribes the signed-in address when switched on', async () => {
    await renderAccount({ emailNewsletter: false });

    await userEvent.click(screen.getByLabelText('Monthly newsletter'));

    await waitFor(() => {
      const sub = calls.find((c) => c.url === '/api/v1/newsletter/subscribe');
      expect(sub).toBeDefined();
      expect(sub!.method).toBe('POST');
      expect(sub!.body).toEqual({ email: 'ada@example.com', source: 'newsletter' });
    });
  });

  it('unsubscribes the signed-in address when switched off', async () => {
    await renderAccount({ emailNewsletter: true });

    await userEvent.click(screen.getByLabelText('Monthly newsletter'));

    await waitFor(() => {
      const unsub = calls.find((c) => c.url === '/api/v1/newsletter/unsubscribe');
      expect(unsub).toBeDefined();
      expect(unsub!.method).toBe('POST');
      expect(unsub!.body).toEqual({ email: 'ada@example.com' });
    });
  });

  it('does not touch the newsletter list for an unrelated toggle', async () => {
    await renderAccount({});

    await userEvent.click(screen.getByLabelText('Donation receipts'));

    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/v1/users/settings' && c.method === 'PUT')).toBe(true);
    });
    expect(calls.some((c) => c.url.startsWith('/api/v1/newsletter/'))).toBe(false);
  });
});
