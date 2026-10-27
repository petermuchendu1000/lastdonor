/**
 * A collaborator's campaigns are listed, exactly once, and only while live.
 *
 * ── WHY AGAINST A REAL DATABASE ─────────────────────────────────────────────
 *
 * The query is a correlated `EXISTS` over another table. `docs/101` is the
 * precedent: a predicate of that shape can be valid SQL that is never true,
 * return zero rows for every input, and raise no error anywhere - unit tests,
 * a text ratchet and `tsc` all passed over exactly that defect, and only
 * running it against Postgres found it. A mock would prove nothing here.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `/dashboard/campaigns` was `where(eq(campaigns.creatorId, userId))`, so a
 * person who accepted an invitation landed on "You haven't created any
 * campaigns yet" while their membership row was live and accepted and the API
 * answered 200 for the same session (`docs/117`).
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { listMyCampaigns, resolveCampaignRole } from '@/lib/dashboard/my-campaigns.server';
import { clearDatabase, seedCampaign, seedUser } from '../../../test/helpers';

let creator: Awaited<ReturnType<typeof seedUser>>;
let helper: Awaited<ReturnType<typeof seedUser>>;
let stranger: Awaited<ReturnType<typeof seedUser>>;
let campaign: Awaited<ReturnType<typeof seedCampaign>>;

/** A membership row, in whatever state the case needs. */
async function membership(over: Partial<typeof schema.campaignCollaborators.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.campaignCollaborators)
    .values({
      campaignId: campaign.id,
      invitedEmail: `invite-${Math.random().toString(36).slice(2)}@test.invalid`,
      invitedBy: creator.id,
      tokenHash: Math.random().toString(36).repeat(4),
      expiresAt: new Date(Date.now() + 86_400_000),
      ...over,
    })
    .returning();
  return row;
}

beforeEach(async () => {
  await clearDatabase();
  creator = await seedUser({ email: `creator-${Math.random()}@test.invalid` });
  helper = await seedUser({ email: `helper-${Math.random()}@test.invalid` });
  stranger = await seedUser({ email: `stranger-${Math.random()}@test.invalid` });
  campaign = await seedCampaign({
    creatorId: creator.id,
    slug: `mine-${Math.random().toString(36).slice(2)}`,
    title: 'Help the Otieno family rebuild',
  });
});

describe('listMyCampaigns', () => {
  it('gives the creator their own campaign, as creator', async () => {
    const rows = await listMyCampaigns(creator.id);
    expect(rows.map((r) => r.id)).toEqual([campaign.id]);
    expect(rows[0].role).toBe('creator');
    expect(rows[0].title).toBe('Help the Otieno family rebuild');
  });

  it('⛔ gives an ACCEPTED collaborator the campaign, as collaborator', async () => {
    // The whole point of the module.
    await membership({ userId: helper.id, acceptedAt: new Date() });

    const rows = await listMyCampaigns(helper.id);
    expect(rows.map((r) => r.id)).toEqual([campaign.id]);
    expect(rows[0].role).toBe('collaborator');
  });

  it('⛔ a PENDING invitation lists nothing', async () => {
    // `user_id` is null until acceptance, so this must not match at all.
    await membership({ invitedEmail: helper.email ?? 'x@test.invalid' });
    expect(await listMyCampaigns(helper.id)).toEqual([]);
  });

  it('⛔ a row with a USER but no acceptance lists nothing', async () => {
    /*
      ⚠️ THE CASE THE PREVIOUS TEST DOES NOT COVER, and the reason this one
      exists. That one leaves `user_id` null, so the `userId` predicate alone
      excludes it and the test passes whether or not `accepted_at` is
      checked - proven by mutation: deleting `isNotNull(acceptedAt)` from the
      query left the whole file green.

      This is the state `can-collaborate.ts` names in its own comment: a
      future change that back-fills `user_id` at invitation time. Then only
      the acceptance predicate stands between a PENDING invite and access.
    */
    await membership({ userId: helper.id });
    expect(await listMyCampaigns(helper.id)).toEqual([]);
    expect(await resolveCampaignRole(campaign.id, helper.id)).toBeNull();
  });

  it('⛔ a REVOKED membership lists nothing, immediately', async () => {
    await membership({ userId: helper.id, acceptedAt: new Date(), revokedAt: new Date() });
    expect(await listMyCampaigns(helper.id)).toEqual([]);
  });

  it('⛔ lists a campaign ONCE even with two live memberships for one person', async () => {
    /*
      The reason this uses `exists` and not a `leftJoin`. The partial unique
      index is on `(campaign_id, invited_email)` while live, so one person who
      accepted invitations sent to two different addresses of theirs holds TWO
      live rows on ONE campaign - and a join would list it twice.
    */
    await membership({ userId: helper.id, acceptedAt: new Date(), invitedEmail: 'a@test.invalid' });
    await membership({ userId: helper.id, acceptedAt: new Date(), invitedEmail: 'b@test.invalid' });

    const rows = await listMyCampaigns(helper.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(campaign.id);
  });

  it('shows somebody unrelated nothing', async () => {
    await membership({ userId: helper.id, acceptedAt: new Date() });
    expect(await listMyCampaigns(stranger.id)).toEqual([]);
  });

  it('does not leak another campaign the membership is not for', async () => {
    const other = await seedCampaign({
      creatorId: stranger.id, slug: `other-${Math.random().toString(36).slice(2)}`,
    });
    await membership({ userId: helper.id, acceptedAt: new Date() });

    const rows = await listMyCampaigns(helper.id);
    expect(rows.map((r) => r.id)).toEqual([campaign.id]);
    expect(rows.map((r) => r.id)).not.toContain(other.id);
  });

  it('a creator who is ALSO a collaborator reads as creator, and once', async () => {
    // Contrived, but the role must be deterministic rather than whichever
    // branch the SQL happened to satisfy.
    await membership({ userId: creator.id, acceptedAt: new Date() });
    const rows = await listMyCampaigns(creator.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('creator');
  });
});

describe('resolveCampaignRole', () => {
  it('names the creator', async () => {
    expect(await resolveCampaignRole(campaign.id, creator.id)).toEqual({
      role: 'creator', creatorId: creator.id,
    });
  });

  it('names an accepted collaborator', async () => {
    await membership({ userId: helper.id, acceptedAt: new Date() });
    expect(await resolveCampaignRole(campaign.id, helper.id)).toEqual({
      role: 'collaborator', creatorId: creator.id,
    });
  });

  it('⛔ returns null for a pending invite, a revoked one, and a stranger', async () => {
    expect(await resolveCampaignRole(campaign.id, stranger.id)).toBeNull();

    await membership({ invitedEmail: 'pending@test.invalid' });
    expect(await resolveCampaignRole(campaign.id, helper.id)).toBeNull();

    await membership({ userId: helper.id, acceptedAt: new Date(), revokedAt: new Date() });
    expect(await resolveCampaignRole(campaign.id, helper.id)).toBeNull();
  });

  it('returns null for a campaign that does not exist', async () => {
    expect(
      await resolveCampaignRole('00000000-0000-4000-8000-000000000000', creator.id),
    ).toBeNull();
  });
});
