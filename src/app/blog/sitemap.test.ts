/**
 * `/blog/sitemap.xml` - build-time freeze and fail-soft.
 *
 * The defect this pins (verified 2026-10-15): the route exported neither
 * `revalidate` nor `dynamic`, so Next rendered it once during `next build`
 * against the deliberately empty build-phase database and froze an empty
 * sitemap into the image. It answered 200, was well-formed, and listed
 * nothing, for the life of the deploy. See docs/46 §2 for the same defect in
 * the root sitemap.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  shouldThrow: false,
}));

vi.mock('@/db/schema', () => ({
  blogPosts: {
    slug: { name: 'slug' },
    publishedAt: { name: 'published_at' },
    updatedAt: { name: 'updated_at' },
    coverImageUrl: { name: 'cover_image_url' },
    published: { name: 'published' },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, value: unknown) => ({ op: 'eq', col, value }),
  desc: (col: unknown) => ({ op: 'desc', col }),
}));

vi.mock('@/db', () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = async () => {
    if (state.shouldThrow) throw new Error('pool wedged');
    return state.rows;
  };
  return { db: { select: () => chain } };
});

const mod = await import('./sitemap');
const sitemap = mod.default;

beforeEach(() => {
  state.rows = [];
  state.shouldThrow = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('blog sitemap', () => {
  it('sets revalidate, without which the route is baked empty at build time', () => {
    // This is the whole defect. A missing or zero value means Next renders
    // once during `next build`, when the database is intentionally empty.
    expect(typeof mod.revalidate).toBe('number');
    expect(mod.revalidate).toBeGreaterThan(0);
  });

  it('lists published posts', async () => {
    state.rows = [
      {
        slug: 'first-post',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-02-01T00:00:00Z'),
        coverImageUrl: null,
      },
    ];

    const out = await sitemap();
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://lastdonor.org/blog/first-post');
    // updatedAt wins so an edited post gets a re-crawl signal.
    expect(out[0].lastModified).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('never reports "now" as lastModified when both dates are absent', async () => {
    // `new Date()` here would claim on every regeneration that every post had
    // just changed, which trains crawlers to ignore the field entirely.
    state.rows = [
      { slug: 'dateless', publishedAt: null, updatedAt: null, coverImageUrl: null },
    ];

    const out = await sitemap();
    expect(out[0].lastModified).toBeUndefined();
  });

  it('serves an empty sitemap rather than a 500 when the database is unreachable', async () => {
    state.shouldThrow = true;

    const out = await sitemap();
    expect(out).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it('keeps crawl hints identical to the root sitemap blog section', async () => {
    // Two sitemap entries for one URL with different priority or
    // changeFrequency give a crawler contradictory hints. The root sitemap
    // uses monthly/0.5; if that changes, this must change with it.
    state.rows = [
      {
        slug: 'p',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: null,
        coverImageUrl: 'https://example.com/a.png',
      },
    ];

    const out = await sitemap();
    expect(out[0].changeFrequency).toBe('monthly');
    expect(out[0].priority).toBe(0.5);
    expect(out[0].images).toEqual(['https://example.com/a.png']);
  });
});
