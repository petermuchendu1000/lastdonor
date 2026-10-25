/**
 * Institutional vouches against a real Postgres.
 *
 * ── WHAT ONLY A DATABASE CAN SETTLE ─────────────────────────────────────────
 *
 * `decide.test.ts` covers the decisions. None of it can tell whether:
 *
 *   - the PARTIAL unique index actually permits a second vouch after a
 *     revocation and refuses a second live one (a partial index is the kind of
 *     thing that silently becomes a total one in a migration),
 *   - the `revocation_complete` CHECK really rejects half a revocation,
 *   - `db.$count` as a correlated subquery emits the SQL it looks like it
 *     emits - the `docs/101` lesson is that a `sql` expression can be valid,
 *     silent and wrong,
 *   - the rolling budget counts REVOKED vouches, which is what stops an
 *     attacker reclaiming budget,
 *   - and above all: whether a vouch lifts the pre-verification raise cap,
 *     and whether revoking it puts the cap back.
 *
 * That last pair is the whole point of the feature and the whole risk of it,
 * so it is asserted through `checkRaiseCap` - the function the money-in routes
 * actually call - and not by reading `verification_status` and assuming.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { checkRaiseCap } from '@/lib/campaign-raise-cap';
import { getCurrency } from '@/lib/money/currencies';
import { VOUCH_WINDOW_DAYS } from './decide';
import { listCampaignVouches, recordVouch, revokeVouch } from './vouch';
import { clearDatabase, seedCampaign, seedUser } from '../../../test/helpers';

const USD = getCurrency('USD');

async function seedAdmin() {
  return seedUser({ role: 'admin', email: `admin-${Date.now()}-${Math.random()}@test.invalid` });
}

async function seedInstitution(
  verifiedBy: string,
  overrides: Partial<typeof schema.trustedInstitutions.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.trustedInstitutions)
    .values({
      name: `St Mary Hospital ${Math.random().toString(36).slice(2, 8)}`,
      kind: 'hospital',
      country: 'KE',
      verificationNotes: 'Called the switchboard and confirmed the finance office.',
      verifiedBy,
      ...overrides,
    })
    .returning();
  return row;
}

const representative = {
  representativeName: 'Grace Wanjiku',
  representativeRole: 'Medical Social Worker',
  representativeEmail: 'grace@example.invalid',
  relationship: 'The patient has been admitted to our paediatric ward since 3 March.',
  statement: 'We confirm the admission and the outstanding bill on this account.',
};

/** The raise cap exactly as a money-in route asks about it. */
async function capFor(campaignId: string) {
  const [c] = await db
    .select({
      verificationStatus: schema.campaigns.verificationStatus,
      currency: schema.campaigns.currency,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  return checkRaiseCap(
    { verificationStatus: c.verificationStatus, currency: c.currency, realRaisedMinor: 0 },
    USD.unverifiedCapMinor + 1,
  );
}

describe('recordVouch', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await clearDatabase();
  });

  it('verifies the campaign and lifts the raise cap', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    /*
      `publishedAt: null` is part of the fixture, not decoration: docs/78 makes
      an `under_review` campaign one with no publish stamp, and `seedCampaign`
      stamps one by default. Without this the assertion below would be about
      the fixture rather than about the vouch.
    */
    const campaign = await seedCampaign({
      currency: 'USD',
      status: 'under_review',
      publishedAt: null,
    });

    // Before: one shilling over the cap is refused.
    const before = await capFor(campaign.id);
    expect(before.allowed).toBe(false);

    const result = await recordVouch({
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });

    expect(result).toMatchObject({ ok: true, liftedRaiseCap: true });

    const [after] = await db
      .select({
        verificationStatus: schema.campaigns.verificationStatus,
        verificationSource: schema.campaigns.verificationSource,
        status: schema.campaigns.status,
        publishedAt: schema.campaigns.publishedAt,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .limit(1);

    expect(after.verificationStatus).toBe('identity_verified');
    expect(after.verificationSource).toBe('institution_vouch');
    expect((await capFor(campaign.id)).allowed).toBe(true);

    // ⛔ And the publication review is untouched: docs/78, docs/79.
    expect(after.status).toBe('under_review');
    expect(after.publishedAt).toBeNull();
  });

  it('⛔ does not release a cent, and leaves the campaign short of fully_verified', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const campaign = await seedCampaign({ currency: 'USD' });

    await recordVouch({
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });

    const [after] = await db
      .select({
        verificationStatus: schema.campaigns.verificationStatus,
        totalReleasedAmount: schema.campaigns.totalReleasedAmount,
        totalWithdrawnAmount: schema.campaigns.totalWithdrawnAmount,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .limit(1);

    expect(after.verificationStatus).not.toBe('fully_verified');
    expect(after.totalReleasedAmount).toBe(0);
    expect(after.totalWithdrawnAmount).toBe(0);
  });

  it('writes an audit row naming the institution and the status change', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const campaign = await seedCampaign({ currency: 'USD' });

    await recordVouch({
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });

    const [row] = await db
      .select({ eventType: schema.auditLogs.eventType, details: schema.auditLogs.details })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.eventType, 'institution.vouch_recorded'));

    expect(row).toBeDefined();
    const details = row.details as Record<string, unknown>;
    expect(details.institutionName).toBe(institution.name);
    expect(details.verificationStatusBefore).toBe('unverified');
    expect(details.verificationStatusAfter).toBe('identity_verified');
    expect(details.vouchesUsedInWindow).toBe(1);
  });

  it('refuses a second live vouch from the same institution, and the index agrees', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const campaign = await seedCampaign({ currency: 'USD' });
    const input = {
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    };

    expect((await recordVouch(input)).ok).toBe(true);

    const second = await recordVouch(input);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('ALREADY_VOUCHED');

    /*
      And the database refuses it independently of the application check. A
      guard that lives only in TypeScript is a guard one new code path can
      walk around.
    */
    await expect(
      db.insert(schema.institutionVouches).values({ ...input, campaignId: campaign.id }),
    ).rejects.toThrow();
  });

  it('lets a SECOND institution vouch for the same campaign', async () => {
    // Two organisations independently confirming a crisis is corroboration,
    // not a duplicate, and is allowed by the partial index.
    const admin = await seedAdmin();
    const hospital = await seedInstitution(admin.id, { name: 'Kenyatta Hospital', kind: 'hospital' });
    const church = await seedInstitution(admin.id, { name: 'All Saints Cathedral', kind: 'faith' });
    const campaign = await seedCampaign({ currency: 'USD' });

    expect(
      (await recordVouch({
        institutionId: hospital.id,
        campaignId: campaign.id,
        recordedBy: admin.id,
        ...representative,
      })).ok,
    ).toBe(true);

    /*
      ⚠️ The campaign is now `identity_verified`, which `canCampaignBeVouched`
      refuses. That is correct for a FIRST vouch and wrong for corroboration,
      and it is recorded in docs/108 as a known limit rather than papered
      over: a second institution's vouch has to be recorded before the first,
      or not at all.
    */
    const second = await recordVouch({
      institutionId: church.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('VERIFICATION_STATE');
  });

  it('refuses a suspended institution', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id, {
      status: 'suspended',
      suspendedAt: new Date(),
      suspendedReason: 'Their email was compromised.',
    });
    const campaign = await seedCampaign({ currency: 'USD' });

    const r = await recordVouch({
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('INSTITUTION_SUSPENDED');

    // And nothing was written on the way to the refusal.
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.institutionVouches);
    expect(n).toBe(0);
    const [c] = await db
      .select({ verificationStatus: schema.campaigns.verificationStatus })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id));
    expect(c.verificationStatus).toBe('unverified');
  });

  it('⚠️ counts REVOKED vouches against the rolling budget', async () => {
    /*
      The attack this closes: if revoking your own vouch gave the budget
      back, an institution with a limit of 2 could vouch, revoke, vouch,
      revoke, forever. The budget is a rate of ASSERTIONS.
    */
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id, { monthlyVouchLimit: 2 });
    const campaigns = await Promise.all([
      seedCampaign({ currency: 'USD', slug: `c1-${Date.now()}` }),
      seedCampaign({ currency: 'USD', slug: `c2-${Date.now()}` }),
      seedCampaign({ currency: 'USD', slug: `c3-${Date.now()}` }),
    ]);

    const first = await recordVouch({
      institutionId: institution.id,
      campaignId: campaigns[0].id,
      recordedBy: admin.id,
      ...representative,
    });
    expect(first.ok).toBe(true);

    // Revoke it. The budget must NOT come back.
    expect((await revokeVouch({
      vouchId: first.ok ? first.vouchId : '',
      revokedBy: admin.id,
      reason: 'Recorded against the wrong campaign.',
    })).ok).toBe(true);

    expect((await recordVouch({
      institutionId: institution.id,
      campaignId: campaigns[1].id,
      recordedBy: admin.id,
      ...representative,
    })).ok).toBe(true);

    const third = await recordVouch({
      institutionId: institution.id,
      campaignId: campaigns[2].id,
      recordedBy: admin.id,
      ...representative,
    });
    expect(third.ok).toBe(false);
    expect(third.ok === false && third.code).toBe('INSTITUTION_BUDGET_SPENT');
  });

  it('forgets a vouch older than the window', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id, { monthlyVouchLimit: 1 });
    const older = await seedCampaign({ currency: 'USD', slug: `old-${Date.now()}` });
    const newer = await seedCampaign({ currency: 'USD', slug: `new-${Date.now()}` });

    const longAgo = new Date(Date.now() - (VOUCH_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    await recordVouch(
      {
        institutionId: institution.id,
        campaignId: older.id,
        recordedBy: admin.id,
        ...representative,
      },
      longAgo,
    );

    // Budget of 1, one vouch already - but it fell out of the window.
    const r = await recordVouch({
      institutionId: institution.id,
      campaignId: newer.id,
      recordedBy: admin.id,
      ...representative,
    });
    expect(r.ok).toBe(true);
  });

  it('refuses a campaign that does not exist, without inventing one', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const r = await recordVouch({
      institutionId: institution.id,
      campaignId: '00000000-0000-4000-a000-000000000000',
      recordedBy: admin.id,
      ...representative,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('NOT_FOUND');
  });
});

