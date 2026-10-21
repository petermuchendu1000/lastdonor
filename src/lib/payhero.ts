/**
 * PayHero / FinoQ — M-Pesa collections.
 *
 * Written against responses probed from the live API on 2026-10-21 with this
 * account's credentials, not from the published docs. The full transcript and
 * the decisions behind it are in
 * `docs/92-PAYHERO-GATEWAY-AND-MULTI-CURRENCY-ADR.md`.
 *
 * PayHero Africa rebranded to FinoQ during 2026; the company states that
 * logins, accounts, channels, API keys and webhooks carry over, and
 * `backend.payhero.co.ke` still authenticates with these credentials
 * (verified 2026-10-21). The host is left as-is until FinoQ publishes a
 * replacement, because a host nobody has probed is a host nobody can trust.
 *
 * ── The four things this API does that will break a naive client ──────────
 *
 * 1. **`success: true` does NOT mean the payment succeeded.** It reports that
 *    the API call worked. The payment outcome is in `status`, and the two
 *    disagree. Probed on `GET /api/v2/transaction-status`:
 *
 *      {"success":true, …, "status":"SUCCESS", "provider_reference":"UJLJ8B7LT3"}
 *      {"success":true, …, "status":"FAILED",  "amount":800}
 *
 *    Fourteen real settled payments on this account all returned
 *    `success:true / status:"SUCCESS"`; a failed one returned
 *    `success:true / status:"FAILED"`. A client that reads `success` books
 *    failed payments as paid. **Only `status` is read here, and anything that
 *    is not exactly `SUCCESS` is not money.**
 *
 * 2. **An empty `reference` returns somebody else's transaction, with HTTP
 *    200.** `GET /api/v2/transaction-status` with the parameter missing, or
 *    set to `""`, or to a single space, answered 200 four times in a row with
 *    a stable record belonging to a different merchant (`merchant:"peterkimari"`,
 *    a phone number appearing 0 times in 600 of this account's own
 *    transactions, while our own rows read `merchant:"muchs"`). It is not a
 *    random row and it is not ours. A poll with an undefined reference would
 *    therefore read a stranger's outcome as the answer to our question — and
 *    since that record's `status` was `FAILED`, the failure mode is "mark the
 *    wrong thing" rather than a clean error. `getTransactionStatus` refuses a
 *    blank reference before the request is built. Reported upstream; do not
 *    rely on it being fixed.
 *
 * 3. **`external_reference` is not a lookup key.** Querying
 *    `transaction-status?reference=<our own external_reference>` returns 404,
 *    even for a payment that settled and whose `external_reference` is
 *    visible in `GET /api/v2/transactions`. Only PayHero's own `reference`
 *    (and the M-Pesa code) resolve. Consequence for the design: the
 *    `reference` returned at initiation **must be persisted**, or the payment
 *    becomes unverifiable.
 *
 * 4. **Error bodies have three different shapes and are sometimes
 *    `text/plain`.** All probed:
 *
 *      401 application/json  {"status":401,"success":false,"message":"Unauthorized. …"}
 *      400 text/plain        {"error_code":"invalid_argument","error_message":"…","status_code":400}
 *      400 application/json  {"error_code":"request_failed","error_message":"Failed to perform request. Please try again","status_code":400}
 *      404 application/json  {"error_message":"Endpoint not found"}
 *
 *    So the message key is `error_message` OR `message`, and the
 *    `Content-Type` cannot be trusted to decide whether to parse. The body is
 *    read as text and parsed opportunistically.
 *
 * ── A retryable-sounding message for a permanent fault ────────────────────
 *
 * An unregistered `channel_id` returns `"Failed to perform request. Please
 * try again"`. Trying again cannot help — the channel does not exist. This is
 * the same trap `docs/72` fixed for Stripe, where a dead key produced "Failed
 * to create checkout session" and invited a retry that could never succeed.
 * `classifyInitiationFailure` separates configuration faults from genuinely
 * transient ones so the donor is never told to retry into a wall.
 *
 * ── Abuse protection, which constrains testing ────────────────────────────
 *
 * PayHero's own documented limits: more than 10 successive failed or
 * cancelled STK requests to the SAME phone number blocks that number for 24
 * hours; over 50 failed requests account-wide in a 6-hour sliding window
 * restricts the account for 4 hours, 500 for 24 hours, 1000 for 72 hours.
 * A cancelled prompt counts. This is why `initiateStkPush` validates
 * everything it can locally before spending a request.
 *
 * ── Isolation from the other product on this account ──────────────────────
 *
 * This PayHero account is shared with BETWOIN LTD, another of the owner's
 * companies: 792 transactions, real inbound M-Pesa from numbers unrelated to
 * LastDonor, and one shared bank channel. Unlike Africa's Talking, whose
 * delivery callback is one-per-app (`docs/86`), PayHero's `callback_url` is
 * per-request, so sharing does not break callbacks. Two rules follow and are
 * enforced by the caller, not here:
 *
 *   - LastDonor only ever recognises a payment whose `external_reference` it
 *     minted and stored itself. See `LASTDONOR_REFERENCE_PREFIX`.
 *   - Account-wide figures are never LastDonor figures. The service wallet
 *     balance is shared with BETWOIN and another product's withdrawal drains
 *     it, so it must not appear in any LastDonor total. `getWalletBalance`
 *     exists for operational diagnostics only and says so.
 */

