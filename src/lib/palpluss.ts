/**
 * Palpluss M-Pesa collection client.
 *
 * Palpluss (Nairobi) wraps Safaricom Daraja: STK Push collections and B2C
 * payouts, so this codebase does not hold Daraja credentials. It is the second
 * M-Pesa rail alongside PayHero (`src/lib/payhero.ts`), which is still wired
 * and still healthy — see docs/92. Nothing routes to Palpluss until a currency
 * in `src/lib/money/currencies.ts` names `gateway: 'palpluss'`.
 *
 * ---------------------------------------------------------------------------
 * PROBED BEHAVIOUR. Every item marked [VERIFIED] was measured against
 * api.palpluss.com on 2026-11-24 with a live key. The published docs
 * (docs.palpluss.com) contradict themselves in twelve places, so nothing here
 * is taken from them without a probe. Items marked [UNVERIFIED] are the ones a
 * probe could not reach without moving money; they are handled defensively
 * rather than assumed.
 *
 * 1. **A blank transaction id returns somebody else's transactions, with HTTP
 *    200.** [VERIFIED] `GET /v1/transactions/` — an empty path segment —
 *    collapses onto the LIST endpoint and answers `200` with 20 rows from the
 *    whole tenant. `GET /v1/transactions/../transactions` does the same. A
 *    malformed but non-empty id (`not-a-uuid`) correctly answers 400, so the
 *    dangerous input is specifically the empty one: a poll built from an
 *    `undefined` id would read a stranger's payment and report it as the
 *    donor's. `getTransactionStatus` therefore refuses anything that is not a
 *    UUID *before* a URL is built. This is PayHero's probed trap #2 in a new
 *    costume (docs/92) — do not remove the guard.
 *
 * 2. **The meaningful error code is nested one level deeper than the envelope
 *    suggests.** [VERIFIED] A 404 answers
 *      {"success":false,"error":{"message":"Transaction not found",
 *       "code":"HTTP_404",
 *       "details":{"code":"TRANSACTION_NOT_FOUND", …}}, "requestId":"…"}
 *    so code that reads `error.code` gets `HTTP_404` — the status restated —
 *    and never sees `TRANSACTION_NOT_FOUND`. `errorCodeFrom` reads the nested
 *    one first.
 *
 * 3. **The TWO ENDPOINTS OF ONE FLOW USE DIFFERENT CASING.** [VERIFIED by
 *    executing both against the same transaction, 2026-11-24]
 *
 *      POST /payments/stk      -> camelCase: transactionId, phone,
 *                                 accountReference, resultDescription,
 *                                 providerCheckoutId, transactionFee
 *      GET  /transactions/{id} -> snake_case: transaction_id, phone_number,
 *                                 external_reference, result_desc,
 *                                 provider_checkout_id, transaction_fee
 *
 *    Note `accountReference` on the way in comes back as `external_reference`
 *    on the way out — a different NAME, not just a different case. Both
 *    conflicting doc claims were right about one endpoint each, which is why
 *    neither could be trusted alone.
 *
 *    `pick()` is therefore load-bearing and not defensive habit: committing to
 *    either casing would read `undefined` on exactly one of the two calls, and
 *    an `undefined` transaction id is a payment this platform cannot verify.
 *    ⛔ Do not "tidy" it into a single spelling.
 *
 * 4. **HTTP 200 + `success: true` + `resultCode: "0"` does not mean the donor
 *    paid.** [VERIFIED by executing a real KES 1 push, 2026-11-24] Initiation
 *    answered
 *      200 {"success":true,"data":{"status":"PENDING","resultCode":"0",
 *           "resultDescription":"Success. Request accepted for processing"}}
 *    and that same transaction settled 29 seconds later as
 *      {"status":"FAILED","result_code":"1038","result_desc":"No response from user."}
 *    So all three of the signals a caller would reach for — the HTTP status,
 *    the `success` flag, and a zero `resultCode` — were present on a payment
 *    that never happened. "Success" there describes Safaricom accepting the
 *    request, nothing more. Exactly PayHero's trap #1 (docs/92), now measured
 *    here too. Only `SUCCESS` from a status read settles a payment.
 *
 * 5. **The service fee is prepaid, flat, and not charged on failure.**
 *    [VERIFIED across 50 ledger rows] `transaction_fee` is `3` on every
 *    success at or above KES 10, `0` at KES 1, and `0` on all 26 failed rows.
 *    The published pricing page says fees are charged even when a request
 *    later fails; the ledger contradicts it. The fee comes from a prepaid
 *    service wallet, so an empty wallet refuses collection before Safaricom is
 *    reached (`402 INSUFFICIENT_SERVICE_BALANCE`) — the docs/147 §11.3 float
 *    hazard, and there is no float monitor for this rail yet.
 *
 * 6. **Safaricom's own result codes arrive verbatim.** [VERIFIED] `result_code`
 *    `"1"` is an insufficient customer balance, `"1032"` a cancelled prompt,
 *    `"1037"` an unreachable handset, `"1038"` no response, `"17"` is
 *    Palpluss's own "Rule limited." — its per-phone throttle, not a Safaricom
 *    code. See `STK_PUSHES_PER_PHONE_PER_MINUTE`.
 *
 * 7. **Both auth spellings are accepted.** [VERIFIED] `Authorization: Basic
 *    base64(KEY:)` and a raw `Authorization: Basic <KEY>` both authenticate.
 *    We send the base64 form, which is what HTTP Basic actually is; a
 *    fabricated key answers `401 INVALID_API_KEY`, so the credential is
 *    genuinely checked rather than ignored.
 *
 * ⚠️ The key this was probed with belongs to a tenant SHARED with two other
 * products (callbacks observed for `invest254-api.fly.dev` and
 * `printpesa.com`, references `Invest254`, `TamuTraders`, `Madolar`,
 * `66Investors`). Owner decision 2026-11-24: LastDonor gets its own Palpluss
 * account, so `PALPLUSS_API_KEY` in production must be that tenant's key and
 * not the shared one. Until then finding 1 above is not theoretical — the rows
 * a blank id would return are real third-party customers' payments.
 */

