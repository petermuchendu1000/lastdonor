import type { MetadataRoute } from 'next';
import { db } from '@/db';
import { blogPosts } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

const BASE_URL = 'https://lastdonor.org';

/**
 * `/blog/sitemap.xml`.
 *
 * ── Why `revalidate` is load-bearing here ─────────────────────────────────
 *
 * Without it, Next renders this route ONCE during `next build` and freezes the
 * result into the image for the life of that deploy. The build is deliberately
 * hermetic - `src/db/build-phase.ts` resolves a failed read to zero rows and
 * `Dockerfile` makes the database URL an optional build secret - so the file
 * was generated against an EMPTY database and then served, 200 and well-formed,
 * listing nothing, until the next deploy. Verified 2026-10-15: this route
 * exported neither `revalidate` nor `dynamic`, which is the same defect found
 * in `src/app/sitemap.ts` (see docs/46 §2) and the reason zero `/blog/<slug>`
 * URLs were ever published.
 *
 * `build-phase.ts` reasons that a build-time empty read is safe "because every
 * one of these routes sets `revalidate`" and so fills in on first request.
 * That assumption is only true if the route actually does. Any new route that
 * reads the database during build must set it.
 *
 * ── Why a database failure returns [] instead of throwing ────────────────
 *
 * A thrown error here makes `/blog/sitemap.xml` a 500. An empty sitemap and a
 * 500 are both "no URLs", but the 500 is also an error in Search Console and
 * retried aggressively. This is a narrow exception to the usual rule that a
 * SERVING instance must fail loudly (`build-phase.ts`): it applies to a
 * crawler-facing, read-only, non-money route, and must not be copied to
 * anything that takes payment or sends mail.
 *
 * ── Why these URLs are also in the root sitemap ──────────────────────────
 *
 * `src/app/sitemap.ts` lists published blog posts too, and `src/app/robots.ts`
 * advertises ONLY `/sitemap.xml`, so this route is reachable but unadvertised.
 * A URL may legally appear in several sitemaps, but two entries for one URL
 * with DIFFERENT `priority`/`changeFrequency` send a crawler contradictory
 * hints, so the values below are kept identical to the root sitemap's blog
 * section on purpose. If one is changed, change both - or retire this route in
 * favour of the root sitemap, which is the simpler end state.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let posts: {
    slug: string;
    publishedAt: Date | null;
    updatedAt: Date | null;
    coverImageUrl: string | null;
  }[];

  try {
    posts = await db
      .select({
        slug: blogPosts.slug,
        publishedAt: blogPosts.publishedAt,
        updatedAt: blogPosts.updatedAt,
        coverImageUrl: blogPosts.coverImageUrl,
      })
      .from(blogPosts)
      .where(eq(blogPosts.published, true))
      .orderBy(desc(blogPosts.publishedAt));
  } catch (err) {
    console.error(
      '[blog/sitemap] blog posts could not be read; serving an empty sitemap:',
      err,
    );
    return [];
  }

  return posts.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    // `updatedAt` first so an edited post gets a re-crawl signal; `publishedAt`
    // alone reports the original date forever. Falls through to `undefined`,
    // never `new Date()`: "now" would make every regeneration claim every post
    // had just changed, which trains the crawler to ignore the field.
    lastModified: post.updatedAt ?? post.publishedAt ?? undefined,
    // Kept identical to the root sitemap's blog section, as above.
    changeFrequency: 'monthly' as const,
    priority: 0.5,
    ...(post.coverImageUrl ? { images: [post.coverImageUrl] } : {}),
  }));
}
