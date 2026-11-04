import type { MetadataRoute } from 'next';
import { brandGraphicPath, brandGraphicsFor } from '@/lib/brand-graphics';
import { resolveCampaignHero } from '@/lib/campaign-hero';
import { db } from '@/db';
import { campaigns, blogPosts } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { and, notInArray } from 'drizzle-orm';
import { PLATFORM_FUND_CAMPAIGN_IDS } from '@/db/public-campaigns';
import { ALL_CATEGORY_SLUGS } from '@/lib/category-content';

const BASE_URL = 'https://lastdonor.org';

/**
 * The last time the EDITORIAL copy of the static pages was intentionally
 * changed. Hand-maintained on purpose - see the note on `staticSitemap`.
 *
 * Bumped 2026-10-18 from `2026-04-27`. It had not been touched while the
 * landing page was rebuilt section by section through October: the navbar
 * (docs/48), hero (docs/49, docs/53), cards and the six-into-two section
 * merge (docs/51), the campaign listing (docs/55), the steps section
 * (docs/56), the fee ledger (docs/59), the category grid (docs/60), the FAQ
 * collapse (docs/61), the campaign row (docs/62), the how-it-works stepper
 * (docs/63), the trust bar (docs/64), the footer (docs/69) and the icon
 * system (docs/70). Every one of those changed the copy a crawler reads,
 * and the sitemap went on declaring April.
 *
 * **When you intentionally change static-page copy, change this date in the
 * same commit.** A stale `lastmod` is a request not to re-crawl.
 */
const SEO_CONTENT_LAST_MODIFIED = new Date('2026-10-18');

/**
 * Regenerate hourly. This line is the whole fix for the defect recorded in
 * docs/46, and it is not a performance tweak.
 *
 * Without it the sitemap is a fully static route: Next renders it ONCE during
 * `next build` and the output never changes again for the life of the image.
 * The build is deliberately hermetic (`src/db/build-phase.ts`), so a database
 * read that fails during the build resolves to ZERO ROWS instead of throwing -
 * and `Dockerfile` makes the `database_url` build secret optional. Those two
 * facts together meant the shipped sitemap was generated against an empty
 * database and then frozen: observed live 2026-10-15, `/sitemap.xml` served
 * the static and category pages and not one `/campaigns/<slug>` or
 * `/blog/<slug>` URL. The only pages that can accept money were invisible to
 * search engines, permanently, with no error anywhere.
 *
 * `revalidate` is what the 24 other database-backed routes use for exactly
 * this reason, and `src/db/build-phase.ts` says so in as many words ("the
 * route pre-renders empty and fills in on first request, because every one of
 * these routes sets `revalidate`"). The sitemap was simply not one of them.
 *
 * One hour, not 60s like `/campaigns/[slug]`: a sitemap is crawler input, not
 * a user-facing page, and crawlers refetch it on their own schedule. Google's
 * own guidance is that `lastmod` and sitemap freshness are hints, so a
 * new campaign is discoverable within the hour either way, at one query per
 * hour per instance rather than one per minute.
 */
export const revalidate = 3600;

/**
 * Campaign statuses that belong in a sitemap.
 *
 * This is deliberately the SAME set as `isIndexable` in
 * `src/app/campaigns/[slug]/page.tsx:211`, which is what decides
 * `robots: { index }` on the page itself. The detail route serves 200 for
 * `paused`, `suspended` and `cancelled` too, but marks them `noindex` - and a
 * URL that is both submitted in a sitemap and served with `noindex` is a
 * direct contradiction that Google reports as "Submitted URL marked
 * noindex". The two lists must therefore move together; if you add a status
 * here, change `isIndexable` in the same commit.
 *
 *   - `active`, `last_donor_zone`: live and donatable. The reason the sitemap
 *     exists.
 *   - `completed`: funded and closed, still a public record and still useful
 *     to a searcher. Listed at low priority with a monthly change frequency.
 *
 * Excluded, and why: `draft` and `under_review` are not public at all (the
 * detail query does not even return them, so they would be sitemap entries
 * resolving to 404); `archived` is excluded for a DIFFERENT reason since
 * 2026-10-27 - it is now served with a closed notice (`docs/118` §9), so it is
 * no longer a 404, but a closed appeal is not something to advertise to search
 * engines and `isIndexable` keeps it `noindex`; `paused` is a temporary state
 * whose page tells the visitor to come back; `suspended` and `cancelled` are
 * trust-and-safety outcomes - advertising a suspended appeal to search
 * engines would be the platform soliciting traffic to a fundraiser it has
 * itself stopped trusting. See docs/46.
 */