import { SUPPORTED_CURRENCY_CODES, getCurrency } from './money/currencies';
import { normalisePhone } from './phone';
// The isolation prefix is defined once, by the rail that introduced it.
// Re-declaring it here would be a second answer to one question (docs/146).
import { LASTDONOR_REFERENCE_PREFIX } from './payhero';

const BASE_URL = 'https://api.palpluss.com/v1';

/** Live keys are `pp_live_`, simulated-money keys `pp_test_`. */
const LIVE_KEY_PREFIX = 'pp_live_';

/**
 * `accountReference` is `maxLength: 12` in the published schema.
 *
 * ⚠️ The limit is not enforced server-side: the shared tenant's ledger holds
 * `PAL-1795473367727` (17 chars), accepted and settled. We hold ourselves to
 * the documented limit anyway — an unenforced limit is a limit that starts
 * being enforced one day — which leaves 9 characters after `LD-`. A UUID does
 * not fit, so the caller passes a short id and keeps the mapping in our own
 * table.
 */
export const MAX_ACCOUNT_REFERENCE = 12;

/** `transactionDesc` is `maxLength: 13` and is shown on the PIN prompt. */
export const MAX_TRANSACTION_DESC = 13;

/**
 * What the donor reads on their own handset, in 13 characters.
 *
 * The brand, not the campaign title: a title clipped to 13 characters says
 * nothing ("Help Keisha W"), while the one thing a person needs at a PIN
 * prompt is who is asking. Checked against `MAX_TRANSACTION_DESC` by a test
 * rather than by eye.
 */
export const TRANSACTION_DESC = 'LastDonor';

/**
 * How many random characters fit after `LD-`.
 *
 * DERIVED from the documented limit, never written down: the whole reason
 * this reference is short is `MAX_ACCOUNT_REFERENCE`, and a hardcoded 9 would
 * silently become wrong the day that moves.
 */
export const ACCOUNT_REFERENCE_RANDOM_CHARS =
  MAX_ACCOUNT_REFERENCE - LASTDONOR_REFERENCE_PREFIX.length;

/**
 * RFC 4648 base32, upper case.
 *
 * Upper-case alphanumeric because that is what every reference observed on
 * this tenant uses and because nothing documents the accepted charset — and
 * 32 symbols because 256 is an exact multiple of it, so `byte & 31` is
 * uniform. A modulo over a 36-character alphabet would bias the first four
 * letters, which is a silly way to lose entropy from a value this short.
 */
