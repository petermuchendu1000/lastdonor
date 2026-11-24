/**
 * `POST /api/v1/donations/palpluss/initiate`, EXECUTED against a real Postgres.
 *
 * ── Why this is an integration test and not a mocked route test ───────────
 *
 * The thing this route gets wrong if it gets anything wrong is a write to a
 * money table that carries a COMPOSITE FOREIGN KEY on
 * `(campaign_id, credited_currency)` — the database guarantee that a campaign
 * is only ever credited in its own currency (`docs/92`, moved one column by
 * `docs/168`). `docs/124` §5.1 is the standing lesson: **a mock cannot raise a
 * foreign-key or NOT NULL violation**, so a drizzle-mocked test of this route
 * would assert the shape of an insert that Postgres might refuse. Two account
 * erasure routes shipped broken under exactly that kind of green test.
 *
 * `docs/107` §7 also records that no route's data query is executed by
 * anything. The PayHero twin has no behavioural test of its own at all.
 *
 * ⚠️ AND IT TURNS OUT TO BE POSSIBLE, which `docs/126` reads as if it were
 * not. That doc says the node-environment integration suite "CANNOT LOAD"
 * `next/server`, and the finding there was true of NextAuth — `auth.ts`
 * imports it and the suite cannot load THAT. Measured 2026-11-24: a route
 * handler importing `next/server` alone loads here fine. This route is public
 * (`src/middleware.ts`), so it touches no NextAuth, which is what makes it
 * reachable from this suite.
 *
 * ── What is stubbed, and what is emphatically not ─────────────────────────
 *
 * Stubbed: `initiateStkPush` (it would put a PIN prompt on a real handset) and
 * `palplussChargeCurrency` (it returns null until a currency names
 * `gateway: 'palpluss'`, which is an owner action — `docs/180` §7 — so the
 * happy path is otherwise unreachable and would ship untested on the day it
 * becomes reachable).
 *
 * NOT stubbed: the campaign lookup, `realRaisedMinorSql`, the raise cap, the
 * FX snapshot read, the per-phone abuse guard, the insert, the composite FK,
 * the update, and the audit row. Those all run against Postgres.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { writeFxSnapshot } from '@/lib/money/fx-store.server';
import { PalplussApiError, PalplussRequestNotSentError } from '@/lib/palpluss';
import { clearDatabase, seedCampaign } from '../../../../../../../test/helpers';

/*
  The two stubs. `importOriginal` keeps every other export real — the
  classifier, the error classes, `toPalplussMsisdn`, the reference minting and
  the constants are all the production ones, because they are part of what is
  under test.
*/
const stkPush = vi.fn();
const chargeCurrency = vi.fn<() => string | null>(() => 'KES');

vi.mock('@/lib/palpluss', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/palpluss')>();
  return {
    ...real,
    initiateStkPush: (...args: unknown[]) => stkPush(...args),
    palplussChargeCurrency: () => chargeCurrency(),
  };
});

const { POST } = await import('./route');

const PHONE = '0712345678';
const PHONE_E164 = '+254712345678';

/** A USD campaign charged in KES — the real shape of every live campaign. */
const USD_CREDIT_MINOR = 500; // $5.00, the USD floor
const KES_CHARGE_MINOR = 65_000; // KES 650.00 at the rate seeded below

