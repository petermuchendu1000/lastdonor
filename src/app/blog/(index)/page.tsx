import type { Metadata } from 'next';
import { db } from '@/db';
import { blogPosts } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { BlogCard } from '@/components/blog/BlogCard';
import { seoKeywords } from '@/lib/seo/keywords';

export const revalidate = 300; // ISR: refresh every 5 minutes

export const metadata: Metadata = {
  title: 'Campaign Stories & Impact Updates | LastDonor',
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

const CATEGORIES = [
  { label: 'All', value: null },
  { label: 'Campaign Stories', value: 'campaign_story' },
  { label: 'Impact Reports', value: 'impact_report' },
  { label: 'News', value: 'news' },
] as const;

interface PageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function BlogPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const categoryFilter = CATEGORIES.find(
    (c) => c.value === params.category,
  )?.value;

  const conditions = categoryFilter
    ? and(eq(blogPosts.published, true), eq(blogPosts.category, categoryFilter))
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="font-display text-4xl font-bold text-foreground">
        Stories &amp; Impact
      </h1>
      <p className="mt-2 text-lg text-muted-foreground">
        What happened after the money was raised. Real updates from real campaigns.
      </p>

      {/* Category Tabs */}
      <nav className="mt-8 flex gap-2 overflow-x-auto" aria-label="Blog categories">
        {CATEGORIES.map((cat) => {
          const isActive = categoryFilter === cat.value;
          const href = cat.value
            ? `/blog?category=${cat.value}`
            : '/blog';

          return (
            <a
              key={cat.label}
              href={href}
              className={`inline-flex shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {cat.label}
            </a>
          );
        })}
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
          <p className="text-lg text-muted-foreground">
            No posts published yet. Check back soon.
          </p>
        </div>
      )}
    </div>
  );
}