const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Mint one `LD-XXXXXXXXX` account reference.
 *
 * ⚠️ 45 bits (9 × 5), where PayHero's `LD-<uuid>` carries 122. That is forced
 * by `MAX_ACCOUNT_REFERENCE`, not chosen, and it is why the reference is
 * never the key to anything that could be read by guessing: the gateway's own
 * transaction id stays server-side, and a status poll resolving by this value
 * sits behind an IP limit that makes 10^14 attempts unreachable. If this ever
 * becomes a bearer token for something that matters, lengthen it — the
 * server-side limit is Palpluss's, and the 12 characters are theirs too.
 *
 * `globalThis.crypto` rather than `node:crypto` deliberately: this module
 * holds constants the donor's browser may yet need (`MIN_PUSH_INTERVAL_MS`,
 * the same way `PROMPT_LIFETIME_MS` was needed — docs/159 §7), and a node
 * builtin import would make it unimportable there.
 */
export function mintAccountReference(): string {
  const bytes = new Uint8Array(ACCOUNT_REFERENCE_RANDOM_CHARS);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += REFERENCE_ALPHABET[b & 31];
  return `${LASTDONOR_REFERENCE_PREFIX}${out}`;
}

/**
 * Palpluss throttles STK pushes per phone, and answers `result_code: "17"`
 * ("Rule limited.") rather than an HTTP error when it bites. [VERIFIED: two
 * rows in the shared ledger, both seconds after a burst to the same number.]
 */
export const STK_PUSHES_PER_PHONE_PER_MINUTE = 2;

/**
 * The shortest gap between two pushes to one number that stays under the
 * throttle above. DERIVED, never picked: at 2 per minute, a third push inside
 * any 60s window is refused, so the floor is 60s / 2.
 *
 * ⚠️ `mpesa-abuse-guard.ts` sets `RETRY_COOLDOWN_MS = 20_000`, which permits
 * three pushes a minute. That is correct for PayHero and too permissive here:
 * a donor retrying twice at 20s would have the third prompt silently rule
 * limited. Whatever guards a Palpluss push must respect THIS constant.
 */
export const MIN_PUSH_INTERVAL_MS = 60_000 / STK_PUSHES_PER_PHONE_PER_MINUTE;

/** Terminal states. A payment in any other state may still change. */
export const TERMINAL_STATUSES = Object.freeze([
  'SUCCESS',
  'FAILED',
  'REVERSED',
  'CANCELLED',
  // `EXPIRED` is absent from the published status enum but present in the
  // webhook event list. Treated as terminal because an expired prompt cannot
  // later succeed; if it never appears, this entry costs nothing.
  'EXPIRED',
] as const);

export type PalplussStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REVERSED'
  | 'CANCELLED'
  | 'EXPIRED';

/** Every status this client recognises. Anything else is NOT money. */
const KNOWN_STATUSES: readonly string[] = Object.freeze([
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'REVERSED',
  'CANCELLED',
  'EXPIRED',
]);

/**
 * What a settlement should DO about a status.
 *
 * ⛔ A PURE FUNCTION, and executed by its tests rather than read as text.
 * `docs/162` §5.1 found that a structural rule cannot see which way a branch
 * points — an injection that INVERTED a settlement decision passed every
 * text rule — and `docs/157` §4.1 fixed the same class by making the
 * judgement pure. The whole of "is this money" lives here, in one expression
 * per outcome, so a test can drive all seven values plus an unknown one.
 *
 *   `pending`      — not over. Poll again; settle nothing.
 *   `success`      — the donor paid. The only value that books a donation.
 *   `failed`       — over, and no money moved.
 *   `reversed`     — money moved and came BACK. Not a failure, not a success.
 *   `unrecognised` — Palpluss's vocabulary grew. Treated as pending so a
 *                    later read can resolve it, never as an outcome.
 */
export type PalplussStatusClass =
  | 'pending'
  | 'success'
  | 'failed'
  | 'reversed'
  | 'unrecognised';

