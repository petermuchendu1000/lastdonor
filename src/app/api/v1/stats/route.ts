import { NextResponse } from 'next/server';
import { db } from '@/db';
import { donations, campaigns } from '@/db/schema';
import { sql, eq, and, inArray } from 'drizzle-orm';
import { completedCampaignFilter } from '@/db/public-campaigns';

export const revalidate = 300;

export async function GET() {
  try {
    const [stats] = await db
      .select({
        totalRaised: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
        totalDonors: sql<number>`count(distinct ${donations.donorEmail})::int`,
      })
      .from(donations)
      .where(and(eq(donations.source, 'real'), eq(donations.refunded, false)));

    const [completed] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaigns)
      /*
        ⛔ `COMPLETED_STATUSES`, not `['completed','archived']`. This is a
        PUBLIC response, and with the old set it published
        `campaignsCompleted: 1` beside `peopleSupported: 0` - one
        completed campaign that supported nobody, in a single payload.
        [VERIFIED live before the fix.] The one archived row is a PayHero
        test campaign that reached a tenth of its goal and has no
        `completed_at`. See docs/146.
      */
      .where(completedCampaignFilter());

    const [active] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(inArray(campaigns.status, ['active', 'last_donor_zone']));

    const [supported] = await db
      .select({ count: sql<number>`count(distinct ${campaigns.subjectName})::int` })
      .from(campaigns)
      .where(eq(campaigns.status, 'completed'));

    const data = {
      totalRaised: stats.totalRaised,
      totalDonors: stats.totalDonors,
      campaignsCompleted: completed.count,
      campaignsActive: active.count,
      peopleSupported: supported.count,
    };

    return NextResponse.json(
      { ok: true, data },
      {
        headers: {
          'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    console.error('[stats] Failed to fetch platform stats:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load statistics' } },
      { status: 500 },
    );
  }
}