const LIVE_SITEMAP_STATUSES = ['active', 'last_donor_zone'] as const;
const CLOSED_SITEMAP_STATUSES = ['completed'] as const;

/**
 * Static and category URLs. These need no database, so they are the floor the
 * sitemap degrades to.
 *
 * ⚠️ **A CATEGORY WITH NO LIVE CAMPAIGN IS NO LONGER ADVERTISED.** Owner
 * decision 2026-11-03 (`docs/169` §5), REVERSING the one recorded in
 * `docs/46` and re-affirmed in `docs/144`. The superseded reasoning is kept
 * here because it was not wrong, it was outweighed:
 *
 *   - each page renders its own editorial copy from `category-content.ts`,
 *     so it is a real landing page and not thin by accident;
 *   - they answer 200 whether or not they hold campaigns;
 *   - dropping a URL from a sitemap does not deindex it, it only stops
 *     declaring a `lastmod`;
 *   - and gating on a live count makes the advertised set FLAP as campaigns
 *     open and close, which is worse for crawl budget than a stable list.
 *
 * What outweighed it: Search Console measured this domain on 2026-11-03 with
 * **60 URLs known and zero indexed**, four of them "Crawled - currently not
 * indexed". **17 of the 23 category pages hold nothing.** On a domain whose
 * crawl budget is visibly not being spent on the pages that matter,
 * advertising 17 near-empty URLs is a cost with no measured benefit. The
 * flapping objection is accepted as a real cost of this change.
 *
 * ⛔ The pages themselves are UNTOUCHED - `generateStaticParams` still builds
 * all 23 and every one still answers 200. This changes advertisement only.
 *
 * ⛔ And it is NOT paired with `noindex`. A URL both submitted in a sitemap
 * and served `noindex` is the contradiction `campaign-visibility.ts` names;
 * a URL that is merely unadvertised is not in that bind, and `noindex`ing
 * these would be a second, larger decision.
 *
 * ── Why some of these dates are derived and others are not ───────────
 *
 * Added 2026-10-18. Every URL here used to carry one hand-maintained
 * constant, including the pages whose content is a list of campaigns. That
 * is a contradiction a crawler can see: `/campaigns/category/medical`
 * declared `changeFrequency: daily` and a `lastmod` six months old.
 *
 * So the pages whose content IS the campaign set now derive their date from
 * that set, and only the pages whose content is editorial copy keep the
 * constant.
 *
 * The derived date is the newest `publishedAt`, NOT the newest `updatedAt`.
 * `updatedAt` moves when a maintenance job touches a row - `cron/reconcile`
 * step 5 sets `updated_at = NOW()` on any campaign whose echo counters
 * drift - and a listing page has not changed because a counter was
 * repaired. `publishedAt` moves when a campaign goes live, which is exactly
 * when these pages change. (The per-campaign URLs below still use
 * `updatedAt`, because for one campaign's own page an edit IS the change
 * worth re-crawling; that trade-off is noted there too.)
 */
