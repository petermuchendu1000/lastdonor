import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { blogPosts } from '@/db/schema';
import { eq, and, desc, ne } from 'drizzle-orm';
import { ArticleRenderer } from '@/components/blog/ArticleRenderer';
import { AuthorBio } from '@/components/blog/AuthorBio';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { BlogCard } from '@/components/blog/BlogCard';
import { Badge } from '@/components/ui/badge';
import { ShareButtons } from '@/components/campaign/ShareButtons';
import { formatDate } from '@/lib/utils/dates';
import { buildArticleJsonLd } from '@/lib/blog/geo-optimizer';
import { seoKeywords } from '@/lib/seo/keywords';
import Image from 'next/image';

const CATEGORY_LABELS: Record<string, string> = {
  campaign_story: 'Campaign Story',
  impact_report: 'Impact Report',
  news: 'News',
};

const CAUSE_CATEGORY_LABELS: Record<string, string> = {
  medical: 'Medical',
  disaster: 'Disaster Relief',
  military: 'Military',
  veterans: 'Veterans',
  memorial: 'Memorial',
  funeral: 'Funeral',
  community: 'Community',
  'essential-needs': 'Essential Needs',
  education: 'Education',
  emergency: 'Emergency',
  faith: 'Faith & Religion',
  animal: 'Animals',
  'mental-health': 'Mental Health',
  addiction: 'Recovery',
  elderly: 'Elderly Care',
  housing: 'Housing',
  family: 'Family',
  justice: 'Justice',
  environment: 'Environment',
  sports: 'Sports',
  creative: 'Creative Arts',
  wishes: 'Wishes',
  'first-responders': 'First Responders',
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = 120;

export async function generateStaticParams() {
  // Fail soft - see the note in campaigns/[slug]/page.tsx. `revalidate = 120`
  // renders each post on first request when nothing is pre-rendered.
  try {
    const rows = await db
      .select({ slug: blogPosts.slug })
      .from(blogPosts)
      .where(eq(blogPosts.published, true));
    return rows.map((r) => ({ slug: r.slug }));
  } catch (err) {
    console.warn(
      '[build] generateStaticParams(blog): database unreachable, ' +
        'pre-rendering no blog posts; they will render on demand.',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [post] = await db
    .select({
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      coverImageUrl: blogPosts.coverImageUrl,
      metaTitle: blogPosts.metaTitle,
      metaDescription: blogPosts.metaDescription,
      primaryKeyword: blogPosts.primaryKeyword,
      secondaryKeywords: blogPosts.secondaryKeywords,
    })
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.published, true)))
    .limit(1);

  if (!post) return { title: 'Post Not Found' };

  const title = post.metaTitle ?? post.title;
  const description = post.metaDescription ?? post.excerpt ?? `Read "${post.title}" on LastDonor.org`;

  const keywords = [
    ...(post.primaryKeyword ? [post.primaryKeyword] : []),
    ...(Array.isArray(post.secondaryKeywords) ? (post.secondaryKeywords as string[]) : []),
  ];

  return {
    title,
    description,
    keywords: keywords.length > 0 ? keywords : seoKeywords('campaigns', 'trust'),
    alternates: {
      canonical: `https://lastdonor.org/blog/${slug}`,
    },
    openGraph: {
      title,
      description,
      images: post.coverImageUrl
        ? [{ url: post.coverImageUrl, width: 1200, height: 630, alt: post.title }]
        : [
            {
              url: `/api/v1/og/page?title=${encodeURIComponent(post.title)}&subtitle=${encodeURIComponent(post.excerpt ?? 'A story from LastDonor.org')}`,
              width: 1200,
              height: 630,
              alt: post.title,
            },
          ],
      type: 'article',
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;

  const [post] = await db
    .select()
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.published, true)))
    .limit(1);

  // Soft 404: answers 200, not 404. See docs/80 - `noStore()` here was
  // tried and reverted, it 500s under on-demand ISR generation.
  if (!post) notFound();

  // Related posts: same category, exclude current, up to 3
  const related = await db
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
    .where(
      and(
        eq(blogPosts.published, true),
        eq(blogPosts.category, post.category),
        ne(blogPosts.id, post.id),
      ),
    )
    .orderBy(desc(blogPosts.publishedAt))
    .limit(3);

  const articleUrl = `https://lastdonor.org/blog/${post.slug}`;

  const faqEntries = Array.isArray(post.faqData)
    ? (post.faqData as Array<{ question: string; answer: string }>)
    : undefined;

  const keywords = [
    ...(post.primaryKeyword ? [post.primaryKeyword] : []),
    ...(Array.isArray(post.secondaryKeywords) ? (post.secondaryKeywords as string[]) : []),
  ];

  const readingTime = post.wordCount ? Math.max(1, Math.ceil(post.wordCount / 225)) : null;

  // Use cause category label when available (richer than blog_category enum)
  const displayCategory = post.causeCategory
    ? (CAUSE_CATEGORY_LABELS[post.causeCategory] ?? post.causeCategory.replace(/-/g, ' '))
    : (CATEGORY_LABELS[post.category] ?? post.category);

  const jsonLdArray = buildArticleJsonLd({
    title: post.title,
    description: post.excerpt ?? '',
    slug: post.slug,
    coverImageUrl: post.coverImageUrl,
    publishedAt: post.publishedAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: post.updatedAt?.toISOString(),
    wordCount: post.wordCount ?? 0,
    category: post.category,
    keywords,
    faqData: faqEntries,
  });

  return (
    <>
      {jsonLdArray.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />

        {post.coverImageUrl && (
          <div className="mt-6 overflow-hidden rounded-xl">
            <Image
              src={post.coverImageUrl}
              alt={post.title}
              width={1200}
              height={630}
              priority
              className="h-auto w-full object-cover"
            />
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <Badge variant="outline" className="text-xs">
            {displayCategory}
          </Badge>
          {readingTime && (
            <span className="text-sm text-muted-foreground">
              {readingTime} min read
            </span>
          )}
          {post.publishedAt && (
            <time
              dateTime={post.publishedAt.toISOString()}
              className="text-sm text-muted-foreground"
            >
              {formatDate(post.publishedAt)}
            </time>
          )}
        </div>

        <h1 className="mt-4 font-display text-3xl font-bold text-foreground sm:text-4xl">
          {post.title}
        </h1>

        <div className="mt-8">
          <ArticleRenderer html={post.bodyHtml} />
        </div>

        <div className="mt-8">
          <ShareButtons url={articleUrl} title={post.title} />
        </div>

        <div className="mt-8">
          <AuthorBio name={post.authorName} bio={post.authorBio} />
        </div>

        {/* Related Posts */}
        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-2xl font-bold text-foreground">
              Related Stories
            </h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <BlogCard key={r.slug} {...r} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
