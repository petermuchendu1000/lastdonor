/**
 * Settling a PayHero collection, executed against a real Postgres.
 *
 * ── WHY THIS IS AN INTEGRATION TEST ────────────────────────────────────────
 *
 * `settlePayHeroRequest` returns `{ kind: 'recorded' }` and the status route
 * turns that into `state: 'succeeded'`, which the donor reads as
 * "Thank you - your donation is in". Whether a donation row was ACTUALLY
 * written is decided inside `recordGatewayCharge`, which has early returns
 * that write none - and the only way to see which of those fired is to run
 * the whole thing against a database. `payhero-settlement.test.ts` mocks
 * `@/db`, so it cannot: a mock cannot refuse an insert for a reason of its
 * own (`docs/124` §5.1).
 *
 * Only the GATEWAY is stubbed. Postgres is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, like } from 'drizzle-orm';

import type { TransactionStatus } from '@/lib/payhero';

const getTransactionStatus = vi.fn<(ref: string) => Promise<TransactionStatus>>();

vi.mock('@/lib/payhero', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payhero')>();
  return { ...actual, getTransactionStatus };
});

/*
  ⚠️ `payment-service.ts:27` imports `safeAsync` from `@/lib/api-handler`,
  which imports NextAuth -> `next/server`, which this node-environment suite
  CANNOT LOAD (`docs/126`, `docs/107`). Cutting it here is what lets the money
  path be executed at all. The stub is faithful: `safeAsync` takes an
  already-created promise and swallows its rejection.
*/
vi.mock('@/lib/api-handler', () => ({
  safeAsync: (p: Promise<unknown>) => {
    void Promise.resolve(p).catch(() => {});
  },
}));

// Outside a request scope `revalidatePath` has no store to invalidate.
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { db } = await import('@/db');
const schema = await import('@/db/schema');
const { settlePayHeroRequest } = await import('@/lib/services/payhero-settlement');
const { clearDatabase } = await import('../../../test/helpers');

let seq = 0;

function successStatus(amountMajor: number): TransactionStatus {
  return {
    status: 'SUCCESS',
    amountMajor,
    providerReference: `LAB${(seq += 1).toString().padStart(7, '0')}`,
    externalReference: null,
    phoneNumber: '0712345678',
    merchant: 'muchs',
    raw: { status: 'SUCCESS' },
  };
}

async function seedCampaign(status: 'active' | 'completed') {
  seq += 1;
  const [row] = await db
    .insert(schema.campaigns)
    .values({
      title: `Settlement fixture ${seq}`,
      slug: `settlement-fixture-${seq}-${Date.now()}`,
      storyHtml: '<p>Lab fixture for the settlement walk.</p>',
      subjectName: 'Lab Subject',
      category: 'medical',
      heroImageUrl: 'https://example.com/lab.jpg',
      goalAmount: 100_000,
      currency: 'KES',
      status,
      publishedAt: new Date(),
    })
    .returning({ id: schema.campaigns.id });
  return row.id;
}

async function seedRequest(campaignId: string, amountMinor: number) {
  seq += 1;
  const ref = `LD-lab-${seq}-${Date.now()}`;
  const [row] = await db
    .insert(schema.payheroPaymentRequests)
    .values({
      campaignId,
      currency: 'KES',
      amount: amountMinor,
      externalReference: ref,
      payheroReference: `ph-${seq}`,
      phoneE164: '+254712345678',
      msisdnSent: '0712345678',
      channelId: 1234,
      donorEmail: 'lab-donor@example.com',
      donorName: 'Lab Donor',
      status: 'pending',
    })
    .returning({ id: schema.payheroPaymentRequests.id });
  return { id: row.id, ref };
}

describe('settling a PayHero collection against a real database', () => {
  beforeEach(async () => {
    await clearDatabase();
    getTransactionStatus.mockReset();
  });

  it('CONTROL: an active campaign records a donation and the request carries its id', async () => {
    const campaignId = await seedCampaign('active');
    const { id, ref } = await seedRequest(campaignId, 5_000); // KES 50.00
    getTransactionStatus.mockResolvedValue(successStatus(50));

    const outcome = await settlePayHeroRequest(ref);

    expect(outcome.kind).toBe('recorded');

    const rows = await db.select().from(schema.donations).where(eq(schema.donations.campaignId, campaignId));
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(5_000);
    expect(rows[0].currency).toBe('KES');

    const [req] = await db
      .select()
      .from(schema.payheroPaymentRequests)
      .where(eq(schema.payheroPaymentRequests.id, id));
    expect(req.status).toBe('succeeded');
    expect(req.donationId).toBe(rows[0].id);
  });

  it('⛔ a campaign that completed during the prompt is NOT reported as recorded', async () => {
    /*
      The window `payment-service.ts` names in its own comment: the initiate
      route refuses a completed campaign, but a campaign can reach its goal
      while the donor is entering a PIN.
    */
    const campaignId = await seedCampaign('active');
    const { id, ref } = await seedRequest(campaignId, 5_000);
    await db
      .update(schema.campaigns)
      .set({ status: 'completed' })
      .where(eq(schema.campaigns.id, campaignId));

    getTransactionStatus.mockResolvedValue(successStatus(50));

    const outcome = await settlePayHeroRequest(ref);

    /*
      The outcome the status route may NOT turn into `state: 'succeeded'`.
      This used to be `recorded` - the function looked the donation up three
      lines earlier and returned `recorded` regardless.
    */
    expect(outcome.kind).toBe('collected_unrecorded');

    // And what the database actually holds.
    const rows = await db.select().from(schema.donations).where(eq(schema.donations.campaignId, campaignId));
    expect(rows, 'NO donation row is written on this path').toHaveLength(0);

    const [req] = await db
      .select()
      .from(schema.payheroPaymentRequests)
      .where(eq(schema.payheroPaymentRequests.id, id));
    expect(req.status, 'the request is already claimed as succeeded').toBe('succeeded');
    expect(req.donationId, 'nothing to link it to').toBeNull();

    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(like(schema.auditLogs.eventType, 'donation.%'));
    expect(audit.map((a) => a.eventType)).toContain('donation.manual_refund_required');
    expect(audit.find((a) => a.eventType === 'donation.manual_refund_required')?.severity).toBe(
      'critical',
    );

    // The durable record says so too, not just the return value.
    expect(req.failureReason ?? '').toMatch(/no donation row was written/i);
  });

  it('a settlement race re-reads the row, so a recorded donation is not reported as unrecorded', async () => {
    /*
      `already_settled` used to be returned with a hardcoded status and no
      donation link, so a caller that lost the race could not tell a booked
      collection from an unbooked one - the same blindness one layer up. The
      row read at the top of `settlePayHeroRequest` is stale by then.
    */
    const campaignId = await seedCampaign('active');
    const { id, ref } = await seedRequest(campaignId, 5_000);
    getTransactionStatus.mockResolvedValue(successStatus(50));

    // First caller wins and books the donation.
    expect((await settlePayHeroRequest(ref)).kind).toBe('recorded');

    // Second caller loses the race: the row is no longer pending.
    const second = await settlePayHeroRequest(ref);
    expect(second.kind).toBe('already_settled');
    if (second.kind !== 'already_settled') throw new Error('unreachable');
    expect(second.status).toBe('succeeded');

    const [req] = await db
      .select()
      .from(schema.payheroPaymentRequests)
      .where(eq(schema.payheroPaymentRequests.id, id));
    expect(
      second.donationId,
      'the loser must report the donation the winner wrote, not null',
    ).toBe(req.donationId);
    expect(second.donationId).not.toBeNull();
  });
});
