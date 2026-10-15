import type { MetadataRoute } from 'next';
import { db } from '@/db';
import { campaigns, blogPosts } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { ALL_CATEGORY_SLUGS } from '@/lib/category-content';

const BASE_URL = 'https://lastdonor.org';
const SEO_CONTENT_LAST_MODIFIED = new Date('2026-04-27');

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
 * resolving to 404); `archived` likewise; `paused` is a temporary state whose
 * page tells the visitor to come back; `suspended` and `cancelled` are
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
 * All 23 category landing pages stay listed even when a category currently
 * holds no campaign. They are not thin by accident: each one renders its own
 * editorial copy from `src/lib/category-content.ts` and is a real landing
 * page, they return 200 whether or not they have campaigns, and dropping a URL
 * from a sitemap does not deindex it anyway - it only stops declaring a
 * `lastmod`. Gating them on a live campaign count would also make the set of
 * listed URLs flap as campaigns open and close, which is worse for crawl
 * budget than a stable list. Decision recorded in docs/46.
 */
function staticSitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    // lastModified must be a deterministic date representing the last intentional
    // content change, not new Date(). A perpetually-changing lastmod causes Google
    // to treat the homepage as constantly mutating, wasting crawl budget and
    // creating a temporal contradiction when content is actually stable under ISR.
    // Update this value whenever the homepage copy, H1, or schema is intentionally changed.
    { url: BASE_URL, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/about`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/how-it-works`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/transparency`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/campaigns`, lastModified: SEO_CONTENT_LAST_MODIFIED, changeFrequency: 'daily', priority: 0.9 },
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

  const categoryPages: MetadataRoute.Sitemap = ALL_CATEGORY_SLUGS.map((slug) => ({
    url: `${BASE_URL}/campaigns/category/${slug}`,
    lastModified: SEO_CONTENT_LAST_MODIFIED,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...categoryPages];
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
async function sitemapSection(
  name: string,
  load: () => Promise<MetadataRoute.Sitemap>,
): Promise<MetadataRoute.Sitemap> {
  try {
    return await load();
  } catch (err) {
    console.error(
      `[sitemap] ${name} could not be read; serving the sitemap without it:`,
      err,
    );
    return [];
  }
}

async function campaignSitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await db
    .select({
      slug: campaigns.slug,
      status: campaigns.status,
      updatedAt: campaigns.updatedAt,
      publishedAt: campaigns.publishedAt,
    })
    .from(campaigns)
    .where(
      inArray(campaigns.status, [
        ...LIVE_SITEMAP_STATUSES,
        ...CLOSED_SITEMAP_STATUSES,
      ]),
    );

  return rows.map((c) => {
    const isLive = (LIVE_SITEMAP_STATUSES as readonly string[]).includes(c.status);
    return {
      url: `${BASE_URL}/campaigns/${c.slug}`,
      // `updatedAt` is `notNull().defaultNow()` (`schema.ts`), so it is always
      // a real date; `publishedAt` is the fallback only in case a row predates
      // that default. Never `new Date()` - a lastmod that changes on every
      // regeneration tells Google every campaign changed every hour and
      // devalues the signal for the ones that actually did.
      lastModified: c.updatedAt ?? c.publishedAt ?? SEO_CONTENT_LAST_MODIFIED,
      changeFrequency: isLive ? ('daily' as const) : ('monthly' as const),
      priority: isLive ? 0.8 : 0.3,
    };
  });
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
  const [campaignPages, blogPages] = await Promise.all([
    sitemapSection('campaigns', campaignSitemap),
    sitemapSection('blog posts', blogSitemap),
  ]);

  return [...staticSitemap(), ...campaignPages, ...blogPages];
}
