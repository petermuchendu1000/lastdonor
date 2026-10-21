/**
 * PayHero client tests.
 *
 * The response fixtures here are REAL bodies captured from the live API on
 * 2026-10-21 with this account's credentials, with the account's own
 * identifiers left intact and nothing invented. Where a body came back as
 * `text/plain` carrying JSON, the test reproduces that too, because that
 * combination is what breaks a `res.json()` client.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LASTDONOR_REFERENCE_PREFIX,
  PayHeroApiError,
  PayHeroNotConfiguredError,
  classifyInitiationFailure,
  configuredChannelId,
  getTransactionStatus,
  getWalletBalance,
  initiateStkPush,
  isPayHeroConfigured,
  toPayHeroMsisdn,
} from '@/lib/payhero';

const CHANNEL_ID = 12226;

function respond(
  body: string,
  { status = 200, contentType = 'application/json' } = {},
) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': contentType },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.PAYHERO_API_USERNAME = 'test-user';
  process.env.PAYHERO_API_PASSWORD = 'test-pass';
  process.env.PAYHERO_CHANNEL_ID = String(CHANNEL_ID);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PAYHERO_API_USERNAME;
  delete process.env.PAYHERO_API_PASSWORD;
  delete process.env.PAYHERO_CHANNEL_ID;
});

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    amountMinor: 5_000,
    currency: 'KES',
    phone: '0713572703',
    externalReference: `${LASTDONOR_REFERENCE_PREFIX}00000000-0000-4000-a000-000000000001`,
    callbackUrl: 'https://lastdonor.org/api/v1/donations/payhero/callback',
    ...overrides,
  };
}

// ─── Configuration ──────────────────────────────────────────────────────────

describe('configuration', () => {
  it('is configured only with all three values present', () => {
    expect(isPayHeroConfigured()).toBe(true);
    expect(configuredChannelId()).toBe(CHANNEL_ID);

    delete process.env.PAYHERO_CHANNEL_ID;
    expect(isPayHeroConfigured()).toBe(false);
    expect(configuredChannelId()).toBe(null);
  });

  it('treats a non-numeric channel id as unconfigured', () => {
    process.env.PAYHERO_CHANNEL_ID = 'my-channel';
    expect(isPayHeroConfigured()).toBe(false);
  });

  it('treats a zero or negative channel id as unconfigured', () => {
    process.env.PAYHERO_CHANNEL_ID = '0';
    expect(isPayHeroConfigured()).toBe(false);
    process.env.PAYHERO_CHANNEL_ID = '-1';
    expect(isPayHeroConfigured()).toBe(false);
  });

  it('throws a typed error, not a generic one, when unconfigured', async () => {
    delete process.env.PAYHERO_API_PASSWORD;
    await expect(getTransactionStatus('ref')).rejects.toBeInstanceOf(
      PayHeroNotConfiguredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends Basic base64(username:password), which is what the API accepts', async () => {
    // Probed 2026-10-21: username:password -> 200; username:secret -> 401;
    // the secret raw -> 401. The API secret is not used by v2 at all.
    fetchMock.mockResolvedValue(
      respond('{"id":13559,"currency":"KES","available_balance":2248,"wallet_status":"PENDING"}'),
    );
    await getWalletBalance();

    const headers = fetchMock.mock.calls[0][1].headers;
    const expected = `Basic ${Buffer.from('test-user:test-pass').toString('base64')}`;
    expect(headers.Authorization).toBe(expected);
  });
});

// ─── Phone handling ─────────────────────────────────────────────────────────

describe('toPayHeroMsisdn', () => {
  it('renders a Kenyan number in the national form PayHero itself uses', () => {
    // PayHero's documented example is 0787677676 and all 600 observed
    // transactions on this account use the same 07… shape.
    expect(toPayHeroMsisdn('0713572703')).toBe('0713572703');
    expect(toPayHeroMsisdn('+254713572703')).toBe('0713572703');
    expect(toPayHeroMsisdn('254713572703')).toBe('0713572703');
    expect(toPayHeroMsisdn('0713 572 703')).toBe('0713572703');
  });

  it('refuses a non-Kenyan number rather than guessing', () => {
    // docs/84: a provider that infers the country will dial a US local
    // number as a Kenyan one. The only channel on this account is a Kenyan
    // paybill, so a foreign number cannot be collected from at all.
    expect(toPayHeroMsisdn('+14155552671')).toBe(null);
    expect(toPayHeroMsisdn('+2348012345678')).toBe(null);
  });

  it('refuses junk', () => {
    expect(toPayHeroMsisdn('')).toBe(null);
    expect(toPayHeroMsisdn(null)).toBe(null);
    expect(toPayHeroMsisdn(undefined)).toBe(null);
    expect(toPayHeroMsisdn('not a number')).toBe(null);
    expect(toPayHeroMsisdn('071357270')).toBe(null); // one digit short
  });
});

// ─── Initiation ─────────────────────────────────────────────────────────────

describe('initiateStkPush', () => {
  const ACCEPTED =
    '{"success":true,"status":"QUEUED","reference":"E8UWT7CLUW",' +
    '"CheckoutRequestID":"ws_CO_15012024164321519708344109"}';

  it('returns the reference, which is the only key status lookups resolve', async () => {
    fetchMock.mockResolvedValue(respond(ACCEPTED, { status: 201 }));

    const result = await initiateStkPush(validRequest());

    expect(result.reference).toBe('E8UWT7CLUW');
    expect(result.checkoutRequestId).toBe('ws_CO_15012024164321519708344109');
    expect(result.status).toBe('QUEUED');
  });

  it('sends the amount in MAJOR units, because that is what PayHero takes', async () => {
    fetchMock.mockResolvedValue(respond(ACCEPTED, { status: 201 }));
    await initiateStkPush(validRequest({ amountMinor: 25_000 }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.amount).toBe(250); // KES 250.00, not 25000
    expect(body.provider).toBe('m-pesa');
    expect(body.channel_id).toBe(CHANNEL_ID);
    expect(body.phone_number).toBe('0713572703');
  });

  /*
   * A gift of KES 50.50 cannot be requested: PayHero's amount is a whole-unit
   * integer. Refused rather than rounded, because rounding money without
   * telling anyone is how a ledger stops matching a bank.
   */
  it('refuses a fractional amount instead of silently rounding it', async () => {
    await expect(initiateStkPush(validRequest({ amountMinor: 5_050 }))).rejects.toThrow(
      /whole KES only/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an amount outside the currency bounds without spending a request', async () => {
    // PayHero blocks a number for 24h after 10 successive failures, so a
    // request that cannot work must never reach the wire.
    await expect(initiateStkPush(validRequest({ amountMinor: 100 }))).rejects.toThrow(
      /outside the KES bounds/,
    );
    await expect(
      initiateStkPush(validRequest({ amountMinor: 25_000_100 })),
    ).rejects.toThrow(/outside the KES bounds/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a currency PayHero does not collect', async () => {
    await expect(
      initiateStkPush(validRequest({ currency: 'USD', amountMinor: 5_000 })),
    ).rejects.toThrow(/does not collect USD/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an unusable phone number without spending a request', async () => {
    await expect(initiateStkPush(validRequest({ phone: 'nope' }))).rejects.toThrow(
      /Unusable phone number/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /*
   * The isolation boundary. This account is shared with BETWOIN LTD, and a
   * reference without our prefix cannot be told apart from their traffic when
   * a callback arrives.
   */
  it('refuses a reference that is not in the LastDonor namespace', async () => {
    await expect(
      initiateStkPush(validRequest({ externalReference: 'INV-009' })),
    ).rejects.toThrow(/must start with LD-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a non-https callback url', async () => {
    await expect(
      initiateStkPush(validRequest({ callbackUrl: 'http://lastdonor.org/cb' })),
    ).rejects.toThrow(/must be https/);
    await expect(
      initiateStkPush(validRequest({ callbackUrl: 'not-a-url' })),
    ).rejects.toThrow(/not a valid URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /*
   * Without a reference the payment can never be verified, because our own
   * external_reference returns 404 from transaction-status. A pending row we
   * can neither settle nor abandon is worse than a clean failure.
   */
  it('treats a response with no reference as a failure', async () => {
    fetchMock.mockResolvedValue(
      respond('{"success":true,"status":"QUEUED","CheckoutRequestID":"ws_CO_1"}', {
        status: 201,
      }),
    );
    await expect(initiateStkPush(validRequest())).rejects.toThrow(
      /returned no reference/,
    );
  });

  it('never puts credentials in the error message', async () => {
    fetchMock.mockResolvedValue(
      respond('{"status":401,"success":false,"message":"Unable to perform request"}', {
        status: 401,
      }),
    );
    const error = await initiateStkPush(validRequest()).catch((e) => e);

    expect(String(error)).not.toContain('test-pass');
    expect(String(error)).not.toContain('test-user');
    expect(String(error)).toContain('Unable to perform request');
  });
});

// ─── Error shapes ───────────────────────────────────────────────────────────

describe('error shapes', () => {
  it('parses a JSON error body served as text/plain', async () => {
    // Probed: POST /api/v2/payments with {} answered 400 with
    // Content-Type text/plain and a JSON body. res.json() is not safe here.
    fetchMock.mockResolvedValue(
      respond(
        '{"error_code":"invalid_argument","error_message":"You have provided an invalid argument","status_code":400}',
        { status: 400, contentType: 'text/plain; charset=utf-8' },
      ),
    );

    const error = (await initiateStkPush(validRequest()).catch((e) => e)) as PayHeroApiError;

    expect(error).toBeInstanceOf(PayHeroApiError);
    expect(error.status).toBe(400);
    expect(error.errorCode).toBe('invalid_argument');
    expect(error.message).toContain('You have provided an invalid argument');
  });

  it('reads the message from `message` as well as `error_message`', async () => {
    // Auth errors use `message`; validation errors use `error_message`.
    fetchMock.mockResolvedValue(
      respond(
        '{"status":401,"success":false,"message":"Unauthorized. Basic Authentication required, given auth not correct."}',
        { status: 401 },
      ),
    );
    const error = (await getWalletBalance().catch((e) => e)) as PayHeroApiError;

    expect(error.message).toContain('given auth not correct');
    expect(error.errorCode).toBe(null);
  });

  it('survives a 404 body carrying only error_message', async () => {
    fetchMock.mockResolvedValue(
      respond('{"error_message":"Endpoint not found"}', { status: 404 }),
    );
    const error = (await getWalletBalance().catch((e) => e)) as PayHeroApiError;
    expect(error.message).toContain('Endpoint not found');
  });

  it('does not throw a JSON parse error when the body is not JSON at all', async () => {
    fetchMock.mockResolvedValue(
      respond('<html>502 Bad Gateway</html>', { status: 502, contentType: 'text/html' }),
    );
    const error = (await getWalletBalance().catch((e) => e)) as PayHeroApiError;

    expect(error).toBeInstanceOf(PayHeroApiError);
    expect(error.status).toBe(502);
    expect(error.message).not.toMatch(/Unexpected token|JSON/i);
  });
});

// ─── Failure classification ─────────────────────────────────────────────────

describe('classifyInitiationFailure', () => {
  /*
   * The docs/72 trap, in PayHero form: an unregistered channel_id answers
   * "Failed to perform request. Please try again". A donor cannot create a
   * payment channel, so telling them to retry is telling them to retry into a
   * wall. Probed with channel_id 999999999.
   */
  it('classifies an unregistered channel as configuration, not transient', () => {
    const error = new PayHeroApiError(
      400,
      'Failed to perform request. Please try again',
      'request_failed',
    );
    expect(classifyInitiationFailure(error)).toBe('configuration');
  });

  it('classifies "not a payments channel" as configuration', () => {
    const error = new PayHeroApiError(400, 'this channel is not a payments channel', 'invalid_argument');
    expect(classifyInitiationFailure(error)).toBe('configuration');
  });

  it('classifies bad credentials as configuration', () => {
    expect(classifyInitiationFailure(new PayHeroApiError(401, 'Unable to perform request'))).toBe(
      'configuration',
    );
    expect(classifyInitiationFailure(new PayHeroNotConfiguredError())).toBe('configuration');
  });

  it('classifies a moved endpoint as configuration', () => {
    expect(classifyInitiationFailure(new PayHeroApiError(404, 'Endpoint not found'))).toBe(
      'configuration',
    );
  });

  it('classifies 5xx and 429 as transient', () => {
    expect(classifyInitiationFailure(new PayHeroApiError(502, 'bad gateway'))).toBe('transient');
    expect(classifyInitiationFailure(new PayHeroApiError(429, 'slow down'))).toBe('transient');
  });

  it('classifies a timeout as transient', () => {
    expect(classifyInitiationFailure(new Error('The operation was aborted'))).toBe('transient');
  });

  it('classifies another 4xx as a rejection of this request', () => {
    expect(
      classifyInitiationFailure(new PayHeroApiError(400, 'invalid argument', 'invalid_argument')),
    ).toBe('rejected');
  });
});

// ─── Transaction status: the money-correctness surface ──────────────────────

describe('getTransactionStatus', () => {
  /*
   * THE trap. Probed four times on 2026-10-21: transaction-status with the
   * reference missing, empty, or a single space answered HTTP 200 with a
   * stable record belonging to merchant "peterkimari" — not ours (our rows
   * read "muchs", and that phone number appears 0 times in 600 of this
   * account's transactions). Its status was FAILED, so the failure mode is
   * reading a stranger's outcome as the answer about our donation.
   */
  it('refuses a blank reference before any request is made', async () => {
    for (const blank of ['', '   ', '\t\n']) {
      await expect(getTransactionStatus(blank)).rejects.toThrow(
        /requires a non-empty reference/,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the reason in the error, so nobody re-adds the fallback', async () => {
    await expect(getTransactionStatus('')).rejects.toThrow(
      /another merchant's transaction/,
    );
  });

  /*
   * `success: true` is about the API call, not the payment. This exact pairing
   * was observed live: success true alongside status FAILED.
   */
  it('reads the outcome from `status`, never from `success`', async () => {
    fetchMock.mockResolvedValue(
      respond(
        '{"transaction_date":"2026-06-20T17:48:58.294235Z","provider":"m-pesa",' +
          '"success":true,"merchant":"peterkimari","phone_number":"0722468260",' +
          '"amount":800,"payment_reference":"","third_party_reference":"",' +
          '"status":"FAILED","CheckoutRequestID":"","external_reference":"Pay"}',
      ),
    );

    const result = await getTransactionStatus('some-ref');

    expect(result.status).toBe('FAILED');
    expect(result.amountMajor).toBe(800);
    expect(result.merchant).toBe('peterkimari');
  });

  it('maps a real settled payment', async () => {
    // Captured verbatim from this account, 2026-10-21.
    fetchMock.mockResolvedValue(
      respond(
        '{"transaction_date":"2026-10-20T21:22:35.33151Z","provider":"m-pesa",' +
          '"success":true,"merchant":"muchs","phone_number":"0717551645","amount":200,' +
          '"payment_reference":"","third_party_reference":"UJLJ8B7LT3","status":"SUCCESS",' +
          '"reference":"UJLJ8B7LT3","CheckoutRequestID":"","provider_reference":"UJLJ8B7LT3",' +
          '"external_reference":"93d84052-35d9-48b9-a532-fbc88c7e2647"}',
      ),
    );

    const result = await getTransactionStatus('UJLJ8B7LT3');

    expect(result.status).toBe('SUCCESS');
    expect(result.amountMajor).toBe(200);
    expect(result.providerReference).toBe('UJLJ8B7LT3');
    expect(result.externalReference).toBe('93d84052-35d9-48b9-a532-fbc88c7e2647');
    expect(result.merchant).toBe('muchs');
  });

  it('maps a queued payment', async () => {
    fetchMock.mockResolvedValue(
      respond('{"success":true,"status":"QUEUED","reference":"E8UWT7CLUW"}'),
    );
    expect((await getTransactionStatus('E8UWT7CLUW')).status).toBe('QUEUED');
  });

  /*
   * A status PayHero has not documented must never be read as money. If they
   * add PARTIAL or REVERSED tomorrow, this client calls it UNKNOWN and the
   * caller leaves the donation pending, rather than guessing.
   */
  it('maps an unrecognised status to UNKNOWN rather than guessing', async () => {
    for (const status of ['PARTIAL', 'REVERSED', 'PENDING', '', 'success ok']) {
      fetchMock.mockResolvedValue(
        respond(JSON.stringify({ success: true, status })),
      );
      expect((await getTransactionStatus('ref')).status).toBe('UNKNOWN');
    }
  });

  it('maps a missing status to UNKNOWN, not to SUCCESS', async () => {
    fetchMock.mockResolvedValue(respond('{"success":true,"amount":200}'));
    expect((await getTransactionStatus('ref')).status).toBe('UNKNOWN');
  });

  it('accepts lowercase status, because casing is not worth a lost payment', async () => {
    fetchMock.mockResolvedValue(respond('{"success":true,"status":"success"}'));
    expect((await getTransactionStatus('ref')).status).toBe('SUCCESS');
  });

  it('url-encodes the reference', async () => {
    fetchMock.mockResolvedValue(respond('{"status":"QUEUED"}'));
    await getTransactionStatus('LD-a b&c=d');

    expect(fetchMock.mock.calls[0][0]).toContain('reference=LD-a%20b%26c%3Dd');
    expect(fetchMock.mock.calls[0][0]).not.toContain('b&c=d');
  });

  it('reports a 404 as an error, not as a failed payment', async () => {
    // A reference PayHero has never seen is not the same as a payment that
    // failed, and conflating them would mark a live payment dead.
    fetchMock.mockResolvedValue(
      respond(
        '{"error_code":"resource_not_found","error_message":"transaction with the given reference not found","status_code":404}',
        { status: 404 },
      ),
    );
    await expect(getTransactionStatus('never-existed')).rejects.toBeInstanceOf(
      PayHeroApiError,
    );
  });
});

// ─── Wallet ─────────────────────────────────────────────────────────────────

describe('getWalletBalance', () => {
  it('reads the shared service wallet', async () => {
    fetchMock.mockResolvedValue(
      respond(
        '{"id":13559,"account_id":12038,"wallet_type":"service_wallet","currency":"KES",' +
          '"available_balance":2248,"wallet_status":"PENDING"}',
      ),
    );

    const result = await getWalletBalance();

    expect(result.currency).toBe('KES');
    expect(result.availableBalance).toBe(2248);
    expect(result.walletStatus).toBe('PENDING');
  });

  it('throws rather than reporting a balance it did not get', async () => {
    fetchMock.mockResolvedValue(respond('{"wallet_type":"service_wallet"}'));
    await expect(getWalletBalance()).rejects.toThrow(/no available_balance/);
  });
});
