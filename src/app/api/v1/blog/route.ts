import { NextResponse } from 'next/server';
import { db } from '@/db';
import { blogPosts } from '@/db/schema';
import { eq, and, desc, lt } from 'drizzle-orm';
import { withApiHandler } from '@/lib/api-handler';
import { parsePagination } from '@/lib/api-helpers';
import { MAX_REPORTED_VALUE_LENGTH, resolveBlogCategory } from '@/lib/blog-categories';

/*
  ⛔ The category list is NOT restated here. This file used to hold its own
  copy - one of EIGHT hand-written copies of a three-value database enum
  across seven files, none derived from `blogCategoryEnum`.
*/

export const GET = withApiHandler(async (request) => {
  const { searchParams } = request.nextUrl;
  const categoryParam = searchParams.get('category');
  const cursor = searchParams.get('cursor');
  const { limit } = parsePagination(searchParams, { defaultLimit: 10 });

  /*
    ⛔ An unrecognised category is REPORTED, not dropped. This read
    `VALID_CATEGORIES.includes(x) ? eq(...) : null`, so a caller asking for a
    category we do not have received every post with `ok: true` and nothing
    saying their filter had been ignored - `docs/45`'s rule, which was made
    for `/campaigns` and never swept here. `docs/164`.

    ⚠️ The casts are gone too: `resolveBlogCategory` narrows, so the column
    comparison no longer needs `as BlogCategory` to typecheck. A cast is what
    let the string in.
  */
  const resolved = resolveBlogCategory(categoryParam);

  const publishedFilter = eq(blogPosts.published, true);
  const conditions =
    resolved.kind === 'category'
      ? and(publishedFilter, eq(blogPosts.category, resolved.value))
      : publishedFilter;

  const results = await db
    .select({
      id: blogPosts.id,
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
      cursor
        ? and(conditions, lt(blogPosts.id, cursor))
        : conditions,
    )
    .orderBy(desc(blogPosts.publishedAt))
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return NextResponse.json(
    {
      ok: true,
      data,
      meta: {
        cursor: nextCursor,
        hasMore,
        // Additive, and present only when there is something to report, so a
        // caller reading `meta.cursor`/`meta.hasMore` is unaffected.
        ...(resolved.kind === 'unapplied'
          ? { unappliedCategory: resolved.raw.slice(0, MAX_REPORTED_VALUE_LENGTH) }
          : {}),
      },
    },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
  );
}, { skipAuth: true });
