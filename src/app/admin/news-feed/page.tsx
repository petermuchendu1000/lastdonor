import { db } from '@/db';
import { newsItems } from '@/db/schema';
import { desc, count } from 'drizzle-orm';
import { NewsFeedMonitor } from '@/components/admin/NewsFeedMonitor';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'News Feed - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function NewsFeedPage() {
  /* Select only the columns the UI needs - excludes heavy articleBody */
  const items = await db
    .select({
      id: newsItems.id,
      title: newsItems.title,
      url: newsItems.url,
      source: newsItems.source,
      summary: newsItems.summary,
      category: newsItems.category,
      relevanceScore: newsItems.relevanceScore,
      campaignCreated: newsItems.campaignCreated,
      publishedAt: newsItems.publishedAt,
      fetchedAt: newsItems.fetchedAt,
    })
    .from(newsItems)
    .orderBy(desc(newsItems.fetchedAt))
    .limit(200);

  const [sourcesResult, categoriesResult, statusCounts] = await Promise.all([
    db
      .selectDistinct({ source: newsItems.source })
      .from(newsItems)
      .orderBy(newsItems.source),
    db
      .selectDistinct({ category: newsItems.category })
      .from(newsItems)
      .orderBy(newsItems.category),
    db
      .select({
        campaignCreated: newsItems.campaignCreated,
        count: count(),
      })
      .from(newsItems)
      .groupBy(newsItems.campaignCreated),
  ]);

  const sources = sourcesResult.map((r) => r.source);
  const categories: string[] = categoriesResult
    .map((r) => r.category)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const counts = {
    total: 0,
    withCampaign: 0,
    pending: 0,
  };
  for (const row of statusCounts) {
    const n = Number(row.count);
    counts.total += n;
    if (row.campaignCreated) counts.withCampaign = n;
    else counts.pending = n;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">News feed</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Monitor incoming news articles and convert them to campaigns.
      </p>
      <div className="mt-6">
        <NewsFeedMonitor
          items={items.map((item) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            source: item.source,
            summary: item.summary,
            category: item.category,
            relevanceScore: item.relevanceScore,
            campaignCreated: item.campaignCreated,
            publishedAt: item.publishedAt?.toISOString() ?? null,
            fetchedAt: item.fetchedAt.toISOString(),
          }))}
          sources={sources}
          categories={categories}
          counts={counts}
        />
      </div>
    </div>
  );
}
