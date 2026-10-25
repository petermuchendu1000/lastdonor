/**
 * The collaborator table's guarantees, against a real Postgres.
 *
 * ⚠️ Why this file exists rather than more unit tests: every safety property
 * of this table is a DATABASE constraint, and `docs/101` is the doc about a
 * money guard that passed unit tests, a text ratchet and typecheck while
 * being silently inert - caught only by running it against real Postgres. A
 * CHECK or a partial unique index that does not fire is invisible from
 * anywhere else.
 *
 * `canCollaborate` is exercised here too, because its correctness is entirely
 * about which rows a WHERE clause matches, which no mock can tell you.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { canCollaborate } from '@/lib/collaborators/can-collaborate';
import { clearDatabase, seedCampaign, seedUser } from '../../../test/helpers';

let seq = 0;

async function fixture() {
  seq += 1;
  const owner = await seedUser({ email: `owner-${seq}-${Date.now()}@test.invalid` });
  const helper = await seedUser({ email: `helper-${seq}-${Date.now()}@test.invalid` });
  const campaign = await seedCampaign({
    creatorId: owner.id,
    slug: `collab-${seq}-${Date.now()}`,
  });
  return { owner, helper, campaign };
}

function row(over: Partial<typeof schema.campaignCollaborators.$inferInsert>) {
  seq += 1;
  return {
    invitedEmail: `invitee-${seq}-${Date.now()}@test.invalid`.toLowerCase(),
    tokenHash: `hash-${seq}-${Date.now()}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    ...over,
  } as typeof schema.campaignCollaborators.$inferInsert;
}

beforeEach(async () => {
  await clearDatabase();
  /*
    `clearDatabase` does NOT name this table, but its `TRUNCATE ... CASCADE`
    of `campaigns` reaches it - verified from the Postgres NOTICE
    "truncate cascades to table campaign_collaborators" on 2026-10-25. This
    line is therefore belt-and-braces, kept so the suite does not depend on a
    cascade staying in place if `clearDatabase`'s table list is ever reordered.
  */
  await db.execute(sql`TRUNCATE TABLE campaign_collaborators CASCADE`);
});

afterAll(async () => {
  await clearDatabase();
});

describe('the table accepts a well-formed invite', () => {
  it('inserts and reads back', async () => {
    const { owner, campaign } = await fixture();
    const [inserted] = await db
      .insert(schema.campaignCollaborators)
      .values(row({ campaignId: campaign.id, invitedBy: owner.id }))
      .returning();

    expect(inserted.id).toBeTruthy();
    expect(inserted.acceptedAt).toBeNull();
    expect(inserted.revokedAt).toBeNull();
    expect(inserted.userId).toBeNull();
  });
});

describe('⛔ the CHECK constraints fire', () => {
  it('refuses a mixed-case email', async () => {
    /*
      Without this, `alice@x.com` and `Alice@x.com` are two different live
      rows for one person, and revoking one leaves the other granting
      access. The partial unique index below cannot see that they are the
      same address.
    */
    const { owner, campaign } = await fixture();
    await expect(
      db.insert(schema.campaignCollaborators).values(
        row({ campaignId: campaign.id, invitedBy: owner.id, invitedEmail: 'Mixed@Case.test' }),
      ),
    ).rejects.toThrow(/campaign_collaborators_email_lower/);
  });

  it('refuses an accepted row with no user', async () => {
    // An "accepted" row with a null user matches nothing in
    // `canCollaborate`, so it would read as granted while granting nothing.
    const { owner, campaign } = await fixture();
    await expect(
      db.insert(schema.campaignCollaborators).values(
        row({
          campaignId: campaign.id,
          invitedBy: owner.id,
          acceptedAt: new Date(),
          userId: null,
        }),
      ),
    ).rejects.toThrow(/campaign_collaborators_accepted_has_user/);
  });

  it('accepts an accepted row WITH a user, so the check is not a blanket refusal', async () => {
    const { owner, helper, campaign } = await fixture();
    const [ok] = await db
      .insert(schema.campaignCollaborators)
      .values(
        row({
          campaignId: campaign.id,
          invitedBy: owner.id,
          acceptedAt: new Date(),
          userId: helper.id,
        }),
      )
      .returning();
    expect(ok.userId).toBe(helper.id);
  });
});