function post(body: Record<string, unknown>, cookie?: string): NextRequest {
  return new NextRequest('https://lastdonor.org/api/v1/donations/palpluss/initiate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function donorBody(campaignId: string, over: Record<string, unknown> = {}) {
  return {
    campaignId,
    amount: USD_CREDIT_MINOR,
    phone: PHONE,
    donorName: 'Asha Mutiso',
    donorEmail: 'asha@example.invalid',
    ...over,
  };
}

/**
 * The FX snapshot the quote reads. USD 1 : KES 130 is the live order of
 * magnitude (`docs/168` measured KES 650 for a US$5.00 credit).
 */
async function seedRates() {
  await writeFxSnapshot({
    base: 'USD',
    rates: { USD: 1, KES: 130 },
    asOf: new Date().toISOString(),
    provider: 'test',
    fetchedAt: new Date().toISOString(),
  });
}

async function rowsFor(campaignId: string) {
  return db
    .select()
    .from(schema.palplussPaymentRequests)
    .where(eq(schema.palplussPaymentRequests.campaignId, campaignId));
}

function accepted(transactionId: string) {
  return {
    transactionId,
    status: 'PENDING' as const,
    amountMajor: KES_CHARGE_MINOR / 100,
    currency: 'KES',
    phone: '254712345678',
    accountReference: 'LD-IGNORED',
    providerRequestId: 'mrq_1',
    providerCheckoutId: 'ws_CO_test',
    transactionFeeMajor: 3,
    resultCode: '0',
    resultDescription: 'Success. Request accepted for processing',
  };
}

beforeEach(async () => {
  await clearDatabase();
  stkPush.mockReset();
  chargeCurrency.mockReset();
  chargeCurrency.mockReturnValue('KES');
  process.env.PALPLUSS_API_KEY = 'pp_test_integration';
  await seedRates();
});

describe('the row exists BEFORE Palpluss is called', () => {
  /*
    ⛔ THE CENTRAL ASSERTION OF THIS ROUTE, and the reason
    `palpluss_transaction_id` stopped being NOT NULL (`docs/182`).
    Palpluss mints that id, so a NOT NULL column forces the call to happen
    first — and a process that dies between the response arriving and the
    INSERT committing loses the campaign, the donor, the amount and the quote
    for a collection that may already have succeeded.

    Proven by EXECUTION rather than by reading the file in order: the stub
    queries the table at the moment the gateway would have been reached, which
    is the only way to observe what is durable at that instant.
  */
  it('inserts a pending row with no transaction id, then writes the id after', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });

    let atCallTime: Awaited<ReturnType<typeof rowsFor>> = [];
    stkPush.mockImplementation(async () => {
      atCallTime = await rowsFor(campaign.id);
      return accepted('11111111-1111-4111-8111-111111111111');
    });

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(200);

    // At the instant of the call: the row is durable, and has no gateway id.
    expect(atCallTime).toHaveLength(1);
    expect(atCallTime[0].status).toBe('pending');
    expect(atCallTime[0].palplussTransactionId).toBeNull();
    expect(atCallTime[0].accountReference).toMatch(/^LD-[A-Z2-7]{9}$/);
    expect(atCallTime[0].donorEmail).toBe('asha@example.invalid');

    // Afterwards: the gateway's id is on the row.
    const [after] = await rowsFor(campaign.id);
    expect(after.palplussTransactionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(after.providerCheckoutId).toBe('ws_CO_test');
    expect(after.status).toBe('pending');
  });

  it('returns OUR reference and never the gateway transaction id', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    const txId = '22222222-2222-4222-8222-222222222222';
    stkPush.mockResolvedValue(accepted(txId));

    const res = await POST(post(donorBody(campaign.id)));
    const json = await res.json();

    const [row] = await rowsFor(campaign.id);
    expect(json.data.reference).toBe(row.accountReference);
    /*
      That transaction id is the key to `GET /transactions/{id}` on a tenant
      that may be shared with another product (`docs/180` §3). It must not
      reach a browser.
    */
    expect(JSON.stringify(json)).not.toContain(txId);
    expect(json.data.maskedPhone).toBe('•••• 678');
  });
});

