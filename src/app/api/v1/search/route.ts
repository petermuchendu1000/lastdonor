import { NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, blogPosts } from '@/db/schema';
import { eq, and, or, desc, ilike } from 'drizzle-orm';
import { listedCampaignFilter } from '@/db/public-campaigns';
import { withApiHandler } from '@/lib/api-handler';
import { isValidCategory } from '@/lib/api-helpers';
import { apiError } from '@/lib/errors';

const MAX_RESULTS_PER_TYPE = 6;

export const GET = withApiHandler(async (request, { requestId }) => {
  const { searchParams } = request.nextUrl;
  const rawQuery = searchParams.get('q')?.trim() ?? '';
  const categoryParam = searchParams.get('category');

  if (rawQuery.length < 2) {
    return apiError('VALIDATION_ERROR', 'Search query must be at least 2 characters.', requestId);
  }
  if (rawQuery.length > 100) {
    return apiError('VALIDATION_ERROR', 'Search query must be at most 100 characters.', requestId);
  }

  // Escape LIKE wildcards in user input to prevent pattern injection
  const escapedQuery = rawQuery.replace(/[%_\\]/g, '\\$&');
  const pattern = `%${escapedQuery}%`;

  // ⛔ A LISTING: searching for "fund" must not surface the platform's own
  // general fund among people's appeals (docs/147).
  const campaignStatusFilter = listedCampaignFilter();

  const campaignTextFilter = or(
    ilike(campaigns.title, pattern),
    ilike(campaigns.subjectName, pattern),
    ilike(campaigns.location, pattern),
    ilike(campaigns.subjectHometown, pattern),
  )!;

  const categoryFilter = isValidCategory(categoryParam)
    ? eq(campaigns.category, categoryParam)
    : null;

  const campaignConditions = categoryFilter
    ? and(campaignStatusFilter, campaignTextFilter, categoryFilter)!
    : and(campaignStatusFilter, campaignTextFilter)!;

  const blogTextFilter = or(
    ilike(blogPosts.title, pattern),
    ilike(blogPosts.excerpt, pattern),
    ilike(blogPosts.authorName, pattern),
  )!;

  const blogConditions = and(
    eq(blogPosts.published, true),
    blogTextFilter,
  )!;

  const [campaignResults, blogResults] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        title: campaigns.title,
        slug: campaigns.slug,
        category: campaigns.category,
        subjectName: campaigns.subjectName,
        heroImageUrl: campaigns.heroImageUrl,
        location: campaigns.location,
        raisedAmount: campaigns.raisedAmount,
        goalAmount: campaigns.goalAmount,
        status: campaigns.status,
      })
      .from(campaigns)
      .where(campaignConditions)
      .orderBy(desc(campaigns.publishedAt))
      .limit(MAX_RESULTS_PER_TYPE),

    db
      .select({
        id: blogPosts.id,
        title: blogPosts.title,
        slug: blogPosts.slug,
        excerpt: blogPosts.excerpt,
        authorName: blogPosts.authorName,
        category: blogPosts.category,
        coverImageUrl: blogPosts.coverImageUrl,
      })
      .from(blogPosts)
      .where(blogConditions)
      .orderBy(desc(blogPosts.publishedAt))
      .limit(MAX_RESULTS_PER_TYPE),
  ]);

  return NextResponse.json(
    { ok: true, data: { campaigns: campaignResults, blogPosts: blogResults } },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
  );
}, { skipAuth: true });