import { normalisePhone } from './phone';
import { getCurrency } from './money/currencies';

const BASE_URL = 'https://backend.payhero.co.ke';

/**
 * Every LastDonor `external_reference` starts with this.
 *
 * The isolation boundary on a shared account. A callback carrying anything
 * else is BETWOIN's traffic or a forgery, and is refused before any lookup.
 * It is a prefix rather than a secret because it is not a security control on
 * its own — the authority is our own stored intent row, which is keyed by the
 * full reference. This just makes the wrong ones cheap to reject.
 */
export const LASTDONOR_REFERENCE_PREFIX = 'LD-';

/** M-Pesa is the only provider this client requests. */
const PROVIDER_MPESA = 'm-pesa';

export class PayHeroNotConfiguredError extends Error {
  constructor() {
    super(
      'PAYHERO_API_USERNAME / PAYHERO_API_PASSWORD / PAYHERO_CHANNEL_ID are not set; ' +
        'M-Pesa collection is unavailable.',
    );
    this.name = 'PayHeroNotConfiguredError';
  }
}

export class PayHeroApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    /** PayHero's own `error_code`, when it sent one. */
    readonly errorCode: string | null = null,
  ) {
    // The body is PayHero's message. Credentials are never in it, and the
    // Authorization header is never logged anywhere in this module.
    super(`PayHero API error ${status}${errorCode ? ` (${errorCode})` : ''}: ${body.slice(0, 300)}`);
    this.name = 'PayHeroApiError';
  }
}

interface PayHeroConfig {
  username: string;
  password: string;
  /** The registered payment channel that collects the money. */
  channelId: number;
}

/**
 * Read at call time, not at import time, so missing credentials are a 503 on
 * one request rather than a module that will not load. Same reasoning as
 * `africastalking.ts`.
 */
function config(): PayHeroConfig {
  const username = process.env.PAYHERO_API_USERNAME;
  const password = process.env.PAYHERO_API_PASSWORD;
  const channelRaw = process.env.PAYHERO_CHANNEL_ID;

  if (!username || !password || !channelRaw) throw new PayHeroNotConfiguredError();

  const channelId = Number(channelRaw);
  if (!Number.isInteger(channelId) || channelId <= 0) {
    throw new PayHeroNotConfiguredError();
  }

  return { username, password, channelId };
}

