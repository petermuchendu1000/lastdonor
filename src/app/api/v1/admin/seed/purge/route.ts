import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { db } from '@/db';
import { donations, campaignSeedMessages, campaigns, auditLogs } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function POST(_request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'Seed purge is disabled in production' } },
      { status: 403 },
    );
  }

  const requestId = randomUUID();

  try {
    const session = await requireRole(['admin']);

    // 1. Count seed data before purge
    const [seedDonationStats] = await db
      .select({
        count: sql<number>`count(*)::int`,
        totalAmount: sql<number>`coalesce(sum(${donations.amount}), 0)::int`,
      })
      .from(donations)
      .where(eq(donations.source, 'seed'));

    const [seedMessageStats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaignSeedMessages);

    // 2. Delete seed donations
    await db.delete(donations).where(eq(donations.source, 'seed'));

    // 3. Delete seed messages
    await db.delete(campaignSeedMessages);

    // 4. Recalculate all campaign totals from remaining real donations in a single batch query
    await db.execute(sql`
      UPDATE campaigns SET
        raised_amount = sub.total_amount,
        -- Clamped in the SAME statement. Without this a single fully-verified
        -- campaign (total_released_amount == raised_amount) trips the
        -- campaigns_released_lte_raised CHECK and 500s the entire purge,
        -- because this is one batch UPDATE over every campaign.
        total_released_amount = LEAST(campaigns.total_released_amount, sub.total_amount),
        donor_count = sub.donor_count,
        updated_at = NOW()
      FROM (
        SELECT
          c.id AS campaign_id,
          COALESCE(SUM(CASE WHEN d.refunded = false THEN d.amount ELSE 0 END), 0)::int AS total_amount,
          COUNT(CASE WHEN d.refunded = false THEN 1 END)::int AS donor_count
        FROM campaigns c
        LEFT JOIN donations d ON d.campaign_id = c.id
        GROUP BY c.id
      ) sub
      WHERE campaigns.id = sub.campaign_id
        AND (campaigns.raised_amount != sub.total_amount OR campaigns.donor_count != sub.donor_count)
    `);

    // Also reset seed_donation_count echo column to 0 for all campaigns
    await db.update(campaigns)
      .set({ seedDonationCount: 0, updatedAt: new Date() })
      .where(sql`${campaigns.seedDonationCount} > 0`);

    // 5. Audit log
    const purged = {
      donations: seedDonationStats.count,
      donationAmount: seedDonationStats.totalAmount,
      messages: seedMessageStats.count,
    };

    await db.insert(auditLogs).values({
      eventType: 'admin.seed_purge',
      actorId: session.user.id,
      actorRole: 'admin',
      severity: 'warning',
      details: { purged },
    });

    return NextResponse.json({ ok: true, data: { purged } });
  } catch (error) {
    if (error instanceof Error && (error.name === 'UnauthorizedError' || error.name === 'ForbiddenError')) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: error.name === 'UnauthorizedError' ? 'UNAUTHORIZED' : 'FORBIDDEN',
            message: error.message,
            requestId,
          },
        },
        { status: error.name === 'UnauthorizedError' ? 401 : 403 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to purge seed data',
          requestId,
        },
      },
      { status: 500 },
    );
  }
}
