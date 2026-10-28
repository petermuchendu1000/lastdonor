/**
 * Erasing a person, executed against a real Postgres.
 *
 * ── WHY THIS IS AN INTEGRATION TEST ────────────────────────────────────────
 *
 * Both defects it covers are invisible to anything that does not run SQL:
 *
 *  - `tx.delete(users)` raised a FOREIGN KEY violation for anyone holding one
 *    of the 25 references the old transaction did not name. There is no type
 *    error and no failing unit test; the statement is perfectly well-formed.
 *  - The admin path's scrub wrote `badges: null, preferences: null` into two
 *    `NOT NULL` columns, so its UPDATE threw and the row came back unchanged.
 *    Again: valid TypeScript, valid drizzle, wrong at the database.
 *
 * The `docs/101` and `docs/107` lesson a third time - a `sql`/update statement
 * is checked by running it, not by reading it. `docs/124`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { DELETED_DONOR_NAME, DELETED_DONOR_PLACEHOLDER } from '@/lib/constants';
import { USER_PII_SCRUB, anonymiseAccount, anonymisedEmail } from '@/lib/account-erasure';
import { authEmailIdentifiersFor } from '@/lib/password-reset-tokens';
import { clearDatabase } from '../../test/helpers';

let seq = 0;

async function seedUser(email: string) {
  const [row] = await db
    .insert(schema.users)
    .values({ email, name: 'Ada Example', phone: '+254712345678', location: 'Nairobi' })
    .returning({ id: schema.users.id });
  return row.id;
}

async function seedCampaign(creatorId: string | null = null) {
  seq++;
  const [row] = await db
    .insert(schema.campaigns)
    .values({
      title: `Erasure fixture ${seq}`,
      slug: `erasure-fixture-${seq}`,
      status: 'active',
      heroImageUrl: 'https://example.invalid/x.webp',
      storyHtml: '<p>Story long enough to be a story.</p>',
      goalAmount: 500_000,
      category: 'community',
      subjectName: 'Subject',
      creatorId,
    })
    .returning({ id: schema.campaigns.id });
  return row.id;
}

const erase = (userId: string, email: string | null) =>
  db.transaction((tx) => anonymiseAccount(tx, { userId, email }));

const userRow = async (id: string) => {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return row;
};

describe('⛔ the reported symptom: a reference the old transaction never named', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('a user who has shared a campaign can be erased', async () => {
    /*
      The exact production case. [VERIFIED 2026-10-27] one donor held a single
      `campaign_share_links` row (`docs/57`), and `tx.delete(users)` answered
      `violates foreign key constraint
      "campaign_share_links_user_id_users_id_fk"`, which the route turned into
      a 500 saying "Please try again".
    */
    const userId = await seedUser('sharer@example.invalid');
    const campaignId = await seedCampaign();
    await db
      .insert(schema.campaignShareLinks)
      .values({ campaignId, token: `tok-${seq}`, userId });

    await expect(erase(userId, 'sharer@example.invalid')).resolves.not.toThrow();

    const row = await userRow(userId);
    expect(row.email).toBe(anonymisedEmail(userId));
    // The share link survives, pointing at a row that is no longer anybody.
    const [link] = await db
      .select({ userId: schema.campaignShareLinks.userId })
      .from(schema.campaignShareLinks)
      .where(eq(schema.campaignShareLinks.campaignId, campaignId));
    expect(link.userId).toBe(userId);
  });

  it('⚠️ and so can one holding NOT NULL references, which could never be nulled', async () => {
    /*
      The other two blocked production users, and the reason "null what you
      can" was rejected: `campaign_collaborators.invited_by`,
      `interaction_logs.donor_id` and `site_settings.updated_by` are all
      `NO ACTION`, and the first two are `NOT NULL`.
    */
    const userId = await seedUser('inviter@example.invalid');
    const campaignId = await seedCampaign();

    await db.insert(schema.campaignCollaborators).values({
      campaignId,
      invitedEmail: 'helper@example.invalid',
      invitedBy: userId,
      tokenHash: 'hash-abc',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(schema.interactionLogs).values({
      donorId: userId,
      type: 'note',
      subject: 'Called about a campaign',
      contactedAt: new Date(),
    });
    await db.insert(schema.siteSettings).values({
      key: `erasure-fixture-${seq}`,
      value: sql`'{}'::jsonb`,
      updatedBy: userId,
    });

    await expect(erase(userId, 'inviter@example.invalid')).resolves.not.toThrow();

    // The invitation and the settings row survive; the CRM note goes.
    const [[collab], [setting], logs] = await Promise.all([
      db.select({ invitedBy: schema.campaignCollaborators.invitedBy }).from(schema.campaignCollaborators),
      db.select({ updatedBy: schema.siteSettings.updatedBy }).from(schema.siteSettings),
      db.select({ id: schema.interactionLogs.id }).from(schema.interactionLogs),
    ]);
    expect(collab.invitedBy).toBe(userId);
    expect(setting.updatedBy).toBe(userId);
    expect(logs).toEqual([]);
  });

  it('the control: a user with no references at all is erased the same way', async () => {
    /*
      Without this, "erasure succeeds" could be true of an implementation that
      silently does nothing, and every assertion above would still pass.
    */
    const userId = await seedUser('plain@example.invalid');
    await erase(userId, 'plain@example.invalid');
    const row = await userRow(userId);
    expect(row.email).toBe(anonymisedEmail(userId));
    expect(row.name).toBe(DELETED_DONOR_NAME);
  });
});