export function classifyPalplussStatus(raw: string | null | undefined): PalplussStatusClass {
  const s = (raw ?? '').trim().toUpperCase();

  if (!KNOWN_STATUSES.includes(s)) return 'unrecognised';

  switch (s) {
    case 'PENDING':
    case 'PROCESSING':
      return 'pending';
    case 'SUCCESS':
      return 'success';
    /*
      ⛔ REVERSED is deliberately NOT folded into `failed`, though both decline
      to book a donation and the difference is invisible on screen.

      `failed` means no money ever moved: the donor cancelled, the prompt
      expired, or the balance was short. `REVERSED` means Palpluss took the
      money and then returned it. Those need different records — a reversal is
      a movement on the service account that somebody may have to reconcile,
      and on the day it arrives for a collection we had ALREADY booked, it is
      a refund nobody asked us for. Merging them would file that under
      "the payment did not go through" and lose it.

      [UNVERIFIED by execution] no REVERSED has ever been observed on this
      tenant — the ledger's 50 rows are SUCCESS and FAILED only. It is in the
      published status enum, so it is handled rather than guessed at.
    */
    case 'REVERSED':
      return 'reversed';
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'failed';
    default:
      /*
        Unreachable: the membership check above has already run. Kept because
        `KNOWN_STATUSES` and this switch are two lists that could drift, and
        a silent fall-through would read an unhandled status as an outcome.
      */
      return 'unrecognised';
  }
}

export interface StkPushRequest {
  /** Integer minor units, in `currency`. Our ledger's unit (docs/92). */
  readonly amountMinor: number;
  readonly currency: string;
  readonly phone: string;
  /** Must start with `LD-` and fit `MAX_ACCOUNT_REFERENCE`. */
  readonly accountReference: string;
  /** Shown on the PIN prompt; truncated to `MAX_TRANSACTION_DESC`. */
  readonly transactionDesc: string;
  readonly callbackUrl: string;
}

export interface StkPushAccepted {
  /**
   * Palpluss's own transaction id, and the ONLY key `GET /transactions/{id}`
   * accepts. Our `accountReference` is not a lookup key, so this MUST be
   * persisted before the response is discarded or the payment becomes
   * unverifiable — PayHero's probed trap #3 (docs/92), unchanged here.
   */
  readonly transactionId: string;
  readonly status: PalplussStatus;
  readonly amountMajor: number;
  readonly currency: string;
  readonly phone: string;
  readonly accountReference: string;
  /** Safaricom's MerchantRequestID / CheckoutRequestID, for support queries. */
  readonly providerRequestId: string | null;
  readonly providerCheckoutId: string | null;
  /** Service-wallet fee in KES for this request. See finding 5. */
  readonly transactionFeeMajor: number | null;
  readonly resultCode: string | null;
  readonly resultDescription: string | null;
}

export interface TransactionSnapshot {
  readonly transactionId: string;
  /**
   * The status narrowed to the vocabulary we know, or `PENDING` when Palpluss
   * sent something else.
   *
   * ⚠️ Do NOT branch a settlement on this field. It cannot represent "a
   * status we do not recognise", so an unknown value arrives here
   * indistinguishable from a genuine `PENDING`. Classify `rawStatus` with
   * `classifyPalplussStatus` instead.
   */
  readonly status: PalplussStatus;
  /**
   * Exactly what Palpluss said, before any narrowing.
   *
   * ⛔ This field exists because `status` used to be a CAST —
   * `asString(...) as PalplussStatus` — which is a lie at the type level: an
   * unrecognised status compiled as a known one and would have been read as
   * whatever the fallback was. The raw string is the only honest input to a
   * decision about somebody's money.
   */
  readonly rawStatus: string;
  readonly amountMajor: number | null;
  readonly currency: string | null;
  readonly phone: string | null;
  readonly accountReference: string | null;
  /** Present on SUCCESS, null otherwise. [VERIFIED in the ledger.] */
  readonly mpesaReceipt: string | null;
  readonly resultCode: string | null;
  readonly resultDescription: string | null;
  readonly transactionFeeMajor: number | null;
}

/**
 * Raised when a guard in this module refused to send anything.
 *
 * Kept distinct from `PalplussApiError` because the two mean opposite things to
 * a donor: nothing left this process, so nothing can have been charged.
 * docs/158 classifies a request-not-sent as `configuration`, and anything that
 * might have reached the rail as `unknown` — and telling a donor "nothing has
 * been charged" is only honest on this branch.
 */
export class PalplussRequestNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PalplussRequestNotSentError';
  }
}

