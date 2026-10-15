/**
 * NewsletterSignup — P2, fixed 2026-10-15.
 *
 * The component showed "Welcome! Check your inbox" for every `ok` response,
 * including `already_subscribed` and `resubscribed`, which send NO email. Its
 * `res.status === 409` branch was dead code: the API never answers 409.
 * `src/app/newsletter/form.tsx` already branched on `json.data.status`
 * correctly; this file pins that behaviour for this component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { NewsletterSignup } from '@/components/NewsletterSignup';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function respond(body: unknown, { ok = true, status = 200 } = {}) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

async function submit(email = 'test@example.com') {
  render(<NewsletterSignup source="homepage" />);
  await userEvent.type(screen.getByLabelText('Email address'), email);
  await userEvent.click(screen.getByRole('button', { name: /subscribe/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('a brand-new subscription', () => {
  it('promises mail, because mail is actually sent', async () => {
    respond({ ok: true, data: { status: 'subscribed' } }, { status: 201 });

    await submit();

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Welcome! Check your inbox for a confirmation.');
  });
});

describe('already_subscribed (sends no email)', () => {
  it('does not tell the user to check their inbox', async () => {
    respond({ ok: true, data: { status: 'already_subscribed' } });

    await submit();

    expect(await screen.findByText(/already subscribed/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
  });

  it('does not raise a toast promising a confirmation email', async () => {
    respond({ ok: true, data: { status: 'already_subscribed' } });

    await submit();

    expect(toast.success).toHaveBeenCalledWith('You are already subscribed.');
    expect(toast.success).not.toHaveBeenCalledWith(
      expect.stringContaining('Check your inbox'),
    );
  });
});

describe('resubscribed (sends no email)', () => {
  it('confirms reactivation without promising mail', async () => {
    respond({ ok: true, data: { status: 'resubscribed' } });

    await submit();

    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Welcome back! Your subscription is active again.');
  });
});

describe('errors', () => {
  it('surfaces the API error message on a non-2xx', async () => {
    respond(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address' } },
      { ok: false, status: 400 },
    );

    await submit();

    expect(toast.error).toHaveBeenCalledWith('Enter a valid email address');
    expect(screen.queryByText(/subscribed/i)).not.toBeInTheDocument();
  });

  it('treats a 200 carrying ok:false as a failure, not a success', async () => {
    respond({ ok: false, error: { message: 'Subscription failed. Please try again.' } });

    await submit();

    expect(toast.error).toHaveBeenCalledWith('Subscription failed. Please try again.');
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
  });
});