describe('⛔ the NOT NULL columns that made the admin scrub throw', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('badges and preferences come back as their defaults, never null', async () => {
    /*
      `schema.ts:389-390` - both are `.notNull()`. The admin route set both to
      `null`, so its UPDATE aborted the transaction and that branch had never
      worked once. Asserting the VALUES rather than "it did not throw",
      because a scrub that skipped the columns entirely would also not throw.
    */
    const userId = await seedUser('defaults@example.invalid');
    await erase(userId, 'defaults@example.invalid');

    const row = await userRow(userId);
    expect(row.badges).toEqual([]);
    expect(row.preferences).toEqual({});
  });
});

describe('⛔ the address is gone from every store mail is sent from', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('users, donations, campaign subscriptions and the newsletter list', async () => {
    /*
      The invariant that matters most, and the one the admin path broke: it
      scrubbed `users.email` and left the real address in the three places
      `bulk-email-recipients.ts` and the newsletter cron actually read.
    */
    const email = 'reachable@example.invalid';
    const userId = await seedUser(email);
    const campaignId = await seedCampaign();

    await db.insert(schema.donations).values({
      campaignId,
      stripePaymentId: `seed_erasure_${seq}`,
      amount: 5_000,
      donorEmail: email,
      donorName: 'Ada Example',
      message: 'Thinking of you',
      phaseAtTime: 'first_believers',
      userId,
    });
    await db.insert(schema.donorCampaignSubscriptions).values({ campaignId, donorEmail: email, userId });
    await db.insert(schema.newsletterSubscribers).values({ email });
    /*
      ⛔ `verification_tokens` stores the address as PLAINTEXT in `identifier`,
      has no foreign key to `users`, and nothing else ever deletes these rows.
      It was a fifth store this function had never looked at, found while
      adding the password-reset cooldown - which would have written a second
      row holding the same address. `docs/127`.
    */
    for (const identifier of authEmailIdentifiersFor(email)) {
      await db.insert(schema.verificationTokens).values({
        identifier,
        token: `tok-${seq}`,
        expires: new Date(Date.now() + 3_600_000),
      });
    }

    await erase(userId, email);

    const [[u], donationRows, subs, subscribers, tokens] = await Promise.all([
      db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)),
      db.select().from(schema.donations),
      db.select().from(schema.donorCampaignSubscriptions),
      db.select().from(schema.newsletterSubscribers),
      db.select().from(schema.verificationTokens),
    ]);

    const everywhere = JSON.stringify({ u, donationRows, subs, subscribers, tokens });
    expect(everywhere).not.toContain(email);
    expect(tokens).toEqual([]);

    // And the donation itself survives, scrubbed.
    expect(donationRows).toHaveLength(1);
    expect(donationRows[0].donorEmail).toBe(DELETED_DONOR_PLACEHOLDER);
    expect(donationRows[0].donorName).toBe(DELETED_DONOR_NAME);
    expect(donationRows[0].message).toBeNull();
    expect(donationRows[0].userId).toBeNull();
    expect(subs).toEqual([]);
    expect(subscribers).toEqual([]);
  });

  it('⚠️ the control: it leaves ANOTHER person\'s reset rows alone', async () => {
    /*
      Without this, "the address is gone from verification_tokens" would also
      be satisfied by truncating the table - and the identifiers are built
      from an address, so a `LIKE` pattern would reach other people's rows
      (`%` and `_` are legal in a local part).
    */
    const email = `erase-tokens-${++seq}@example.invalid`;
    const userId = await seedUser(email);
    const bystander = 'bystander@example.invalid';
    for (const identifier of [...authEmailIdentifiersFor(email), ...authEmailIdentifiersFor(bystander)]) {
      await db.insert(schema.verificationTokens).values({
        identifier,
        token: 'tok',
        expires: new Date(Date.now() + 3_600_000),
      });
    }

    await erase(userId, email);

    const left = await db.select({ identifier: schema.verificationTokens.identifier }).from(schema.verificationTokens);
    expect(left.map((r) => r.identifier).sort()).toEqual(authEmailIdentifiersFor(bystander).sort());
  });

  it('⚠️ two people who followed the SAME campaign can both be erased', async () => {
    /*
      Why those subscriptions are DELETED and not scrubbed to the shared
      placeholder: `idx_donor_subs_email_campaign` is UNIQUE on
      (donor_email, campaign_id), so the second erasure would collide and
      abort. The duplicate case Gate 7 asks for, and it is a real one.
    */
    const campaignId = await seedCampaign();
    const a = await seedUser('a@example.invalid');
    const b = await seedUser('b@example.invalid');
    await db.insert(schema.donorCampaignSubscriptions).values([
      { campaignId, donorEmail: 'a@example.invalid', userId: a },
      { campaignId, donorEmail: 'b@example.invalid', userId: b },
    ]);

    await erase(a, 'a@example.invalid');
    await expect(erase(b, 'b@example.invalid')).resolves.not.toThrow();
    expect(await db.select().from(schema.donorCampaignSubscriptions)).toEqual([]);
  });

  it('⚠️ erasing the same person twice is harmless', async () => {
    const userId = await seedUser('twice@example.invalid');
    await erase(userId, 'twice@example.invalid');
    // Second call passes the ORIGINAL address, as a retried request would.
    await expect(erase(userId, 'twice@example.invalid')).resolves.not.toThrow();
    expect((await userRow(userId)).email).toBe(anonymisedEmail(userId));
  });
});

