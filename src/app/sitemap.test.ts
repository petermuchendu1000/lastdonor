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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  /*
    Absent from this fixture until 2026-11-04, so NO sitemap test had ever
    exercised a campaign with a real organiser photograph - which is how the
    sitemap came to advertise Supabase URLs carrying `X-Robots-Tag: none`.
  */
  heroImageUrl: string | null;
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
    heroImageUrl:
      'https://vavxdjqufxrsbyohcwdh.supabase.co/storage/v1/object/public/media/campaign-photos/aaaa1111.jpg',
    updatedAt: new Date('2026-10-12T09:00:00Z'),
    publishedAt: new Date('2026-10-01T09:00:00Z'),
  },
  {
    slug: 'final-stretch-for-mia',
    status: 'last_donor_zone',
    category: 'medical',
    heroImageUrl: null,
    updatedAt: new Date('2026-10-14T18:30:00Z'),
    publishedAt: new Date('2026-09-20T09:00:00Z'),
  },
  {
    slug: 'the-okafor-family-fund',
    status: 'completed',
    category: 'memorial',
    heroImageUrl: null,
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
  /** Pages that need no database at all. */
  const STATIC_PAGE_COUNT = 19;
  /**
   * What a FAILED campaign read still serves: the static pages plus every
   * category landing page.
   *
   * ⛔ The categories are here because a failed read means the tally is
   * UNKNOWN, not zero - `advertisedCategorySlugs` keeps all 23 when
   * `campaignsLoaded` is false. Contrast the empty-database case below,
   * where the tally IS known and every category really is empty.
   */
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

  /*
    ⚠️ CHANGED 2026-11-03 (`docs/169` §5), and the distinction it now draws
    is the point. This used to expect `EXPECTED_STATIC_TOTAL`, i.e. all 23
    category URLs, because they were advertised unconditionally.

    An empty database is NOT the same case as a failed read. Here the tally
    is KNOWN and every category really does hold nothing, so advertising a
    category landing page would be advertising a page with no campaigns on
    it - exactly what the owner's decision removes. A failed read is the
    sibling case above, and it still keeps all 23.

    What this test is FOR has not changed: an empty database must still
    produce a valid, non-empty sitemap rather than throwing or collapsing.
  */
  it('an empty database produces the static pages, and no category URL', async () => {
    state.campaigns = [];
    state.blogPosts = [];
    const { entries } = await runSitemap();

    expect(entries).toHaveLength(STATIC_PAGE_COUNT);
    // Still a real sitemap, which is what this case exists to prove.
    expect(urls(entries)).toContain('https://lastdonor.org');
    expect(urls(entries)).toContain('https://lastdonor.org/campaigns');
    for (const entry of entries) {
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
    // And not one category landing page, because none of them has anything.
    expect(
      urls(entries).filter((u) => u.includes('/campaigns/category/')),
    ).toEqual([]);
  });

  /*
    The pair that makes the two cases above mean something. Without this,
    "empty database drops them" and "failed read keeps them" could both be
    satisfied by a single wrong rule in either direction.
  */
  it('tells an empty tally apart from an unknown one', async () => {
    state.campaigns = [];
    const { entries: known } = await runSitemap();

    state.campaigns = [];
    state.failing = new Set(['campaigns']);
    const { entries: unknown } = await runSitemap();

    const cats = (e: { url: string }[]) =>
      urls(e).filter((u) => u.includes('/campaigns/category/')).length;

    expect(cats(known)).toBe(0);
    expect(cats(unknown)).toBe(ALL_CATEGORY_SLUGS.length);
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

  it('lists all 19 static pages', async () => {
    const { entries } = await runSitemap();
    const listed = urls(entries);
    for (const path of MUST_KEEP) {
      expect(listed, path).toContain(`https://lastdonor.org${path}`);
    }
  });

  /*
    ⚠️ CHANGED 2026-11-03 (`docs/169` §5). This used to require all 23
    category URLs in the same breath as the 19 static ones. They are not the
    same claim: a static page is unconditional, a category page is now
    advertised only while it holds a live campaign. Splitting them is what
    stops the static list quietly losing its guard the next time the category
    rule changes.
  */
  it('still builds a page for every category, advertised or not', () => {
    // The pages are untouched by the advertisement decision -
    // `generateStaticParams` renders all 23 and each answers 200.
    expect(ALL_CATEGORY_SLUGS).toHaveLength(23);
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

  /*
    ⚠️ CHANGED 2026-11-03 (`docs/169` §5). Both of these used to assert the
    EDITORIAL-DATE FALLBACK on a category with no live campaign. That
    fallback is unchanged and still right - what moved is that such a
    category is no longer advertised at all, so there is no entry on the
    healthy path to carry a date.

    The property each one protected is asserted more strongly below: the URL
    is absent rather than present-with-a-conservative-date. The fallback
    itself is still exercised, on the failed-read path where it remains
    reachable.
  */
  it('drops a category whose only campaign is completed', async () => {
    // `memorial` holds ONLY the completed campaign. The category page
    // filters `listedCampaignFilter()` - the live statuses - so that page
    // renders nothing, and a sitemap entry for it would advertise an empty
    // page. This is the discriminating case: a rule keyed on "any campaign"
    // rather than "a LIVE campaign" passes every other test and fails this.
    const { entries } = await runSitemap();
    expect(urls(entries)).not.toContain(
      'https://lastdonor.org/campaigns/category/memorial',
    );
    // And the completed campaign's own URL is still advertised - dropping
    // the category must not drop the campaign.
    expect(urls(entries)).toContain(
      'https://lastdonor.org/campaigns/the-okafor-family-fund',
    );
  });

  it('drops a category with no campaign at all', async () => {
    const { entries } = await runSitemap();
    expect(urls(entries)).not.toContain(
      'https://lastdonor.org/campaigns/category/animal',
    );
  });

  it('keeps a category that has a live campaign, with its derived date', async () => {
    // Anti-vacuity: without this, dropping EVERY category satisfies the two
    // rules above while deleting the whole section.
    const { entries } = await runSitemap();
    const veterans = find(entries, 'https://lastdonor.org/campaigns/category/veterans');
    expect(veterans).toBeDefined();
    expect(veterans?.lastModified).toEqual(new Date('2026-10-01T09:00:00Z'));

    const medical = find(entries, 'https://lastdonor.org/campaigns/category/medical');
    expect(medical).toBeDefined();
  });

  it('still falls back to the editorial date on the path where that is reachable', async () => {
    // The failed-read path keeps every category, so the fallback this
    // suite used to prove on `memorial` is exercised here instead - and a
    // completed campaign still never dates one.
    state.failing = new Set(['campaigns']);
    const { entries } = await runSitemap();
    const memorial = find(entries, 'https://lastdonor.org/campaigns/category/memorial');
    expect(memorial?.lastModified).not.toEqual(new Date('2026-07-01T09:00:00Z'));
    expect(memorial?.lastModified).toEqual(new Date('2026-10-18'));
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

/**
 * The invariant the whole change rests on, checked from BOTH ends.
 *
 * "A category advertised in the sitemap renders at least one campaign on its
 * page." The sitemap decides from `LIVE_SITEMAP_STATUSES`; the page decides
 * from `listedCampaignFilter()`. Nothing connects those two declarations, so
 * if either moves the sitemap starts advertising empty pages - which is the
 * exact defect this change removes, inverted.
 *
 * Derived from source at both ends rather than pinning today's answer
 * (`docs/109`'s shape), so widening either list fails here instead of
 * silently un-fixing the sitemap.
 */
describe('a category is advertised only if its page would list something', () => {
  const SITEMAP_SRC = readFileSync(
    join(__dirname, 'sitemap.ts'),
    'utf8',
  );
  const FILTER_SRC = readFileSync(
    join(__dirname, '../db/public-campaigns.ts'),
    'utf8',
  );

  /** Statuses named inside a `const NAME = [...] as const` declaration. */
  function statusesInConst(src: string, name: string): string[] {
    const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(src);
    if (!m) return [];
    return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  }

  /** Statuses named inside `listedCampaignFilter`'s body. */
  function listedStatuses(): string[] {
    const start = FILTER_SRC.indexOf('export function listedCampaignFilter');
    expect(start, 'listedCampaignFilter not found - rule cannot run').toBeGreaterThan(-1);
    const body = FILTER_SRC.slice(start, FILTER_SRC.indexOf('\n}', start));
    return [...body.matchAll(/campaigns\.status,\s*'([a-z_]+)'/g)]
      .map((x) => x[1])
      .sort();
  }

  it('finds both declarations at all (anti-vacuity)', () => {
    // Two empty arrays would compare equal and prove nothing.
    expect(statusesInConst(SITEMAP_SRC, 'LIVE_SITEMAP_STATUSES').length).toBeGreaterThan(0);
    expect(listedStatuses().length).toBeGreaterThan(0);
  });

  it('the sitemap LIVE statuses equal the statuses the category page lists', () => {
    expect(statusesInConst(SITEMAP_SRC, 'LIVE_SITEMAP_STATUSES')).toEqual(listedStatuses());
  });

  it('the CLOSED statuses are deliberately not among them', () => {
    // `completed` is advertised as a campaign URL and must never make a
    // category look occupied - the category page does not list it.
    const closed = statusesInConst(SITEMAP_SRC, 'CLOSED_SITEMAP_STATUSES');
    expect(closed.length).toBeGreaterThan(0);
    for (const s of closed) {
      expect(listedStatuses(), `${s} must not be listed by the category page`).not.toContain(s);
    }
  });
});

/**
 * The judgement itself, EXECUTED.
 *
 * `advertisedCategorySlugs` is a branch, and a source-reading rule cannot see
 * which way a branch points (`docs/162` §5.1). Inverting it passes every
 * structural check above and fails these.
 */
describe('advertisedCategorySlugs, run directly', () => {
  async function fn() {
    vi.resetModules();
    return (await import('./sitemap')).advertisedCategorySlugs;
  }

  it('returns only the categories present in the tally when it is known', async () => {
    const advertised = await fn();
    expect(
      advertised({
        newestPublished: new Date('2026-10-01'),
        newestByCategory: new Map([['medical', new Date('2026-10-01')]]),
        campaignsLoaded: true,
      }),
    ).toEqual(['medical']);
  });

  it('returns EVERY category when the tally is unknown', async () => {
    const advertised = await fn();
    expect(
      advertised({
        newestPublished: null,
        newestByCategory: new Map(),
        campaignsLoaded: false,
      }),
    ).toEqual(ALL_CATEGORY_SLUGS);
  });

  it('returns none when the tally is known and empty', async () => {
    // The row that separates "known empty" from "unknown". An
    // implementation keying on `newestByCategory.size` collapses the two.
    const advertised = await fn();
    expect(
      advertised({
        newestPublished: null,
        newestByCategory: new Map(),
        campaignsLoaded: true,
      }),
    ).toEqual([]);
  });

  it('never invents a slug that is not a real category', async () => {
    const advertised = await fn();
    const out = advertised({
      newestPublished: null,
      newestByCategory: new Map([['not-a-category', new Date()]]),
      campaignsLoaded: true,
    });
    expect(out).toEqual([]);
  });
});


describe('⛔ every image the sitemap advertises is on OUR domain', () => {
  /*
    The defect: Supabase Storage sends `X-Robots-Tag: none` on every public
    object (Google's own definition of `noindex, nofollow`), and this sitemap
    advertised organiser photos by their raw Supabase URL - announcing them
    at an address Google is told to ignore.

    This asserts the PROPERTY, not the mechanism, so it holds however
    `resolveCampaignHero` is implemented later.
  */
  it('no <image:loc> points off lastdonor.org', async () => {
    const { entries } = await runSitemap();
    const images = entries.flatMap((e) => (e as { images?: string[] }).images ?? []);

    const offDomain = images.filter((u) => !u.startsWith('https://lastdonor.org/'));
    expect(offDomain, `off-domain images: ${offDomain.join(', ')}`).toEqual([]);
  });

  it('⚠️ CONTROL: the campaign WITH a photo is advertised, not skipped', async () => {
    /*
      Without this, emitting no images at all would satisfy the row above -
      and the one campaign that has a real photograph is exactly the one
      whose image we most want indexed.
    */
    const { entries } = await runSitemap();
    const reyes = entries.find((e) => e.url.endsWith('/campaigns/help-sergeant-reyes'));
    const images = (reyes as { images?: string[] } | undefined)?.images ?? [];

    expect(images).toHaveLength(1);
    expect(images[0]).toBe('https://lastdonor.org/media/campaign-photos/aaaa1111.jpg');
    expect(images[0]).not.toMatch(/supabase/i);
  });
});
