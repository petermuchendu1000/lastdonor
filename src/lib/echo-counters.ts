import 'server-only';

import { sql, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaigns, campaignUpdates, campaignMessages } from '@/db/schema';

/**
 * Insert a campaign update or message AND move its counter, together.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 *
 * `campaigns.update_count`, `message_count` and `seed_donation_count`
 * are denormalised counters that exist to keep listing queries off an
 * N+1. CLAUDE.md has carried a warning since 2026-10-14 that nothing
 * increments them: ten insert sites wrote the rows and left the
 * counters alone, and the only writer was `cron/reconcile`, which
 * repairs them after the fact.
 *
 * That was survivable while no cron ran (docs/65). It stopped being
 * survivable on 2026-10-18, when the scheduler was deployed and
 * `update-phases` began generating organiser updates every five
 * minutes. Measured the same night: a baseline at 01:14Z found ONE
 * campaign with a drifting counter; by 02:07Z there were FOUR, because
 * three updates had been written at 01:45, 01:50 and 01:55 and not one
 * of them touched `update_count`. A dormant defect became a live one
 * the moment the thing that writes rows started running.
 *
 * Repairing nightly is not the fix. Between two reconcile runs the
 * counters are simply wrong, and anything reading them - the adaptive
 * campaign email prints `updateCount` straight to the recipient -
 * reads a number that is wrong by however many updates were written
 * since 04:00.
 *
 * ── Why a helper rather than ten careful call sites ──────────────────
 *
 * Ten call sites that must each remember a second statement is the
 * arrangement that produced this bug. One function that cannot insert
 * without incrementing is the arrangement that cannot.
 *
 * `SET x = x + 1` is evaluated by Postgres against the current row, so
 * concurrent inserts do not lose a count the way a read-modify-write
 * in application code would.
 */

/** `db` or a transaction handle; both expose the methods used here. */
type Executor = Pick<typeof db, 'insert' | 'update'>;

type UpdateValues = typeof campaignUpdates.$inferInsert;
type MessageValues = typeof campaignMessages.$inferInsert;

/**
 * Insert a campaign update and increment `campaigns.update_count`.
 *
 * Pass the transaction handle when the caller already has one, so the
 * row and the counter commit or roll back together. Without one the
 * two statements are separate, which is still far better than never
 * incrementing, and `reconcile` remains the backstop.
 */
export async function insertCampaignUpdate(
  values: UpdateValues,
  executor: Executor = db,
): Promise<typeof campaignUpdates.$inferSelect> {
  const [created] = await executor.insert(campaignUpdates).values(values).returning();
  await executor
    .update(campaigns)
    .set({ updateCount: sql`${campaigns.updateCount} + 1` })
    .where(eq(campaigns.id, values.campaignId));
  return created;
}

/** As above, for `campaign_messages` and `campaigns.message_count`. */
export async function insertCampaignMessage(
  values: MessageValues,
  executor: Executor = db,
): Promise<typeof campaignMessages.$inferSelect> {
  const [created] = await executor.insert(campaignMessages).values(values).returning();
  await executor
    .update(campaigns)
    .set({ messageCount: sql`${campaigns.messageCount} + 1` })
    .where(eq(campaigns.id, values.campaignId));
  return created;
}
