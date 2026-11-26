import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  KES routes to `payhero` in `currencies.ts` and will until the owner flips it
  (2026-11-24 decision: add Palpluss alongside, switch when it has taken a real
  donation). So the happy path needs a currency that routes HERE, and the real
  KES definition is kept available to prove the routing guard actually bites.

  Only `gateway` is overridden: the bounds, exponent and caps stay real, so the
  amount tests are measured against production policy numbers rather than
  invented ones.
*/
const state = vi.hoisted(() => ({ routeKesToPalpluss: true }));

/*
  ⚠️ The toggle FORCES the gateway both ways, and that changed with
  `docs/185`. It used to override KES only when `routeKesToPalpluss` was true
  and otherwise return the real definition, on the premise that the real
  definition said `payhero` — the comment on the refusal test below said so
  outright: *"the REAL routing: KES -> payhero"*. The flip made that premise
  false, so switching the toggle OFF stopped changing anything and two tests
  measured the same configuration twice.

  Forcing both arms makes this file independent of whichever rail the live
  table happens to name, which is what a test of THIS CLIENT should be.
*/
vi.mock('./money/currencies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./money/currencies')>();
  return {
    ...actual,
    getCurrency: (code: string) => {
      const real = actual.getCurrency(code);
      if (real.code !== 'KES') return real;
      return {
        ...real,
        gateway: state.routeKesToPalpluss ? ('palpluss' as const) : ('payhero' as const),
      };
    },
  };
});

const {
  ACCOUNT_REFERENCE_RANDOM_CHARS,
  MAX_ACCOUNT_REFERENCE,
  MAX_TRANSACTION_DESC,
  MIN_PUSH_INTERVAL_MS,
  PalplussApiError,
  PalplussNotConfiguredError,
  PalplussRequestNotSentError,
  STK_PUSHES_PER_PHONE_PER_MINUTE,
  TRANSACTION_DESC,
  classifyPalplussInitiationFailure,
  getTransactionStatus,
  initiateStkPush,
  isLiveKey,
  isPalplussConfigured,
  isTerminal,
  mintAccountReference,
  palplussChargeCurrency,
  toPalplussMsisdn,
} = await import('./palpluss');

const TX = '1cbdbaca-2a6b-4e1c-84f4-23e214794b6c';

/** A valid request: KES 50.00 = the real `minDonationMinor` for KES. */
function req(over: Partial<Parameters<typeof initiateStkPush>[0]> = {}) {
  return {
    amountMinor: 5_000,
    currency: 'KES',
    phone: '0712345678',
    accountReference: 'LD-AB12CD34',
    transactionDesc: 'LastDonor',
    callbackUrl: 'https://lastdonor.org/api/v1/donations/palpluss/callback',
    ...over,
  };
}

