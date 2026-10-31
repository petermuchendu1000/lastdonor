import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db';
import { blogPosts } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { BlogCard } from '@/components/blog/BlogCard';
import { seoKeywords } from '@/lib/seo/keywords';
import {
  blogCategoryTabs,
  blogEmptyState,
  resolveBlogCategory,
  unappliedCategoryNotice,
} from '@/lib/blog-categories';

/*
  NO `revalidate` HERE, DELIBERATELY.

  This page reads `searchParams`, which makes it dynamic in Next 15 - its
  output depends on the query string, so it cannot be prerendered or
  ISR-cached. It used to carry `export const revalidate = 300` and that line
  was INERT.

  Measured against production on 2026-10-24: this route answers
  `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`,
  while the five `revalidate` pages that do NOT read `searchParams` answer
  `s-maxage=300, stale-while-revalidate=...`. The correlation was exact
  across all ten.

  Same class as the sixteen inert `revalidate` exports docs/88 removed from
  the admin tree: a cache directive that reads as a promise and does nothing.
  `src/app/revalidate-honesty.ratchet.test.ts` fails the build if the two are
  combined again.
*/

export const metadata: Metadata = {
  title: 'Campaign Stories & Impact Updates',
  description:
    'Real stories from reviewed LastDonor campaigns. See who received help, how funds were used, and what happened next. Impact reports from medical, emergency, and family fundraising campaigns.',
  keywords: seoKeywords('trust', 'campaigns', 'medical', 'emergency', 'memorial', 'family'),
  alternates: { canonical: 'https://lastdonor.org/blog' },
  openGraph: {
    title: 'Campaign Stories & Impact Updates | LastDonor',
    description:
      'Real stories from reviewed campaigns. See who got helped and what happened next through impact reports and campaign updates.',
    url: 'https://lastdonor.org/blog',
    images: [
      {
        url: '/api/v1/og/page?title=Campaign+Stories&subtitle=What+happened+after+the+money+was+raised.',
        width: 1200,
        height: 630,
        alt: 'Campaign Stories & Impact Updates on LastDonor',
      },
    ],
  },
};

interface PageProps {
  searchParams: Promise<{ category?: string | string[] }>;
}

export default async function BlogPage({ searchParams }: PageProps) {
  const params = await searchParams;
  /*
    ⛔ ONE resolver, returning a KIND rather than a value.

    This was `CATEGORIES.find((c) => c.value === params.category)?.value`
    against a list whose first entry was `{ label: 'All', value: null }`. An
    absent param is `undefined` and `null === undefined` is false, so the All
    pill was never active on any URL, and an unrecognised value was
    indistinguishable from no filter at all - silently widening the list,
    which `docs/45` forbids. See `src/lib/blog-categories.ts` and `docs/164`.
  */
  const resolved = resolveBlogCategory(params.category);

  const conditions =
    resolved.kind === 'category'
      ? and(eq(blogPosts.published, true), eq(blogPosts.category, resolved.value))
      : eq(blogPosts.published, true);

  const posts = await db
    .select({
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      coverImageUrl: blogPosts.coverImageUrl,
      authorName: blogPosts.authorName,
      category: blogPosts.category,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(conditions)
    .orderBy(desc(blogPosts.publishedAt))
    .limit(50);

  const emptyState = blogEmptyState(resolved);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="font-display text-4xl font-bold text-foreground">
        Stories &amp; Impact
      </h1>
      <p className="mt-2 text-lg text-muted-foreground">
        What happened after the money was raised. Real updates from real campaigns.
      </p>

      {/*
        ⛔ An unapplied filter is REPORTED, never dropped in silence. `docs/45`:
        a list shown unfiltered with the filter pill inert reads as "all of
        these match what you asked for".
      */}
      {/*
        ⛔ `wrap-anywhere` is load-bearing: this sentence quotes a string from
        the URL back to the visitor, and an unbroken one pushes the page
        sideways. Measured here at 36px even with the value capped at 40, so
        the cap is not the whole fix. See `src/lib/reported-value.ts`.
      */}
      {resolved.kind === 'unapplied' && (
        <p
          role="status"
          className="mt-6 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-foreground wrap-anywhere"
        >
          {unappliedCategoryNotice(resolved.raw)}
        </p>
      )}

      {/*
        Category tabs. Which one is active is decided by `blogCategoryTabs`,
        not here - the defect was an active test that was false on every URL,
        and a judgement in JSX cannot be executed by a test.
      */}
      <nav className="mt-8 flex gap-2 relative overflow-x-auto" aria-label="Blog categories">
        {blogCategoryTabs(resolved).map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.isActive ? 'page' : undefined}
            className={`inline-flex shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab.isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {/* Posts Grid */}
      {posts.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <BlogCard key={post.slug} {...post} />
          ))}
        </div>
      ) : (
        <div className="mt-16 text-center">
          {/*
            ⚠️ Decided by `blogEmptyState`, because "No posts published yet"
            is a claim about the WHOLE BLOG and is false under a filter the
            moment any other category holds a post (`docs/123`: 0 published
            rows ever, so it is latent).
          */}
          <p className="text-lg text-muted-foreground">{emptyState.message}</p>
          {emptyState.showAllLink && (
            <Link
              href="/blog"
              className="mt-4 inline-block text-sm font-medium text-primary underline"
            >
              See every story
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
