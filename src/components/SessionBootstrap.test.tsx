/**
 * docs/44 - one document load must cost at most one `GET /api/auth/session`,
 * and an inconclusive read must never surface as "unauthenticated".
 *
 * Before the fix a single mount issued two reads: `SessionProvider` fetched on
 * mount, `getSession()` announced it on a fresh `BroadcastChannel('next-auth')`,
 * and the provider's own channel object received its own announcement and
 * refetched. Two reads per navigation halved the usable rate-limit budget.
 *
 * This renders the real `SessionBootstrap`, including the real
 * `next-auth/react` provider, so the duplicate would be caught here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import { SessionBootstrap } from '@/components/SessionBootstrap';
import { resetSessionReadHealth, isSessionReadConclusive } from '@/lib/auth-state';

function Readout() {
  const { data, status } = useSession();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{data?.user?.name ?? 'none'}</span>
    </div>
  );
}

function sessionBody(name: string) {
  return new Response(
    JSON.stringify({ user: { id: 'u1', name }, expires: '2099-01-01T00:00:00.000Z' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSessionReadHealth();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetSessionReadHealth();
});

function sessionReadCount(): number {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/auth/session')).length;
}

describe('SessionBootstrap', () => {
  it('issues exactly one session read per mount', async () => {
    fetchMock.mockResolvedValue(sessionBody('Jane'));

    render(
      <SessionBootstrap>
        <Readout />
      </SessionBootstrap>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('Jane');
    expect(sessionReadCount()).toBe(1);

    // Give the broadcast-channel echo a chance to land before counting again.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(sessionReadCount()).toBe(1);
  });

  it('starts in a loading state rather than claiming the visitor is anonymous', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(
      <SessionBootstrap>
        <Readout />
      </SessionBootstrap>,
    );

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
  });

  it('reports unauthenticated only on a conclusive 200 with no session', async () => {
    fetchMock.mockResolvedValue(
      new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    render(
      <SessionBootstrap>
        <Readout />
      </SessionBootstrap>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(sessionReadCount()).toBe(1);
  });

  it('holds the unknown state on a 429 instead of signing the user out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED' } }), {
        status: 429,
        headers: { 'retry-after': '11' },
      }),
    );

    render(
      <SessionBootstrap>
        <Readout />
      </SessionBootstrap>,
    );

    await waitFor(() => expect(isSessionReadConclusive()).toBe(false));

    // The whole point: never 'unauthenticated' on a 429.
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(sessionReadCount()).toBe(1);
  });

  it('retries after Retry-After and recovers without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock
      .mockResolvedValueOnce(
        new Response('{}', { status: 429, headers: { 'retry-after': '11' } }),
      )
      .mockResolvedValue(sessionBody('Jane'));

    render(
      <SessionBootstrap>
        <Readout />
      </SessionBootstrap>,
    );

    await waitFor(() => expect(sessionReadCount()).toBe(1));
    expect(screen.getByTestId('status')).toHaveTextContent('loading');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(isSessionReadConclusive()).toBe(true);
    expect(sessionReadCount()).toBe(2);
  });
});
