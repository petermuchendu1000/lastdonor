/**
 * `/sitemap.xml` must contain the pages that can accept money.
 *
 * Observed live 2026-10-15: the sitemap listed 42 URLs - every marketing and
 * policy page plus all 23 `/campaigns/category/<slug>` landing pages - and
 * ZERO `/campaigns/<slug>` detail pages, and zero `/blog/<slug>` posts. The
 * route queries for both, so the query was not the problem: the route had no
 * `revalidate`, so Next rendered it once during `next build`, where
 * `src/db/build-phase.ts` resolves a failed read to zero rows and the
 * `database_url` build secret is optional. The empty result was then frozen
 * into the image for its whole life.
 *
 * These tests drive the real default export against a fake `@/db` and pin:
 *
 *   - `revalidate` is exported and finite, which is the actual fix;
 *   - campaign detail URLs appear, with `lastModified` from the row;
 *   - only the statuses that `src/app/campaigns/[slug]/page.tsx` marks
 *     indexable are queried, so the sitemap cannot submit a `noindex` URL;
 *   - a database failure degrades to a valid static sitemap instead of a 500,
 *     per section rather than all-or-nothing.
 *
 * See docs/46.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ALL_CATEGORY_SLUGS } from '@/lib/category-content';
import { GENERAL_FUND_CAMPAIGN_ID } from '@/lib/constants';

const dialect = new PgDialect();

interface CampaignRow {
  slug: string;
  status: string;
  category: string;
  updatedAt: Date | null;
  publishedAt: Date | null;
}

interface BlogRow {
  slug: string;
  publishedAt: Date | null;
  updatedAt: Date | null;
}

/** What the fake database answers, and which tables blow up. */
const state = vi.hoisted(() => ({
  campaigns: [] as unknown[],
  blogPosts: [] as unknown[],
  failing: new Set<string>(),
  /** Every `where()` condition the route handed us, keyed by table. */
  conditions: new Map<string, unknown[]>(),
}));

