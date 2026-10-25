import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { verifyCronAuth } from '@/lib/cron-auth';
import { acquireCronLock, CRON_LOCKS, lockSkipPayload } from '@/lib/locks';
import { logError } from '@/lib/errors';
import { notifyVerificationConsequence } from '@/lib/notifications';
import { formatMoney } from '@/lib/money/format';
import { isSupportedCurrency } from '@/lib/money/currencies';
import { capMinor, type ReminderLevel } from '@/lib/verification-reminders';
import {
  recordReminderRun,
  recordReminderSent,
  selectDueReminders,
} from '@/lib/verification-reminders.server';

export const dynamic = 'force-dynamic';

/*
  300, matching this job's lock TTL (`src/lib/locks.ts`) - `locks.test.ts`
  asserts the two agree, so a route that can outlive its own lock cannot
  ship. Up to MAX_SENDS_PER_RUN sequential Resend calls, each with two
  retries, does not fit in 60 seconds.
*/
export const maxDuration = 300;

/**
 * Tell organisers of live, unverified campaigns what is blocked. Daily at
 * 09:00 UTC (`src/lib/cron-schedule.ts`).
 *
 * -- WHAT THIS DOES NOT DO ---------------------------------------------------
 *
 * It does not count days, quote a deadline, or say anything about money being
 * sent back. It picks the one true statement about the campaign right now and
 * sends that, at most once per statement for the life of the campaign.
 *
 * (STOP) The four emails already in the codebase could not be used. Every one
 * of them opens with "reached its goal N days ago" and three threaten to
 * return the donations. [VERIFIED 2026-10-25, by enumerating every refund
 * call site] no mechanism sends money back on a clock - all refunds are
 * admin-initiated - and the campaigns this job finds have usually reached no
 * goal. The reasoning is in `src/lib/verification-reminders.ts`.
 *
 * Who is due one, and the send-once ledger, live in
 * `verification-reminders.server.ts` so that an integration test can execute
 * the queries. This handler is the loop and the mail.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();

  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron authorization.', requestId } },
      { status: 401 },
    );
  }

  const lockSpec = CRON_LOCKS['verification-reminders'];
  const lock = await acquireCronLock(lockSpec);
  if (!lock.ok) {
    return NextResponse.json(lockSkipPayload(lockSpec, lock.reason));
  }

  try {
    const { considered, due, deferred } = await selectDueReminders(new Date());

    const sent: { level: ReminderLevel; emailed: boolean }[] = [];

    for (const row of due) {
      const result = await notifyVerificationConsequence({
        creatorId: row.creatorId,
        creatorEmail: row.creatorEmail,
        creatorName: row.creatorName,
        campaignId: row.campaignId,
        campaignTitle: row.campaignTitle,
        level: row.level,
        capLabel: money(capMinor(row.currency), row.currency),
        raisedLabel: money(row.realRaisedMinor, row.currency),
        goalLabel: money(row.goalMinor, row.currency),
      });

      await recordReminderSent({
        row,
        emailed: result?.emailed ?? false,
        notificationCreated: result !== null,
      });

      sent.push({ level: row.level, emailed: result?.emailed ?? false });
    }

    await recordReminderRun({ considered, sent, deferred });

    const levels: Record<string, number> = {};
    for (const s of sent) levels[s.level] = (levels[s.level] ?? 0) + 1;

    return NextResponse.json({
      ok: true,
      data: {
        considered,
        sent: sent.length,
        emailed: sent.filter((s) => s.emailed).length,
        deferred,
        levels,
        requestId,
      },
    });
  } catch (err) {
    logError(err, { requestId, route: 'cron/verification-reminders' });
    await db.insert(auditLogs).values({
      eventType: 'cron.verification_reminders_failed',
      targetType: 'campaign',
      severity: 'error',
      details: { message: err instanceof Error ? err.message : String(err) },
    }).catch(() => { /* the audit write must not mask the original failure */ });

    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Verification reminders failed.', requestId } },
      { status: 500 },
    );
  } finally {
    await lock.lock.release();
  }
}

/**
 * Format a figure, or give an empty string.
 *
 * An unpriceable currency reaches no level that quotes a cap (`trueLevel`
 * returns null before any cap comparison), so the empty string is only ever
 * rendered into a sentence that does not use it. It is still returned rather
 * than thrown on, because one row in an exotic currency must not end a sweep
 * over every live campaign.
 */
function money(minor: number | null, currency: string): string {
  if (minor === null || !Number.isFinite(minor)) return '';
  if (!isSupportedCurrency(currency)) return '';
  return formatMoney(minor, currency, 'exact');
}
