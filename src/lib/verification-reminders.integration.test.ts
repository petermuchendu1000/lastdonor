/**
 * `selectDueReminders` against a real Postgres.
 *
 * ⚠️ The first assertion is the cheapest and the one that matters: **the
 * queries execute.** `docs/107` is a doc about a page that answered 500 on
 * every load while lint, typecheck, 6,855 unit tests and nine ratchets were
 * green, because its query lived inline and nothing ran it. `docs/101` is the
 * same family: a `sql` template that returned 0 for every row - valid SQL, no
 * error, a money cap silently disabled.
 *
 * This job reads `realRaisedMinorSql` (the `docs/101` expression itself) and
 * folds a JSONB `details` column into a send-once ledger. Neither is
 * observable from a unit test.
 *
 * The second half is the ledger, and it is tested by DOING it: write the row
 * the route would write, then ask again, and the level must be gone. A ledger
 * asserted only by reading code is the `docs/109` defect - a test that pins
 * today's text while the behaviour drifts underneath it.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  REMINDER_AUDIT_EVENT,
  recordReminderSent,
  selectDueReminders,
} from '@/lib/verification-reminders.server';
import { REMINDER_MIN_GAP_HOURS, capMinor } from '@/lib/verification-reminders';
import { clearDatabase, seedCampaign, seedUser } from '../../test/helpers';

const NOW = new Date('2026-10-25T09:00:00.000Z');
const CAP_USD = capMinor('USD')!;

let seq = 0;

/** A campaign with a creator, in a state that can take money. */
async function liveCampaign(over: Partial<typeof schema.campaigns.$inferInsert> = {}) {
  seq += 1;
  const user = await seedUser({ email: `organiser-${seq}-${Date.now()}@test.invalid` });
  const campaign = await seedCampaign({
    creatorId: user.id,
    status: 'active',
    verificationStatus: 'unverified',
    currency: 'USD',
    goalAmount: 500_000,
    slug: `reminder-${seq}-${Date.now()}`,
    publishedAt: new Date(NOW.getTime() - seq * 60_000),
    ...over,
  });
  return { user, campaign };
}

async function donate(
  campaignId: string,
  amount: number,
  opts: { source?: 'real' | 'seed'; refunded?: boolean } = {},
) {
  seq += 1;
  await db.insert(schema.donations).values({
    campaignId,
    stripePaymentId: `pi_reminder_${Date.now()}_${seq}`,
    amount,
    donorName: 'Test Donor',
    donorEmail: 'donor@test.invalid',
    phaseAtTime: 'first_believers',
    source: opts.source ?? 'real',
    refunded: opts.refunded ?? false,
    currency: 'USD',
  });
}

beforeEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await clearDatabase();
});

describe('the queries run at all', () => {
  it('executes against an empty database', async () => {
    // The `docs/107` assertion. An empty candidate set must also skip the
    // ledger read entirely, because `inArray` over an empty list is its own
    // hazard.
    const out = await selectDueReminders(NOW);
    expect(out).toEqual({ considered: 0, due: [], deferred: 0 });
  });

  it('executes with live campaigns and real donations', async () => {
    const { campaign } = await liveCampaign();
    await donate(campaign.id, 2_500);

    const out = await selectDueReminders(NOW);
    expect(out.considered).toBe(1);
    expect(out.due).toHaveLength(1);
    expect(out.due[0].level).toBe('first_money');
  });
});

describe('the figure it reasons about is the REAL one', () => {
  it('⛔ ignores seeded donations', async () => {
    /*
      The `docs/101` hazard in reverse. `raised_amount` is blended with
      fabricated seed money; if this job measured that column, a campaign
      with nothing but seed donations would be told it was near a cap it had
      not approached, and a real campaign's headroom would be eaten by money
      nobody gave.
    */
    const { campaign } = await liveCampaign();
    await donate(campaign.id, CAP_USD, { source: 'seed' });
    // The blended column is set to the cap, which is what the simulation
    // engine does. This is the whole point of the test: the two numbers now
    // DISAGREE, so a job reading the wrong one is visible.
    await db
      .update(schema.campaigns)
      .set({ raisedAmount: CAP_USD })
      .where(eq(schema.campaigns.id, campaign.id));

    const out = await selectDueReminders(NOW);
    // ...and the job must still see zero real money, so nothing is due.
    expect(out.considered).toBe(1);
    expect(out.due).toHaveLength(0);
  });

  it('ignores refunded donations', async () => {
    const { campaign } = await liveCampaign();
    await donate(campaign.id, CAP_USD, { refunded: true });

    const out = await selectDueReminders(NOW);
    expect(out.due).toHaveLength(0);
  });

  it('sums several real donations to reach a level', async () => {
    const { campaign } = await liveCampaign();
    // Three gifts that only cross the cap together: a query returning one
    // row's amount, or 0, would both read as "not at cap".
    await donate(campaign.id, 20_000);
    await donate(campaign.id, 20_000);
    await donate(campaign.id, 20_000);

    const out = await selectDueReminders(NOW);
    expect(out.due[0].realRaisedMinor).toBe(60_000);
    expect(out.due[0].level).toBe('at_cap');
  });
});