export class PalplussNotConfiguredError extends Error {
  constructor() {
    super('PALPLUSS_API_KEY is not set; refusing to initiate a collection.');
    this.name = 'PalplussNotConfiguredError';
  }
}

export class PalplussApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The nested `error.details.code` where present — see finding 2. */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'PalplussApiError';
  }
}

interface PalplussConfig {
  readonly apiKey: string;
  readonly channelId: string | null;
}

/**
 * Read credentials at call time, never at module scope.
 *
 * `next build` imports every route handler to collect page data, so a module
 * that constructs a client at import time fails the whole build wherever the
 * credential is absent — the defect docs/97 §5.4 records, where a `?? ''` that
 * looked like tolerance was the opposite.
 */
function config(): PalplussConfig {
  const apiKey = process.env.PALPLUSS_API_KEY;
  if (!apiKey) throw new PalplussNotConfiguredError();
  return {
    apiKey,
    channelId: process.env.PALPLUSS_CHANNEL_ID ?? null,
  };
}

/** True when a collection would be attempted rather than refused. */
export function isPalplussConfigured(): boolean {
  return Boolean(process.env.PALPLUSS_API_KEY);
}

/**
 * True when the configured key moves real money.
 *
 * Exposed so a screen can say so rather than a comment claiming it — docs/136
 * §7: a hardcoded "this is test mode" banner becomes a lie the day it is not.
 */
export function isLiveKey(): boolean {
  return (process.env.PALPLUSS_API_KEY ?? '').startsWith(LIVE_KEY_PREFIX);
}

/**
 * The currency this rail charges in, or `null` when nothing routes to it.
 *
 * ⚠️ `null` is TODAY'S ANSWER and the reason this returns one instead of
 * throwing, which is what `payHeroChargeCurrency()` does. No entry in
 * `CURRENCIES` names `gateway: 'palpluss'` yet (owner action, docs/180 §7),
 * so the zero case is the live state and has to be a branch a route can
 * handle rather than an exception. `payHeroChargeCurrency` throws because
 * exactly one currency has always named it, so there it means "the currency
 * table is broken".
 *
 * ⛔ Not hardcoded to `'KES'`. docs/136 §7 is about a screen whose only
 * prose-rather-than-derived sentence became false the day the thing started
 * working; the same applies to a rail's own charge currency. What this rail
 * charges is a fact about the currency table, so it is read from it.
 */
export function palplussChargeCurrency(): string | null {
  const codes = SUPPORTED_CURRENCY_CODES.filter(
    (code) => getCurrency(code).gateway === 'palpluss',
  );
  // Two would be ambiguous and is as much a refusal as none.
  return codes.length === 1 ? codes[0] : null;
}

function authHeader(cfg: PalplussConfig): string {
  // HTTP Basic with the key as username and an EMPTY password: the trailing
  // colon is load-bearing. See finding 7 — the raw form also works, but this
  // is the one that is actually Basic auth.
  return `Basic ${Buffer.from(`${cfg.apiKey}:`, 'utf8').toString('base64')}`;
}

/**
 * Normalise to Palpluss's canonical `254XXXXXXXXX`.
 *
 * Palpluss accepts `07…`, `254…` and `+254…` and normalises internally, but we
 * send the canonical form so the value we store and the value they echo are
 * the same string. Non-Kenyan numbers are refused rather than guessed: the
 * channel is a Kenyan paybill, so collecting from one is impossible, and
 * sending it would spend a throttle slot to learn nothing.
 */