/** Mock a Palpluss response. `data` is wrapped in the real envelope. */
function respond(data: unknown, init: { status?: number; success?: boolean } = {}) {
  const body = JSON.stringify({
    success: init.success ?? (init.status ?? 200) < 400,
    data,
    requestId: 'req_1',
  });
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchMock() {
  const spy = vi.fn();
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** The JSON body of the single call the mock received. */
function sentBody(spy: ReturnType<typeof fetchMock>): Record<string, unknown> {
  return JSON.parse((spy.mock.calls[0]?.[1] as { body: string }).body);
}

beforeEach(() => {
  state.routeKesToPalpluss = true;
  vi.stubEnv('PALPLUSS_API_KEY', 'pp_live_testkey000000000000000000000');
  vi.stubEnv('PALPLUSS_CHANNEL_ID', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('configuration', () => {
  it('reports configured only when a key is present', () => {
    expect(isPalplussConfigured()).toBe(true);
    vi.stubEnv('PALPLUSS_API_KEY', '');
    expect(isPalplussConfigured()).toBe(false);
  });

  it('refuses to initiate with no key rather than calling the API', async () => {
    vi.stubEnv('PALPLUSS_API_KEY', '');
    const spy = fetchMock();
    await expect(initiateStkPush(req())).rejects.toBeInstanceOf(PalplussNotConfiguredError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('distinguishes a live key from a test key', () => {
    expect(isLiveKey()).toBe(true);
    vi.stubEnv('PALPLUSS_API_KEY', 'pp_test_abc');
    expect(isLiveKey()).toBe(false);
  });
});

describe('initiateStkPush pre-flight guards', () => {
  /*
    Every guard here throws PalplussRequestNotSentError, and the type is the
    point: docs/158 classifies that as `configuration`, so the donor is told
    nothing was charged — which is only honest because no request left.
  */
  it('refuses a currency this gateway does not collect', async () => {
    state.routeKesToPalpluss = false; // a table where KES routes elsewhere
    const spy = fetchMock();
    await expect(initiateStkPush(req())).rejects.toBeInstanceOf(PalplussRequestNotSentError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a reference outside the LD- namespace', async () => {
    const spy = fetchMock();
    await expect(initiateStkPush(req({ accountReference: 'PAL-123' }))).rejects.toThrow(/LD-/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a reference longer than the documented limit', async () => {
    const tooLong = `LD-${'X'.repeat(MAX_ACCOUNT_REFERENCE)}`;
    expect(tooLong.length).toBeGreaterThan(MAX_ACCOUNT_REFERENCE);
    await expect(initiateStkPush(req({ accountReference: tooLong }))).rejects.toThrow(/limit/);
  });

  it('accepts a reference exactly at the limit', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: TX, status: 'PENDING' }));
    const exact = 'LD-123456789';
    expect(exact.length).toBe(MAX_ACCOUNT_REFERENCE);
    await expect(initiateStkPush(req({ accountReference: exact }))).resolves.toBeTruthy();
  });

  it('refuses a non-integer minor amount', async () => {
    await expect(initiateStkPush(req({ amountMinor: 5_000.5 }))).rejects.toThrow(/integer/);
  });

  it('refuses an amount outside the currency bounds', async () => {
    await expect(initiateStkPush(req({ amountMinor: 1 }))).rejects.toThrow(/outside/);
    await expect(initiateStkPush(req({ amountMinor: 999_999_999 }))).rejects.toThrow(/outside/);
  });

  /*
    M-Pesa moves whole shillings. A fraction is REFUSED, not rounded: rounding
    money without telling anyone is how a ledger stops matching a bank.
  */
  it('refuses a fractional shilling, and accepts the whole one beside it', async () => {
    await expect(initiateStkPush(req({ amountMinor: 5_050 }))).rejects.toThrow(/whole KES/);
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: TX, status: 'PENDING' }));
    await expect(initiateStkPush(req({ amountMinor: 5_100 }))).resolves.toBeTruthy();
  });

  it('refuses an unusable or non-Kenyan number', async () => {
    const spy = fetchMock();
    for (const phone of ['', 'not a phone', '+14155550123']) {
      await expect(initiateStkPush(req({ phone }))).rejects.toThrow(/phone/i);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a callback that is not https', async () => {
    await expect(initiateStkPush(req({ callbackUrl: 'http://lastdonor.org/cb' }))).rejects.toThrow(/https/);
    await expect(initiateStkPush(req({ callbackUrl: 'not a url' }))).rejects.toThrow(/valid URL/);
  });
});

describe('initiateStkPush wire format', () => {
  it('sends the amount in MAJOR units', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: TX, status: 'PENDING' }));
    await initiateStkPush(req({ amountMinor: 5_000 }));
    /*
      KES 50.00. The 100x trap: our ledger is minor units and Palpluss wants
      shillings, so sending `amountMinor` straight through would ask for KES
      5,000 — a hundred times the gift.
    */
    expect(sentBody(spy).amount).toBe(50);
  });

  it('sends the phone in canonical 254 form', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: TX, status: 'PENDING' }));
    await initiateStkPush(req({ phone: '0712345678' }));
    expect(sentBody(spy).phone).toBe('254712345678');
  });

  it('truncates the PIN-prompt description to the documented limit', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: TX, status: 'PENDING' }));
    await initiateStkPush(req({ transactionDesc: 'A'.repeat(50) }));
    expect(String(sentBody(spy).transactionDesc).length).toBe(MAX_TRANSACTION_DESC);
  });

  it('omits channelId when none is configured, and sends it when one is', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: TX, status: 'PENDING' }));
    await initiateStkPush(req());
    expect('channelId' in sentBody(spy)).toBe(false);

    vi.stubEnv('PALPLUSS_CHANNEL_ID', '4e0750fe-f851-49d9-a888-ea98bea29878');
    const spy2 = fetchMock();
    spy2.mockResolvedValue(respond({ transaction_id: TX, status: 'PENDING' }));
    await initiateStkPush(req());
    expect(sentBody(spy2).channelId).toBe('4e0750fe-f851-49d9-a888-ea98bea29878');
  });

  it('sends HTTP Basic with an empty password', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: TX, status: 'PENDING' }));
    await initiateStkPush(req());
    const headers = (spy.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    const decoded = Buffer.from(headers.Authorization.replace('Basic ', ''), 'base64').toString('utf8');
    // The trailing colon IS the empty password; without it this is not Basic auth.
    expect(decoded).toBe('pp_live_testkey000000000000000000000:');
  });
});

