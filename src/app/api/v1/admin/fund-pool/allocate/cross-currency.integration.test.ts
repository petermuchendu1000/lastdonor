/**
 * Fund-pool allocations may not cross a currency boundary.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `POST /api/v1/admin/fund-pool/allocate` validated the allocation ids, their
 * `pending` status, and that the target campaign is not simulated. It never
 * compared currencies - and `fund_pool_allocations` has NO currency column of
 * its own, so an allocation's `amount` belongs to the campaign the money came
 * FROM. Moving one onto a campaign in another currency silently re-reads the
 * figure: KES 5,000 becomes US$50 on the next screen that renders it, the same
 * ~130x shape as the `/transparency` defect in `docs/114` §1.
 *
 * ⚠️ Severity, traced before claiming it (`docs/115` §7.2): allocations are
 * inserted only behind `campaign.simulationFlag` (`payment-service.ts:335`),
 * and `fund-pool/disburse` flips a status and writes an audit row WITHOUT
 * crediting any campaign. So this was a reporting defect. The guard goes in
 * before disbursement ever credits a balance, which is the moment it would
 * stop being one.
 *
 * ── WHY THE REAL HANDLER AND THE REAL DATABASE ──────────────────────────────
 *
 * The defect was a MISSING JOIN, not a wrong comparison. A unit test over a
 * pure predicate would have passed against the broken route, because the
 * broken route never had the source currency to compare. Only running the
 * actual query proves it is now fetched.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMock = vi.hoisted(() => ({
  value: { user: { id: '', role: 'admin', email: 'admin@test.invalid' } },
}));

/*
  ⚠️ The whole module is replaced, with NO `vi.importActual`. Importing the
  real one pulls in next-auth, which resolves `next/server` - absent in the
  integration suite's `node` environment - and the mock fails to load with a
  message about hoisting that has nothing to do with the cause.

  The route imports exactly these three symbols, so exactly these three are
  provided.
*/
vi.mock('@/lib/auth', () => ({
  requireRole: async () => sessionMock.value,
  UnauthorizedError: class UnauthorizedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { clearDatabase, seedCampaign, seedUser } from '../../../../../../../test/helpers';
import { POST } from './route';

/** A donation on `campaign`, in that campaign's currency. */
async function seedDonation(campaignId: string, currency: string, amount: number) {
  const [row] = await db
    .insert(schema.donations)
    .values({
      campaignId,
      amount,
      currency,
      donorEmail: `d-${Math.random()}@test.invalid`,
      donorName: 'A Donor',
      source: 'seed',
      refunded: false,
      stripePaymentId: `seed_${Math.random().toString(36).slice(2)}`,
      // NOT NULL with no default; enum read off the live schema.
      phaseAtTime: 'first_believers',
    })
    .returning();
  return row;
}

async function seedAllocation(donationId: string, sourceCampaignId: string, amount: number) {
  const [row] = await db
    .insert(schema.fundPoolAllocations)
    .values({ donationId, sourceCampaignId, amount, status: 'pending' })
    .returning();
  return row;
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/v1/admin/fund-pool/allocate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let kesSource: Awaited<ReturnType<typeof seedCampaign>>;
let usdTarget: Awaited<ReturnType<typeof seedCampaign>>;
let kesTarget: Awaited<ReturnType<typeof seedCampaign>>;

beforeEach(async () => {
  await clearDatabase();
  const admin = await seedUser({ email: `admin-${Math.random()}@test.invalid`, role: 'admin' });
  sessionMock.value = { user: { id: admin.id, role: 'admin', email: admin.email ?? '' } };

  // The SOURCE is simulated, because that is the only way an allocation is
  // ever created (`payment-service.ts:335`). The TARGETS are real, because
  // the route refuses a simulated target.
  kesSource = await seedCampaign({
    creatorId: admin.id, currency: 'KES', slug: `kes-src-${Date.now()}`, simulationFlag: true,
  });
  usdTarget = await seedCampaign({
    creatorId: admin.id, currency: 'USD', slug: `usd-tgt-${Date.now()}`, simulationFlag: false, status: 'active',
  });
  kesTarget = await seedCampaign({
    creatorId: admin.id, currency: 'KES', slug: `kes-tgt-${Date.now()}`, simulationFlag: false, status: 'active',
  });
});

describe('POST /api/v1/admin/fund-pool/allocate — currency boundary', () => {
  it('⛔ REFUSES a KES allocation onto a USD campaign', async () => {
    const donation = await seedDonation(kesSource.id, 'KES', 500_000);
    const allocation = await seedAllocation(donation.id, kesSource.id, 500_000);

    const res = await POST(
      post({ allocationIds: [allocation.id], targetCampaignId: usdTarget.id }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // The message must name both currencies, or an admin cannot act on it.
    expect(body.error.message).toContain('KES');
    expect(body.error.message).toContain('USD');

    // And nothing may have been written.
    const [after] = await db
      .select({ status: schema.fundPoolAllocations.status, target: schema.fundPoolAllocations.targetCampaignId })
      .from(schema.fundPoolAllocations)
      .where(eq(schema.fundPoolAllocations.id, allocation.id));
    expect(after.status).toBe('pending');
    expect(after.target).toBeNull();
  });

  it('ALLOWS the same allocation onto a campaign in its own currency', async () => {
    /*
      The other half, and the one that proves the guard is not simply
      refusing everything - a check that always fails is as useless as one
      that never does.
    */
    const donation = await seedDonation(kesSource.id, 'KES', 500_000);
    const allocation = await seedAllocation(donation.id, kesSource.id, 500_000);

    const res = await POST(
      post({ allocationIds: [allocation.id], targetCampaignId: kesTarget.id }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.allocated).toBe(1);

    const [after] = await db
      .select({ status: schema.fundPoolAllocations.status, target: schema.fundPoolAllocations.targetCampaignId })
      .from(schema.fundPoolAllocations)
      .where(eq(schema.fundPoolAllocations.id, allocation.id));
    expect(after.status).toBe('allocated');
    expect(after.target).toBe(kesTarget.id);
  });

  it('⛔ refuses the WHOLE batch when only one allocation is in another currency', async () => {
    /*
      The batch is a single transaction, so a partial allocation would be
      worse than a refusal: some funds moved, some not, and no record of
      which. The route takes up to 100 ids at a time.
    */
    const usdSource = await seedCampaign({
      creatorId: sessionMock.value.user.id, currency: 'USD',
      slug: `usd-src-${Date.now()}`, simulationFlag: true,
    });
    const good = await seedAllocation((await seedDonation(kesSource.id, 'KES', 1_000)).id, kesSource.id, 1_000);
    const bad = await seedAllocation((await seedDonation(usdSource.id, 'USD', 2_000)).id, usdSource.id, 2_000);

    const res = await POST(
      post({ allocationIds: [good.id, bad.id], targetCampaignId: kesTarget.id }) as never,
    );
    expect(res.status).toBe(400);

    // The matching one must NOT have been allocated either.
    const rows = await db
      .select({ id: schema.fundPoolAllocations.id, status: schema.fundPoolAllocations.status })
      .from(schema.fundPoolAllocations);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('records the currency on the audit row, so the decision is reconstructible', async () => {
    const donation = await seedDonation(kesSource.id, 'KES', 7_500);
    const allocation = await seedAllocation(donation.id, kesSource.id, 7_500);

    await POST(post({ allocationIds: [allocation.id], targetCampaignId: kesTarget.id }) as never);

    const [audit] = await db
      .select({ details: schema.auditLogs.details })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.eventType, 'fund_pool.allocated'));
    expect((audit.details as Record<string, unknown>).currency).toBe('KES');
  });
});