describe('the charge and the credit are different things', () => {
  /*
    `docs/168`. The campaign is credited in ITS currency; the donor is charged
    in the rail's. The composite FK on `(campaign_id, credited_currency)` is
    what makes the credit half a database guarantee — and only a real Postgres
    can refuse it.
  */
  it('charges KES and credits the campaign in USD, through the composite FK', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    stkPush.mockResolvedValue(accepted('33333333-3333-4333-8333-333333333333'));

    await POST(post(donorBody(campaign.id)));

    const [row] = await rowsFor(campaign.id);
    expect(row.currency).toBe('KES');
    expect(row.amount).toBe(KES_CHARGE_MINOR);
    expect(row.creditedCurrency).toBe('USD');
    expect(row.creditedAmountMinor).toBe(USD_CREDIT_MINOR);
  });

  it('asks the gateway for the CHARGE, not the credit', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    stkPush.mockResolvedValue(accepted('44444444-4444-4444-8444-444444444444'));

    await POST(post(donorBody(campaign.id)));

    expect(stkPush).toHaveBeenCalledTimes(1);
    const arg = stkPush.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.amountMinor).toBe(KES_CHARGE_MINOR);
    expect(arg.currency).toBe('KES');
    expect(arg.accountReference).toMatch(/^LD-[A-Z2-7]{9}$/);
    expect(arg.callbackUrl).toMatch(/^https:\/\/.+\/api\/v1\/donations\/palpluss\/callback$/);
  });

  /*
    The quote is recorded so settlement never re-derives it — re-reading the
    rate later would move the credit after the donor agreed to the charge.
    `fx-display-only.ratchet.test.ts` asserts the property statically; this
    asserts the values are real.
  */
  it('persists the quote it used', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    stkPush.mockResolvedValue(accepted('55555555-5555-4555-8555-555555555555'));

    await POST(post(donorBody(campaign.id)));

    const [row] = await rowsFor(campaign.id);
    expect(Number(row.fxRateMicro)).toBe(130_000_000);
    expect(row.fxMarginBps).toBe(0);
    expect(row.fxQuotedAt).toBeInstanceOf(Date);
  });

  it('credits a KES campaign in KES, with no conversion in between', async () => {
    const campaign = await seedCampaign({ currency: 'KES', goalAmount: 10_000_000 });
    stkPush.mockResolvedValue(accepted('66666666-6666-4666-8666-666666666666'));

    const res = await POST(post(donorBody(campaign.id, { amount: 10_000 })));
    expect(res.status).toBe(200);

    const [row] = await rowsFor(campaign.id);
    expect(row.currency).toBe('KES');
    expect(row.creditedCurrency).toBe('KES');
    expect(row.amount).toBe(10_000);
    expect(row.creditedAmountMinor).toBe(10_000);
  });
});

