/**
 * docs/44 - the campaign message composer must not tell a signed-in user to
 * sign in.
 *
 * Observed on production once `GET /api/auth/session` began answering 429: the
 * composer was replaced by "Sign in to leave a message of support." for a user
 * whose cookie was still valid and whose `/dashboard` still rendered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseSession = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageForm } from '@/components/campaign/MessageForm';
import {
  markSessionReadIndeterminate,
  resetSessionReadHealth,
} from '@/lib/auth-state';

beforeEach(() => {
  resetSessionReadHealth();
  mockUseSession.mockReset();
  global.fetch = vi.fn();
});

afterEach(() => {
  resetSessionReadHealth();
});

describe('MessageForm on a degraded session read', () => {
  it('renders the sign-in prompt only when the visitor is conclusively anonymous', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<MessageForm campaignSlug="marcus-delgado" />);

    expect(screen.getByText(/to leave a message of support/i)).toBeInTheDocument();
  });

  it('renders no auth-gated empty state when the session read was rate limited', () => {
    markSessionReadIndeterminate();
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    const { container } = render(<MessageForm campaignSlug="marcus-delgado" />);

    expect(screen.queryByText(/to leave a message of support/i)).toBeNull();
    expect(screen.queryByText('Sign in')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('renders no auth-gated empty state while the read is in flight', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });
    const { container } = render(<MessageForm campaignSlug="marcus-delgado" />);

    expect(container.innerHTML).toBe('');
  });

  it('still renders the composer for an authenticated user', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Jane', role: 'donor' } },
      status: 'authenticated',
    });
    render(<MessageForm campaignSlug="marcus-delgado" />);

    expect(screen.getByText('Leave a Message')).toBeInTheDocument();
  });
});