/** True when a collection would be attempted rather than refused. */
export function isPayHeroConfigured(): boolean {
  const channelId = Number(process.env.PAYHERO_CHANNEL_ID);
  return Boolean(
    process.env.PAYHERO_API_USERNAME &&
      process.env.PAYHERO_API_PASSWORD &&
      Number.isInteger(channelId) &&
      channelId > 0,
  );
}

/** The configured channel, for diagnostics and for asserting a callback's origin. */
export function configuredChannelId(): number | null {
  return isPayHeroConfigured() ? Number(process.env.PAYHERO_CHANNEL_ID) : null;
}

/**
 * The `Authorization` header value.
 *
 * PayHero's docs call this "the Basic Authorization token" and tell you to
 * copy it from the dashboard, without saying what it is made of. Probed
 * 2026-10-21 against `GET /api/v2/wallets`:
 *
 *   base64(api_username + ':' + api_password)  -> 200
 *   base64(api_username + ':' + api_secret)    -> 401 "Unable to perform request"
 *   the api_secret, raw                        -> 401 "given auth not correct"
 *   the api_password, raw                      -> 401 "given auth not correct"
 *
 * So it is ordinary HTTP Basic over username:password, and **the API secret
 * is not used by v2 at all** — it is not a webhook signing key either, since
 * PayHero's callbacks carry no signature (see the callback route).
 */
function authHeader(cfg: PayHeroConfig): string {
  return `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`;
}

/** Pull PayHero's message out of whichever error shape it used. */
function errorMessageFrom(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    const msg = o.error_message ?? o.message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  return fallback;
}

function errorCodeFrom(parsed: unknown): string | null {
  if (parsed && typeof parsed === 'object') {
    const code = (parsed as Record<string, unknown>).error_code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return null;
}

async function call(
  cfg: PayHeroConfig,
  path: string,
  init: { method: 'GET' } | { method: 'POST'; json: Record<string, unknown> },
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init.method === 'POST' ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  /*
    Read as text and parse opportunistically. A 400 here can arrive as
    `text/plain` carrying a JSON body (probed: the empty-payload case), so
    neither `res.json()` nor a Content-Type branch is safe.
  */
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    throw new PayHeroApiError(
      res.status,
      errorMessageFrom(parsed, text.slice(0, 300) || res.statusText),
      errorCodeFrom(parsed),
    );
  }

  if (parsed === null) {
    throw new PayHeroApiError(res.status, `non-JSON response: ${text.slice(0, 200)}`);
  }

  return parsed;
}

// ─── Phone format ───────────────────────────────────────────────────────────

/**
 * The format PayHero wants a subscriber number in.
 *
 * Normalised through `normalisePhone` FIRST, against our own region, for the
 * reason `docs/84` records: a provider that guesses the country for you will
 * happily dial a US local number as a Kenyan one. Our region decides, or we
 * do not send.
 *
 * It is then rendered as the national `07…` form rather than E.164, because
 * that is what PayHero itself uses in both places we can observe: the
 * documented example (`0787677676`) and all 600 of this account's own
 * historical transactions (`0717551645`, `0722468260`, …). E.164 may well
 * work too, but it is unverified, and `docs/81` is explicit that this project
 * does not ship an unexercised provider path. Returns `null` for anything
 * unusable.
 *
 * Note for the multi-country future: FinoQ's other markets will need E.164 or
 * a per-country national format, so this function is the one place that
 * changes.
 */
export function toPayHeroMsisdn(input: string | null | undefined): string | null {
  const phone = normalisePhone(input);
  if (!phone) return null;

  // Kenya: +254 7XXXXXXXX / +254 1XXXXXXXX -> 07XXXXXXXX / 01XXXXXXXX
  const kenyan = phone.e164.match(/^\+254(\d{9})$/);
  if (kenyan) return `0${kenyan[1]}`;

  /*
    Any other country is refused rather than guessed. The only channel this
    account has is a Kenyan paybill, so a non-Kenyan number cannot be
    collected from anyway, and sending one would spend an STK request against
    the abuse counters to learn nothing.
  */
  return null;
}