describe('everything that can refuse does so before a prompt is sent', () => {
  /** A refusal that reaches the gateway has cost the donor a wasted push. */
  const expectNothingSent = async (campaignId: string | null) => {
    expect(stkPush).not.toHaveBeenCalled();
    if (campaignId) expect(await rowsFor(campaignId)).toHaveLength(0);
  };

  it('refuses an unknown campaign with 404', async () => {
    const res = await POST(post(donorBody('00000000-0000-4000-8000-000000000000')));
    expect(res.status).toBe(404);
    await expectNothingSent(null);
  });

  it('refuses a campaign that is not accepting donations', async () => {
    const campaign = await seedCampaign({ currency: 'USD', status: 'under_review' });
    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(404);
    await expectNothingSent(campaign.id);
  });

  /*
    The pre-verification cap (`docs/101`). This is the last point at which
    refusing costs the donor nothing, and it is measured over REAL
    un-refunded donations, not the seed-blended `raised_amount`.
  */
  it('refuses with 409 once the unverified raise cap is reached, and writes no row', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    await db.insert(schema.donations).values({
      campaignId: campaign.id,
      stripePaymentId: `pi_cap_${Date.now()}`,
      amount: 50_000, // the whole USD$500 pre-verification cap
      donorName: 'Earlier Donor',
      donorEmail: 'earlier@example.invalid',
      phaseAtTime: 'first_believers',
      source: 'real',
      currency: 'USD',
    });

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(409);
    await expectNothingSent(campaign.id);
  });

  it('refuses an unusable phone number with 400', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    const res = await POST(post(donorBody(campaign.id, { phone: '+15551234567' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error.field).toBe('phone');
    await expectNothingSent(campaign.id);
  });

  /*
    The per-number guard, counting BOTH rails. The pending row below is a
    PayHero one, so this also proves the cross-rail half by execution: a
    prompt raised on the other rail blocks this one.
  */
  it('refuses with 429 while the other rail has a live prompt on that number', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    await db.insert(schema.payheroPaymentRequests).values({
      externalReference: `LD-${Date.now()}`,
      campaignId: campaign.id,
      currency: 'KES',
      amount: 5_000,
      creditedAmountMinor: USD_CREDIT_MINOR,
      creditedCurrency: 'USD',
      fxRateMicro: 130_000_000,
      fxMarginBps: 0,
      fxQuotedAt: new Date(),
      phoneE164: PHONE_E164,
      msisdnSent: '254712345678',
      donorEmail: 'someone@example.invalid',
      status: 'pending',
      /*
        ⚠️ NOT NULL on that table, and an integer where this rail's is a uuid
        text column. Omitting it failed the insert, which read as a defect in
        the route until the message was read — `docs/128` §6's class: a fixture
        Postgres refuses is not evidence about the code.
      */
      channelId: 1234,
    });

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(stkPush).not.toHaveBeenCalled();
    // Only the PayHero row exists; nothing was written on this rail.
    expect(await rowsFor(campaign.id)).toHaveLength(0);
  });

  it('refuses with FX_UNAVAILABLE when no rate is stored, and writes no row', async () => {
    await db.delete(schema.siteSettings);
    const campaign = await seedCampaign({ currency: 'USD' });

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('FX_UNAVAILABLE');
    await expectNothingSent(campaign.id);
  });

  it('refuses when the key is absent', async () => {
    delete process.env.PALPLUSS_API_KEY;
    const campaign = await seedCampaign({ currency: 'USD' });

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('PAYMENTS_UNAVAILABLE');
    await expectNothingSent(campaign.id);
  });

  /*
    ⛔ TODAY'S ACTUAL STATE, asserted with the real function's answer.

    No currency names `gateway: 'palpluss'`, so this route refuses every
    request. That is why the rest of this file stubs the derivation — and why
    this test exists, so the refusal is a measured branch rather than an
    assumption about an unreachable one.
  */
  it('refuses when no currency routes to this rail at all', async () => {
    chargeCurrency.mockReturnValue(null);
    const campaign = await seedCampaign({ currency: 'USD' });

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('PAYMENTS_UNAVAILABLE');
    await expectNothingSent(campaign.id);
  });

  it('CONTROL: the real derivation returns null today, which is what that branch is for', async () => {
    const real = await vi.importActual<typeof import('@/lib/palpluss')>('@/lib/palpluss');
    expect(
      real.palplussChargeCurrency(),
      'a currency now routes to Palpluss - the stub in this file is no longer standing in ' +
        'for an unreachable state, and docs/182 should be re-read',
    ).toBeNull();
  });
});

