import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { inArray, sql } from 'drizzle-orm';
import { clearDatabase, seedCampaign } from '../../../test/helpers';
import { COMPLETED_STATUSES } from '@/lib/campaign-visibility';

/**
 * A count rendered as a link is a promise about what is behind the link.
 *
 * ## The defect this encodes (docs/146)
 *
 * `/campaigns` rendered **"Completed 1"** linking to `/completed-campaigns`,
 * which showed nothing. The badge counted
 * `status IN ('completed','archived')`; the page listed `status = 'completed'`.
 * [VERIFIED live: the badge carried "1"; the destination served 0 campaign
 * links and its empty state.]
 *
 * ⚠️ **Why these assert the PROPERTY, not "the two ends agree".** Both ends now
 * read one constant, so "they agree" is a check that cannot fail - the
 * `docs/119` trap. What can fail is *archived is not counted as completed*,
 * which is the thing that was wrong.
 */

/** The badge's shape: a FILTER aggregate over the whole table. */
async function countCompleted(): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`count(*) FILTER (WHERE ${inArray(campaigns.status, [...COMPLETED_STATUSES])})::int`,
    })
    .from(campaigns);
  return Number(row?.n ?? 0);
}

/** The destination's shape: a WHERE on the listing query. */
async function listCompleted(): Promise<string[]> {
  const rows = await db
    .select({ slug: campaigns.slug })
    .from(campaigns)
    .where(inArray(campaigns.status, [...COMPLETED_STATUSES]));
  return rows.map((r) => r.slug).sort();
}

describe('the completed count and the completed list describe one set', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await clearDatabase();
  });

  it('⛔ the reported symptom: an archived campaign is NOT counted as completed', async () => {
    /*
      Production's only archived row is the PayHero test campaign - raised
      10,000 of 100,000 KES, no `completed` transition in its audit history -
      and the badge called it a completed campaign.
    */
    await seedCampaign({ slug: 'was-archived', status: 'archived', publishedAt: new Date() });

    expect(await countCompleted()).toBe(0);
    expect(await listCompleted()).toEqual([]);
  });

  it('⛔ a campaign ARCHIVED AS A DRAFT is not counted either', async () => {
    // `ALLOWED_TRANSITIONS` permits `draft -> archived`, and both delete
    // routes implement deletion AS archiving. So the archived set contains
    // campaigns that completed nothing and were never even published.
    await seedCampaign({ slug: 'deleted-draft', status: 'archived', publishedAt: null });

    expect(await countCompleted()).toBe(0);
  });

  it('a genuinely completed campaign IS counted and IS listed', async () => {
    // Anti-vacuity: without this, `COMPLETED_STATUSES = []` satisfies every
    // rule above.
    await seedCampaign({ slug: 'really-done', status: 'completed', publishedAt: new Date() });

    expect(await countCompleted()).toBe(1);
    expect(await listCompleted()).toEqual(['really-done']);
  });

  it('counts only the completed ones out of a mixed table', async () => {
    await seedCampaign({ slug: 'done-1', status: 'completed', publishedAt: new Date() });
    await seedCampaign({ slug: 'done-2', status: 'completed', publishedAt: new Date() });
    await seedCampaign({ slug: 'closed', status: 'archived', publishedAt: new Date() });
    await seedCampaign({ slug: 'live', status: 'active', publishedAt: new Date() });
    await seedCampaign({ slug: 'queued', status: 'under_review', publishedAt: null });

    expect(await countCompleted()).toBe(2);
    expect(await listCompleted()).toEqual(['done-1', 'done-2']);
  });

  it('the badge number equals the number of rows its destination lists', async () => {
    // The weaker of the two claims (one constant feeds both), kept because it
    // is the literal statement the UI makes to a visitor.
    await seedCampaign({ slug: 'a', status: 'completed', publishedAt: new Date() });
    await seedCampaign({ slug: 'b', status: 'archived', publishedAt: new Date() });

    expect(await countCompleted()).toBe((await listCompleted()).length);
  });

  it('an empty table reports zero rather than erroring', async () => {
    expect(await countCompleted()).toBe(0);
    expect(await listCompleted()).toEqual([]);
  });
});