describe('⛔ the scrub list is checked against the table it scrubs', () => {
  it('every personal column on `users` is either scrubbed or deliberately kept', async () => {
    /*
      The previous scrub was written before `phone_e164`, `phone_verified_at`,
      `sms_consent_at` (`docs/82`, `docs/85`) and `stripe_connect_account_id`
      existed, and silently kept leaving each new one behind. A hand-written
      list is only as good as whoever remembered to extend it - `docs/119`.

      So the live column list is read from the database and every column must
      appear in one side or the other. Adding a personal column to `users`
      fails this until somebody decides which.
    */
    const rows = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_name = 'users' and table_schema = 'public'
    `);
    const columns = [...rows].map((r) => r.column_name);
    expect(columns.length).toBeGreaterThan(20);

    /** Not personal, or kept on purpose. */
    const KEPT = new Set([
      'id', // opaque, and the only thing left
      'email', // replaced with anonymisedEmail(), asserted above
      'role',
      'donor_type',
      'created_at',
      // Aggregates: numbers about a person who no longer exists.
      'total_donated',
      'campaigns_supported',
      'campaigns_created',
      'last_donor_count',
      'donor_score',
      'last_donation_at',
      // Sign-in throttling state; carries no identity.
      'failed_login_count',
      'failed_login_window_start',
      // Payout rail state. The ACCOUNT ID is scrubbed; these two say only
      // that some account once existed, which the withdrawal record implies.
      'stripe_connect_status',
      'stripe_connect_onboarded_at',
      'payout_currency',
    ]);

    const scrubbed = new Set(
      Object.keys(USER_PII_SCRUB).map((k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)),
    );

    const unaccounted = columns.filter((c) => !KEPT.has(c) && !scrubbed.has(c));
    expect(unaccounted, 'new `users` columns with no erasure decision').toEqual([]);
  });
});

describe('⚠️ the campaign link is kept on purpose', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('creator_id still points at the anonymised row', async () => {
    /*
      The self-service route used to null this to get past the foreign key.
      Nothing needs it now the row survives, and `docs/119` found 13 of 14
      live campaigns already have no organiser - a campaign with a null
      creator cannot be traced, reminded or paid. The row it points at holds
      no personal data.
    */
    const userId = await seedUser('organiser@example.invalid');
    const campaignId = await seedCampaign(userId);

    await erase(userId, 'organiser@example.invalid');

    const [c] = await db
      .select({ creatorId: schema.campaigns.creatorId })
      .from(schema.campaigns)
      .where(and(eq(schema.campaigns.id, campaignId)));
    expect(c.creatorId).toBe(userId);
    expect((await userRow(userId)).name).toBe(DELETED_DONOR_NAME);
  });
});