describe('the send-once ledger, exercised rather than read', () => {
  it('stops the same level coming back', async () => {
    const { campaign } = await liveCampaign();
    await donate(campaign.id, 2_500);

    const first = await selectDueReminders(NOW);
    expect(first.due[0].level).toBe('first_money');

    // Write exactly what the route writes.
    await recordReminderSent({
      row: first.due[0],
      emailed: true,
      notificationCreated: true,
    });

    const again = await selectDueReminders(NOW);
    expect(again.considered).toBe(1);
    expect(again.due).toHaveLength(0);
  });

  it('holds the floor, then releases it', async () => {
    const { campaign } = await liveCampaign();
    await donate(campaign.id, 2_500);

    const first = await selectDueReminders(NOW);
    await recordReminderSent({ row: first.due[0], emailed: true, notificationCreated: true });

    // The campaign jumps to its cap in the same afternoon.
    await donate(campaign.id, CAP_USD);

    const sameDay = await selectDueReminders(new Date(NOW.getTime() + 3_600_000));
    expect(sameDay.due, 'a second level inside the floor').toHaveLength(0);

    const later = await selectDueReminders(
      new Date(NOW.getTime() + (REMINDER_MIN_GAP_HOURS + 1) * 3_600_000),
    );
    expect(later.due).toHaveLength(1);
    expect(later.due[0].level).toBe('at_cap');
  });

  it('writes a row readable by the next run', async () => {
    // The two halves are a reader and a writer of the same JSONB shape, and
    // docs/104 is the doc about a writer and a reader that drifted apart
    // silently. So the row is read back as the ledger reads it.
    const { campaign } = await liveCampaign();
    await donate(campaign.id, 2_500);
    const out = await selectDueReminders(NOW);
    await recordReminderSent({ row: out.due[0], emailed: false, notificationCreated: true });

    const rows = await db
      .select({ details: schema.auditLogs.details, targetId: schema.auditLogs.targetId })
      .from(schema.auditLogs);
    const row = rows.find((r) => r.targetId === campaign.id)!;
    expect(row).toBeDefined();
    const details = row.details as Record<string, unknown>;
    expect(details.level).toBe('first_money');
    expect(details.emailed).toBe(false);
    expect(typeof details.level).toBe('string');
  });

  it('an unrelated audit row does not suppress a reminder', async () => {
    // The ledger is keyed on event type as well as target. A campaign with
    // other audit history must still be reachable.
    const { campaign } = await liveCampaign();
    await donate(campaign.id, 2_500);
    await db.insert(schema.auditLogs).values({
      eventType: 'campaign.published',
      targetType: 'campaign',
      targetId: campaign.id,
      details: { level: 'first_money' },
    });

    const out = await selectDueReminders(NOW);
    expect(out.due).toHaveLength(1);
  });
});

describe('who is considered at all', () => {
  it('skips a campaign that cannot take money', async () => {
    const { campaign } = await liveCampaign({ status: 'under_review', publishedAt: null });
    await donate(campaign.id, 2_500);

    const out = await selectDueReminders(NOW);
    expect(out.considered).toBe(0);
    expect(out.due).toHaveLength(0);
  });

  it('skips a fully verified campaign', async () => {
    const { campaign } = await liveCampaign({ verificationStatus: 'fully_verified' });
    await donate(campaign.id, CAP_USD);

    const out = await selectDueReminders(NOW);
    expect(out.considered).toBe(1);
    expect(out.due).toHaveLength(0);
  });

  it('defers past the per-run ceiling instead of dropping', async () => {
    for (let i = 0; i < 3; i++) {
      const { campaign } = await liveCampaign();
      await donate(campaign.id, 2_500);
    }

    const out = await selectDueReminders(NOW, 2);
    expect(out.considered).toBe(3);
    expect(out.due).toHaveLength(2);
    expect(out.deferred).toBe(1);
  });
});

describe('the ledger event name is the one the route writes', () => {
  it('is a single constant, shared by reader and writer', () => {
    expect(REMINDER_AUDIT_EVENT).toBe('verification_reminder.sent');
  });
});
