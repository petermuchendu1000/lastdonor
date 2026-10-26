/**
 * A campaign's currency is chosen at creation, and NOTHING could choose it.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `campaigns.currency` is the target of a composite foreign key from
 * `donations (campaign_id, currency)`, which makes a campaign single-currency
 * and immutable once money arrives (`docs/92`). It is therefore settable at
 * exactly one moment: the insert.
 *
 * ⛔ All four `insert(campaigns)` sites OMITTED THE COLUMN, so every campaign
 * this codebase has ever created took the `'USD'` column default - on a
 * platform where Stripe cannot take a payment at all (`docs/72`) and every
 * donation ever collected came over M-Pesa in shillings (`docs/92`).
 *
 * Both create validators then hardcoded dollars in their goal bounds:
 * `createCampaignSchema` said `.min(100_000, 'Minimum goal is $1,000')`, and
 * `createUserCampaignSchema` `.min(100, 'Minimum goal is $1')`. Those were
 * accidentally true while USD was the only reachable currency and would have
 * become the `docs/101` defect the moment it was not: a shilling figure
 * validated against a dollar range, reported in dollars.
 *
 * ── WHAT IS ASSERTED, AND WHY HERE ──────────────────────────────────────────
 *
 * The real handler against a real database, because the property is that a
 * COLUMN gets a value. A unit test over the validator proves the schema
 * accepts `currency` and says nothing about whether the insert carries it -
 * and the insert is the half that was missing.
 *
 * ⚠️ USD behaviour is preserved deliberately: a request with no `currency` is
 * still a USD campaign, and the wizard's goal bounds are the SAME INTEGERS as
 * before (see `MIN_WIZARD_GOAL_MINOR`). The only behaviour that changed is
 * that KES is now expressible.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMock = vi.hoisted(() => ({
  value: { user: { id: '', role: 'donor', email: 'organiser@test.invalid', name: 'An Organiser' } },
}));

/*
  ⚠️ The whole auth module is replaced, with NO `vi.importActual`: the real one
  pulls in next-auth, which resolves `next/server`, absent in this suite's
  `node` environment, and the failure names hoisting rather than the cause.
*/
vi.mock('@/lib/auth', () => ({
  requireRole: async () => sessionMock.value,
  UnauthorizedError: class UnauthorizedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

/* The route fires two emails and does not await them. Neither is under test. */
vi.mock('@/lib/notifications', () => ({
  notifyAdminsCampaignSubmitted: async () => undefined,
  notifyCampaignSubmittedForReview: async () => undefined,
}));

import { db } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/money/currencies';
import { clearDatabase, seedUser } from '../../../../../test/helpers';
import { POST } from './route';

/** A submission that passes every other rule in the schema. */
function submission(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Help the Otieno family rebuild after the fire',
    story: 'A'.repeat(220),
    category: 'disaster',
    subjectName: 'Grace Otieno',
    subjectHometown: 'Kisumu',
    beneficiaryRelation: 'family',
    heroImageUrl: 'https://images.unsplash.com/photo-1',
    goalAmount: 500_000,
    agreedToTerms: true,
    confirmedTruthful: true,
    beneficiaryConsent: true,
    ...overrides,
  };
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/v1/user-campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  );
}

async function storedCurrency(campaignId: string): Promise<string> {
  const [row] = await db
    .select({ currency: schema.campaigns.currency })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId));
  return row.currency;
}

beforeEach(async () => {
  await clearDatabase();
  const user = await seedUser({ email: `org-${Math.random()}@test.invalid`, role: 'donor' });
  sessionMock.value = {
    user: { id: user.id, role: 'donor', email: user.email ?? '', name: user.name ?? 'An Organiser' },
  };
});