// ─── Initiating a collection ────────────────────────────────────────────────

export interface StkPushRequest {
  /** Amount in the currency's MINOR units, e.g. 5000 for KES 50.00. */
  amountMinor: number;
  /** ISO 4217 code. Must be a currency PayHero collects. */
  currency: string;
  /** Anything a person typed; normalised and refused if unusable. */
  phone: string;
  /** Our own reference. Must start with `LASTDONOR_REFERENCE_PREFIX`. */
  externalReference: string;
  /** Where PayHero should POST the outcome. Absolute https URL. */
  callbackUrl: string;
  /** Shown on the prompt. Optional. */
  customerName?: string | null;
}

export interface StkPushAccepted {
  /**
   * PayHero's reference for this attempt. **Persist this.** It is the only
   * key `transaction-status` resolves — our own `external_reference` 404s.
   */
  reference: string;
  /** Safaricom's checkout id, echoed back on the callback. May be empty. */
  checkoutRequestId: string;
  /** PayHero's own queue state at initiation, normally `QUEUED`. */
  status: string;
}

/**
 * Why an initiation failed, and whether retrying could ever help.
 *
 * `configuration` is the class `docs/72` was about: a fault only an operator
 * can fix, which must never be presented to a donor as "try again".
 */
export type InitiationFailureKind = 'configuration' | 'rejected' | 'transient';

export function classifyInitiationFailure(error: unknown): InitiationFailureKind {
  if (error instanceof PayHeroNotConfiguredError) return 'configuration';

  if (error instanceof PayHeroApiError) {
    if (error.status === 401 || error.status === 403) return 'configuration';
    if (error.status === 404) return 'configuration';

    /*
      An unregistered channel answers 400 `request_failed` with "Failed to
      perform request. Please try again" (probed with channel_id 999999999).
      The wording invites a retry; the cause is a missing channel. Treated as
      configuration, because a donor retrying cannot create a channel.
    */
    if (error.errorCode === 'request_failed') return 'configuration';

    /*
      "this channel is not a payments channel" — probed by sending a bad
      provider against the real channel. Also an operator problem.
    */
    if (/not a payments channel/i.test(error.message)) return 'configuration';

    if (error.status >= 500) return 'transient';
    if (error.status === 429) return 'transient';

    // Any other 4xx: PayHero refused this specific request.
    return 'rejected';
  }

  // Timeout, DNS, TLS, socket reset.
  return 'transient';
}

/**
 * Ask PayHero to push an M-Pesa PIN prompt to a handset.
 *
 * Everything checkable is checked locally first. PayHero's abuse protection
 * counts failed and cancelled requests against both the number (10 in
 * succession → 24h block) and the account (50 in 6h → 4h restriction), so a
 * request that was never going to work must not be spent.
 *
 * A successful return means **the prompt was queued, not that money moved.**
 * Nothing may be recorded as a donation on the strength of this; the outcome
 * comes from `getTransactionStatus`.
 */