describe('⛔ one live invite per (campaign, email)', () => {
  it('refuses a duplicate while the first is live', async () => {
    const { owner, campaign } = await fixture();
    const email = 'dupe@test.invalid';
    await db
      .insert(schema.campaignCollaborators)
      .values(row({ campaignId: campaign.id, invitedBy: owner.id, invitedEmail: email }));

    await expect(
      db
        .insert(schema.campaignCollaborators)
        .values(row({ campaignId: campaign.id, invitedBy: owner.id, invitedEmail: email })),
    ).rejects.toThrow(/idx_campaign_collaborators_live/);
  });

  it('allows a re-invite once the first is revoked', async () => {
    // The partial predicate is the point: revoked rows stay as history
    // without blocking the organiser from inviting the person again.
    const { owner, campaign } = await fixture();
    const email = 'again@test.invalid';
    const [first] = await db
      .insert(schema.campaignCollaborators)
      .values(row({ campaignId: campaign.id, invitedBy: owner.id, invitedEmail: email }))
      .returning();

    await db
      .update(schema.campaignCollaborators)
      .set({ revokedAt: new Date() })
      .where(eq(schema.campaignCollaborators.id, first.id));

    const [second] = await db
      .insert(schema.campaignCollaborators)
      .values(row({ campaignId: campaign.id, invitedBy: owner.id, invitedEmail: email }))
      .returning();
    expect(second.id).not.toBe(first.id);

    // And the history is still there.
    const all = await db
      .select()
      .from(schema.campaignCollaborators)
      .where(eq(schema.campaignCollaborators.invitedEmail, email));
    expect(all).toHaveLength(2);
  });

  it('allows the same person on a DIFFERENT campaign', async () => {
    const { owner, campaign } = await fixture();
    const other = await seedCampaign({ creatorId: owner.id, slug: `other-${Date.now()}` });
    const email = 'both@test.invalid';
    for (const c of [campaign, other]) {
      await db
        .insert(schema.campaignCollaborators)
        .values(row({ campaignId: c.id, invitedBy: owner.id, invitedEmail: email }));
    }
    const all = await db.select().from(schema.campaignCollaborators);
    expect(all).toHaveLength(2);
  });
});

describe('canCollaborate grants only on an accepted, unrevoked row', () => {
  it('⛔ a PENDING invite grants nothing', async () => {
    /*
      The row exists from the moment the organiser sends the invite. If this
      were wrong, sending an invite would itself hand over access - and the
      only symptom would be a helper who could act before clicking anything.
    */
    const { owner, helper, campaign } = await fixture();
    await db.insert(schema.campaignCollaborators).values(
      row({ campaignId: campaign.id, invitedBy: owner.id, userId: helper.id }),
    );
    expect(await canCollaborate(campaign.id, helper.id, 'post_update')).toBe(false);
  });

  it('an accepted invite grants', async () => {
    const { owner, helper, campaign } = await fixture();
    await db.insert(schema.campaignCollaborators).values(
      row({
        campaignId: campaign.id,
        invitedBy: owner.id,
        userId: helper.id,
        acceptedAt: new Date(),
      }),
    );
    expect(await canCollaborate(campaign.id, helper.id, 'post_update')).toBe(true);
    expect(await canCollaborate(campaign.id, helper.id, 'edit_content')).toBe(true);
  });

  it('⛔ revocation takes effect immediately', async () => {
    const { owner, helper, campaign } = await fixture();
    const [r] = await db
      .insert(schema.campaignCollaborators)
      .values(
        row({
          campaignId: campaign.id,
          invitedBy: owner.id,
          userId: helper.id,
          acceptedAt: new Date(),
        }),
      )
      .returning();
    expect(await canCollaborate(campaign.id, helper.id, 'post_update')).toBe(true);

    await db
      .update(schema.campaignCollaborators)
      .set({ revokedAt: new Date() })
      .where(eq(schema.campaignCollaborators.id, r.id));

    expect(await canCollaborate(campaign.id, helper.id, 'post_update')).toBe(false);
  });

  it('does not leak across campaigns or users', async () => {
    const { owner, helper, campaign } = await fixture();
    const stranger = await seedUser({ email: `stranger-${Date.now()}@test.invalid` });
    const other = await seedCampaign({ creatorId: owner.id, slug: `nope-${Date.now()}` });

    await db.insert(schema.campaignCollaborators).values(
      row({
        campaignId: campaign.id,
        invitedBy: owner.id,
        userId: helper.id,
        acceptedAt: new Date(),
      }),
    );

    expect(await canCollaborate(other.id, helper.id, 'post_update')).toBe(false);
    expect(await canCollaborate(campaign.id, stranger.id, 'post_update')).toBe(false);
    expect(await canCollaborate(campaign.id, null, 'post_update')).toBe(false);
    expect(await canCollaborate(campaign.id, undefined, 'post_update')).toBe(false);
  });

  it('⛔ refuses a non-delegatable capability even for a live collaborator', async () => {
    /*
      The type system forbids this at a well-behaved call site; the runtime
      guard is for a capability arriving as a plain string. Cast here to
      reach the code path a future caller could.
    */
    const { owner, helper, campaign } = await fixture();
    await db.insert(schema.campaignCollaborators).values(
      row({
        campaignId: campaign.id,
        invitedBy: owner.id,
        userId: helper.id,
        acceptedAt: new Date(),
      }),
    );
    for (const cap of ['withdraw', 'upload_identity', 'delete_campaign', 'invite_collaborator']) {
      expect(
        await canCollaborate(campaign.id, helper.id, cap as never),
        cap,
      ).toBe(false);
    }
  });
});

describe('deleting a campaign takes its collaborators with it', () => {
  it('cascades', async () => {
    // Otherwise a deleted campaign leaves rows whose campaign_id dangles,
    // and a re-used id would silently inherit them.
    const { owner, helper, campaign } = await fixture();
    await db.insert(schema.campaignCollaborators).values(
      row({ campaignId: campaign.id, invitedBy: owner.id, userId: helper.id }),
    );
    await db.delete(schema.campaigns).where(eq(schema.campaigns.id, campaign.id));
    const left = await db.select().from(schema.campaignCollaborators);
    expect(left).toHaveLength(0);
  });
});