describe('initiateStkPush response handling', () => {
  it('returns PENDING as accepted-not-paid', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(
      respond({
        transaction_id: TX,
        status: 'PENDING',
        amount: 50,
        currency: 'KES',
        phone_number: '254712345678',
        external_reference: 'LD-AB12CD34',
        provider_checkout_id: 'ws_CO_1',
        transaction_fee: 3,
        result_code: '0',
      }),
    );
    const out = await initiateStkPush(req());
    expect(out).toMatchObject({
      transactionId: TX,
      status: 'PENDING',
      amountMajor: 50,
      providerCheckoutId: 'ws_CO_1',
      transactionFeeMajor: 3,
    });
    // `status: PENDING` is the whole point — nothing here says the donor paid.
    expect(isTerminal(out.status)).toBe(false);
  });

  /*
    Finding 3, and these two fixtures are TRANSCRIBED from a real KES 1 push
    and its own status read (2026-11-24) rather than invented. The point is
    that one flow answers in two casings, so a client committed to either
    spelling reads `undefined` on exactly one of its two calls — and an
    undefined transaction id is a payment that cannot be verified.
  */
  /*
    ⚠️ The MSISDN in these fixtures is the house placeholder, not the number the
    live probe used. Safaricom's CheckoutRequestID is
    <prefix><timestamp><msisdn>, so `ws_CO_…5712345678` carries a phone number
    in what looks like an opaque id — transcribing a real response verbatim
    into a PUBLIC repo publishes it twice over, once in `phone` and once here.
  */
  it('reads the REAL initiate response, which is camelCase', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(
      respond({
        transactionId: TX,
        tenantId: '69ce89de-1483-4722-bbe0-f679bacfa5cd',
        channelId: '4e0750fe-f851-49d9-a888-ea98bea29878',
        type: 'STK',
        status: 'PENDING',
        amount: 1,
        currency: 'KES',
        phone: '254712345678',
        accountReference: 'LD-PROBE1',
        transactionDesc: 'LastDonor',
        providerRequestId: '65a2-4f53-9021-b6c8a9c69bd243337340',
        providerCheckoutId: 'ws_CO_24112026034712835712345678',
        resultCode: '0',
        resultDescription: 'Success. Request accepted for processing',
        transactionFee: 0,
      }),
    );
    const out = await initiateStkPush(req());
    expect(out).toMatchObject({
      transactionId: TX,
      status: 'PENDING',
      phone: '254712345678',
      accountReference: 'LD-PROBE1',
      providerCheckoutId: 'ws_CO_24112026034712835712345678',
      resultCode: '0',
      transactionFeeMajor: 0,
    });
    /*
      The whole trap in one assertion: every signal a caller would reach for
      said success, and this transaction then failed with 1038.
    */
    expect(isTerminal(out.status)).toBe(false);
  });

  it('reads the REAL status response, which is snake_case with different NAMES', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(
      respond({
        transaction_id: TX,
        type: 'STK',
        status: 'FAILED',
        amount: 1,
        currency: 'KES',
        phone_number: '254712345678',
        // `accountReference` going in, `external_reference` coming out.
        external_reference: 'LD-PROBE1',
        provider_checkout_id: 'ws_CO_24112026034712835712345678',
        result_code: '1038',
        result_desc: 'No response from user.',
        transaction_fee: 0,
      }),
    );
    await expect(getTransactionStatus(TX)).resolves.toMatchObject({
      transactionId: TX,
      status: 'FAILED',
      phone: '254712345678',
      accountReference: 'LD-PROBE1',
      resultCode: '1038',
      resultDescription: 'No response from user.',
      transactionFeeMajor: 0,
    });
  });

  /*
    Our reference is not a lookup key and a blank id reads another tenant's
    ledger, so a request we cannot verify later is worse than one refused.
  */
  it('fails when no transaction id comes back', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ status: 'PENDING' }));
    await expect(initiateStkPush(req())).rejects.toThrow(/unverifiable/);
  });

  it('treats success:false as a failure even with HTTP 200', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: TX }, { success: false }));
    await expect(initiateStkPush(req())).rejects.toBeInstanceOf(PalplussApiError);
  });

  /*
    Finding 2: `error.code` is the HTTP status restated; the real code is
    nested at `error.details.code`.
  */
  it('surfaces the nested error code, not the restated HTTP status', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            message: 'Insufficient service balance',
            code: 'HTTP_402',
            details: { code: 'INSUFFICIENT_SERVICE_BALANCE' },
          },
        }),
        { status: 402, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(initiateStkPush(req())).rejects.toMatchObject({
      status: 402,
      code: 'INSUFFICIENT_SERVICE_BALANCE',
    });
  });

  /*
    [VERIFIED 2026-11-24] a 400 from POST /payments/stk returns `error.message`
    as an ARRAY of validation strings, while a 404 from GET /transactions/{id}
    returns a plain string. Handling only the string case discards the one
    piece of text that says what was wrong.
  */
  it('joins an array-valued error message instead of discarding it', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            message: ['amount must be a positive number', 'phone must be a string'],
            code: 'HTTP_400',
            details: { error: 'Bad Request', statusCode: 400 },
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(initiateStkPush(req())).rejects.toThrow(
      /amount must be a positive number; phone must be a string/,
    );
  });

  it('still reads a string-valued error message', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: { message: 'Transaction not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(initiateStkPush(req())).rejects.toThrow(/Transaction not found/);
  });

  it('fails cleanly on a non-JSON body', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(new Response('<html>gateway down</html>', { status: 200 }));
    await expect(initiateStkPush(req())).rejects.toBeInstanceOf(PalplussApiError);
  });
});

