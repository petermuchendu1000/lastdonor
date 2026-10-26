/**
 * A campaign's destination, against a real Postgres.
 *
 * ── THE MUTANT THAT PROMPTED THIS FILE ──────────────────────────────────────
 *
 * `decide.test.ts` covers the decisions and the withdrawal route's unit test
 * covers the refusal. Neither could kill one mutation: deleting
 * `eq(status, 'active')` from the query left all 47 route tests green,
 * because that suite's database mock performs the filtering itself and cannot
 * read a `where()` argument.
 *
 * ⛔ The mutant is real, not equivalent. A campaign that was designated,
 * revoked and designated again holds TWO rows. Without the filter, `limit(1)`
 * can return the revoked one, the guard returns null, and the organiser
 * withdraws money their donors were told goes to a hospital. The tests below
 * build exactly that two-row state, which no amount of mocking reaches.
 *
 * Also settled only by a database:
 *   - the PARTIAL unique index permits a second designation after revocation
 *     and refuses a second live one (a partial index is exactly the thing
 *     that quietly becomes a total one in a migration),
 *   - the two composite FKs make a currency mismatch UNSTORABLE rather than
 *     merely validated (`docs/92`).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';
import { organiserWithdrawalBlockedBy } from './decide';
import { activeDesignation } from './designation.server';
import { clearDatabase, seedCampaign, seedUser } from '../../../test/helpers';

async function seedWorld(currency = 'KES') {
  const admin = await seedUser({
    role: 'admin',
    email: `admin-${Date.now()}-${Math.random()}@test.invalid`,
  });
  const campaign = await seedCampaign({ creatorId: admin.id, currency });
  const [institution] = await db
    .insert(schema.trustedInstitutions)
    .values({
      name: `Hospital ${Math.random()}`,
      kind: 'hospital',
      country: 'KE',
      verifiedBy: admin.id,
      verificationNotes: 'rang the billing office and read the shortcode back',
    })
    .returning();
  const [account] = await db
    .insert(schema.institutionPayoutAccounts)
    .values({
      institutionId: institution.id,
      currency,
      rail: 'mpesa_paybill',
      accountIdentifier: '403480',
      accountReferenceLabel: 'patient file number',
      confirmedBy: admin.id,
      confirmationNotes: 'rang the billing office and read the shortcode back',
    })
    .returning();
  return { admin, campaign, institution, account };
}

function designationValues(w: Awaited<ReturnType<typeof seedWorld>>, reference: string) {
  return {
    campaignId: w.campaign.id,
    payoutAccountId: w.account.id,
    currency: w.campaign.currency,
    accountReference: reference,
    designatedBy: w.admin.id,
  };
}

beforeEach(async () => {
  await clearDatabase();
});

describe('activeDesignation', () => {
  it('returns nothing for a campaign nobody designated — every campaign today', async () => {
    const w = await seedWorld();
    expect(await activeDesignation(db, w.campaign.id)).toBeNull();
    expect(organiserWithdrawalBlockedBy(await activeDesignation(db, w.campaign.id))).toBeNull();
  });

  it('returns the live designation and blocks the organiser', async () => {
    const w = await seedWorld();
    await db.insert(schema.campaignPayoutDesignations).values(designationValues(w, 'IP/1'));

    const row = await activeDesignation(db, w.campaign.id);
    expect(row?.status).toBe('active');
    expect(organiserWithdrawalBlockedBy(row)).toBe('designated_to_institution');
  });

  it('⛔ THE MUTANT: a revoked row beside a live one must still block', async () => {
    /*
      Revoke-then-redesignate is ordinary - an organiser picks the wrong
      hospital, or the first account is retired. The campaign then holds two
      rows, and a query without the `active` filter can return either.
    */
    const w = await seedWorld();
    await db.insert(schema.campaignPayoutDesignations).values(designationValues(w, 'IP/old'));
    await db
      .update(schema.campaignPayoutDesignations)
      .set({ status: 'revoked', revokedAt: new Date(), revokedBy: w.admin.id })
      .where(eq(schema.campaignPayoutDesignations.campaignId, w.campaign.id));
    await db.insert(schema.campaignPayoutDesignations).values(designationValues(w, 'IP/new'));

    const rows = await db
      .select()
      .from(schema.campaignPayoutDesignations)
      .where(eq(schema.campaignPayoutDesignations.campaignId, w.campaign.id));
    expect(rows, 'the two-row state this test exists for').toHaveLength(2);

    const row = await activeDesignation(db, w.campaign.id);
    expect(row?.status).toBe('active');
    expect(organiserWithdrawalBlockedBy(row)).toBe('designated_to_institution');
  });

  it('stops blocking once the only designation is revoked', async () => {
    const w = await seedWorld();
    await db.insert(schema.campaignPayoutDesignations).values(designationValues(w, 'IP/1'));
    await db
      .update(schema.campaignPayoutDesignations)
      .set({ status: 'revoked', revokedAt: new Date(), revokedBy: w.admin.id })
      .where(eq(schema.campaignPayoutDesignations.campaignId, w.campaign.id));

    expect(organiserWithdrawalBlockedBy(await activeDesignation(db, w.campaign.id))).toBeNull();
  });
});