class FakeChain implements PromiseLike<unknown[]> {
  private table = '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: any) {
    this.table = getTableName(table);
    return this;
  }

  where(condition: unknown) {
    const existing = state.conditions.get(this.table) ?? [];
    existing.push(condition);
    state.conditions.set(this.table, existing);
    return this;
  }

  limit() {
    return this;
  }

  then<R1 = unknown[], R2 = never>(
    onfulfilled?: ((value: unknown[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => {
        if (state.failing.has(this.table)) {
          // Shape of a real postgres.js failure during the pool wedge
          // (docs/37): the query simply never resolves successfully.
          throw new Error(`relation "${this.table}" is unavailable`);
        }
        if (this.table === 'campaigns') return state.campaigns;
        if (this.table === 'blog_posts') return state.blogPosts;
        return [];
      })
      .then(onfulfilled, onrejected);
  }
}

vi.mock('@/db', () => ({
  db: {
    select: () => new FakeChain(),
  },
}));

const CAMPAIGN_ROWS: CampaignRow[] = [
  {
    slug: 'help-sergeant-reyes',
    status: 'active',
    category: 'veterans',
    updatedAt: new Date('2026-10-12T09:00:00Z'),
    publishedAt: new Date('2026-10-01T09:00:00Z'),
  },
  {
    slug: 'final-stretch-for-mia',
    status: 'last_donor_zone',
    category: 'medical',
    updatedAt: new Date('2026-10-14T18:30:00Z'),
    publishedAt: new Date('2026-09-20T09:00:00Z'),
  },
  {
    slug: 'the-okafor-family-fund',
    status: 'completed',
    category: 'memorial',
    updatedAt: new Date('2026-08-02T12:00:00Z'),
    publishedAt: new Date('2026-07-01T09:00:00Z'),
  },
];

const BLOG_ROWS: BlogRow[] = [
  {
    slug: 'how-we-verify-campaigns',
    publishedAt: new Date('2026-05-01T09:00:00Z'),
    updatedAt: new Date('2026-09-09T09:00:00Z'),
  },
];

/** Import fresh so module-level state cannot leak between cases. */
async function runSitemap() {
  vi.resetModules();
  const mod = await import('./sitemap');
  return { entries: await mod.default(), revalidate: mod.revalidate };
}

function urls(entries: { url: string }[]): string[] {
  return entries.map((e) => e.url);
}

beforeEach(() => {
  state.campaigns = CAMPAIGN_ROWS;
  state.blogPosts = BLOG_ROWS;
  state.failing = new Set();
  state.conditions = new Map();
});

describe('sitemap is not frozen at build time', () => {
  it('exports a finite revalidate, so it regenerates after the build', async () => {
    const { revalidate } = await runSitemap();
    expect(typeof revalidate).toBe('number');
    expect(revalidate).toBeGreaterThan(0);
    expect(Number.isFinite(revalidate)).toBe(true);
  });
});

describe('sitemap lists campaign detail pages', () => {
  it('includes a URL for every live and completed campaign', async () => {
    const { entries } = await runSitemap();
    expect(urls(entries)).toEqual(
      expect.arrayContaining([
        'https://lastdonor.org/campaigns/help-sergeant-reyes',
        'https://lastdonor.org/campaigns/final-stretch-for-mia',
        'https://lastdonor.org/campaigns/the-okafor-family-fund',
      ]),
    );
  });

  it('does not confuse a detail page with its category page', async () => {
    const { entries } = await runSitemap();
    const detail = urls(entries).filter((u) =>
      /^https:\/\/lastdonor\.org\/campaigns\/[^/]+$/.test(u),
    );
    expect(detail).toHaveLength(CAMPAIGN_ROWS.length);
  });

  it('takes lastModified from the row, never from the clock', async () => {
    const { entries } = await runSitemap();
    const entry = entries.find(
      (e) => e.url === 'https://lastdonor.org/campaigns/final-stretch-for-mia',
    );
    expect(entry?.lastModified).toEqual(new Date('2026-10-14T18:30:00Z'));
  });

  it('ranks a live campaign above a completed one', async () => {
    const { entries } = await runSitemap();
    const live = entries.find((e) => e.url.endsWith('/campaigns/help-sergeant-reyes'));
    const done = entries.find((e) => e.url.endsWith('/campaigns/the-okafor-family-fund'));
    expect(live?.priority).toBeGreaterThan(done!.priority!);
    expect(live?.changeFrequency).toBe('daily');
    expect(done?.changeFrequency).toBe('monthly');
  });

  it('includes published blog posts', async () => {
    const { entries } = await runSitemap();
    expect(urls(entries)).toContain(
      'https://lastdonor.org/blog/how-we-verify-campaigns',
    );
  });
});

describe('sitemap queries only the indexable statuses', () => {
  /**
   * The detail page marks `paused`, `suspended` and `cancelled` as
   * `robots: { index: false }` while still serving 200
   * (`src/app/campaigns/[slug]/page.tsx:211`). Submitting one here would earn
   * a "Submitted URL marked noindex" error in Search Console, and in the
   * suspended / cancelled case would mean advertising a fundraiser the
   * platform has itself stopped.
   */
  it('asks for active, last_donor_zone and completed, and no other status', async () => {
    /*
      ⚠️ This asserted `params` was EXACTLY the three statuses, which is a
      claim about the WHERE clause's shape rather than about which statuses it
      asks for. `docs/147` added a second half to that clause - the platform
      fund is excluded, because this query filters on status alone while the
      campaign page also requires `published_at` - so the fund id is now a
      bound parameter too and an exact-equality assertion broke on a change
      that is correct.

      It now asserts the PROPERTY: every intended status is asked for, and the
      sibling row below proves no unintended status is. The fund exclusion has
      its own row.
    */
    await runSitemap();
    const conditions = state.conditions.get('campaigns') ?? [];
    expect(conditions).toHaveLength(1);
    const { params } = dialect.sqlToQuery(conditions[0] as SQL);
    for (const status of ['active', 'last_donor_zone', 'completed']) {
      expect(params, status).toContain(status);
    }
  });

  it('excludes the platform general fund from the campaign URLs it advertises', async () => {
    /*
      docs/147. The fund holds a live status so `payhero/initiate` will
      collect for it, and this query reads status alone - so without the
      exclusion the sitemap would submit `/campaigns/<fund slug>` while the
      page requires `published_at IS NOT NULL` and answers 404.
    */
    await runSitemap();
    const { params } = dialect.sqlToQuery(
      (state.conditions.get('campaigns') ?? [])[0] as SQL,
    );
    expect(params).toContain(GENERAL_FUND_CAMPAIGN_ID);
  });

  it('never asks for a non-public or trust-and-safety status', async () => {
    await runSitemap();
    const { params } = dialect.sqlToQuery(
      (state.conditions.get('campaigns') ?? [])[0] as SQL,
    );
    for (const excluded of [
      'draft',
      'archived',
      'under_review',
      'paused',
      'suspended',
      'cancelled',
    ]) {
      expect(params, excluded).not.toContain(excluded);
    }
  });
});

describe('sitemap survives a database failure', () => {
  /** Static pages plus one landing page per category: needs no database. */
  const STATIC_PAGE_COUNT = 19;
  const EXPECTED_STATIC_TOTAL = STATIC_PAGE_COUNT + ALL_CATEGORY_SLUGS.length;

  it('serves the static sitemap instead of throwing', async () => {
    state.failing = new Set(['campaigns', 'blog_posts']);
    const { entries } = await runSitemap();

    expect(entries).toHaveLength(EXPECTED_STATIC_TOTAL);
    expect(urls(entries)).toContain('https://lastdonor.org');
    expect(urls(entries)).toContain('https://lastdonor.org/campaigns');
    expect(urls(entries)).toContain('https://lastdonor.org/privacy');
    expect(urls(entries)).toContain('https://lastdonor.org/terms');
  });

  it('still emits a valid entry for every URL it does serve', async () => {
    state.failing = new Set(['campaigns', 'blog_posts']);
    const { entries } = await runSitemap();
    for (const entry of entries) {
      expect(entry.url.startsWith('https://lastdonor.org')).toBe(true);
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
  });

  it('keeps every category landing page', async () => {
    state.failing = new Set(['campaigns', 'blog_posts']);
    const { entries } = await runSitemap();
    for (const slug of ALL_CATEGORY_SLUGS) {
      expect(urls(entries)).toContain(
        `https://lastdonor.org/campaigns/category/${slug}`,
      );
    }
  });

  it('degrades per section: a blog failure does not cost the campaigns', async () => {
    state.failing = new Set(['blog_posts']);
    const { entries } = await runSitemap();

    expect(urls(entries)).toContain(
      'https://lastdonor.org/campaigns/help-sergeant-reyes',
    );
    expect(urls(entries).some((u) => u.startsWith('https://lastdonor.org/blog/'))).toBe(
      false,
    );
  });

  it('degrades per section: a campaign failure does not cost the blog', async () => {
    state.failing = new Set(['campaigns']);
    const { entries } = await runSitemap();

    expect(urls(entries)).toContain(
      'https://lastdonor.org/blog/how-we-verify-campaigns',
    );
    expect(entries).toHaveLength(EXPECTED_STATIC_TOTAL + BLOG_ROWS.length);
  });

  it('an empty database still produces the static sitemap', async () => {
    state.campaigns = [];
    state.blogPosts = [];
    const { entries } = await runSitemap();
    expect(entries).toHaveLength(EXPECTED_STATIC_TOTAL);
  });
});

describe('the pages that returned 200 before the fix are all still listed', () => {
  /**
   * Pinned explicitly: the live audit confirmed every one of these returns
   * 200, so none may be dropped while adding the campaign URLs.
   */
  const MUST_KEEP = [
    '',
    '/about',
    '/how-it-works',
    '/transparency',
    '/campaigns',
    '/compare',
    '/completed-campaigns',
    '/blog',
    '/last-donor-wall',
    '/donate',
    '/share-your-story',
    '/editorial-standards',
    '/donor-faq',
    '/campaign-verification-policy',
    '/fund-release-policy',
    '/campaign-rules',
    '/refund-policy',
    '/privacy',
    '/terms',
  ];

  it('lists all 19 static pages and all 23 category pages', async () => {
    const { entries } = await runSitemap();
    const listed = urls(entries);
    for (const path of MUST_KEEP) {
      expect(listed, path).toContain(`https://lastdonor.org${path}`);
    }
    expect(ALL_CATEGORY_SLUGS).toHaveLength(23);
    for (const slug of ALL_CATEGORY_SLUGS) {
      expect(listed).toContain(`https://lastdonor.org/campaigns/category/${slug}`);
    }
  });

  it('emits no duplicate URL', async () => {
    const { entries } = await runSitemap();
    const listed = urls(entries);
    expect(new Set(listed).size).toBe(listed.length);
  });
});

/*
  The pages whose content IS the campaign set must date themselves from it.

  Found 2026-10-18 while asking why nothing ranks: every URL carried one
  hand-maintained constant of `2026-04-27`, six months stale, including
  `/campaigns/category/medical`, which also declared
  `changeFrequency: 'daily'`. A crawler reading "changes daily, last
  changed in April" has been told twice, contradictorily, how much to
  care.

  The derived date is `publishedAt`, not `updatedAt`, because
  `cron/reconcile` step 5 writes `updated_at = NOW()` on echo-counter
  drift and a listing page has not changed because a counter was
  repaired.
*/
describe('listing pages date themselves from the campaigns they list', () => {
  const find = (entries: { url: string; lastModified?: string | Date }[], url: string) =>
    entries.find((e) => e.url === url);

  it('dates the homepage and /campaigns from the newest live publishedAt', async () => {
    const { entries } = await runSitemap();
    // Newest live publishedAt is help-sergeant-reyes at 2026-10-01.
    // the-okafor-family-fund is completed, so it is not on these pages.
    const expected = new Date('2026-10-01T09:00:00Z');
    expect(find(entries, 'https://lastdonor.org')?.lastModified).toEqual(expected);
    expect(find(entries, 'https://lastdonor.org/campaigns')?.lastModified).toEqual(expected);
  });

  it('dates each category page from the newest live campaign in THAT category', async () => {
    const { entries } = await runSitemap();
    expect(
      find(entries, 'https://lastdonor.org/campaigns/category/veterans')?.lastModified,
    ).toEqual(new Date('2026-10-01T09:00:00Z'));
    expect(
      find(entries, 'https://lastdonor.org/campaigns/category/medical')?.lastModified,
    ).toEqual(new Date('2026-09-20T09:00:00Z'));
  });

  it('does not let a completed campaign date its category page', async () => {
    // `memorial` holds only the completed campaign, which is not listed on
    // the category page, so the page must fall back to the editorial date
    // rather than claim the completed campaign's freshness.
    const { entries } = await runSitemap();
    const memorial = find(entries, 'https://lastdonor.org/campaigns/category/memorial');
    expect(memorial?.lastModified).not.toEqual(new Date('2026-07-01T09:00:00Z'));
    expect(memorial?.lastModified).toEqual(new Date('2026-10-18'));
  });

  it('falls back to the editorial date for a category with no live campaign', async () => {
    const { entries } = await runSitemap();
    expect(
      find(entries, 'https://lastdonor.org/campaigns/category/animal')?.lastModified,
    ).toEqual(new Date('2026-10-18'));
  });

  it('falls back to the editorial date when the campaign read fails', async () => {
    state.failing = new Set(['campaigns']);
    const { entries } = await runSitemap();
    expect(find(entries, 'https://lastdonor.org')?.lastModified).toEqual(
      new Date('2026-10-18'),
    );
  });

  it('never dates a listing page from the clock', async () => {
    const { entries } = await runSitemap();
    const now = Date.now();
    for (const e of entries) {
      const t = new Date(e.lastModified as Date).getTime();
      // A lastmod within a second of now means someone reached for
      // `new Date()`, which tells Google everything changed every hour.
      expect(Math.abs(now - t)).toBeGreaterThan(1000);
    }
  });

  it('keeps the editorial constant off the clock, but current', async () => {
    // The constant is hand-maintained; this only pins that it was moved
    // past the October landing-page rebuild it had been lagging.
    const { entries } = await runSitemap();
    const policy = find(entries, 'https://lastdonor.org/privacy');
    expect(new Date(policy!.lastModified as Date).getTime()).toBeGreaterThan(
      new Date('2026-10-01').getTime(),
    );
  });
});
