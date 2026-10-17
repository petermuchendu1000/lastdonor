/**
 * Africa's Talking — SMS.
 *
 * Written against responses probed from the live sandbox on 2026-10-17 with
 * this account's key, not from the published docs. See `docs/84` for the
 * full transcript and for the account-activation question behind it.
 *
 * ── The three things this API does that will break a naive client ─────────
 *
 * 1. **A failed send still answers HTTP 201.** Every one of these came back
 *    `201`:
 *
 *      {"SMSMessageData":{"Message":"Sent to 1/1 …","Recipients":[
 *        {"status":"Success","statusCode":101,"cost":"KES 0.8000",…}]}}
 *
 *      {"SMSMessageData":{"Message":"Sent to 0/1 Total Cost: 0 …","Recipients":[
 *        {"status":"InvalidPhoneNumber","statusCode":403,"cost":"0",
 *         "messageId":"None","number":"notanumber"}]}}
 *
 *      {"SMSMessageData":{"Message":"InvalidSenderId","Recipients":[]}}
 *
 *    `res.ok` is true for all three. The outcome lives in the body, and in
 *    the third case there is no per-recipient entry at all — the whole
 *    request was rejected and `Recipients` is empty.
 *
 * 2. **Errors are not JSON.** A 400 or 401 answers `text/plain`:
 *
 *      400  requirement failed: The message to send should not be empty
 *      400  Request is missing required form field 'message'
 *      401  The supplied authentication is invalid
 *
 *    `await res.json()` throws on all of them. The body is read as text and
 *    only parsed when the request succeeded.
 *
 * 3. **Africa's Talking will guess the country for you.** Probed:
 *    `to=0712345678` (no `+`) was accepted and delivered to
 *    `+254712345678`. A recipient is therefore never passed through raw —
 *    `normalisePhone` resolves it against OUR region first (`docs/82`), so
 *    a US local number cannot be silently dialled as a Kenyan one.
 *
 * ── Sender ID ─────────────────────────────────────────────────────────────
 *
 * Omitting `from` works and the message sends (Africa's Talking's connector
 * docs say it defaults to `AFRICASTKNG`). Passing an unregistered one —
 * probed with `from=LASTDONOR` — returns `InvalidSenderId` with an empty
 * `Recipients` array and sends nothing. So `AT_SENDER_ID` is optional and
 * is only sent when set: an unset sender ID delivers, a wrong one silently
 * delivers nothing.
 */
import { normalisePhone } from './phone';
import type { CountryCode } from 'libphonenumber-js';

const SANDBOX_BASE = 'https://api.sandbox.africastalking.com/version1';
const LIVE_BASE = 'https://api.africastalking.com/version1';

/** The username Africa's Talking assigns to every account's sandbox app. */
export const SANDBOX_USERNAME = 'sandbox';

export class SmsNotConfiguredError extends Error {
  constructor() {
    super('AT_USERNAME / AT_API_KEY are not set; SMS is unavailable.');
    this.name = 'SmsNotConfiguredError';
  }
}

export class SmsApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    // The body is Africa's Talking's own message, never our key.
    super(`Africa's Talking API error ${status}: ${body.slice(0, 300)}`);
    this.name = 'SmsApiError';
  }
}

interface AtConfig {
  username: string;
  apiKey: string;
  senderId: string | null;
  base: string;
}

/**
 * Read at call time, not at import time, so a missing key is a 503 on one
 * request rather than a module that will not load.
 */
function config(): AtConfig {
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  if (!username || !apiKey) throw new SmsNotConfiguredError();

  return {
    username,
    apiKey,
    senderId: process.env.AT_SENDER_ID || null,
    /*
      The environment is chosen by the username, which is how Africa's
      Talking itself models it: the sandbox app is always called `sandbox`,
      and a live app has the name you gave it. There is no separate flag to
      get out of step with the key — and the key is scoped to one
      environment anyway (this sandbox key answers 401 against the live
      host, probed 2026-10-17).
    */
    base: username === SANDBOX_USERNAME ? SANDBOX_BASE : LIVE_BASE,
  };
}

/** True when a send would be attempted rather than refused. */
export function isSmsConfigured(): boolean {
  return Boolean(process.env.AT_USERNAME && process.env.AT_API_KEY);
}

/** True when sends go to the simulator instead of a real handset. */
export function isSmsSandbox(): boolean {
  return process.env.AT_USERNAME === SANDBOX_USERNAME;
}

