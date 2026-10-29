import { NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { eq, and, or, desc, asc, sql, ilike, gte, inArray } from 'drizzle-orm';
import { COMPLETED_STATUSES } from '@/lib/campaign-visibility';
import { createCampaignSchema } from '@/lib/validators/campaign';
import { sanitizeHtml } from '@/lib/utils/sanitize';
import { withApiHandler } from '@/lib/api-handler';
import { campaignSearchCondition } from '@/lib/campaign-search';
import {
  parsePagination,
  paginatedResponse,
  parseBody,
  requireAuthRole,
  isValidCategory,
  resolveSortOrder,
} from '@/lib/api-helpers';

const SORT_MAP = {
  most_funded: desc(campaigns.raisedAmount),
  least_funded: asc(campaigns.raisedAmount),
  closing_soon: desc(sql`(${campaigns.raisedAmount}::float / NULLIF(${campaigns.goalAmount}, 0))`),
  newest: desc(campaigns.publishedAt),
};

export const GET = withApiHandler(async (request, { requestId: _requestId }) => {
  const { searchParams } = request.nextUrl;
  const { limit, offset } = parsePagination(searchParams);
  const categoryParam = searchParams.get('category');
  const sortParam = searchParams.get('sort');

  // Build filters
  /*
    `status=completed` selects a MODE, not a status value: it is what
    `/completed-campaigns` passes through `CampaignGrid`'s `extraParams` for
    its "Load more" requests. So the mode's predicate must be the same one
    that page's first query uses, which is `COMPLETED_STATUSES`.

    ⛔ This was a hardcoded `eq(campaigns.status, 'completed')` - a THIRD
    definition of completed, on the continuation path of the very page whose
    disagreement with the `/campaigns` badge was docs/146. It agreed with the
    other two only because the set happens to hold one value: adding a status
    to the constant would have made page 1 and "Load more" list different
    things, which is the reported defect one level down.
  */
  const statusParam = searchParams.get('status');
  const statusFilter = statusParam === 'completed'
    ? inArray(campaigns.status, [...COMPLETED_STATUSES])
    : or(eq(campaigns.status, 'active'), eq(campaigns.status, 'last_donor_zone'))!;

  const filterParts = [statusFilter];

  if (isValidCategory(categoryParam)) {
    filterParts.push(eq(campaigns.category, categoryParam));
  }

  // Same shared predicate the /campaigns page uses, so "Load More" cannot
  // return a different result set than the first page. See docs/45.
  const keywordCondition = campaignSearchCondition(searchParams.get('q'));
  if (keywordCondition) {
    filterParts.push(keywordCondition);
  }

  const locationParam = searchParams.get('location')?.trim().slice(0, 100);
  if (locationParam) {
    const locPattern = `%${locationParam}%`;
    filterParts.push(
      or(
        ilike(campaigns.location, locPattern),
        ilike(campaigns.subjectHometown, locPattern),
      )!,
    );
  }

  if (searchParams.get('close_to_target') === '1') {
    filterParts.push(
      gte(
        sql`(${campaigns.raisedAmount}::float / NULLIF(${campaigns.goalAmount}, 0))`,
        0.9,
      ),
    );
  }

  const primaryOrder = resolveSortOrder(sortParam, SORT_MAP, 'newest');

  const results = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      slug: campaigns.slug,
      status: campaigns.status,
      heroImageUrl: campaigns.heroImageUrl,
      category: campaigns.category,
      location: campaigns.location,
      subjectName: campaigns.subjectName,
      subjectHometown: campaigns.subjectHometown,
      campaignOrganizer: campaigns.campaignOrganizer,
      goalAmount: campaigns.goalAmount,
      raisedAmount: campaigns.raisedAmount,
      /*
        ⛔ WITHOUT THIS, "Load more" ON /campaigns RENDERS IN DOLLARS.

        `CampaignGrid` requires `currency` on every item (its `CampaignData`
        says so) and appends the rows this route returns. It parses them with
        `json.data as CampaignData[]` - an UNCHECKED CAST - so the compiler
        believed the shape and `currency` arrived `undefined`, falling through
        to `<Money>`'s USD default.

        Reproduced in a browser on an all-KES fixture: the 12 server-rendered
        cards read `Ksh 18,400`, and the 5 appended by one click of "Load
        more" read `$12,350`. Same campaigns, same rows, different currency.
        `campaigns-listing-shape.test.ts` now derives the required keys from
        `CampaignGrid.tsx` and fails if this select misses any of them, so
        the NEXT field to go missing is caught too (`docs/92`, `docs/104`).
      */
      currency: campaigns.currency,
      donorCount: campaigns.donorCount,
      publishedAt: campaigns.publishedAt,
    })
    .from(campaigns)
    .where(and(...filterParts))
    .orderBy(primaryOrder, asc(campaigns.id))
    .offset(offset)
    .limit(limit + 1);

  const response = paginatedResponse(results, limit, offset);

  // Add cache headers for public listing
  response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  return response;
});

export const POST = withApiHandler(async (request, { requestId, session }) => {
  const authResult = requireAuthRole(session, ['editor', 'admin'], requestId);
  if ('error' in authResult) return authResult.error;

  const bodyResult = await parseBody(request, createCampaignSchema, requestId);
  if ('error' in bodyResult) return bodyResult.error;

  const data = bodyResult.data;

  // Check for slug uniqueness
  const [existing] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.slug, data.slug))
    .limit(1);

  if (existing) {
    const { apiError } = await import('@/lib/errors');
    return apiError('CONFLICT', 'A campaign with this slug already exists', requestId, {
      field: 'slug',
    });
  }

  const sanitizedStoryHtml = sanitizeHtml(data.storyHtml);

  const [campaign] = await db
    .insert(campaigns)
    .values({
      title: data.title,
      slug: data.slug,
      category: data.category,
      heroImageUrl: data.heroImageUrl,
      photoCredit: data.photoCredit ?? null,
      subjectName: data.subjectName,
      subjectHometown: data.subjectHometown ?? null,
      storyHtml: sanitizedStoryHtml,
      /*
        ⛔ The currency a campaign raises in, and the ONLY moment it can be
        chosen. `donations` carries a composite FK onto
        `campaigns (id, currency)`, so once any money arrives this column
        cannot change (`docs/92`) - and the update route's `updateValues`
        allowlist deliberately omits it.

        It was omitted here entirely until 2026-10-26, so every campaign
        this route ever created took the `'USD'` column default
        (`docs/116` §3).
      */
      currency: data.currency,
      goalAmount: data.goalAmount,
      impactTiers: data.impactTiers,
      status: data.status,
      publishedAt: data.status === 'active' ? new Date() : null,
    })
    .returning();

  return NextResponse.json({ ok: true, data: campaign }, { status: 201 });
});