export function toPalplussMsisdn(input: string | null | undefined): string | null {
  const phone = normalisePhone(input);
  if (!phone) return null;
  const kenyan = phone.e164.match(/^\+254(\d{9})$/);
  return kenyan ? `254${kenyan[1]}` : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read a field under either spelling. See finding 3. */
function pick(obj: Record<string, unknown>, snake: string, camel: string): unknown {
  return obj[snake] ?? obj[camel];
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function errorCodeFrom(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const err = (parsed as { error?: unknown }).error;
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; details?: unknown };
  // Nested first: `error.code` is the HTTP status restated (finding 2).
  if (e.details && typeof e.details === 'object') {
    const nested = asString((e.details as { code?: unknown }).code);
    if (nested) return nested;
  }
  return asString(e.code);
}

/**
 * Pull a human-readable message out of an error envelope.
 *
 * ⚠️ `error.message` is a STRING on some failures and an ARRAY of validation
 * strings on others. [VERIFIED 2026-11-24] a 400 from `POST /payments/stk`
 * answered
 *   "message": ["amount must be a positive number",
 *               "amount must not be less than 1",
 *               "phone must be a string"]
 * while the 404 from `GET /transactions/{id}` answered a plain string. A reader
 * that handles only the string case falls through to the fallback and throws
 * away the only text that says what was actually wrong — which is how a
 * validation bug gets reported as "Bad Request" and nothing else.
 */
function errorMessageFrom(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === 'object') {
    const err = (parsed as { error?: unknown }).error;
    if (err && typeof err === 'object') {
      const raw = (err as { message?: unknown }).message;
      const msg = asString(raw);
      if (msg) return msg;
      if (Array.isArray(raw)) {
        const joined = raw.filter((m): m is string => typeof m === 'string' && m.length > 0).join('; ');
        if (joined) return joined;
      }
    }
  }
  return fallback;
}

async function call(
  cfg: PalplussConfig,
  path: string,
  init: { method: 'GET' } | { method: 'POST'; json: Record<string, unknown> },
  timeoutMs: number,
): Promise<Record<string, unknown>> {
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
    Read as text and parse opportunistically. Probed error bodies here were all
    `application/json`, unlike PayHero's `text/plain` 4xx — but a Content-Type
    branch buys nothing and would break the day that changes, so this mirrors
    the PayHero client rather than trusting the header.
  */
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    throw new PalplussApiError(
      res.status,
      errorMessageFrom(parsed, text.slice(0, 300) || res.statusText),
      errorCodeFrom(parsed),
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new PalplussApiError(res.status, `non-JSON response: ${text.slice(0, 200)}`);
  }

  const body = parsed as Record<string, unknown>;

  /*
    `success: false` with HTTP 200 is not documented either way. Treated as a
    failure rather than read past, because the alternative is reporting a
    refusal as an accepted payment.
  */
  if (body.success === false) {
    throw new PalplussApiError(res.status, errorMessageFrom(body, 'request refused'), errorCodeFrom(body));
  }

  const data = body.data;
  if (!data || typeof data !== 'object') {
    throw new PalplussApiError(res.status, 'response carried no data object');
  }
  return data as Record<string, unknown>;
}

/**
 * Ask Palpluss to raise an STK prompt on the donor's handset.
 *
 * Returns only that the request was ACCEPTED. The donor has not paid yet; the
 * outcome arrives by callback and is settled by re-reading the transaction.
 */