async function call(
  cfg: AtConfig,
  path: string,
  init: { method: 'GET' } | { method: 'POST'; form: Record<string, string> },
): Promise<unknown> {
  const res = await fetch(`${cfg.base}${path}`, {
    method: init.method,
    headers: {
      apiKey: cfg.apiKey,
      // Without this the API answers XML, not JSON. Probed: the balance
      // endpoint returned <AfricasTalkingResponse>…</AfricasTalkingResponse>
      // when Accept was absent.
      Accept: 'application/json',
      ...(init.method === 'POST'
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : {}),
    },
    body: init.method === 'POST' ? new URLSearchParams(init.form).toString() : undefined,
    // A person may be waiting on an OTP; do not hang the request thread.
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();

  // Read the status first: a 4xx body here is plain text and would throw
  // out of JSON.parse with a message that hides the real cause.
  if (!res.ok) throw new SmsApiError(res.status, text);

  try {
    return JSON.parse(text);
  } catch {
    throw new SmsApiError(res.status, `non-JSON response: ${text.slice(0, 200)}`);
  }
}

export type SmsSendResult =
  | { ok: true; to: string; messageId: string; cost: string }
  | { ok: false; to: string; reason: string };

interface AtRecipient {
  cost?: string;
  messageId?: string;
  number?: string;
  status?: string;
  statusCode?: number;
}

/**
 * Send one SMS.
 *
 * Returns a result rather than throwing for a rejected recipient, because
 * "that number is not reachable" is an ordinary outcome every caller has to
 * handle. It throws only for the cases where we learned nothing: no
 * credentials, a transport failure, or a response we cannot read.
 */
export async function sendSms(to: string, message: string): Promise<SmsSendResult> {
  const cfg = config();

  /*
    Normalise before the wire. Africa's Talking accepts `0712345678` and
    resolves it against ITS default region, which is how a US number ends
    up as a Kenyan one. Our region decides, or we do not send.
  */
  const phone = normalisePhone(to);
  if (!phone) return { ok: false, to, reason: 'InvalidPhoneNumber' };

  if (!message.trim()) {
    // Probed: the API answers 400 text/plain for this. Caught here so a
    // caller bug does not surface as an opaque provider error.
    return { ok: false, to: phone.e164, reason: 'EmptyMessage' };
  }

  const form: Record<string, string> = {
    username: cfg.username,
    to: phone.e164,
    message,
  };
  if (cfg.senderId) form.from = cfg.senderId;

  const data = (await call(cfg, '/messaging', { method: 'POST', form })) as {
    SMSMessageData?: { Message?: string; Recipients?: AtRecipient[] };
  };

  const payload = data?.SMSMessageData;
  const recipients = payload?.Recipients ?? [];

  /*
    An empty Recipients array means the request itself was refused and no
    recipient was ever considered — `InvalidSenderId` is the case we
    probed. The reason is in the top-level Message, which for a successful
    send is prose ("Sent to 1/1 …") and for a refusal is a single token.
  */
  if (recipients.length === 0) {
    return { ok: false, to: phone.e164, reason: payload?.Message?.trim() || 'NoRecipients' };
  }

  const r = recipients[0];
  if (r.status !== 'Success') {
    return { ok: false, to: phone.e164, reason: r.status || `statusCode ${r.statusCode}` };
  }

  return {
    ok: true,
    to: phone.e164,
    messageId: r.messageId ?? '',
    cost: r.cost ?? '',
  };
}

/**
 * The app's remaining credit, as Africa's Talking reports it
 * (`"KES 4.2000"`).
 *
 * Useful as a liveness probe — it is the cheapest authenticated call — but
 * **not as a send guard**. Probed on the sandbox: with a balance of
 * KES 0.0120 a send still succeeded and the balance went to KES -0.7880.
 */
export async function getSmsBalance(): Promise<string> {
  const cfg = config();
  const data = (await call(
    cfg,
    `/user?username=${encodeURIComponent(cfg.username)}`,
    { method: 'GET' },
  )) as { UserData?: { balance?: string } };

  const balance = data?.UserData?.balance;
  if (typeof balance !== 'string') {
    throw new SmsApiError(200, `no balance in response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return balance;
}

/** Exported for tests and for callers that want to validate before sending. */
export function toSendableNumber(input: string, region?: CountryCode): string | null {
  return normalisePhone(input, region)?.e164 ?? null;
}
