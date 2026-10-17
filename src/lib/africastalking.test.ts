/**
 * Africa's Talking SMS client.
 *
 * Every response body in this file is a VERBATIM capture from the live
 * sandbox on 2026-10-17, not a guess at the shape. The whole point of the
 * module is that this API reports failure inside a 201, so a test written
 * from an imagined payload would prove nothing. See `docs/84`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sendSms,
  getSmsBalance,
  isSmsConfigured,
  isSmsSandbox,
  SmsNotConfiguredError,
  SmsApiError,
} from './africastalking';

/** Probed responses, copied exactly. */
const BODY = {
  success:
    '{"SMSMessageData":{"Message":"Sent to 1/1 Total Cost: KES 0.8000 Message parts: 1","Recipients":[{"cost":"KES 0.8000","messageId":"ATXid_2aca28c388b357de733468ffc760bafe","number":"+254711082300","status":"Success","statusCode":101}]}}',
  invalidPhone:
    '{"SMSMessageData":{"Message":"Sent to 0/1 Total Cost: 0 Message parts: 1","Recipients":[{"cost":"0","messageId":"None","number":"notanumber","status":"InvalidPhoneNumber","statusCode":403}]}}',
  invalidSenderId: '{"SMSMessageData":{"Message":"InvalidSenderId","Recipients":[]}}',
  balance: '{"UserData":{"balance":"KES 4.2000"}}',
  // 4xx bodies are text/plain, not JSON.
  emptyMessage: 'requirement failed: The message to send should not be empty',
  badAuth: 'The supplied authentication is invalid',
  xml: '<AfricasTalkingResponse><UserData><balance>KES -0.7880</balance></UserData></AfricasTalkingResponse>',
};