export async function initiateStkPush(req: StkPushRequest): Promise<StkPushAccepted> {
  const cfg = config();
  const currency = getCurrency(req.currency);

  if (currency.gateway !== 'palpluss') {
    throw new PalplussRequestNotSentError(
      `Palpluss does not collect ${currency.code}; refusing to initiate. ` +
        'Currency-to-gateway routing is in src/lib/money/currencies.ts.',
    );
  }

  if (!req.accountReference.startsWith(LASTDONOR_REFERENCE_PREFIX)) {
    // The isolation boundary, guarded at the only place a reference reaches the
    // wire. The tenant may be shared (see the header note), and a reference
    // without our prefix cannot be told apart from another product's traffic.
    throw new PalplussRequestNotSentError(
      `accountReference must start with ${LASTDONOR_REFERENCE_PREFIX}; refusing to initiate.`,
    );
  }
  if (req.accountReference.length > MAX_ACCOUNT_REFERENCE) {
    throw new PalplussRequestNotSentError(
      `accountReference is ${req.accountReference.length} chars; the limit is ${MAX_ACCOUNT_REFERENCE}.`,
    );
  }

  if (!Number.isInteger(req.amountMinor)) {
    throw new PalplussRequestNotSentError('amountMinor must be an integer number of minor units.');
  }
  if (req.amountMinor < currency.minDonationMinor || req.amountMinor > currency.maxDonationMinor) {
    throw new PalplussRequestNotSentError(
      `amountMinor ${req.amountMinor} is outside the ${currency.code} bounds ` +
        `${currency.minDonationMinor}–${currency.maxDonationMinor}.`,
    );
  }

  /*
    Palpluss's `amount` is in MAJOR units (KES), minimum 1. Our ledger is minor
    units, so a gift of KES 50.50 cannot be requested over M-Pesa — refused
    here rather than silently rounded, for the reason the PayHero client gives:
    rounding money without telling anyone is how a ledger stops matching a
    bank. `minorToMajor` is deliberately NOT used — its own contract says the
    float it returns must never be sent to a gateway. Alignment is proven
    first, so this division is exact.
  */
  const minorPerMajor = 10 ** currency.exponent;
  if (req.amountMinor % minorPerMajor !== 0) {
    throw new PalplussRequestNotSentError(
      `Palpluss accepts whole ${currency.code} only; ${req.amountMinor} minor units is a fraction.`,
    );
  }
  const amountMajor = req.amountMinor / minorPerMajor;

  const msisdn = toPalplussMsisdn(req.phone);
  if (!msisdn) {
    throw new PalplussRequestNotSentError('Unusable phone number; refusing to spend an STK request on it.');
  }

  let callback: URL;
  try {
    callback = new URL(req.callbackUrl);
  } catch {
    throw new PalplussRequestNotSentError('callbackUrl is not a valid URL.');
  }
  if (callback.protocol !== 'https:') {
    // Palpluss requires https and refuses private addresses. The route treats
    // the body as a hint and re-fetches anyway, but there is no reason to
    // accept a rewritable channel.
    throw new PalplussRequestNotSentError('callbackUrl must be https.');
  }

  const data = await call(
    cfg,
    '/payments/stk',
    {
      method: 'POST',
      json: {
        amount: amountMajor,
        phone: msisdn,
        accountReference: req.accountReference,
        transactionDesc: req.transactionDesc.slice(0, MAX_TRANSACTION_DESC),
        callbackUrl: req.callbackUrl,
        ...(cfg.channelId ? { channelId: cfg.channelId } : {}),
      },
    },
    20_000,
  );

  const transactionId = asString(pick(data, 'transaction_id', 'transactionId'));
  if (!transactionId) {
    /*
      Without this id the payment is unverifiable: our own reference is not a
      lookup key, and a blank id reads another tenant's ledger (finding 1). A
      request we cannot later verify is worse than one that was refused, so
      this is an error and not a warning.
    */
    throw new PalplussApiError(200, 'initiation returned no transaction id; payment would be unverifiable');
  }

  return {
    transactionId,
    status: (asString(pick(data, 'status', 'status')) ?? 'PENDING') as PalplussStatus,
    amountMajor: asNumber(data.amount) ?? amountMajor,
    currency: asString(data.currency) ?? currency.code,
    phone: asString(pick(data, 'phone_number', 'phone')) ?? msisdn,
    accountReference: asString(pick(data, 'external_reference', 'accountReference')) ?? req.accountReference,
    providerRequestId: asString(pick(data, 'provider_request_id', 'providerRequestId')),
    providerCheckoutId: asString(pick(data, 'provider_checkout_id', 'providerCheckoutId')),
    transactionFeeMajor: asNumber(pick(data, 'transaction_fee', 'transactionFee')),
    resultCode: asString(pick(data, 'result_code', 'resultCode')),
    resultDescription: asString(pick(data, 'result_desc', 'resultDescription')),
  };
}

/**
 * Re-read a transaction from Palpluss.
 *
 * This is the only thing that settles a payment. A callback body is a hint
 * that something changed, never the outcome itself (docs/81, docs/92).
 */
