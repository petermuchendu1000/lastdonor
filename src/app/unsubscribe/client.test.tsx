/**
 * The unsubscribe page is the middle link of the one-click chain.
 *
 * The email footer mints `?email=&campaign=&token=`; the route authorises on
 * the token OR a session owning the address. This component read only `email`
 * and `campaign` and sent `{ email }`, so the token minted in the mail was
 * dropped on the floor and the request 403'd for every donor who was not
 * already signed in as that address.
 *
 * These tests pin that the token is forwarded, that a tokenless link is still
 * attempted (old links, and the signed-in session path, must keep working),
 * and that a donor who cannot be unsubscribed automatically is still given the
 * support mailbox rather than a dead end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UnsubscribeClient } from './client';

let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

const TOKEN = 'a'.repeat(64);

const fetchMock = vi.fn();

function okResponse(body: unknown = { ok: true, data: { subscribed: false } }) {
  return { json: async () => body } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okResponse());
  vi.stubGlobal('fetch', fetchMock);
  mockSearchParams = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The parsed body of the single DELETE the component issued. */
function sentBody(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(init.method).toBe('DELETE');
  return JSON.parse(init.body as string);
}

describe('UnsubscribeClient token propagation', () => {
  it('forwards the token from the query string into the DELETE', async () => {
    mockSearchParams = new URLSearchParams({
      email: 'donor@example.com',
      campaign: 'a-campaign',
      token: TOKEN,
    });

    render(<UnsubscribeClient />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody()).toEqual({ email: 'donor@example.com', token: TOKEN });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/v1/campaigns/a-campaign/subscribe');

    await waitFor(() => expect(screen.getByText('Unsubscribed')).toBeInTheDocument());
  });

  it('url-encodes the campaign slug in the path', async () => {
    mockSearchParams = new URLSearchParams({
      email: 'donor@example.com',
      campaign: 'a campaign/../x',
      token: TOKEN,
    });

    render(<UnsubscribeClient />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/v1/campaigns/a%20campaign%2F..%2Fx/subscribe');
  });

  it('still attempts the DELETE when the link carries no token', async () => {
    // Links minted before the fix have no token, and a signed-in donor can
    // still unsubscribe through the session path. Refusing to try would break
    // that; the token key is simply omitted.
    mockSearchParams = new URLSearchParams({
      email: 'donor@example.com',
      campaign: 'a-campaign',
    });

    render(<UnsubscribeClient />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody()).toEqual({ email: 'donor@example.com' });
  });

  it('does not send an empty token key for a blank token parameter', async () => {
    mockSearchParams = new URLSearchParams({
      email: 'donor@example.com',
      campaign: 'a-campaign',
      token: '',
    });

    render(<UnsubscribeClient />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody()).toEqual({ email: 'donor@example.com' });
  });
});

describe('UnsubscribeClient dead ends', () => {
  it('keeps the missing-params state when email or campaign is absent', async () => {
    mockSearchParams = new URLSearchParams({ token: TOKEN });

    render(<UnsubscribeClient />);

    await waitFor(() => expect(screen.getByText('Invalid Link')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers the support mailbox on an incomplete link', async () => {
    mockSearchParams = new URLSearchParams({ email: 'donor@example.com' });

    render(<UnsubscribeClient />);

    await waitFor(() => expect(screen.getByText('Invalid Link')).toBeInTheDocument());
    const mailto = screen.getByText('support@lastdonor.org');
    expect(mailto.getAttribute('href')).toContain('mailto:support@lastdonor.org?subject=');
  });

  it('offers the support mailbox, naming the campaign, when the request is refused', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ ok: false, error: { code: 'FORBIDDEN', message: 'no', requestId: 'r' } }),
    );
    mockSearchParams = new URLSearchParams({
      email: 'donor@example.com',
      campaign: 'a-campaign',
    });

    render(<UnsubscribeClient />);

    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeInTheDocument());
    const mailto = screen.getByText('support@lastdonor.org');
    expect(decodeURIComponent(mailto.getAttribute('href') ?? '')).toContain('a-campaign');
  });

  it('offers the support mailbox when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    mockSearchParams = new URLSearchParams({
      email: 'donor@example.com',
      campaign: 'a-campaign',
      token: TOKEN,
    });

    render(<UnsubscribeClient />);

    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeInTheDocument());
    expect(screen.getByText('support@lastdonor.org')).toBeInTheDocument();
  });
});
