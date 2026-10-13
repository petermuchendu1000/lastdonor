import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewsletterSignup } from '@/components/NewsletterSignup';

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('NewsletterSignup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders an email input', () => {
    render(<NewsletterSignup source="homepage" />);
    const input = screen.getByLabelText('Email address');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('placeholder', 'you@example.com');
  });

  it('renders a subscribe button', () => {
    render(<NewsletterSignup source="homepage" />);
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument();
  });

  it('validates email before submit', async () => {
    render(<NewsletterSignup source="homepage" />);
    const button = screen.getByRole('button', { name: /subscribe/i });
    await userEvent.click(button);
    // Form should show email validation error, not call fetch
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls API on valid email submit', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    render(<NewsletterSignup source="footer" />);
    const input = screen.getByLabelText('Email address');
    await userEvent.type(input, 'test@example.com');
    await userEvent.click(screen.getByRole('button', { name: /subscribe/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/newsletter/subscribe',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('shows success message after successful subscription', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    render(<NewsletterSignup source="homepage" />);
    await userEvent.type(screen.getByLabelText('Email address'), 'test@example.com');
    await userEvent.click(screen.getByRole('button', { name: /subscribe/i }));

    // Should show the subscribed state
    expect(await screen.findByText(/you're subscribed/i)).toBeInTheDocument();
  });
});