describe('the database guarantees, not the validation', () => {
  it('⛔ refuses a SECOND live designation on one campaign', async () => {
    const w = await seedWorld();
    await db.insert(schema.campaignPayoutDesignations).values(designationValues(w, 'IP/1'));

    await expect(
      db.insert(schema.campaignPayoutDesignations).values(designationValues(w, 'IP/2')),
    ).rejects.toThrow(/idx_campaign_payout_designations_one_active/);
  });

  it('permits a new designation after a revocation (the index is PARTIAL)', async () => {
    const w = await seedWorld();
    await db.insert(schema.campaignPayoutDesignations).values(designationValues(w, 'IP/1'));
    await db
      .update(schema.campaignPayoutDesignations)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(schema.campaignPayoutDesignations.campaignId, w.campaign.id));

    await expect(
      db.insert(schema.campaignPayoutDesignations).values(designationValues(w, 'IP/2')),
    ).resolves.toBeDefined();
  });

  it('⛔ makes a CURRENCY MISMATCH unstorable, in both directions', async () => {
    /*
      `docs/92`: a campaign has one currency and two are never added
      together. The two composite FKs must BOTH hold, so neither naming the
      account's currency nor lying about it can route a KES ledger to a USD
      account.
    */
    const w = await seedWorld('KES');
    const [usdAccount] = await db
      .insert(schema.institutionPayoutAccounts)
      .values({
        institutionId: w.institution.id,
        currency: 'USD',
        rail: 'mpesa_paybill',
        accountIdentifier: '403480',
        accountReferenceLabel: 'patient file number',
        confirmedBy: w.admin.id,
        confirmationNotes: 'rang the billing office and read the shortcode back',
      })
      .returning();

    // Honest about the account's currency -> the CAMPAIGN fk rejects it.
    await expect(
      db.insert(schema.campaignPayoutDesignations).values({
        campaignId: w.campaign.id,
        payoutAccountId: usdAccount.id,
        currency: 'USD',
        accountReference: 'IP/3',
        designatedBy: w.admin.id,
      }),
    ).rejects.toThrow(/campaign_currency_fk/);

    // Lying about it to match the campaign -> the ACCOUNT fk rejects it.
    await expect(
      db.insert(schema.campaignPayoutDesignations).values({
        campaignId: w.campaign.id,
        payoutAccountId: usdAccount.id,
        currency: 'KES',
        accountReference: 'IP/4',
        designatedBy: w.admin.id,
      }),
    ).rejects.toThrow(/account_currency_fk/);
  });

  it('⛔ refuses a blank account reference', async () => {
    const w = await seedWorld();
    await expect(
      db.insert(schema.campaignPayoutDesignations).values(designationValues(w, '   ')),
    ).rejects.toThrow(/reference_nonblank/);
  });

  it('⛔ refuses a payout account with no account of how it was checked', async () => {
    const w = await seedWorld();
    await expect(
      db.insert(schema.institutionPayoutAccounts).values({
        institutionId: w.institution.id,
        currency: 'KES',
        rail: 'mpesa_paybill',
        accountIdentifier: '403480',
        accountReferenceLabel: 'patient file number',
        confirmedBy: w.admin.id,
        confirmationNotes: 'ok',
      }),
    ).rejects.toThrow(/notes_substantive/);
  });
});
