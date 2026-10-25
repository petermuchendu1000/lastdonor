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
import {
  acceptInvite,
  countLiveCollaborators,
  createInvite,
  listCollaborators,
  mintInviteToken,
  revokeCollaborator,
  tokenMatchesHash,
  MAX_LIVE_COLLABORATORS,
} from '@/lib/collaborators/invites';
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

describe('the invitation flow, end to end', () => {
  it('mints a token that is never stored in the clear', async () => {
    const { owner, campaign } = await fixture();
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: 'helper@test.invalid',
      invitedBy: owner.id,
    });
    expect(made).not.toBeNull();

    const [stored] = await db
      .select()
      .from(schema.campaignCollaborators)
      .where(eq(schema.campaignCollaborators.id, made!.row.id));

    // The token in the email must not be recoverable from the row.
    expect(stored.tokenHash).not.toBe(made!.token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenMatchesHash(made!.token, stored.tokenHash)).toBe(true);
    expect(tokenMatchesHash('wrong-token', stored.tokenHash)).toBe(false);
  });

  it('lower-cases the address on the way in', async () => {
    // The CHECK would reject a mixed-case insert, so the service must
    // normalise rather than hand the constraint a violation.
    const { owner, campaign } = await fixture();
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: '  MiXeD@Case.TEST  ',
      invitedBy: owner.id,
    });
    expect(made!.row.invitedEmail).toBe('mixed@case.test');
  });

  it('⛔ refuses a duplicate invitation with the constraint, not a prior read', async () => {
    const { owner, campaign } = await fixture();
    const email = 'twice@test.invalid';
    await createInvite({ campaignId: campaign.id, invitedEmail: email, invitedBy: owner.id });
    await expect(
      createInvite({ campaignId: campaign.id, invitedEmail: email, invitedBy: owner.id }),
    ).rejects.toThrow(/idx_campaign_collaborators_live/);
  });

  it('⛔ two simultaneous invitations to the same address: exactly one survives', async () => {
    /*
      The concurrency case. A check-then-insert would let both through; the
      partial unique index is what makes it one. Run them together rather
      than in sequence, because sequence is the case that already passes.
    */
    const { owner, campaign } = await fixture();
    const email = 'race@test.invalid';
    const results = await Promise.allSettled([
      createInvite({ campaignId: campaign.id, invitedEmail: email, invitedBy: owner.id }),
      createInvite({ campaignId: campaign.id, invitedEmail: email, invitedBy: owner.id }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await countLiveCollaborators(campaign.id)).toBe(1);
  });

  it('⛔ stops at the per-campaign cap and reports it rather than throwing', async () => {
    const { owner, campaign } = await fixture();
    for (let i = 0; i < MAX_LIVE_COLLABORATORS; i++) {
      const made = await createInvite({
        campaignId: campaign.id,
        invitedEmail: `cap-${i}@test.invalid`,
        invitedBy: owner.id,
      });
      expect(made, `invite ${i + 1} was refused below the cap`).not.toBeNull();
    }
    expect(await countLiveCollaborators(campaign.id)).toBe(MAX_LIVE_COLLABORATORS);

    // One past the cap: null, so the route can say something specific.
    expect(
      await createInvite({
        campaignId: campaign.id,
        invitedEmail: 'one-too-many@test.invalid',
        invitedBy: owner.id,
      }),
    ).toBeNull();
  });

  it('a revocation frees a slot', async () => {
    const { owner, campaign } = await fixture();
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: 'leaver@test.invalid',
      invitedBy: owner.id,
    });
    expect(await countLiveCollaborators(campaign.id)).toBe(1);
    expect(await revokeCollaborator({ campaignId: campaign.id, collaboratorId: made!.row.id }))
      .toBe(true);
    expect(await countLiveCollaborators(campaign.id)).toBe(0);
  });

  it('accepting grants, and only then', async () => {
    const { owner, helper, campaign } = await fixture();
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: 'grant@test.invalid',
      invitedBy: owner.id,
    });

    expect(await canCollaborate(campaign.id, helper.id, 'post_update')).toBe(false);
    const outcome = await acceptInvite({ token: made!.token, userId: helper.id });
    expect(outcome).toEqual({ ok: true, campaignId: campaign.id });
    expect(await canCollaborate(campaign.id, helper.id, 'post_update')).toBe(true);
  });

  it('⛔ an unknown token grants nothing', async () => {
    const { helper } = await fixture();
    const { raw } = mintInviteToken();
    expect(await acceptInvite({ token: raw, userId: helper.id }))
      .toEqual({ ok: false, reason: 'not_found' });
  });

  it('⛔ an expired invitation is refused', async () => {
    const { owner, helper, campaign } = await fixture();
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: 'late@test.invalid',
      invitedBy: owner.id,
    });
    await db
      .update(schema.campaignCollaborators)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.campaignCollaborators.id, made!.row.id));

    expect(await acceptInvite({ token: made!.token, userId: helper.id }))
      .toEqual({ ok: false, reason: 'expired' });
    expect(await canCollaborate(campaign.id, helper.id, 'post_update')).toBe(false);
  });

  it('⛔ a revoked invitation cannot be accepted', async () => {
    const { owner, helper, campaign } = await fixture();
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: 'gone@test.invalid',
      invitedBy: owner.id,
    });
    await revokeCollaborator({ campaignId: campaign.id, collaboratorId: made!.row.id });

    expect(await acceptInvite({ token: made!.token, userId: helper.id }))
      .toEqual({ ok: false, reason: 'not_found' });
  });

  it('accepting twice from the SAME account is success, not an error', async () => {
    // A double-clicked link must not read as a failure to the person who
    // just succeeded.
    const { owner, helper, campaign } = await fixture();
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: 'twice-ok@test.invalid',
      invitedBy: owner.id,
    });
    await acceptInvite({ token: made!.token, userId: helper.id });
    expect(await acceptInvite({ token: made!.token, userId: helper.id }))
      .toEqual({ ok: true, campaignId: campaign.id });
  });

  it('⛔ a second ACCOUNT cannot accept an invitation already taken', async () => {
    const { owner, helper, campaign } = await fixture();
    const other = await seedUser({ email: `other-${Date.now()}@test.invalid` });
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: 'shared@test.invalid',
      invitedBy: owner.id,
    });
    await acceptInvite({ token: made!.token, userId: helper.id });

    expect(await acceptInvite({ token: made!.token, userId: other.id }))
      .toEqual({ ok: false, reason: 'already_accepted' });
    expect(await canCollaborate(campaign.id, other.id, 'post_update')).toBe(false);
  });

  it('⛔ two simultaneous accepts of one invitation: exactly one wins', async () => {
    /*
      The `accepted_at IS NULL` guard on the UPDATE is what makes this one.
      A read-then-write would attach the campaign to whichever account
      happened to be scheduled second, with no error.
    */
    const { owner, helper, campaign } = await fixture();
    const other = await seedUser({ email: `racer-${Date.now()}@test.invalid` });
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: 'accept-race@test.invalid',
      invitedBy: owner.id,
    });

    const outcomes = await Promise.all([
      acceptInvite({ token: made!.token, userId: helper.id }),
      acceptInvite({ token: made!.token, userId: other.id }),
    ]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);

    const granted = await Promise.all([
      canCollaborate(campaign.id, helper.id, 'post_update'),
      canCollaborate(campaign.id, other.id, 'post_update'),
    ]);
    expect(granted.filter(Boolean)).toHaveLength(1);
  });

  it('⛔ revoking is scoped to the campaign, so an id from elsewhere does nothing', async () => {
    const { owner, campaign } = await fixture();
    const other = await seedCampaign({ creatorId: owner.id, slug: `scope-${Date.now()}` });
    const made = await createInvite({
      campaignId: campaign.id,
      invitedEmail: 'scoped@test.invalid',
      invitedBy: owner.id,
    });

    // Same row id, wrong campaign: refused.
    expect(await revokeCollaborator({ campaignId: other.id, collaboratorId: made!.row.id }))
      .toBe(false);
    expect(await countLiveCollaborators(campaign.id)).toBe(1);
  });

  it('lists pending and accepted members, and nothing revoked', async () => {
    const { owner, helper, campaign } = await fixture();
    const a = await createInvite({
      campaignId: campaign.id, invitedEmail: 'a@test.invalid', invitedBy: owner.id,
    });
    await createInvite({
      campaignId: campaign.id, invitedEmail: 'b@test.invalid', invitedBy: owner.id,
    });
    const c = await createInvite({
      campaignId: campaign.id, invitedEmail: 'c@test.invalid', invitedBy: owner.id,
    });
    await acceptInvite({ token: a!.token, userId: helper.id });
    await revokeCollaborator({ campaignId: campaign.id, collaboratorId: c!.row.id });

    const listed = await listCollaborators(campaign.id);
    expect(listed.map((r) => r.invitedEmail).sort()).toEqual(['a@test.invalid', 'b@test.invalid']);
    expect(listed.find((r) => r.invitedEmail === 'a@test.invalid')!.acceptedAt).not.toBeNull();
    expect(listed.find((r) => r.invitedEmail === 'b@test.invalid')!.acceptedAt).toBeNull();
  });
});
