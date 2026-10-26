import { NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, donations } from '@/db/schema';
import { eq, desc, lt, and, gt } from 'drizzle-orm';
import { withApiHandler } from '@/lib/api-handler';
import { parsePagination, redactAnonymousDonor } from '@/lib/api-helpers';

export const GET = withApiHandler(async (request, { params }) => {
  const slug = params!.slug;
  const { searchParams } = request.nextUrl;
  const { limit } = parsePagination(searchParams);
  const cursor = searchParams.get('cursor');
  const afterId = searchParams.get('after');

  const conditions = [eq(campaigns.slug, slug)];

  if (cursor) {
    conditions.push(lt(donations.id, cursor));
  }

  if (afterId) {
    const [refDonation] = await db
      .select({ createdAt: donations.createdAt })
      .from(donations)
      .where(eq(donations.id, afterId))
      .limit(1);

    if (refDonation) {
      conditions.push(gt(donations.createdAt, refDonation.createdAt));
    }
  }

  const results = await db
    .select({
      id: donations.id,
      donorName: donations.donorName,
      donorLocation: donations.donorLocation,
      amount: donations.amount,
      // Minor units of THIS row's currency (`docs/92`). The feed renders it,
      // and without this every poll replaced shillings with dollars.
      currency: donations.currency,
      message: donations.message,
      isAnonymous: donations.isAnonymous,
      createdAt: donations.createdAt,
    })
    .from(donations)
    .innerJoin(campaigns, eq(donations.campaignId, campaigns.id))
    .where(and(...conditions))
    .orderBy(desc(donations.createdAt))
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const data = hasMore ? results.slice(0, limit) : results;
  const nextCursor = hasMore ? data[data.length - 1].id : undefined;

  return NextResponse.json({
    ok: true,
    data: data.map(redactAnonymousDonor),
    meta: { cursor: nextCursor, hasMore },
  });
}, { skipAuth: true });
