/**
 * docs/44 - the header must not offer "Sign in" on an inconclusive session
 * read.
 *
 * Reproduction being locked down: once `GET /api/auth/session` started
 * answering 429, next-auth reported `status: 'unauthenticated'`, and the navbar
 * swapped the avatar for a "Sign in" link while the user's cookie was still
 * perfectly valid.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseSession = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
  signOut: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/how-it-works',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { Navbar } from '@/components/layout/Navbar';
import {
  markSessionReadIndeterminate,
  resetSessionReadHealth,
} from '@/lib/auth-state';

beforeEach(() => {
  resetSessionReadHealth();
  mockUseSession.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSessionReadHealth();
});

describe('Navbar on a degraded session read', () => {
  it('offers Sign in when the visitor is conclusively anonymous', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<Navbar />);

    expect(screen.getAllByText('Sign in').length).toBeGreaterThan(0);
  });

  it('offers NO Sign in link when the session read was rate limited', () => {
    // What a 429 looks like by the time it reaches a component: next-auth has
    // already collapsed it to `data: null, status: 'unauthenticated'`.
    markSessionReadIndeterminate();
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<Navbar />);

    expect(screen.queryByText('Sign in')).toBeNull();
    expect(screen.getByTestId('auth-indeterminate')).toBeInTheDocument();
  });

  it('offers NO Sign in link while the read is still in flight', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });
    render(<Navbar />);

    expect(screen.queryByText('Sign in')).toBeNull();
    expect(screen.getByTestId('auth-indeterminate')).toBeInTheDocument();
  });

  it('keeps the Donate call to action in every state', () => {
    markSessionReadIndeterminate();
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    render(<Navbar />);

    expect(screen.getAllByText('Donate').length).toBeGreaterThan(0);
  });
});