/**
 * Which category landing pages this sitemap advertises.
 *
 * A PURE function, exported, because the judgement is a branch and **text
 * cannot see which way a branch points** - the lesson `docs/162` §5.1 paid
 * for and `docs/164` repeated. A test that reads this file as source would
 * pass against an inverted condition; a test that EXECUTES this cannot.
 *
 * ⛔ **`campaignsLoaded` is the whole safety of this function, and it is not
 * the same question as "is the map empty".** `NO_DERIVED_DATES` carries an
 * empty map because the campaign read FAILED, and `sitemap()`'s own comment
 * says the dates must then "fall back to the editorial constant rather than
 * disappearing". A bare `newestByCategory.has(slug)` would drop all 23 URLs
 * on any database failure - turning a degraded sitemap into a much smaller
 * one, which is the opposite of what the fail-soft is for.
 *
 * So: **absence of data is not evidence of emptiness.** Same rule as
 * `docs/106` ("a MISSING trusted name is 'cannot judge', never 'no
 * mismatch'") and `docs/159` ("`keepPolling === false`, never
 * `!keepPolling`"). Zero live campaigns on a platform that really has none
 * is a different fact from not having asked.
 *
 * ⚠️ The membership test is **`LIVE` statuses only**, which is what makes
 * this safe: `newestByCategory` is built at `:~300` from
 * `LIVE_SITEMAP_STATUSES` with a non-null `publishedAt`, while the category
 * page filters `listedCampaignFilter()` - the same two statuses, minus the
 * `publishedAt` requirement. The sitemap's test is therefore strictly
 * NARROWER than the page's, so an advertised category always renders at
 * least one card. It can under-advertise; it can never advertise an empty
 * page. A category holding only `completed` campaigns is correctly dropped,
 * because that page shows the live set and a completed campaign is not on it.
 */
export function advertisedCategorySlugs(
  dates: DerivedDates,
): readonly string[] {
  if (!dates.campaignsLoaded) return ALL_CATEGORY_SLUGS;
  return ALL_CATEGORY_SLUGS.filter((slug) => dates.newestByCategory.has(slug));
}

/**
 * A sitemap image URL must be absolute. A campaign hero is either an
 * organiser upload (already absolute) or a site-relative brand panel.
 */
function absoluteImage(src: string): string {
  return /^https?:\/\//i.test(src) ? src : `${BASE_URL}${src}`;
}

function staticSitemap(dates: DerivedDates): MetadataRoute.Sitemap {
  // A category with no live campaign has no campaign-driven date, so it
  // falls back to the editorial constant rather than claiming freshness.
  // (Reachable only when `campaignsLoaded` is false - see
  // `advertisedCategorySlugs`, which otherwise filters such a slug out.)
  const categoryDate = (slug: string) =>
    dates.newestByCategory.get(slug) ?? SEO_CONTENT_LAST_MODIFIED;
  const listingDate = dates.newestPublished ?? SEO_CONTENT_LAST_MODIFIED;
  const staticPages: MetadataRoute.Sitemap = [
    // Every date here must be deterministic - never `new Date()`. A lastmod
    // that moves on every regeneration tells Google the page changes hourly
    // and devalues the signal for the pages that actually did change.
    //
    // The homepage takes `listingDate` because its content is largely the
    // campaign row (docs/62); its editorial copy changing is covered by
    // SEO_CONTENT_LAST_MODIFIED moving too, since that is bumped by hand in
    // the same commit as a copy change.
    { url: BASE_URL, lastModified: listingDate, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/about`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/how-it-works`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/transparency`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/campaigns`, lastModified: listingDate, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/compare`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/completed-campaigns`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/blog`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/last-donor-wall`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/donate`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/share-your-story`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/editorial-standards`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE_URL}/donor-faq`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/campaign-verification-policy`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE_URL}/fund-release-policy`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE_URL}/campaign-rules`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE_URL}/refund-policy`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/privacy`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE_URL}/terms`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.2 },
  ];

  const categoryPages: MetadataRoute.Sitemap = advertisedCategorySlugs(dates).map(
    (slug) => ({
      url: `${BASE_URL}/campaigns/category/${slug}`,
      lastModified: categoryDate(slug),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    }),
  );

  /*
    Attach each page's brand graphics as sitemap <image:image> entries.

    An image sitemap is the only mechanism that tells Google which images
    belong to a URL, rather than leaving it to find them while rendering. The
    pairing is DERIVED from the registry, so moving a graphic to another page
    moves its sitemap entry with it and cannot leave a stale one behind
    (docs/171).
  */
  const withGraphics: MetadataRoute.Sitemap = staticPages.map((entry) => {
    const path = entry.url.replace(BASE_URL, '') || '/';
    const graphics = brandGraphicsFor(path);
    if (graphics.length === 0) return entry;
    return { ...entry, images: graphics.map((g) => `${BASE_URL}${brandGraphicPath(g.slug)}`) };
  });

  return [...withGraphics, ...categoryPages];
}

