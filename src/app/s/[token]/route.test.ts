/**
 * `/s/<token>` - the share-link entry point.
 *
 * The case that matters most here is the one that reached production:
 * redirecting to `request.nextUrl.origin` behind Fly's proxy produced
 * `https://0.0.0.0:3000/...`, so every share link led to a dead host. No
 * unit test could have caught it as written, because the bug only exists
 * once something is proxying. It is pinned now by asserting the redirect
 * target is the CANONICAL origin and never the request's own.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveShareLinkAndCountClick = vi.fn();
const dbLimit = vi.fn();

vi.mock('@/lib/share-links', async () => {
  const actual = await vi.importActual<typeof import('@/lib/share-links')>('@/lib/share-links');
  return {
    ...actual,
    resolveShareLinkAndCountClick: (...args: unknown[]) =>
      resolveShareLinkAndCountClick(...args),
  };
});

vi.mock('@/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: dbLimit }) }) }),
  },
}));

vi.mock('@/lib/errors', () => ({ logError: vi.fn() }));

import { GET } from './route';

/** A request whose own origin is the internal bind address, as on Fly. */
function proxiedRequest(token: string) {
  return new Request(`https://0.0.0.0:3000/s/${token}`) as never;
}

const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://lastdonor.org';
});

describe('a valid share link', () => {
  beforeEach(() => {
    resolveShareLinkAndCountClick.mockResolvedValue({ id: 'link-1', campaignId: 'camp-1' });
    dbLimit.mockResolvedValue([{ slug: 'alicia-reeves' }]);
  });

  it('redirects to the canonical origin, never the request origin', async () => {
    const res = await GET(proxiedRequest('tok_abcdefghijklmnop'), ctx('tok_abcdefghijklmnop'));
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toBe('https://lastdonor.org/campaigns/alicia-reeves');
    expect(location).not.toContain('0.0.0.0');
  });

  it('sets the attribution cookie, httpOnly and lax, for seven days', async () => {
    const res = await GET(proxiedRequest('tok_abcdefghijklmnop'), ctx('tok_abcdefghijklmnop'));
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('ld_via=tok_abcdefghijklmnop');
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it('counts the visit', async () => {
    await GET(proxiedRequest('tok_abcdefghijklmnop'), ctx('tok_abcdefghijklmnop'));
    expect(resolveShareLinkAndCountClick).toHaveBeenCalledWith('tok_abcdefghijklmnop');
  });
});

describe('a link that cannot be honoured is still not a dead end', () => {
  it('redirects an unknown token to the campaign list', async () => {
    resolveShareLinkAndCountClick.mockResolvedValue(null);
    const res = await GET(proxiedRequest('tok_unknownunknown'), ctx('tok_unknownunknown'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://lastdonor.org/campaigns');
  });

  it('redirects when the campaign behind the link has vanished', async () => {
    resolveShareLinkAndCountClick.mockResolvedValue({ id: 'l', campaignId: 'gone' });
    dbLimit.mockResolvedValue([]);
    const res = await GET(proxiedRequest('tok_abcdefghijklmnop'), ctx('tok_abcdefghijklmnop'));
    expect(res.headers.get('location')).toBe('https://lastdonor.org/campaigns');
  });

  it('redirects rather than throwing when the lookup fails', async () => {
    resolveShareLinkAndCountClick.mockRejectedValue(new Error('pool wedged'));
    const res = await GET(proxiedRequest('tok_abcdefghijklmnop'), ctx('tok_abcdefghijklmnop'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://lastdonor.org/campaigns');
  });

  it('never reaches the database for a malformed token', async () => {
    resolveShareLinkAndCountClick.mockResolvedValue(null);
    const res = await GET(proxiedRequest('..%2F..%2Fetc'), ctx('../../etc/passwd'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://lastdonor.org/campaigns');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
