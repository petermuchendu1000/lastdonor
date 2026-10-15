/**
 * docs/44 - a rate-limited or failed session read must read as "unknown",
 * never as "signed out".
 *
 * The bug being locked down: `fetchData` in next-auth collapses every non-2xx
 * answer to `null`, and `null` is how next-auth represents "no session". So a
 * 429 was indistinguishable from a signed-out visitor, and every consumer
 * rendered the anonymous UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockUseSession = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));

import {
  markSessionReadIndeterminate,
  probeSessionRead,
  resetSessionReadHealth,
  isSessionReadConclusive,
  useAuthState,
} from '@/lib/auth-state';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  resetSessionReadHealth();
  mockUseSession.mockReset();
});

afterEach(() => {
  resetSessionReadHealth();
});

describe('probeSessionRead', () => {
  it('reads a 200 with a user as authenticated', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ user: { id: 'u1', name: 'Jane' }, expires: '2099-01-01T00:00:00.000Z' }),
    );
    const result = await probeSessionRead(fetchImpl as unknown as typeof fetch);

    expect(result.outcome).toBe('authenticated');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/auth/session');
    expect(isSessionReadConclusive()).toBe(true);
  });

  it('reads a 200 with no session as conclusively anonymous', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(null));
    const result = await probeSessionRead(fetchImpl as unknown as typeof fetch);

    expect(result.outcome).toBe('anonymous');
    expect(isSessionReadConclusive()).toBe(true);
  });

  it('reads a 429 as indeterminate, not anonymous, and honours Retry-After', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED' } }), {
        status: 429,
        headers: { 'retry-after': '11' },
      }),
    );
    const result = await probeSessionRead(fetchImpl as unknown as typeof fetch);

    expect(result.outcome).toBe('indeterminate');
    if (result.outcome !== 'indeterminate') throw new Error('unreachable');
    expect(result.reason).toBe('http_429');
    expect(result.retryAfterMs).toBe(11_000);
    expect(isSessionReadConclusive()).toBe(false);
  });

  it('reads a 5xx as indeterminate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 502 }));
    const result = await probeSessionRead(fetchImpl as unknown as typeof fetch);

    expect(result.outcome).toBe('indeterminate');
    expect(isSessionReadConclusive()).toBe(false);
  });

  it('reads a network failure as indeterminate', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await probeSessionRead(fetchImpl as unknown as typeof fetch);

    expect(result.outcome).toBe('indeterminate');
    if (result.outcome !== 'indeterminate') throw new Error('unreachable');
    expect(result.reason).toBe('network');
    expect(isSessionReadConclusive()).toBe(false);
  });

  it('clamps an absurd Retry-After', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('', { status: 429, headers: { 'retry-after': '86400' } }),
    );
    const result = await probeSessionRead(fetchImpl as unknown as typeof fetch);
    if (result.outcome !== 'indeterminate') throw new Error('unreachable');
    expect(result.retryAfterMs).toBe(30_000);
  });

  it('does not treat a 200 without a user object as a session', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const result = await probeSessionRead(fetchImpl as unknown as typeof fetch);
    expect(result.outcome).toBe('anonymous');
  });
});

describe('useAuthState', () => {
  it('reports authenticated when there is a session', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1' } },
      status: 'authenticated',
    });
    const { result } = renderHook(() => useAuthState());
    expect(result.current.state).toBe('authenticated');
    expect(result.current.isAnonymous).toBe(false);
  });

  it('reports anonymous for an unauthenticated status after a conclusive read', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    const { result } = renderHook(() => useAuthState());
    expect(result.current.state).toBe('anonymous');
    expect(result.current.isAnonymous).toBe(true);
  });

  it('reports unknown, NOT anonymous, when the last read was inconclusive', () => {
    markSessionReadIndeterminate();
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    const { result } = renderHook(() => useAuthState());

    expect(result.current.state).toBe('unknown');
    expect(result.current.isAnonymous).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('reports unknown while the read is still in flight', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });
    const { result } = renderHook(() => useAuthState());
    expect(result.current.state).toBe('unknown');
  });
});
