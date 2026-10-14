import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { campaigns, auditLogs } from '@/db/schema';
import { and, inArray, eq } from 'drizzle-orm';
import { isOrganizerUpdateDue, generateOrganizerUpdate } from '@/lib/seed/organizer-generator';
import { logError } from '@/lib/errors';
import { verifyCronAuth } from '@/lib/cron-auth';
import { randomUUID } from 'crypto';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Cron handler: schedule organizer updates for active campaigns.
 *
 * Phase transitions and completion are handled exclusively by the
 * simulation-engine (via the simulate-donations cron).  This cron
 * focuses only on generating mid-campaign organizer updates every
 * 3-7 days to keep campaign pages alive between phase transitions.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron authorization.', requestId } }, { status: 401 });
  }

  // ── Overlap guard (P1-11, docs/26 §4) ──────────────────────────────────
  // TTL is derived from this route's maxDuration; see CRON_LOCKS for this job's
  // lock-backend-unavailable policy and why.
  const lockSpec = CRON_LOCKS['update-phases'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    const activeCampaigns = await db
      .select()
      .from(campaigns)
      .where(
        and(
          inArray(campaigns.status, ['active', 'last_donor_zone']),
          eq(campaigns.simulationFlag, true),
        ),
      );

    let updatesGenerated = 0;
    const errors: string[] = [];

    for (const campaign of activeCampaigns) {
      if (!campaign.campaignOrganizer) continue;

      try {
        const due = await isOrganizerUpdateDue(campaign.id);
        if (due) {
          await generateOrganizerUpdate(campaign);
          updatesGenerated++;
        }
      } catch (error) {
        const msg = `Organizer update failed for ${campaign.id}: ${String(error)}`;
        errors.push(msg);
        console.error(msg);
      }
    }

    if (updatesGenerated > 0 || errors.length > 0) {
      await db.insert(auditLogs).values({
        eventType: 'cron.update_phases',
        severity: errors.length > 0 ? 'warning' : 'info',
        details: {
          campaignsChecked: activeCampaigns.length,
          updatesGenerated,
          errors,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      data: { campaignsChecked: activeCampaigns.length, updatesGenerated, errors },
    });
  } catch (error) {
    logError(error, { requestId, route: '/api/v1/cron/update-phases', method: 'GET' });

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Phase update processing failed.', requestId } },
      { status: 500 },
    );
  } finally {
    await lock.lock.release();
  }
}
