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

          // Auto-correct the campaign total. total_released_amount MUST be
          // clamped in the same statement: if the corrected figure lands below
          // what has already been released, the
          // `campaigns_released_lte_raised` CHECK fires and the UPDATE throws.
          await db
            .update(campaigns)
            .set({
              raisedAmount: expectedTotal,
              totalReleasedAmount: sql`LEAST(${campaigns.totalReleasedAmount}, ${expectedTotal})`,
              updatedAt: new Date(),
            })
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

    /*
      4. Transaction Salt: `raised_amount` against the donations that
      justify it. Catches drift from non-atomic writes, ORM bugs and
      manual edits, and auto-corrects it.

      ── Why it filters on no status at all ───────────────────────────

      It used to read `status IN ('active', 'last_donor_zone',
      'paused')`. That was true when it was written and silently became
      false: docs/79 gated both creation paths to `under_review`, so by
      2026-10-18 every campaign on the platform was in a status this
      check did not look at. A financial integrity control was running
      against an empty set every night, and nothing said so. Same shape
      as docs/83 - a thing stopped covering anything as a side effect of
      work in another file.

      The first fix replaced that with an exclusion list of `completed`
      and `archived`, reasoning that funds may already have been
      released against the stored figure, so a silent rewrite is the
      wrong default, and that step 1 audits completed campaigns
      instead. **That reasoning was wrong.** Step 1 does not merely
      audit: it auto-corrects, with the same `LEAST` clamp this loop
      uses (see step 1 above). So excluding `completed` protected
      nothing, and excluding `archived` left it covered by neither step
      - no audit and no correction, for a status that can hold real
      money. There are now no exclusions.

      What the two steps actually are:

        step 1  `completed` only, drift > $1, logs
                `reconcile.discrepancy` AND corrects.
        step 4  every status, ANY drift, logs
                `reconcile.integrity_drift` AND corrects.

      Step 1 runs first, so a completed campaign with a large drift is
      corrected there and re-derived as clean here: no double
      correction and no duplicate audit row. What step 4 adds is the
      sub-dollar drift step 1 tolerates, and every status step 1 never
      looked at.

      Correcting an archived or completed campaign is as safe as
      correcting any other: `total_released_amount` is clamped in the
      same statement, so a corrected figure can never fall below what
      has already been released and trip
      `campaigns_released_lte_raised`.
    */
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
      GROUP BY c.id
      HAVING c.raised_amount != COALESCE(SUM(d.amount) FILTER (WHERE d.refunded = false), 0)::int
    `);

    // Per-row try/catch, same as step 1. Without it a single failing row threw
    // out of this loop, 500'd the whole job and meant step 5 never ran - every
    // run, on the same row, for good. The clamp below is what used to throw.
    for (const row of activeCampaignDrifts) {
      try {
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

        // Auto-correct, clamping released so the corrected raised figure can
        // never fall below it and trip `campaigns_released_lte_raised`.
        await db.update(campaigns)
          .set({
            raisedAmount: row.derived,
            totalReleasedAmount: sql`LEAST(${campaigns.totalReleasedAmount}, ${row.derived})`,
            updatedAt: new Date(),
          })
          .where(eq(campaigns.id, row.id));
      } catch (error) {
        results.errors.push(`Drift correction error for campaign ${row.id}: ${String(error)}`);
      }
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