export async function getTransactionStatus(transactionId: string): Promise<TransactionSnapshot> {
  const cfg = config();

  /*
    Finding 1. An empty id makes the path collapse onto the LIST endpoint,
    which answers HTTP 200 with another tenant's transactions — so a poll built
    from an undefined id would report a stranger's payment as this donor's.
    Checked before a URL exists, and the UUID shape is required rather than
    just non-emptiness, because `../transactions` also reaches the list.
  */
  if (!UUID_RE.test(transactionId.trim())) {
    throw new PalplussRequestNotSentError(
      'transactionId is not a UUID; refusing to query. ' +
        'A blank or traversing id reads the whole tenant ledger with HTTP 200.',
    );
  }

  const data = await call(cfg, `/transactions/${transactionId.trim()}`, { method: 'GET' }, 15_000);

  const id = asString(pick(data, 'transaction_id', 'transactionId'));
  if (!id) {
    throw new PalplussApiError(200, 'status response carried no transaction id');
  }
  if (id.toLowerCase() !== transactionId.trim().toLowerCase()) {
    /*
      Refuse a reply about a different transaction. Cheap, and the one thing
      that would catch a recurrence of finding 1 through some other path.
    */
    throw new PalplussApiError(200, 'status response is for a different transaction');
  }

  const rawStatus = asString(pick(data, 'status', 'status')) ?? '';

  return {
    transactionId: id,
    /*
      Narrowed for display, and NOT the field a settlement reads. An
      unrecognised status lands on `PENDING` here, which is why `rawStatus`
      sits beside it and `classifyPalplussStatus` takes that one.
    */
    status: (KNOWN_STATUSES.includes(rawStatus.trim().toUpperCase())
      ? (rawStatus.trim().toUpperCase() as PalplussStatus)
      : 'PENDING') as PalplussStatus,
    rawStatus,
    amountMajor: asNumber(data.amount),
    currency: asString(data.currency),
    phone: asString(pick(data, 'phone_number', 'phone')),
    accountReference: asString(pick(data, 'external_reference', 'accountReference')),
    mpesaReceipt: asString(pick(data, 'mpesa_receipt', 'mpesaReceipt')),
    resultCode: asString(pick(data, 'result_code', 'resultCode')),
    resultDescription: asString(pick(data, 'result_desc', 'resultDescription')),
    transactionFeeMajor: asNumber(pick(data, 'transaction_fee', 'transactionFee')),
  };
}

/** True when a status cannot change again. */
export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Why an initiation failed, in the four kinds that mean different things to a
 * donor. The twin of `classifyInitiationFailure` in `payhero.ts`, and the
 * distinction it exists for is docs/158's:
 *
 *   `configuration` — our side, and NOTHING LEFT THIS PROCESS or Palpluss
 *                     refused on a credential/route/float. "Nothing has been
 *                     charged" is substantiated.
 *   `transient`     — Palpluss ANSWERED 5xx or 429, so it had the request and
 *                     did not act on it. Also substantiated.
 *   `rejected`      — Palpluss refused this specific request (4xx). It did not
 *                     ask Safaricom for anything.
 *   `unknown`       — NO RESPONSE ARRIVED. Timeout, DNS, TLS, socket reset. The
 *                     push reaches Safaricom synchronously and we give up at
 *                     20s, so a prompt may have been raised that we never
 *                     heard about. ⛔ A donor must NOT be told nothing was
 *                     charged here.
 */
export type PalplussInitiationFailureKind =
  | 'configuration'
  | 'transient'
  | 'rejected'
  | 'unknown';

export function classifyPalplussInitiationFailure(
  error: unknown,
): PalplussInitiationFailureKind {
  if (error instanceof PalplussNotConfiguredError) return 'configuration';
  /*
    ⛔ Our own pre-flight guards, and NOT `unknown`. There are nine of them in
    `initiateStkPush` (routing, the `LD-` prefix, the reference length, integer
    minor units, the currency bounds, major-unit alignment, an unusable phone,
    an unparseable callback URL, a non-https one) and every one throws before
    `fetch` is reached. docs/158 §4 is the story of the PayHero version of this
    branch telling donors we might have charged them for requests that never
    left the building.
  */
  if (error instanceof PalplussRequestNotSentError) return 'configuration';

  if (error instanceof PalplussApiError) {
    // [VERIFIED] a fabricated key answers 401 INVALID_API_KEY.
    if (error.status === 401 || error.status === 403) return 'configuration';
    // A missing route or channel. A donor retrying cannot create either.
    if (error.status === 404) return 'configuration';

    /*
      The prepaid service wallet is empty (`402 INSUFFICIENT_SERVICE_BALANCE`,
      docs/180 finding 5). Operator's problem, not the donor's, and emphatically
      not transient: nothing about waiting tops up a float. docs/147 §11.3 is
      the same hazard on the other rail, where an unmonitored float drained to
      182 KES and nothing escalated.
    */
    if (error.status === 402) return 'configuration';
    if (error.code === 'INSUFFICIENT_SERVICE_BALANCE') return 'configuration';

    if (error.status >= 500) return 'transient';
    if (error.status === 429) return 'transient';

    // Any other 4xx: Palpluss refused this specific request.
    return 'rejected';
  }

  return 'unknown';
}