describe('getTransactionStatus', () => {
  /*
    THE LEDGER-LEAK GUARD. [VERIFIED 2026-11-24] `GET /v1/transactions/` with
    an empty segment answers HTTP 200 with 20 rows from the whole tenant — and
    this tenant is shared with two other products. A poll built from an
    undefined id would read a stranger's payment and report it as the donor's.
    Non-empty malformed ids are refused by the API itself; the empty one is
    not, so the guard has to be ours.
  */
  it.each(['', '   ', 'not-a-uuid', '../transactions', '%20', `${TX}/../..`])(
    'refuses %p without issuing a request',
    async (id) => {
      const spy = fetchMock();
      await expect(getTransactionStatus(id)).rejects.toBeInstanceOf(PalplussRequestNotSentError);
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('accepts a well-formed uuid', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: TX, status: 'SUCCESS', mpesa_receipt: 'LGR019G3J2' }));
    await expect(getTransactionStatus(TX)).resolves.toMatchObject({
      transactionId: TX,
      status: 'SUCCESS',
      mpesaReceipt: 'LGR019G3J2',
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0]?.[0])).toBe(`https://api.palpluss.com/v1/transactions/${TX}`);
  });

  /*
    Cheap, and the one check that would catch a recurrence of the leak through
    some other path: a reply about a different transaction is refused.
  */
  it('refuses a reply about a different transaction', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ transaction_id: '99999999-9999-4999-8999-999999999999', status: 'SUCCESS' }));
    await expect(getTransactionStatus(TX)).rejects.toThrow(/different transaction/);
  });

  it('refuses a reply with no transaction id', async () => {
    const spy = fetchMock();
    spy.mockResolvedValue(respond({ status: 'SUCCESS' }));
    await expect(getTransactionStatus(TX)).rejects.toThrow(/no transaction id/);
  });
});