describe('revokeVouch', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('puts the campaign back under its raise cap when nothing else verified it', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const campaign = await seedCampaign({ currency: 'USD' });

    const vouch = await recordVouch({
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });
    expect((await capFor(campaign.id)).allowed).toBe(true);

    const result = await revokeVouch({
      vouchId: vouch.ok ? vouch.vouchId : '',
      revokedBy: admin.id,
      reason: 'The hospital says it never sent this.',
    });

    expect(result).toMatchObject({ ok: true, unverified: true });

    const [after] = await db
      .select({
        verificationStatus: schema.campaigns.verificationStatus,
        verificationSource: schema.campaigns.verificationSource,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .limit(1);
    expect(after.verificationStatus).toBe('unverified');
    expect(after.verificationSource).toBeNull();
    expect((await capFor(campaign.id)).allowed).toBe(false);
  });

  it('⛔ does NOT un-verify a campaign a person verified from documents', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const campaign = await seedCampaign({ currency: 'USD' });

    const vouch = await recordVouch({
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });

    // An admin then reviews the documents, which overwrites the source.
    await db
      .update(schema.campaigns)
      .set({ verificationSource: 'documents' })
      .where(eq(schema.campaigns.id, campaign.id));

    const result = await revokeVouch({
      vouchId: vouch.ok ? vouch.vouchId : '',
      revokedBy: admin.id,
      reason: 'Tidying up a duplicate record.',
    });

    expect(result).toMatchObject({ ok: true, unverified: false });
    const [after] = await db
      .select({ verificationStatus: schema.campaigns.verificationStatus })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaign.id))
      .limit(1);
    expect(after.verificationStatus).toBe('identity_verified');
  });

  it('keeps the revoked row, with who and why', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const campaign = await seedCampaign({ currency: 'USD' });

    const vouch = await recordVouch({
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });
    await revokeVouch({
      vouchId: vouch.ok ? vouch.vouchId : '',
      revokedBy: admin.id,
      reason: 'The hospital says it never sent this.',
    });

    const all = await listCampaignVouches(campaign.id);
    expect(all).toHaveLength(1);
    expect(all[0].revokedAt).toBeInstanceOf(Date);
    expect(all[0].revokedReason).toBe('The hospital says it never sent this.');
    expect(all[0].institutionName).toBe(institution.name);
    expect(all[0].statement).toBe(representative.statement);

    // No live vouch remains.
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.institutionVouches)
      .where(
        and(
          eq(schema.institutionVouches.campaignId, campaign.id),
          isNull(schema.institutionVouches.revokedAt),
        ),
      );
    expect(n).toBe(0);
  });

  it('lets the same institution vouch again after revoking', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const campaign = await seedCampaign({ currency: 'USD' });
    const input = {
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    };

    const first = await recordVouch(input);
    await revokeVouch({
      vouchId: first.ok ? first.vouchId : '',
      revokedBy: admin.id,
      reason: 'Recorded with the wrong representative.',
    });

    // The PARTIAL index is what makes this possible. A total unique index on
    // (institution, campaign) would refuse it.
    const second = await recordVouch(input);
    expect(second.ok).toBe(true);
    expect(await listCampaignVouches(campaign.id)).toHaveLength(2);
  });

  it('refuses to revoke twice', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const campaign = await seedCampaign({ currency: 'USD' });
    const vouch = await recordVouch({
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });
    const id = vouch.ok ? vouch.vouchId : '';

    expect((await revokeVouch({ vouchId: id, revokedBy: admin.id, reason: 'First.' })).ok).toBe(true);
    const again = await revokeVouch({ vouchId: id, revokedBy: admin.id, reason: 'Second.' });
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.code).toBe('ALREADY_REVOKED');
  });
});