/**
 * Run one database-backed section, degrading to no URLs on failure.
 *
 * A sitemap route that throws returns 500, and a 500 on `/sitemap.xml` is not
 * a degraded sitemap - it is no sitemap, which is strictly worse than a
 * sitemap of the static pages alone. The per-section granularity is
 * deliberate: a failure reading blog posts should not also cost us the
 * campaign URLs.
 *
 * Note this is NOT the build-phase fail-soft in `src/db/build-phase.ts`. That
 * one is keyed on `NEXT_PHASE` and inert at runtime, by design, because a
 * serving instance that cannot reach Postgres must fail loudly. The exception
 * argued here is narrow and specific to this route: nothing a crawler does
 * with a short sitemap is irreversible, and `revalidate` means the next
 * regeneration an hour later repairs it with no deploy. See docs/46.
 */
async function sitemapSection<T>(
  name: string,
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    console.error(
      `[sitemap] ${name} could not be read; serving the sitemap without it:`,
      err,
    );
    return fallback;
  }
}

/**
 * Dates the static section borrows from the campaign section.
 *
 * These come out of the campaign query that already runs - no extra round
 * trip. That matters: the three-concurrent-query cap (CLAUDE.md, docs/87
 * amendment 5) is a hard budget on a `max: 5` pool, and this route is
 * allowed two. Adding a `SELECT max(published_at) GROUP BY category` would
 * have spent the third for data already in hand.
 */
type DerivedDates = {
  /** Newest `publishedAt` across every live campaign, or null if none. */
  newestPublished: Date | null;
  /** Newest `publishedAt` per category slug, live campaigns only. */
  newestByCategory: Map<string, Date>;
  /**
   * Did the campaign query actually run?
   *
   * ⛔ Load-bearing, and NOT derivable from `newestByCategory.size`. An empty
   * map means "no category has a live campaign" when this is true, and "we
   * never found out" when it is false - two facts a size check collapses
   * into one. `advertisedCategorySlugs` is the consumer that must tell them
   * apart, because the wrong answer silently removes 23 URLs.
   */
  campaignsLoaded: boolean;
};

const NO_DERIVED_DATES: DerivedDates = {
  newestPublished: null,
  newestByCategory: new Map(),
  campaignsLoaded: false,
};

