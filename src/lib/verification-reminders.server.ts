import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { auditLogs, campaigns, users } from '@/db/schema';
import { realRaisedMinorSql } from '@/db/real-raised';
import {
  COLLECTING_STATUSES,
  dueReminder,
  type ReminderLevel,
} from '@/lib/verification-reminders';

/**
 * The database half of the reminder ladder: who is due one, and the ledger
 * that stops them getting it twice.
 *
 * ── WHY THIS IS NOT IN THE ROUTE ────────────────────────────────────────────
 *
 * So that a test can run it. `docs/107` is a doc about a page that answered
 * **500 on every load** while lint, typecheck, 6,855 unit tests and nine
 * ratchets were green, because its query lived inline in a server component
 * and nothing executed it. `docs/101` is the same shape: a `sql` template
 * that returned 0 for every row, valid SQL, no error, cap silently disabled.
 *
 * ⚠️ A unit test cannot catch either class. `verification-reminders.ts` holds
 * the rules and is tested directly; this file holds the queries and is tested
 * against a real Postgres by `verification-reminders.integration.test.ts`.
 * Those are different risks and they need different tests.
 *
 * The route is then a loop over what this returns, which is also why the
 * route stays inside the three-concurrent-query ceiling
 * (`src/db/pool-fanout.ratchet.test.ts`): two sequential reads here, then
 * sequential writes.
 */

/** The audit event that IS the send-once ledger. */
export const REMINDER_AUDIT_EVENT = 'verification_reminder.sent';

/**
 * How many organisers one run will mail.
 *
 * A ceiling, not a target. The candidate set is every live campaign, and the
 * first run after a backlog accumulates must not become a hundred sequential
 * Resend calls inside one request holding a connection against a pool of five
 * (`docs/87`). Candidates are ordered oldest-published first, so a campaign
 * deferred today is at the front tomorrow and nobody is permanently last.
 */
export const MAX_SENDS_PER_RUN = 25;

export interface DueReminderRow {
  campaignId: string;
  campaignTitle: string;
  creatorId: string;
  creatorEmail: string;
  creatorName: string;
  level: ReminderLevel;
  currency: string;
  realRaisedMinor: number;
  goalMinor: number;
  verificationStatus: string;
}

export interface ReminderSelection {
  /** Live campaigns examined. */
  considered: number;
  /** Those due a reminder, capped at `limit`. */
  due: DueReminderRow[];
  /** Due but over the cap; they are picked up by the next run. */
  deferred: number;
}

/**
 * Everyone due a reminder at `now`.
 *
 * Two reads, sequential. The second is skipped entirely when there are no
 * candidates, which also keeps `inArray` away from an empty list.
 */
export async function selectDueReminders(
  now: Date,
  limit: number = MAX_SENDS_PER_RUN,
): Promise<ReminderSelection> {
  /*
    `realRaisedMinorSql` is a correlated scalar subquery, so the real figure
    arrives in this same round trip - and it is the REAL figure, never
    `raised_amount`, which is blended with fabricated seed money (`docs/33`,
    `src/db/real-raised.ts`). A cap measured against the blended column would
    warn an organiser about money nobody gave.
  */
  const candidates = await db
    .select({
      campaignId: campaigns.id,
      campaignTitle: campaigns.title,
      status: campaigns.status,
      verificationStatus: campaigns.verificationStatus,
      currency: campaigns.currency,
      goalMinor: campaigns.goalAmount,
      realRaisedMinor: realRaisedMinorSql,
      creatorId: users.id,
      creatorEmail: users.email,
      creatorName: users.name,
    })
    .from(campaigns)
    .innerJoin(users, eq(campaigns.creatorId, users.id))
    .where(inArray(campaigns.status, [...COLLECTING_STATUSES]))
    .orderBy(desc(campaigns.publishedAt));

  if (candidates.length === 0) return { considered: 0, due: [], deferred: 0 };

  const ledger = await readLedger(candidates.map((c) => c.campaignId));

  const due: DueReminderRow[] = [];
  let deferred = 0;

  for (const c of candidates) {
    const level = dueReminder({
      status: c.status,
      verificationStatus: c.verificationStatus,
      currency: c.currency,
      realRaisedMinor: Number(c.realRaisedMinor ?? 0),
      goalMinor: Number(c.goalMinor ?? 0),
      sentLevels: ledger.sentLevels.get(c.campaignId) ?? [],
      lastSentAt: ledger.lastSentAt.get(c.campaignId) ?? null,
      now,
    });
    if (!level) continue;

    // No address, no email. The in-app notification would still be created,
    // but a reminder nobody can read is not worth spending a ledger slot on.
    if (!c.creatorEmail) continue;

    if (due.length >= limit) {
      deferred += 1;
      continue;
    }

    due.push({
      campaignId: c.campaignId,
      campaignTitle: c.campaignTitle,
      creatorId: c.creatorId,
      creatorEmail: c.creatorEmail,
      creatorName: c.creatorName ?? '',
      level,
      currency: c.currency,
      realRaisedMinor: Number(c.realRaisedMinor ?? 0),
      goalMinor: Number(c.goalMinor ?? 0),
      verificationStatus: c.verificationStatus,
    });
  }

  return { considered: candidates.length, due, deferred };
}