describe('the database enforces what the comments claim', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('rejects half a revocation', async () => {
    const admin = await seedAdmin();
    const institution = await seedInstitution(admin.id);
    const campaign = await seedCampaign({ currency: 'USD' });
    const vouch = await recordVouch({
      institutionId: institution.id,
      campaignId: campaign.id,
      recordedBy: admin.id,
      ...representative,
    });

    // revoked_at without revoked_by is a revocation with nobody's name on it.
    await expect(
      db
        .update(schema.institutionVouches)
        .set({ revokedAt: new Date() })
        .where(eq(schema.institutionVouches.id, vouch.ok ? vouch.vouchId : '')),
    ).rejects.toThrow();
  });

  it('rejects a country code that is not two upper-case letters', async () => {
    const admin = await seedAdmin();
    await expect(seedInstitution(admin.id, { country: 'Kenya' })).rejects.toThrow();
    await expect(seedInstitution(admin.id, { country: 'ke' })).rejects.toThrow();
  });

  it('rejects a duplicate organisation in the same country, case-insensitively', async () => {
    const admin = await seedAdmin();
    await seedInstitution(admin.id, { name: 'Nairobi Hospital', country: 'KE' });
    await expect(
      seedInstitution(admin.id, { name: 'nairobi hospital', country: 'KE' }),
    ).rejects.toThrow();
    // Same name in a different country is a different organisation.
    await expect(
      seedInstitution(admin.id, { name: 'Nairobi Hospital', country: 'UG' }),
    ).resolves.toBeDefined();
  });
});