describe('throttle constants', () => {
  /*
    DERIVED, not picked. Palpluss allows 2 pushes per phone per minute and
    answers `result_code: "17"` ("Rule limited.") rather than an HTTP error
    when it bites, so a guard that permits a third is a silently rule-limited
    donor.
  */
  it('derives the minimum interval from the documented throttle', () => {
    expect(MIN_PUSH_INTERVAL_MS * STK_PUSHES_PER_PHONE_PER_MINUTE).toBe(60_000);
  });

  /*
    A tripwire on a premise, not a restatement of a constant: PayHero's guard
    permits a push every 20s, which is three a minute. That is correct for
    PayHero and too permissive here, so whatever guards a Palpluss push must
    use MIN_PUSH_INTERVAL_MS. If PayHero's cooldown ever rises above ours this
    fails, and somebody re-reads the decision.
  */
  it('is stricter than the PayHero retry cooldown it must not inherit', async () => {
    const { RETRY_COOLDOWN_MS } = await import('./mpesa-abuse-guard');
    expect(MIN_PUSH_INTERVAL_MS).toBeGreaterThan(RETRY_COOLDOWN_MS);
  });
});

describe('toPalplussMsisdn', () => {
  it.each([
    ['0712345678', '254712345678'],
    ['+254712345678', '254712345678'],
    ['254712345678', '254712345678'],
    ['0112345678', '254112345678'],
  ])('normalises %s', (input, expected) => {
    expect(toPalplussMsisdn(input)).toBe(expected);
  });

  it.each(['', null, undefined, 'abc', '+14155550123', '+447700900000'])('refuses %p', (input) => {
    // Non-Kenyan numbers are refused rather than guessed: the channel is a
    // Kenyan paybill, so sending one spends a throttle slot to learn nothing.
    expect(toPalplussMsisdn(input)).toBeNull();
  });
});

describe('isTerminal', () => {
  it.each(['SUCCESS', 'FAILED', 'REVERSED', 'CANCELLED', 'EXPIRED'])('%s is terminal', (s) => {
    expect(isTerminal(s)).toBe(true);
  });

  it.each(['PENDING', 'PROCESSING'])('%s is not terminal', (s) => {
    expect(isTerminal(s)).toBe(false);
  });
});

describe('mintAccountReference', () => {
  /*
    The reference has to fit Palpluss's documented 12 characters, start with
    the `LD-` isolation prefix the client refuses to send without, and be
    drawn freshly each time. All three are cheap to get wrong and each is a
    different failure: too long is a refused push, no prefix is a refused
    push, and a predictable value is a reference somebody else can guess.
  */
  it('fits the documented limit exactly', () => {
    const ref = mintAccountReference();
    expect(ref).toHaveLength(MAX_ACCOUNT_REFERENCE);
    expect(ref.startsWith('LD-')).toBe(true);
  });

  it('derives its random length from the limit rather than hardcoding it', () => {
    expect(ACCOUNT_REFERENCE_RANDOM_CHARS).toBe(MAX_ACCOUNT_REFERENCE - 'LD-'.length);
  });

  it('uses only base32 characters, so the whole reference survives a round trip', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(mintAccountReference()).toMatch(/^LD-[A-Z2-7]+$/);
    }
  });

  /*
    ⛔ ANTI-VACUITY for the two rules above: a constant would satisfy both.
    200 draws of 45 bits colliding is about 1 in 10^11, so a repeat here means
    the value is derived from something stable rather than from randomness.
  */
  it('is drawn freshly each time', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(mintAccountReference());
    expect(seen.size).toBe(200);
  });

  it('uses every position, so no character is quietly fixed', () => {
    /*
      A loop that wrote the same symbol into one slot would pass every test
      above. Checked by collecting the distinct symbols seen at each index.
    */
    const perIndex = Array.from({ length: ACCOUNT_REFERENCE_RANDOM_CHARS }, () => new Set<string>());
    for (let i = 0; i < 300; i += 1) {
      const body = mintAccountReference().slice(3);
      body.split('').forEach((ch, idx) => perIndex[idx].add(ch));
    }
    for (const [idx, set] of perIndex.entries()) {
      expect(set.size, `position ${idx} only ever produced ${[...set].join('')}`).toBeGreaterThan(8);
    }
  });
});

describe('TRANSACTION_DESC', () => {
  it('fits the 13 characters a PIN prompt shows', () => {
    expect(TRANSACTION_DESC.length).toBeLessThanOrEqual(MAX_TRANSACTION_DESC);
  });

  it('names the platform, because that is what a person at a PIN prompt needs', () => {
    expect(TRANSACTION_DESC).toMatch(/LastDonor/);
  });
});

