/**
 * `POST /api/v1/campaigns/[slug]/share-link`.
 *
 * Three properties are pinned here, each for a reason that has already cost
 * this codebase something:
 *
 *  - the route is signed-in only, because an unattributable link is a row of
 *    noise and the impact dashboard would count it;
 *  - the link is built on the CANONICAL origin, never the request's own -
 *    `request.nextUrl.origin` behind Fly's proxy shipped every share link as
 *    `https://0.0.0.0:3000/...` (docs/57);
 *  - repeating the call returns the same token, so a sharer who taps Share
 *    twice keeps one countable link rather than splitting their own total.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const mintShareLink = vi.fn();
const dbLimit = vi.fn();

vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

vi.mock('@/lib/share-links', async () => {
  const actual = await vi.importActual<typeof import('@/lib/share-links')>('@/lib/share-links');
  return { ...actual, mintShareLink: (...args: unknown[]) => mintShareLink(...args) };
});

vi.mock('@/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: dbLimit }) }) }) },
}));

import { POST } from './route';

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
/** A request whose own origin is the internal bind address, as on Fly. */
const proxied = () => new Request('https://0.0.0.0:3000/api/v1/campaigns/x/share-link', {
  method: 'POST',
}) as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://lastdonor.org';
  dbLimit.mockResolvedValue([{ id: 'camp-1' }]);
  mintShareLink.mockResolvedValue({ id: 'link-1', token: 'tok_abcdefghijklmnop' });
});

describe('a signed-in sharer', () => {
  beforeEach(() => authMock.mockResolvedValue({ user: { id: 'user-1' } }));

  it('gets a link on the canonical origin, not the request origin', async () => {
    const res = await POST(proxied(), ctx('alicia-reeves'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.url).toBe('https://lastdonor.org/s/tok_abcdefghijklmnop');
    expect(body.data.url).not.toContain('0.0.0.0');
  });

  it('mints against the resolved campaign and their own user id', async () => {
    await POST(proxied(), ctx('alicia-reeves'));
    expect(mintShareLink).toHaveBeenCalledWith({ campaignId: 'camp-1', userId: 'user-1' });
  });

  it('gets the same link back on a second call', async () => {
    const first = await (await POST(proxied(), ctx('alicia-reeves'))).json();
    const second = await (await POST(proxied(), ctx('alicia-reeves'))).json();
    expect(second.data.url).toBe(first.data.url);
  });

  it('is told plainly when the campaign does not exist', async () => {
    dbLimit.mockResolvedValue([]);
    const res = await POST(proxied(), ctx('no-such-campaign'));
    expect(res.status).toBe(404);
    expect(mintShareLink).not.toHaveBeenCalled();
  });

  it('answers 500 rather than throwing when the mint fails', async () => {
    mintShareLink.mockRejectedValue(new Error('pool wedged'));
    const res = await POST(proxied(), ctx('alicia-reeves'));
    expect(res.status).toBe(500);
  });
});

describe('an anonymous caller', () => {
  it('is refused, and no link row is created for nobody', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(proxied(), ctx('alicia-reeves'));
    expect(res.status).toBe(401);
    expect(mintShareLink).not.toHaveBeenCalled();
  });

  it('is refused before the campaign is even looked up', async () => {
    authMock.mockResolvedValue({ user: {} });
    const res = await POST(proxied(), ctx('alicia-reeves'));
    expect(res.status).toBe(401);
    expect(dbLimit).not.toHaveBeenCalled();
  });
});
