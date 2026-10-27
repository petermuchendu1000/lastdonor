/**
 * Integration test helpers.
 * Provides utilities for setting up and tearing down test data.
 */
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import * as schema from '@/db/schema';

/**
 * Clear all test data from the database.
 * CAUTION: This truncates tables - only use against a test database.
 *
 * NOTE on `blog_topic_queue`: it was absent from this list while
 * `blog_posts` was present, so a test that seeded a topic leaked it into
 * every later file. The integration suite runs SERIALLY against one shared
 * database by design (docs/98), which is exactly the condition that turns a
 * leak into a unique-constraint failure three files away. Found by writing
 * the first integration test that touches the queue (docs/123).
 */
export async function clearDatabase() {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_logs,
      campaign_seed_messages,
      campaign_updates,
      campaign_withdrawals,
      campaign_messages,
      fund_pool_allocations,
      notifications,
      donations,
      newsletter_subscribers,
      news_items,
      blog_posts,
      blog_topic_queue,
      sessions,
      accounts,
      verification_tokens,
      campaigns,
      users
    CASCADE
  `);
}

/**
 * Seed a test campaign directly into the database.
 */
export async function seedCampaign(overrides: Partial<typeof schema.campaigns.$inferInsert> = {}) {
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      title: 'Test Campaign',
      slug: `test-campaign-${Date.now()}`,
      status: 'active',
      heroImageUrl: 'https://example.com/test.webp',
      storyHtml: '<p>This is a test campaign story with enough content to pass validation requirements.</p>',
      goalAmount: 500_000,
      raisedAmount: 0,
      donorCount: 0,
      category: 'community',
      subjectName: 'Test Subject',
      publishedAt: new Date(),
      ...overrides,
    })
    .returning();

  return campaign;
}

/**
 * Seed a test user directly into the database.
 */
export async function seedUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `test-${Date.now()}@example.com`,
      name: 'Test User',
      role: 'donor',
      ...overrides,
    })
    .returning();

  return user;
}

/**
 * Seed a test donation directly into the database.
 */
export async function seedDonation(
  campaignId: string,
  overrides: Partial<typeof schema.donations.$inferInsert> = {},
) {
  const [donation] = await db
    .insert(schema.donations)
    .values({
      campaignId,
      stripePaymentId: `pi_test_${Date.now()}`,
      amount: 5000,
      donorName: 'Test Donor',
      donorEmail: 'donor@example.com',
      phaseAtTime: 'first_believers',
      source: 'real',
      ...overrides,
    })
    .returning();

  return donation;
}