async function campaignSitemap(): Promise<{
  urls: MetadataRoute.Sitemap;
  dates: DerivedDates;
}> {
  const rows = await db
    .select({
      slug: campaigns.slug,
      status: campaigns.status,
      category: campaigns.category,
      heroImageUrl: campaigns.heroImageUrl,
      updatedAt: campaigns.updatedAt,
      publishedAt: campaigns.publishedAt,
    })
    .from(campaigns)
    .where(
      and(
        inArray(campaigns.status, [
          ...LIVE_SITEMAP_STATUSES,
          ...CLOSED_SITEMAP_STATUSES,
        ]),
        /*
          ⛔ The platform's own general fund is NOT advertised as a campaign
          URL (`docs/147`). It holds a live status because that is the only
          way `payhero/initiate` will collect for it, and this query filters
          on STATUS ALONE - so without this it would submit
          `/campaigns/<its slug>` to Google while the page itself requires
          `published_at IS NOT NULL` (`docs/131`) and answers 404.

          `/donate` is already advertised here as a static route, which is the
          URL that fund actually has.
        */
        notInArray(campaigns.id, [...PLATFORM_FUND_CAMPAIGN_IDS]),
      ),
    );

  // Only LIVE campaigns feed the listing and category dates: those pages
  // show the live set, and a `completed` campaign is not on them.
  const dates: DerivedDates = {
    newestPublished: null,
    newestByCategory: new Map<string, Date>(),
    // Set here, after the await resolved. `sitemapSection` hands back
    // `NO_DERIVED_DATES` (false) when this function threw, so the flag means
    // exactly "these rows are what the database says".
    campaignsLoaded: true,
  };
  for (const c of rows) {
    if (!(LIVE_SITEMAP_STATUSES as readonly string[]).includes(c.status)) continue;
    if (!c.publishedAt) continue;
    if (!dates.newestPublished || c.publishedAt > dates.newestPublished) {
      dates.newestPublished = c.publishedAt;
    }
    const current = dates.newestByCategory.get(c.category);
    if (!current || c.publishedAt > current) {
      dates.newestByCategory.set(c.category, c.publishedAt);
    }
  }

  const urls = rows.map((c) => {
    const isLive = (LIVE_SITEMAP_STATUSES as readonly string[]).includes(c.status);
    return {
      url: `${BASE_URL}/campaigns/${c.slug}`,
      /*
        The image the page REALLY renders, resolved through the one decider
        (docs/170) rather than the stored column: for most campaigns that is
        the brand panel, not the third-party photograph the column still
        holds. Advertising the stored URL would point Google at somebody
        else's domain for an image our page does not show.
      */
      images: [absoluteImage(resolveCampaignHero({
        heroImageUrl: c.heroImageUrl,
        category: c.category,
        title: c.slug,
      }).src)],
      // `updatedAt` is `notNull().defaultNow()` (`schema.ts`), so it is always
      // a real date; `publishedAt` is the fallback only in case a row predates
      // that default. Never `new Date()` - a lastmod that changes on every
      // regeneration tells Google every campaign changed every hour and
      // devalues the signal for the ones that actually did.
      //
      // Known imprecision, accepted: `updatedAt` also moves when a
      // maintenance job writes to the row - `cron/reconcile` step 5 sets
      // `updated_at = NOW()` on echo-counter drift. For ONE campaign's own
      // page an edit is genuinely the thing worth re-crawling, so
      // `updatedAt` is still the right column here; the listing and
      // category pages use `publishedAt` precisely to avoid inheriting
      // this. Since docs/89 the counters are maintained at the source and
      // reconcile should now find nothing, so the churn should be rare.
      lastModified: c.updatedAt ?? c.publishedAt ?? SEO_CONTENT_LAST_MODIFIED,
      changeFrequency: isLive ? ('daily' as const) : ('monthly' as const),
      priority: isLive ? 0.8 : 0.3,
    };
  });

  return { urls, dates };
}

async function blogSitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await db
    .select({ slug: blogPosts.slug, publishedAt: blogPosts.publishedAt, updatedAt: blogPosts.updatedAt })
    .from(blogPosts)
    .where(eq(blogPosts.published, true));

  return posts.map((p) => ({
    url: `${BASE_URL}/blog/${p.slug}`,
    // Use updatedAt so edited posts receive re-crawl priority signals.
    // publishedAt alone reports the original publish date forever, causing
    // Google to treat edited content as never updated.
    lastModified: p.updatedAt ?? p.publishedAt ?? undefined,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [campaignResult, blogPages] = await Promise.all([
    sitemapSection('campaigns', campaignSitemap, { urls: [], dates: NO_DERIVED_DATES }),
    sitemapSection('blog posts', blogSitemap, [] as MetadataRoute.Sitemap),
  ]);

  // If the campaign read failed, the derived dates fall back to the
  // editorial constant rather than disappearing - a sitemap with honest
  // static dates is still a sitemap.
  return [
    ...staticSitemap(campaignResult.dates),
    ...campaignResult.urls,
    ...blogPages,
  ];
}
