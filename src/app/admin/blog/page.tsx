import { db } from '@/db';
import { auth } from '@/lib/auth';
import { blogPosts } from '@/db/schema';
import { desc, count } from 'drizzle-orm';
import { BlogPostsList } from '@/components/admin/BlogPostsList';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog Posts - Admin - LastDonor.org',
  robots: { index: false },
};

export default async function AdminBlogPage() {
  /*
    `src/app/admin/layout.tsx:30` admits `editor` as well as `admin`, and this
    page is deliberately reachable by one: `blog` GET/POST and `blog/[id]` GET/PATCH all admit `['admin','editor']`,
    so an editor may write and publish here. `DELETE /api/v1/admin/blog/[id]`
    is `['admin']`, so the Delete control is gated.
    So the role is read once here and gates that control alone. `docs/134`.
  */
  const session = await auth();
  const isAdmin = session?.user?.role === 'admin';

  /* Select only the columns the UI needs - excludes heavy bodyHtml, faqData, etc. */
  const [rows, statusCounts] = await Promise.all([
    db
      .select({
        id: blogPosts.id,
        title: blogPosts.title,
        slug: blogPosts.slug,
        category: blogPosts.category,
        authorName: blogPosts.authorName,
        published: blogPosts.published,
        publishedAt: blogPosts.publishedAt,
        createdAt: blogPosts.createdAt,
      })
      .from(blogPosts)
      .orderBy(desc(blogPosts.createdAt))
      .limit(200),
    db
      .select({
        published: blogPosts.published,
        count: count(),
      })
      .from(blogPosts)
      .groupBy(blogPosts.published),
  ]);

  const counts = { total: 0, published: 0, draft: 0 };
  for (const row of statusCounts) {
    const n = Number(row.count);
    counts.total += n;
    if (row.published) counts.published = n;
    else counts.draft = n;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Blog posts</h1>
      <p className="mt-1 text-sm text-muted-foreground">Manage blog content - create, edit, and publish articles.</p>
      <div className="mt-6">
        <BlogPostsList
          isAdmin={isAdmin}
          initialPosts={rows.map((p) => ({
            ...p,
            createdAt: p.createdAt.toISOString(),
            publishedAt: p.publishedAt?.toISOString() ?? null,
          }))}
          counts={counts}
        />
      </div>
    </div>
  );
}