function reply(body: string, status = 201) {
  return new Response(body, { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('AT_USERNAME', 'sandbox');
  vi.stubEnv('AT_API_KEY', 'test-key');
  vi.stubEnv('AT_SENDER_ID', '');
  vi.stubEnv('SMS_DEFAULT_REGION', 'KE');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** The form body of the last POST, as a plain object. */
function lastForm(): Record<string, string> {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
  return Object.fromEntries(new URLSearchParams(String(init.body)));
}

function lastHeaders(): Record<string, string> {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
  return init.headers as Record<string, string>;
}

describe('a send that worked', () => {
  it('reads the messageId and cost out of the 201', async () => {
    fetchMock.mockResolvedValue(reply(BODY.success));
    await expect(sendSms('+254711082300', 'hello')).resolves.toEqual({
      ok: true,
      to: '+254711082300',
      messageId: 'ATXid_2aca28c388b357de733468ffc760bafe',
      cost: 'KES 0.8000',
    });
  });
});

/*
  The reason this module exists. All three of these answered HTTP 201 from
  the real sandbox; a client that trusts `res.ok` reports every one of them
  as a delivered message.
*/
describe('a failure that still answers 201', () => {
  it('does not call an InvalidPhoneNumber recipient a success', async () => {
    fetchMock.mockResolvedValue(reply(BODY.invalidPhone));
    await expect(sendSms('+254711082300', 'hello')).resolves.toEqual({
      ok: false,
      to: '+254711082300',
      reason: 'InvalidPhoneNumber',
    });
  });

  it('reports InvalidSenderId, which arrives with NO recipient entry at all', async () => {
    fetchMock.mockResolvedValue(reply(BODY.invalidSenderId));
    const out = await sendSms('+254711082300', 'hello');
    expect(out).toEqual({ ok: false, to: '+254711082300', reason: 'InvalidSenderId' });
  });

  it('does not crash on a body with neither Recipients nor Message', async () => {
    fetchMock.mockResolvedValue(reply('{}'));
    await expect(sendSms('+254711082300', 'hello')).resolves.toMatchObject({
      ok: false,
      reason: 'NoRecipients',
    });
  });
});

describe('a 4xx, whose body is plain text and not JSON', () => {
  it.each([
    [400, BODY.emptyMessage],
    [401, BODY.badAuth],
  ])('surfaces the %i body instead of a JSON parse error', async (status, body) => {
    fetchMock.mockResolvedValue(reply(body, status));
    await expect(sendSms('+254711082300', 'hello')).rejects.toSatisfy(
      (e: unknown) => e instanceof SmsApiError && e.status === status && e.message.includes(body),
    );
  });

  it('does not leak the api key into the error', async () => {
    fetchMock.mockResolvedValue(reply(BODY.badAuth, 401));
    const err = await sendSms('+254711082300', 'hi').catch((e: Error) => e);
    expect(String(err)).not.toContain('test-key');
  });
});

describe('a 200 that is not JSON', () => {
  it('is an error, not a silent undefined', async () => {
    fetchMock.mockResolvedValue(reply(BODY.xml, 200));
    await expect(getSmsBalance()).rejects.toBeInstanceOf(SmsApiError);
  });
});

/*
  Probed: `to=0712345678` was accepted by the API and delivered to
  +254712345678. Africa's Talking applies its own default region, so a raw
  string must never reach the wire.
*/
describe('the recipient is normalised by us, never by the provider', () => {
  it('sends E.164 even when the caller passed a local number', async () => {
    fetchMock.mockResolvedValue(reply(BODY.success));
    await sendSms('0712345678', 'hello');
    expect(lastForm().to).toBe('+254712345678');
  });

  it('refuses an unusable number without calling the API at all', async () => {
    await expect(sendSms('notanumber', 'hello')).resolves.toEqual({
      ok: false,
      to: 'notanumber',
      reason: 'InvalidPhoneNumber',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a well-formed but undialable number rather than paying to find out', async () => {
    // +1 555 is a reserved US range; the sandbox charged USD 0.02 to send
    // to a +1 number, so this check has a price attached.
    await expect(sendSms('+15551234567', 'hello')).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send an empty message, which the API answers 400 for', async () => {
    await expect(sendSms('+254711082300', '   ')).resolves.toEqual({
      ok: false,
      to: '+254711082300',
      reason: 'EmptyMessage',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the sender id is opt-in, because a wrong one sends nothing', () => {
  it('omits `from` when AT_SENDER_ID is unset', async () => {
    fetchMock.mockResolvedValue(reply(BODY.success));
    await sendSms('+254711082300', 'hello');
    expect(lastForm()).not.toHaveProperty('from');
  });

  it('sends `from` when it is set', async () => {
    vi.stubEnv('AT_SENDER_ID', 'LASTDONOR');
    fetchMock.mockResolvedValue(reply(BODY.success));
    await sendSms('+254711082300', 'hello');
    expect(lastForm().from).toBe('LASTDONOR');
  });
});

describe('the request Africa’s Talking actually needs', () => {
  it('asks for JSON, or the API answers XML', async () => {
    fetchMock.mockResolvedValue(reply(BODY.success));
    await sendSms('+254711082300', 'hello');
    expect(lastHeaders().Accept).toBe('application/json');
  });

  it('authenticates with the apiKey header and form encoding', async () => {
    fetchMock.mockResolvedValue(reply(BODY.success));
    await sendSms('+254711082300', 'hello');
    expect(lastHeaders().apiKey).toBe('test-key');
    expect(lastHeaders()['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('carries the username in the body as well as the key in the header', async () => {
    fetchMock.mockResolvedValue(reply(BODY.success));
    await sendSms('+254711082300', 'hello');
    expect(lastForm().username).toBe('sandbox');
  });
});

describe('which host it talks to', () => {
  it('uses the sandbox host for the sandbox username', async () => {
    fetchMock.mockResolvedValue(reply(BODY.success));
    await sendSms('+254711082300', 'hello');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.sandbox.africastalking.com/version1/messaging',
    );
  });

  it('uses the live host for any other username', async () => {
    vi.stubEnv('AT_USERNAME', 'lastdonor');
    fetchMock.mockResolvedValue(reply(BODY.success));
    await sendSms('+254711082300', 'hello');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.africastalking.com/version1/messaging');
  });

  it('says plainly when it is in sandbox, so nothing reports a simulator send as delivered', () => {
    expect(isSmsSandbox()).toBe(true);
    vi.stubEnv('AT_USERNAME', 'lastdonor');
    expect(isSmsSandbox()).toBe(false);
  });
});

describe('no credentials', () => {
  it.each([
    ['AT_API_KEY', 'AT_USERNAME'],
    ['AT_USERNAME', 'AT_API_KEY'],
  ])('throws NotConfigured when %s is missing', async (missing) => {
    vi.stubEnv(missing, '');
    await expect(sendSms('+254711082300', 'hello')).rejects.toBeInstanceOf(
      SmsNotConfiguredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports configuration without throwing', () => {
    expect(isSmsConfigured()).toBe(true);
    vi.stubEnv('AT_API_KEY', '');
    expect(isSmsConfigured()).toBe(false);
  });

  /*
    Read at call time, not at import time: a missing key must be a 503 on
    one request, not a module that refuses to load.
  */
  it('is read per call, so setting the key later works', async () => {
    vi.stubEnv('AT_API_KEY', '');
    await expect(sendSms('+254711082300', 'hi')).rejects.toBeInstanceOf(SmsNotConfiguredError);
    vi.stubEnv('AT_API_KEY', 'test-key');
    fetchMock.mockResolvedValue(reply(BODY.success));
    await expect(sendSms('+254711082300', 'hi')).resolves.toMatchObject({ ok: true });
  });
});

describe('balance', () => {
  it('returns the string Africa’s Talking reports', async () => {
    fetchMock.mockResolvedValue(reply(BODY.balance, 200));
    await expect(getSmsBalance()).resolves.toBe('KES 4.2000');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.sandbox.africastalking.com/version1/user?username=sandbox',
    );
  });

  /*
    Probed: with KES 0.0120 remaining a send still returned Success and the
    balance went NEGATIVE. Balance is a diagnostic, never a send guard, and
    nothing in this module consults it before sending.
  */
  it('is not consulted before a send', async () => {
    fetchMock.mockResolvedValue(reply(BODY.success));
    await sendSms('+254711082300', 'hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/user');
  });
});