describe('palplussChargeCurrency', () => {
  /*
    ⚠️ This file routes KES here through its `getCurrency` mock, so the
    positive case is reachable. The REAL answer today is null — asserted
    against the unmocked module in the route's integration test, which is the
    one place that can see production's own routing table.
  */
  it('returns the single currency routed to this rail', () => {
    state.routeKesToPalpluss = true;
    expect(palplussChargeCurrency()).toBe('KES');
  });

  it('returns null when nothing routes here, rather than throwing', () => {
    /*
      ⛔ A route cannot handle an exception as a 503 with an operator log
      without catching something it cannot distinguish from a real fault, so
      this answers null.

      ⚠️ This comment used to add that `payHeroChargeCurrency()` throws on the
      same condition and was "right there, because exactly one currency has
      always named it, so zero means the table is broken". `docs/185` spent
      that premise: zero currencies name PayHero now, deliberately. It returns
      null too, and `mpesa-rail-symmetry.test.ts` holds the two shapes
      together.
    */
    state.routeKesToPalpluss = false;
    expect(palplussChargeCurrency()).toBeNull();
    state.routeKesToPalpluss = true;
  });
});

describe('classifyPalplussInitiationFailure', () => {
  /*
    `docs/158`. The four kinds differ by one sentence of donor-facing copy
    about somebody's money, and `unknown` is the only one on which a
    collection may exist. The route's branches are checked by
    `payment-outcome-claims.test.ts`; this is the judgement itself.
  */
  it('classifies NO RESPONSE as unknown', () => {
    for (const error of [
      new Error('The operation was aborted due to timeout'),
      new TypeError('fetch failed'),
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      'a string nobody expected',
      null,
    ]) {
      expect(classifyPalplussInitiationFailure(error)).toBe('unknown');
    }
  });

  it('classifies OUR OWN pre-flight refusals as configuration, never unknown', () => {
    /*
      ⛔ docs/158 §4: the PayHero version of this branch told donors we might
      have charged them for requests that never left the process. Every guard
      inside `initiateStkPush` raises this class, and the point of the class
      is that nothing was dispatched.
    */
    expect(
      classifyPalplussInitiationFailure(new PalplussRequestNotSentError('callbackUrl must be https.')),
    ).toBe('configuration');
    expect(classifyPalplussInitiationFailure(new PalplussNotConfiguredError())).toBe('configuration');
  });

  it.each([
    [401, 'INVALID_API_KEY'],
    [403, null],
    [404, 'TRANSACTION_NOT_FOUND'],
    [402, 'INSUFFICIENT_SERVICE_BALANCE'],
  ])('classifies %i as configuration', (status, code) => {
    expect(classifyPalplussInitiationFailure(new PalplussApiError(status, 'nope', code))).toBe(
      'configuration',
    );
  });

  it('classifies an empty service wallet by CODE as well as by status', () => {
    /*
      The float is prepaid, and no amount of retrying tops one up (docs/180
      finding 5; docs/147 §11.3 is the same hazard on the other rail). Matched
      on the nested code too, because the HTTP status for it is undocumented
      and `error.code` is the status restated (docs/180 finding 2).
    */
    expect(
      classifyPalplussInitiationFailure(
        new PalplussApiError(400, 'insufficient balance', 'INSUFFICIENT_SERVICE_BALANCE'),
      ),
    ).toBe('configuration');
  });

  it.each([500, 502, 503, 504, 429])('classifies %i as transient', (status) => {
    expect(classifyPalplussInitiationFailure(new PalplussApiError(status, 'later'))).toBe(
      'transient',
    );
  });

  it.each([400, 409, 422])('classifies %i as this request being rejected', (status) => {
    expect(classifyPalplussInitiationFailure(new PalplussApiError(status, 'nope'))).toBe('rejected');
  });

  /*
    ⛔ ANTI-VACUITY, and the one property the whole thing exists for: the
    answer for "the gateway answered" and the answer for "nothing answered"
    must not be the same value. A classifier that returned one kind for
    everything would satisfy several rules above.
  */
  it('never gives a timeout the same kind as a gateway that answered', () => {
    const timeout = classifyPalplussInitiationFailure(new Error('aborted'));
    const answered = classifyPalplussInitiationFailure(new PalplussApiError(502, 'bad gateway'));
    expect(timeout).not.toBe(answered);
    expect(answered).toBe('transient');
    expect(timeout).toBe('unknown');
  });
});