/**
 * The send-once ledger for a set of campaigns, in ONE query.
 *
 * `audit_logs` rows of type `verification_reminder.sent`, keyed
 * `target_id = campaign id`, with the level in `details.level` - the pattern
 * `docs/41` uses for the bulk-email filter, and for the same reason: there is
 * no column for it and a migration is not added for bookkeeping.
 *
 * A row whose `details.level` is not a string is counted toward `lastSentAt`
 * but contributes no level. That is deliberate: it still happened, so it
 * still holds the 24-hour floor, but it cannot silently suppress a level by
 * being unreadable.
 */
async function readLedger(campaignIds: string[]): Promise<{
  sentLevels: Map<string, string[]>;
  lastSentAt: Map<string, Date>;
}> {
  const rows = await db
    .select({
      targetId: auditLogs.targetId,
      details: auditLogs.details,
      timestamp: auditLogs.timestamp,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.eventType, REMINDER_AUDIT_EVENT),
        inArray(auditLogs.targetId, campaignIds),
      ),
    );

  const sentLevels = new Map<string, string[]>();
  const lastSentAt = new Map<string, Date>();

  for (const row of rows) {
    if (!row.targetId) continue;
    const level = (row.details as Record<string, unknown> | null)?.level;
    if (typeof level === 'string') {
      const list = sentLevels.get(row.targetId) ?? [];
      list.push(level);
      sentLevels.set(row.targetId, list);
    }
    if (row.timestamp) {
      const prev = lastSentAt.get(row.targetId);
      if (!prev || row.timestamp > prev) lastSentAt.set(row.targetId, row.timestamp);
    }
  }

  return { sentLevels, lastSentAt };
}

/**
 * Write the ledger row for one reminder.
 *
 * ⚠️ Called AFTER the send, so it records what happened rather than what was
 * intended: `createAndEmail` logs and swallows every failure, so a row
 * written beforehand would be a claim. The gap that leaves is one duplicate
 * if two runs overlap, which is why this job's lock fails closed
 * (`src/lib/locks.ts`).
 *
 * ⚠️ A failed or opted-out email still writes the row, and `emailed` says
 * which. The level is NOT retried: the in-app notification exists either way,
 * the dashboard ladder says the same thing, and a retry loop around a send
 * nobody can un-send is how an organiser gets mailed twice about their own
 * money.
 */
export async function recordReminderSent(p: {
  row: DueReminderRow;
  emailed: boolean;
  notificationCreated: boolean;
  /**
   * When the reminder went out. Defaults to the database's clock, which is
   * what the cron wants.
   *
   * ⚠️ It is a parameter because the 24-hour floor is measured FROM this row,
   * and a test that cannot set it is measuring against wall-clock time. The
   * integration test did exactly that and so passed only before 10:00 UTC
   * and failed for the rest of every day. Same reason `consentRecord` takes
   * `now` (`docs/113` §10.2): a rule a test cannot pin is a rule nobody has
   * checked at the boundary that matters.
   */
  at?: Date;
}): Promise<void> {
  await db.insert(auditLogs).values({
    /*
      ⚠️ Written as a direct property, NEVER as `...(p.at ? {...} : {})`. A
      SPREAD bypasses TypeScript's excess-property check, so a misspelled or
      wrong column name in a spread compiles clean and silently writes
      nothing. That is how the first attempt at this fix set `createdAt` - a
      column `audit_logs` does not have - with typecheck green and the bug
      unchanged. The column is `timestamp`.
    */
    timestamp: p.at ?? new Date(),
    eventType: REMINDER_AUDIT_EVENT,
    targetType: 'campaign',
    targetId: p.row.campaignId,
    severity: p.notificationCreated ? 'info' : 'warning',
    details: {
      level: p.row.level,
      emailed: p.emailed,
      notificationCreated: p.notificationCreated,
      realRaisedMinor: p.row.realRaisedMinor,
      goalMinor: p.row.goalMinor,
      currency: p.row.currency,
      verificationStatus: p.row.verificationStatus,
    },
  });
}

/**
 * One row per run, so a job that is firing but sending nothing is
 * distinguishable from a job that is not firing at all. `docs/65` found nine
 * crons dead for the platform's whole life precisely because a job that does
 * nothing leaves no trace.
 */
export async function recordReminderRun(summary: {
  considered: number;
  sent: { level: ReminderLevel; emailed: boolean }[];
  deferred: number;
}): Promise<void> {
  const levels: Record<string, number> = {};
  for (const s of summary.sent) levels[s.level] = (levels[s.level] ?? 0) + 1;

  await db
    .insert(auditLogs)
    .values({
      eventType: 'cron.verification_reminders',
      targetType: 'campaign',
      severity: 'info',
      details: {
        considered: summary.considered,
        sent: summary.sent.length,
        emailed: summary.sent.filter((s) => s.emailed).length,
        deferredToNextRun: summary.deferred,
        levels,
      },
    })
    .catch(() => { /* a summary row must not fail the run */ });
}
