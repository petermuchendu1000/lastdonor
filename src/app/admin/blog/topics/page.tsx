import { db } from '@/db';
import { blogTopicQueue } from '@/db/schema';
import { desc, count } from 'drizzle-orm';
import { TopicQueueList } from '@/components/admin/TopicQueueList';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog Topic Queue - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AdminBlogTopicsPage() {
  /* Select only the columns the UI needs */
  const [topics, statusCounts] = await Promise.all([
    db
      .select({
        id: blogTopicQueue.id,
        title: blogTopicQueue.title,
        slug: blogTopicQueue.slug,
        primaryKeyword: blogTopicQueue.primaryKeyword,
        causeCategory: blogTopicQueue.causeCategory,
        priorityScore: blogTopicQueue.priorityScore,
        seasonalBoost: blogTopicQueue.seasonalBoost,
        status: blogTopicQueue.status,
        newsHook: blogTopicQueue.newsHook,
        createdAt: blogTopicQueue.createdAt,
        generatedPostId: blogTopicQueue.generatedPostId,
      })
      .from(blogTopicQueue)
      .orderBy(desc(blogTopicQueue.priorityScore))
      .limit(200),
    db
      .select({
        status: blogTopicQueue.status,
        count: count(),
      })
      .from(blogTopicQueue)
      .groupBy(blogTopicQueue.status),
  ]);

  const counts: Record<string, number> = { total: 0 };
  for (const row of statusCounts) {
    const n = Number(row.count);
    counts.total += n;
    counts[row.status] = n;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Blog topic queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage AI-generated blog topics. Approve, reject, or manually add topics.
      </p>
      <div className="mt-6">
        <TopicQueueList
          topics={topics.map((t) => ({
            id: t.id,
            title: t.title,
            slug: t.slug,
            primaryKeyword: t.primaryKeyword,
            causeCategory: t.causeCategory,
            priorityScore: t.priorityScore,
            seasonalBoost: t.seasonalBoost,
            status: t.status,
            newsHook: t.newsHook,
            createdAt: t.createdAt.toISOString(),
            generatedPostId: t.generatedPostId,
          }))}
          counts={counts}
        />
      </div>
    </div>
  );
}
