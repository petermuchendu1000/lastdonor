import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, donations, auditLogs, fundPoolAllocations, notifications, users } from '@/db/schema';
import { eq, and, sql, lt } from 'drizzle-orm';
import { logError } from '@/lib/errors';
import { verifyCronAuth } from '@/lib/cron-auth';
import { randomUUID } from 'crypto';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron authorization.', requestId } }, { status: 401 });
  }

  // ── Overlap guard (P1-11, docs/26 §4) ──────────────────────────────────
  // TTL is derived from this route's maxDuration; see CRON_LOCKS for this job's
  // lock-backend-unavailable policy and why.
  const lockSpec = CRON_LOCKS['reconcile'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    const results = {
      discrepancies: 0,
      archived: 0,
      fundPoolAlerts: 0,
      echoColumnFixes: 0,
      activeCampaignDrifts: 0,
      errors: [] as string[],
    };

    // 1. Reconcile Stripe totals with DB totals (real donations only)
    const completedCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.status, 'completed'));

    // Batch: get real + seed totals for all completed campaigns in one query
    const campaignIds = completedCampaigns.map((c) => c.id);
    const donationTotals = campaignIds.length > 0
      ? await db
          .select({
            campaignId: donations.campaignId,
            realTotal: sql<number>`coalesce(sum(case when ${donations.source} = 'real' and ${donations.refunded} = false then ${donations.amount} else 0 end), 0)::int`,
            seedTotal: sql<number>`coalesce(sum(case when ${donations.source} = 'seed' and ${donations.refunded} = false then ${donations.amount} else 0 end), 0)::int`,
            donorCount: sql<number>`count(case when ${donations.source} = 'real' and ${donations.refunded} = false then 1 end)::int`,
          })
          .from(donations)
          .where(sql`${donations.campaignId} in ${campaignIds}`)
          .groupBy(donations.campaignId)
      : [];

    const totalsMap = new Map(donationTotals.map((t) => [t.campaignId, t]));

    for (const campaign of completedCampaigns) {
      try {
        const totals = totalsMap.get(campaign.id);
        const realDonationTotal = totals?.realTotal ?? 0;
        const seedTotalAmount = totals?.seedTotal ?? 0;
        const expectedTotal = realDonationTotal + seedTotalAmount;
        const discrepancy = Math.abs(campaign.raisedAmount - expectedTotal);

        if (discrepancy > 100) {
          // More than $1 discrepancy
          results.discrepancies++;

          await db.insert(auditLogs).values({
            eventType: 'reconcile.discrepancy',
            targetType: 'campaign',
            targetId: campaign.id,
            severity: 'warning',
            details: {
              campaignRaisedAmount: campaign.raisedAmount,
              calculatedTotal: expectedTotal,
              realTotal: realDonationTotal,
              seedTotal: seedTotalAmount,
              discrepancy,
            },
          });

          // Auto-correct the campaign total
          await db
            .update(campaigns)
            .set({ raisedAmount: expectedTotal, updatedAt: new Date() })
            .where(eq(campaigns.id, campaign.id));
        }
      } catch (error) {
        results.errors.push(`Reconcile error for campaign ${campaign.id}: ${String(error)}`);
      }
    }

    // 2. Auto-archive campaigns completed > 90 days ago
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const toArchive = await db
      .select({ id: campaigns.id, title: campaigns.title })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.status, 'completed'),
          lt(campaigns.completedAt, ninetyDaysAgo),
        ),
      );

    for (const campaign of toArchive) {
      await db
        .update(campaigns)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));

      results.archived++;
    }

    // 3. Fund Pool health check - alert admin if pending funds exceed $1,000
    const [pendingPool] = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${fundPoolAllocations.amount}), 0)::int`,
      })
      .from(fundPoolAllocations)
      .where(eq(fundPoolAllocations.status, 'pending'));

    if (pendingPool.total > 100_000) {
      results.fundPoolAlerts++;

      // Find admin user for notification
      const [admin] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'))
        .limit(1);

      if (admin) {
        await db.insert(notifications).values({
          userId: admin.id,
          type: 'campaign_status_changed',
          title: 'Fund Pool Alert',
          message: `$${(pendingPool.total / 100).toFixed(2)} in pending fund pool allocations (${pendingPool.count} donations). Review in admin panel.`,
          link: '/admin/simulation/fund-pool',
        });
      }
    }

    // 4. Transaction Salt: Reconcile ALL active campaigns (not just completed)
    // Detects drift caused by non-atomic operations, ORM bugs, or manual DB edits
    const activeCampaignDrifts = await db.execute<{
      id: string;
      slug: string;
      stored: number;
      derived: number;
    }>(sql`
      SELECT c.id, c.slug, c.raised_amount AS stored,
             COALESCE(SUM(d.amount) FILTER (WHERE d.refunded = false), 0)::int AS derived
      FROM campaigns c
      LEFT JOIN donations d ON d.campaign_id = c.id
      WHERE c.status IN ('active', 'last_donor_zone', 'paused')
      GROUP BY c.id
      HAVING c.raised_amount != COALESCE(SUM(d.amount) FILTER (WHERE d.refunded = false), 0)::int
    `);

    for (const row of activeCampaignDrifts) {
      results.activeCampaignDrifts++;

      await db.insert(auditLogs).values({
        eventType: 'reconcile.integrity_drift',
        targetType: 'campaign',
        targetId: row.id,
        severity: 'critical',
        details: {
          slug: row.slug,
          storedRaisedAmount: row.stored,
          derivedRaisedAmount: row.derived,
          drift: Math.abs(row.stored - row.derived),
        },
      });

      // Auto-correct
      await db.update(campaigns)
        .set({ raisedAmount: row.derived, updatedAt: new Date() })
        .where(eq(campaigns.id, row.id));
    }

    // 5. Echo Column Drift: Reconcile pre-computed counter columns
    // Fix message_count, update_count, seed_donation_count if they diverge from actual counts
    const echoFixCount = await db.execute(sql`
      WITH message_counts AS (
        SELECT campaign_id, COUNT(*)::int AS cnt FROM campaign_messages GROUP BY campaign_id
      ),
      update_counts AS (
        SELECT campaign_id, COUNT(*)::int AS cnt FROM campaign_updates GROUP BY campaign_id
      ),
      seed_counts AS (
        SELECT campaign_id, COUNT(*)::int AS cnt FROM donations WHERE source = 'seed' GROUP BY campaign_id
      )
      UPDATE campaigns SET
        message_count = COALESCE(mc.cnt, 0),
        update_count = COALESCE(uc.cnt, 0),
        seed_donation_count = COALESCE(sc.cnt, 0),
        updated_at = NOW()
      FROM campaigns c2
      LEFT JOIN message_counts mc ON mc.campaign_id = c2.id
      LEFT JOIN update_counts uc ON uc.campaign_id = c2.id
      LEFT JOIN seed_counts sc ON sc.campaign_id = c2.id
      WHERE campaigns.id = c2.id
        AND (
          campaigns.message_count != COALESCE(mc.cnt, 0)
          OR campaigns.update_count != COALESCE(uc.cnt, 0)
          OR campaigns.seed_donation_count != COALESCE(sc.cnt, 0)
        )
    `);

    if (echoFixCount && typeof echoFixCount === 'object' && 'count' in echoFixCount) {
      results.echoColumnFixes = Number(echoFixCount.count) || 0;
    }

    // Log completion
    await db.insert(auditLogs).values({
      eventType: 'cron.reconcile',
      severity: results.discrepancies > 0 || results.activeCampaignDrifts > 0 || results.errors.length > 0 ? 'warning' : 'info',
      details: results,
    });

    return NextResponse.json({ ok: true, data: results });
  } catch (error) {
    logError(error, { requestId, route: '/api/v1/cron/reconcile', method: 'GET' });

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Reconciliation processing failed.', requestId } },
      { status: 500 },
    );
  } finally {
    await lock.lock.release();
  }
}