export async function initiateStkPush(req: StkPushRequest): Promise<StkPushAccepted> {
  const cfg = config();

  const currency = getCurrency(req.currency);
  if (currency.gateway !== 'payhero') {
    throw new Error(
      `PayHero does not collect ${currency.code}; refusing to initiate. ` +
        'Currency-to-gateway routing is in src/lib/money/currencies.ts.',
    );
  }

  if (!req.externalReference.startsWith(LASTDONOR_REFERENCE_PREFIX)) {
    // Guards the isolation boundary at the only place a reference is minted
    // onto the wire. A reference without our prefix could not be told apart
    // from BETWOIN's traffic on the callback.
    throw new Error(
      `external_reference must start with ${LASTDONOR_REFERENCE_PREFIX}; refusing to initiate.`,
    );
  }

  if (!Number.isInteger(req.amountMinor)) {
    throw new Error('amountMinor must be an integer number of minor units.');
  }
  if (req.amountMinor < currency.minDonationMinor || req.amountMinor > currency.maxDonationMinor) {
    throw new Error(
      `amountMinor ${req.amountMinor} is outside the ${currency.code} bounds ` +
        `${currency.minDonationMinor}–${currency.maxDonationMinor}.`,
    );
  }

  /*
    PayHero's `amount` is in MAJOR units and is documented as an Integer; the
    example is `100` for KES 100 and every observed transaction carries a
    whole-shilling amount. Our ledger is minor units, so a gift of KES 50.50
    cannot be requested — rejected here rather than silently rounded, because
    rounding money without telling anyone is how a ledger stops matching a
    bank.
  */
  const minorPerMajor = 10 ** currency.exponent;
  if (req.amountMinor % minorPerMajor !== 0) {
    throw new Error(
      `PayHero accepts whole ${currency.code} only; ${req.amountMinor} minor units is a fraction.`,
    );
  }
  const amountMajor = req.amountMinor / minorPerMajor;

  const msisdn = toPayHeroMsisdn(req.phone);
  if (!msisdn) {
    throw new Error('Unusable phone number; refusing to spend an STK request on it.');
  }

  let callback: URL;
  try {
    callback = new URL(req.callbackUrl);
  } catch {
    throw new Error('callbackUrl is not a valid URL.');
  }
  if (callback.protocol !== 'https:') {
    // PayHero posts the outcome here. Over http it is readable and
    // rewritable in transit, and the route treats the body as a hint anyway,
    // but there is no reason to accept it.
    throw new Error('callbackUrl must be https.');
  }

  const data = (await call(
    cfg,
    '/api/v2/payments',
    {
      method: 'POST',
      json: {
        amount: amountMajor,
        phone_number: msisdn,
        channel_id: cfg.channelId,
        provider: PROVIDER_MPESA,
        external_reference: req.externalReference,
        callback_url: callback.toString(),
        ...(req.customerName ? { customer_name: req.customerName.slice(0, 100) } : {}),
      },
    },
    // Generous: this call reaches Safaricom synchronously. Shorter than the
    // donor's patience, longer than a normal round trip.
    20_000,
  )) as { reference?: unknown; CheckoutRequestID?: unknown; status?: unknown };

  const reference = typeof data.reference === 'string' ? data.reference.trim() : '';
  if (!reference) {
    /*
      Without a reference the payment is unverifiable: our own
      external_reference does not resolve at transaction-status (probed: 404).
      Treated as a hard failure so the caller does not record a pending
      payment it can never settle or abandon.
    */
    throw new PayHeroApiError(
      200,
      `initiation returned no reference: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  return {
    reference,
    checkoutRequestId:
      typeof data.CheckoutRequestID === 'string' ? data.CheckoutRequestID : '',
    status: typeof data.status === 'string' ? data.status : 'QUEUED',
  };
}

// ─── Reading the authoritative outcome ──────────────────────────────────────

/**
 * PayHero's documented payment states.
 *
 * `QUEUED` — prompt sent, no outcome yet. `SUCCESS` — money moved.
 * `FAILED` — it did not, including a donor who cancelled or let the prompt
 * expire. Anything else is treated as `UNKNOWN` and never as money.
 */
export type PaymentStatus = 'QUEUED' | 'SUCCESS' | 'FAILED' | 'UNKNOWN';

export interface TransactionStatus {
  /** The ONLY field that says whether money moved. */
  status: PaymentStatus;
  /** Amount in MAJOR units, as PayHero reports it. Null when absent. */
  amountMajor: number | null;
  /** The M-Pesa receipt number, present once settled. */
  providerReference: string | null;
  /** Our own reference, echoed back. Used to re-check isolation. */
  externalReference: string | null;
  /** The subscriber number PayHero charged, in its own local format. */
  phoneNumber: string | null;
  /** PayHero's account name on the record. Used to detect a foreign row. */
  merchant: string | null;
  /** Unparsed, for audit rows. */
  raw: Record<string, unknown>;
}

function toPaymentStatus(value: unknown): PaymentStatus {
  if (typeof value !== 'string') return 'UNKNOWN';
  const upper = value.trim().toUpperCase();
  if (upper === 'SUCCESS' || upper === 'FAILED' || upper === 'QUEUED') return upper;
  return 'UNKNOWN';
}

/**
 * Ask PayHero what actually happened to a payment.
 *
 * This is the authoritative call. The callback is only a hint that something
 * changed — PayHero's callbacks carry no signature of any kind, so a forged
 * POST could otherwise assert a payment that never happened. Same shape as
 * the Didit webhook in `docs/81`: read an id from the body, then ask the
 * provider over an authenticated call of our own.
 *
 * @param reference PayHero's own `reference` from initiation, or an M-Pesa
 *                  receipt code. **Not** our `external_reference`, which 404s.
 */
export async function getTransactionStatus(reference: string): Promise<TransactionStatus> {
  const cfg = config();

  /*
    THE most important three lines in this module.

    `transaction-status` with a missing, empty or whitespace reference answers
    HTTP 200 with a stable transaction belonging to a DIFFERENT merchant
    (probed four times, 2026-10-21). Letting a blank reference through would
    read that stranger's `status` as the answer about our donation. Refused
    before a request is built, so no network call can ever be made without a
    reference.
  */
  const trimmed = (reference ?? '').trim();
  if (!trimmed) {
    throw new Error(
      'getTransactionStatus requires a non-empty reference: PayHero answers 200 with ' +
        "another merchant's transaction when the parameter is blank.",
    );
  }

  const data = (await call(
    cfg,
    `/api/v2/transaction-status?reference=${encodeURIComponent(trimmed)}`,
    { method: 'GET' },
    15_000,
  )) as Record<string, unknown>;

  const amount = data.amount;

  return {
    // Read from `status` alone. `data.success` reports whether the API call
    // worked and is `true` on a FAILED payment.
    status: toPaymentStatus(data.status),
    amountMajor: typeof amount === 'number' && Number.isFinite(amount) ? amount : null,
    providerReference:
      typeof data.provider_reference === 'string' && data.provider_reference.trim()
        ? data.provider_reference.trim()
        : null,
    externalReference:
      typeof data.external_reference === 'string' && data.external_reference.trim()
        ? data.external_reference.trim()
        : null,
    phoneNumber: typeof data.phone_number === 'string' ? data.phone_number : null,
    merchant: typeof data.merchant === 'string' ? data.merchant : null,
    raw: data,
  };
}

// ─── Diagnostics only ───────────────────────────────────────────────────────

export interface WalletBalance {
  currency: string;
  availableBalance: number;
  walletStatus: string | null;
}

/**
 * The PayHero service wallet balance.
 *
 * **Operational diagnostics only. This is NOT a LastDonor figure and must
 * never appear in a LastDonor total, page or report.** The account is shared
 * with BETWOIN LTD: their collections raise this number and their withdrawals
 * drain it, so it says nothing about money raised on this platform. It is
 * also not a send guard — `docs/84` records the sibling case where Africa's
 * Talking let a send through on a balance of KES 0.012 and went negative.
 *
 * Probed 2026-10-21: `wallet_type=service_wallet` and an omitted
 * `wallet_type` both return the service wallet; `payment_wallet` 404s.
 */
export async function getWalletBalance(): Promise<WalletBalance> {
  const cfg = config();
  const data = (await call(
    cfg,
    '/api/v2/wallets?wallet_type=service_wallet',
    { method: 'GET' },
    15_000,
  )) as Record<string, unknown>;

  const balance = data.available_balance;
  if (typeof balance !== 'number') {
    throw new PayHeroApiError(
      200,
      `no available_balance in response: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  return {
    currency: typeof data.currency === 'string' ? data.currency : 'KES',
    availableBalance: balance,
    walletStatus: typeof data.wallet_status === 'string' ? data.wallet_status : null,
  };
}
