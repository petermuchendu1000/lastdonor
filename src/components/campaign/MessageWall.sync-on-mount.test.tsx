/**
 * docs/43 — a message of support must survive a reload.
 *
 * Production audit 2026-10-15: `POST /api/v1/campaigns/marcus-delgado/messages`
 * returned 201 and the message appeared optimistically, but a reload rendered
 * "No messages yet. Be the first to leave a message of support!" The row was in
 * the database and `GET .../messages?limit=20` returned it; the campaign page is
 * ISR-cached (`revalidate = 60`) and `usePollingList` only started fetching one
 * whole `pollIntervalMs` (30s) after mount, so the reader was shown the stale
 * server render and told their message was never saved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MessageWall, type MessageItem } from './MessageWall';

const POSTED: MessageItem = {
  id: 'msg-1',
  donorName: 'Dana',
  donorLocation: 'Austin, TX',
  message: 'Thinking of you every day. You are not doing this alone.',
  isAnonymous: false,
  createdAt: new Date('2026-10-15T10:00:00Z').toISOString(),
};

function jsonOk(data: MessageItem[], hasMore = false) {
  return {
    ok: true,
    json: async () => ({ ok: true, data, meta: { hasMore } }),
  } as unknown as Response;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MessageWall after a stale ISR render', () => {
  it('shows a stored message that the cached server render omitted', async () => {
    // Exactly the audited state: the cached HTML has no messages, the database
    // has one. No timers are advanced, so this is the reload itself.
    fetchMock.mockResolvedValue(jsonOk([POSTED]));

    render(<MessageWall campaignSlug="marcus-delgado" initialMessages={[]} />);

    expect(
      screen.getByText(/No messages yet\. Be the first to leave a message of support!/),
    ).toBeInTheDocument();

    expect(await screen.findByText(POSTED.message)).toBeInTheDocument();
    expect(
      screen.queryByText(/No messages yet\. Be the first to leave a message of support!/),
    ).not.toBeInTheDocument();
  });

  it('re-reads the API on mount, not one poll interval later', async () => {
    fetchMock.mockResolvedValue(jsonOk([POSTED]));

    render(<MessageWall campaignSlug="marcus-delgado" initialMessages={[]} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/v1/campaigns/marcus-delgado/messages?limit=20');
    // The whole point is to bypass caches, not to read another one.
    expect(init).toMatchObject({ cache: 'no-store' });
  });

  it('is server-rendered first, so crawlers and the first paint still see the list', () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never settles

    render(<MessageWall campaignSlug="marcus-delgado" initialMessages={[POSTED]} />);

    expect(screen.getByText(POSTED.message)).toBeInTheDocument();
  });

  it('keeps the server-rendered list when the refresh fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    render(<MessageWall campaignSlug="marcus-delgado" initialMessages={[POSTED]} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(POSTED.message)).toBeInTheDocument();
    expect(
      screen.queryByText(/No messages yet/),
    ).not.toBeInTheDocument();
  });

  it('keeps the server-rendered list when the refresh is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response);

    render(<MessageWall campaignSlug="marcus-delgado" initialMessages={[POSTED]} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(POSTED.message)).toBeInTheDocument();
  });

  it('drops a message the cached render still shows but the API no longer returns', async () => {
    // A moderated message: merge-only refreshing could never remove it.
    fetchMock.mockResolvedValue(jsonOk([]));

    render(<MessageWall campaignSlug="marcus-delgado" initialMessages={[POSTED]} />);

    await waitFor(() =>
      expect(screen.queryByText(POSTED.message)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });
});