describe('POST /api/v1/user-campaigns — the campaign currency', () => {
  it('⛔ PERSISTS a KES campaign, which was previously impossible', async () => {
    const res = await post(submission({ currency: 'KES', goalAmount: 50_000_000 }));
    expect(res.status).toBe(201);
    const body = await res.json();

    // The column, read back from the database - not the response shape.
    expect(await storedCurrency(body.data.id)).toBe('KES');
  });

  it('defaults to USD when the request says nothing, exactly as before', async () => {
    const res = await post(submission());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(await storedCurrency(body.data.id)).toBe(DEFAULT_CURRENCY);
    expect(DEFAULT_CURRENCY).toBe('USD');
  });

  it('⛔ refuses a currency the platform KNOWS but cannot COLLECT', async () => {
    /*
      `docs/103`: `WORLD_CURRENCY_EXPONENTS` holds 152 currencies and
      `CURRENCIES` holds the two with a gateway. A campaign in a currency
      nothing settles is unfundable AND unmovable, because the composite FK
      freezes it the moment a donation lands.
    */
    for (const code of ['GBP', 'UGX', 'ZAR', 'notacurrency', '']) {
      /*
        ⚠️ The title is NOT varied per code. The route reports only
        `parsed.error.errors[0]`, so the first draft of this test - which
        built a title from the code - had one case fall under the 20-character
        title floor and reported `field: 'title'`. Every other field here is
        valid, so the currency is the only thing that can fail.
      */
      const res = await post(submission({ currency: code }));
      expect(res.status, code).toBe(400);
      const body = await res.json();
      expect(body.error.code, code).toBe('VALIDATION_ERROR');
      expect(body.error.field, code).toBe('currency');
    }
    expect(Object.keys(CURRENCIES).sort()).toEqual(['KES', 'USD']);
  });

  it('⛔ reports a goal below the floor in the campaign’s OWN currency', async () => {
    const res = await post(submission({ currency: 'KES', goalAmount: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.field).toBe('goalAmount');
    /*
      KES 1.00, rendered through `formatMoney` at the `en-KE` locale, which
      gives "Ksh\u00a01" - the symbol a Kenyan reader expects, not the ISO
      code. The property is that it is NOT dollars; the first draft of this
      test asserted the literal "KES" and failed against correct output.

      \u26a0\ufe0f `formatMoney` separates symbol from digits with a NON-BREAKING
      SPACE (U+00A0), so a literal comparison typed with an ordinary space
      fails while printing two identical-looking strings. Normalised here
      rather than pasting an invisible character into the assertion.
    */
    expect(body.error.message.replace(/\u00a0/g, ' ')).toBe('Minimum goal is Ksh 1');
    expect(body.error.message).not.toContain('$');
  });

  it('still reports a USD floor in dollars, with the same number as before', async () => {
    const res = await post(submission({ goalAmount: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.field).toBe('goalAmount');
    expect(body.error.message).toContain('$1');
  });

  it('writes a currency the donations FK will accept, so money can actually arrive', async () => {
    /*
      The end-to-end property, and the reason this is an integration test: a
      campaign row whose currency does not satisfy
      `donations_campaign_currency_fk` is a campaign nobody can give to, and
      the failure would surface as a constraint violation at donation time.
    */
    const res = await post(submission({ currency: 'KES', goalAmount: 50_000_000 }));
    const body = await res.json();

    await db.insert(schema.donations).values({
      campaignId: body.data.id,
      amount: 5_000,
      currency: 'KES',
      donorEmail: 'donor@test.invalid',
      donorName: 'A Donor',
      source: 'real',
      refunded: false,
      stripePaymentId: `payhero_${Math.random().toString(36).slice(2)}`,
      phaseAtTime: 'first_believers',
    });

    const [donation] = await db
      .select({ currency: schema.donations.currency })
      .from(schema.donations)
      .where(eq(schema.donations.campaignId, body.data.id));
    expect(donation.currency).toBe('KES');

    // And the inverse: a USD donation onto that campaign is REFUSED by the
    // database, which is what makes one-currency-per-campaign a guarantee.
    await expect(
      db.insert(schema.donations).values({
        campaignId: body.data.id,
        amount: 5_000,
        currency: 'USD',
        donorEmail: 'donor2@test.invalid',
        donorName: 'Another Donor',
        source: 'real',
        refunded: false,
        stripePaymentId: `pi_${Math.random().toString(36).slice(2)}`,
        phaseAtTime: 'first_believers',
      }),
    ).rejects.toThrow();
  });
});