describe('when the push fails', () => {
  const reasonFor = async (campaignId: string) => (await rowsFor(campaignId))[0];

  const auditFor = async (campaignId: string) =>
    db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.targetId, campaignId),
          eq(schema.auditLogs.eventType, 'donation.palpluss_initiate_failed'),
        ),
      );

  /*
    ⛔ NO RESPONSE ARRIVED. `docs/158`: this is the one branch where the money
    may actually have moved, so the donor must not be told otherwise and the
    row must not agree with its own `failed` status.
  */
  it('records an unknown outcome as unknown, and points at the reconciliation route', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    stkPush.mockRejectedValue(new Error('The operation was aborted due to timeout'));

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('PAYMENT_OUTCOME_UNKNOWN');

    const row = await reasonFor(campaign.id);
    expect(row.status).toBe('failed');
    expect(row.palplussTransactionId).toBeNull();
    expect(row.failureReason).toMatch(/UNKNOWN/);
    /*
      The sentence that makes this rail's loose end recoverable where the
      other rail's is not: [VERIFIED] `GET /v1/transactions` returns
      `external_reference` on every row, so our own reference leads back to
      the transaction.
    */
    expect(row.failureReason).toMatch(/account_reference/);
    expect(row.failureReason).toMatch(/external_reference/);

    const audit = await auditFor(campaign.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].severity).toBe('error');
  });

  it('treats our own pre-flight refusal as configuration, not as unknown', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    stkPush.mockRejectedValue(new PalplussRequestNotSentError('callbackUrl must be https.'));

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('PAYMENTS_UNAVAILABLE');

    const row = await reasonFor(campaign.id);
    expect(row.status).toBe('failed');
    expect(row.failureReason).toBe('Initiation failed (configuration).');
    expect(row.failureReason).not.toMatch(/UNKNOWN/);
    expect((await auditFor(campaign.id))[0].severity).toBe('error');
  });

  it('treats a 5xx from the gateway as transient, and says nothing was charged', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    stkPush.mockRejectedValue(new PalplussApiError(502, 'bad gateway'));

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe('PAYMENTS_UNAVAILABLE');
    expect(json.error.message).toMatch(/nothing has been charged/i);
    expect((await auditFor(campaign.id))[0].severity).toBe('warning');
  });

  /*
    An empty prepaid service wallet (`docs/180` finding 5) is an operator
    problem wearing a 4xx. Retrying does not top up a float, so it must not be
    reported as transient.
  */
  it('treats an empty service wallet as configuration', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    stkPush.mockRejectedValue(
      new PalplussApiError(402, 'insufficient balance', 'INSUFFICIENT_SERVICE_BALANCE'),
    );

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(503);
    const row = await reasonFor(campaign.id);
    expect(row.failureReason).toBe('Initiation failed (configuration).');
  });

  it('treats any other 4xx as this request being rejected', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    stkPush.mockRejectedValue(new PalplussApiError(400, 'phone must be a string'));

    const res = await POST(post(donorBody(campaign.id)));
    expect(res.status).toBe(400);
    const row = await reasonFor(campaign.id);
    expect(row.failureReason).toBe('Initiation failed (rejected).');
    expect((await auditFor(campaign.id))[0].severity).toBe('warning');
  });

  it('settles the row so the number is not held by a phantom prompt', async () => {
    /*
      The abuse guard refuses a second push while the latest is `pending`.
      A failed initiation that left the row pending would lock the donor out
      of retrying for the whole prompt lifetime, having sent them nothing.
    */
    const campaign = await seedCampaign({ currency: 'USD' });
    stkPush.mockRejectedValue(new PalplussApiError(400, 'nope'));

    await POST(post(donorBody(campaign.id)));

    const row = await reasonFor(campaign.id);
    expect(row.status).toBe('failed');
    expect(row.settledAt).toBeInstanceOf(Date);
  });
});

describe('two pushes never share a reference', () => {
  /*
    `account_reference` is UNIQUE, so a collision is an insert failure on a
    money path rather than a silent mix-up — but 45 bits is 45 bits, and the
    test that matters is that the value is drawn freshly each time rather than
    derived from something stable like the campaign id.
  */
  it('mints a distinct reference per request', async () => {
    const campaign = await seedCampaign({ currency: 'USD' });
    let n = 0;
    stkPush.mockImplementation(async () => {
      n += 1;
      return accepted(`7777777${n}-7777-4777-8777-777777777777`);
    });

    await POST(post(donorBody(campaign.id)));
    // Clear the per-number cooldown by ageing the first row.
    await db
      .update(schema.palplussPaymentRequests)
      .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(schema.palplussPaymentRequests.campaignId, campaign.id));
    await POST(post(donorBody(campaign.id)));

    const rows = await rowsFor(campaign.id);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.accountReference)).size).toBe(2);
  });
});
