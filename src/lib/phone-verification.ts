/**
 * Phone verification over SMS: mint a code, send it, check it.
 *
 * `docs/82` left the storage question open — reuse `verification_tokens`,
 * or add a counter. Resolved here with a table of its own; the reasoning
 * is on `phoneVerificationCodes` in `src/db/schema.ts` and in `docs/85`.
 *
 * ── What stops a six-digit code being guessed ─────────────────────────────
 *
 * A six-digit code is one in a million, and an IP rate limit does not
 * protect it: guesses spread across addresses walk straight through. Three
 * things do, and all three are in this file:
 *
 *   1. **Five attempts per code, counted on the row**, then the code is
 *      burned. The budget is 5/1,000,000, not "as many as you can send".
 *   2. **Ten-minute expiry**, so a code is not a standing target.
 *   3. **One live code per user.** Minting deletes the previous row, so an
 *      attacker cannot widen the target by requesting many codes and
 *      guessing against all of them.
 *
 * The code is stored as a SHA-256 hash, never in clear. A database read
 * must not hand somebody a working code.
 *
 * ── A verified phone is not consent to message it ─────────────────────────
 *
 * `phoneVerifiedAt` says the number reaches this person. `smsConsentAt`
 * says they agreed to be messaged. They are set by different actions and
 * `recordSmsConsent` is separate for that reason — the same split
 * `docs/41` made for mail.
 */
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { phoneVerificationCodes, users } from '@/db/schema';
import { normalisePhone } from './phone';
import { sendSms, type SmsSendResult } from './africastalking';

/** Digits in a code. Six is what people expect to be read off a screen. */
export const CODE_LENGTH = 6;

/** How long a code is good for. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Guesses allowed against one code before it is burned.
 *
 * Five, not three: a person mistyping a code they are reading off a phone
 * is the common case, and 5/1,000,000 is not a meaningfully worse budget
 * than 3/1,000,000.
 */
export const MAX_ATTEMPTS = 5;

/** Shortest gap between two code requests from the same person. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Hash a code for storage: **HMAC with the server-side pepper**, not a
 * bare digest.
 *
 * Proven against production on 2026-10-17, before this was peppered: a
 * plain SHA-256 of a six-digit code was recovered in seconds by hashing
 * all 10^6 candidates. The search space is the code's, not the hash's, so
 * a digest is no protection at all here — anyone who can read the table
 * reads a working code.
 *
 * `PASSWORD_PEPPER` lives only in the environment, never in the database,
 * so a database-only breach cannot be turned into codes. Same reasoning,
 * and the same secret, as `src/lib/password.ts`; mandatory in production
 * there and here.
 *
 * The user id is inside the HMAC input so a row copied from one account
 * into another stops verifying, and `phone-otp:` keeps this use
 * domain-separated from password hashing.
 */
export function hashCode(userId: string, code: string): string {
  const pepper = process.env.PASSWORD_PEPPER;

  if (!pepper) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PASSWORD_PEPPER must be set in production to store verification codes.');
    }
    // Dev without a pepper. Still an HMAC, just with a constant key: the
    // stored value stays the same shape, so nothing downstream differs.
    return createHmac('sha256', 'dev-no-pepper').update(`phone-otp:${userId}:${code}`).digest('hex');
  }

  return createHmac('sha256', pepper).update(`phone-otp:${userId}:${code}`).digest('hex');
}

/**
 * A code with uniform digits, from the CSPRNG.
 *
 * `randomInt` rather than `Math.random`, and per digit rather than
 * `randomInt(0, 1_000_000)` padded, so leading zeros are as likely as any
 * other digit and the space really is 10^6.
 */
export function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += randomInt(0, 10).toString();
  return out;
}

/** Constant-time compare of two hex digests of equal length. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export type SendCodeResult =
  | { ok: true; phoneE164: string; sandbox: boolean }
  | {
      ok: false;
      reason: 'invalid_phone' | 'cooldown' | 'already_verified' | 'send_failed';
      detail?: string;
      retryAfterMs?: number;
    };

/**
 * Mint a code for `rawPhone` and text it to them.
 *
 * The number is normalised against our region first (`docs/84`: Africa's
 * Talking will otherwise resolve a local number against *its* default and
 * deliver to a different country's subscriber).
 */
export async function sendPhoneCode(
  userId: string,
  rawPhone: string,
  now: Date = new Date(),
): Promise<SendCodeResult> {
  const phone = normalisePhone(rawPhone);
  if (!phone) return { ok: false, reason: 'invalid_phone' };

  const [existing] = await db
    .select({ createdAt: phoneVerificationCodes.createdAt })
    .from(phoneVerificationCodes)
    .where(eq(phoneVerificationCodes.userId, userId))
    .limit(1);

  if (existing) {
    const since = now.getTime() - existing.createdAt.getTime();
    if (since < RESEND_COOLDOWN_MS) {
      /*
        A cooldown, not a rate-limit tier. Each send costs real money and
        lands on somebody's handset, so "resend" being free is a way to
        bill us to harass a stranger.
      */
      return { ok: false, reason: 'cooldown', retryAfterMs: RESEND_COOLDOWN_MS - since };
    }
  }

  const code = generateCode();

  /*
    Delete-then-insert rather than upsert: the previous code must stop
    working the instant a new one is minted, including its attempt count.
    One live code per user is what keeps the guess budget at five.
  */
  await db.delete(phoneVerificationCodes).where(eq(phoneVerificationCodes.userId, userId));
  await db.insert(phoneVerificationCodes).values({
    userId,
    phoneE164: phone.e164,
    codeHash: hashCode(userId, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    createdAt: now,
  });

  let sent: SmsSendResult;
  try {
    sent = await sendSms(phone.e164, `${code} is your LastDonor verification code. It expires in 10 minutes.`);
  } catch (error) {
    // Transport, or no credentials. The row is left in place: the person
    // has no code, and the cooldown stops a retry loop from billing us.
    return {
      ok: false,
      reason: 'send_failed',
      detail: error instanceof Error ? error.name : 'unknown',
    };
  }

  if (!sent.ok) {
    /*
      The provider refused this recipient. Drop the row - leaving it would
      hold the cooldown against a person who never received anything.
    */
    await db.delete(phoneVerificationCodes).where(eq(phoneVerificationCodes.userId, userId));
    return { ok: false, reason: 'send_failed', detail: sent.reason };
  }

  return {
    ok: true,
    phoneE164: phone.e164,
    // Surfaced, never hidden: in sandbox the message reached a simulator
    // and the person is holding a phone that did not ring.
    sandbox: process.env.AT_USERNAME === 'sandbox',
  };
}

export type VerifyCodeResult =
  | { ok: true; phoneE164: string }
  | {
      ok: false;
      reason: 'no_code' | 'expired' | 'too_many_attempts' | 'wrong_code';
      attemptsLeft?: number;
    };

/**
 * Check a code and, on success, record the number as verified.
 *
 * Consent is NOT granted here. Proving a number reaches you is not
 * agreeing to be messaged on it.
 */
export async function verifyPhoneCode(
  userId: string,
  submitted: string,
  now: Date = new Date(),
): Promise<VerifyCodeResult> {
  const [row] = await db
    .select()
    .from(phoneVerificationCodes)
    .where(eq(phoneVerificationCodes.userId, userId))
    .limit(1);

  if (!row || row.consumedAt) return { ok: false, reason: 'no_code' };

  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(phoneVerificationCodes).where(eq(phoneVerificationCodes.id, row.id));
    return { ok: false, reason: 'expired' };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await db.delete(phoneVerificationCodes).where(eq(phoneVerificationCodes.id, row.id));
    return { ok: false, reason: 'too_many_attempts' };
  }

  const cleaned = submitted.replace(/\D/g, '');

  if (!hashesMatch(hashCode(userId, cleaned), row.codeHash)) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      // Burned. A sixth guess has nothing to guess against.
      await db.delete(phoneVerificationCodes).where(eq(phoneVerificationCodes.id, row.id));
      return { ok: false, reason: 'too_many_attempts', attemptsLeft: 0 };
    }
    await db
      .update(phoneVerificationCodes)
      .set({ attempts })
      .where(eq(phoneVerificationCodes.id, row.id));
    return { ok: false, reason: 'wrong_code', attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  await db
    .update(users)
    .set({ phoneE164: row.phoneE164, phoneVerifiedAt: now })
    .where(eq(users.id, userId));

  await db.delete(phoneVerificationCodes).where(eq(phoneVerificationCodes.id, row.id));

  return { ok: true, phoneE164: row.phoneE164 };
}

/**
 * Record (or withdraw) agreement to receive SMS.
 *
 * A timestamp, not a boolean, for the reason `docs/41` gives about mail:
 * "did they agree" is never the question anyone actually asks — "when, and
 * is that still current" is.
 */
export async function recordSmsConsent(
  userId: string,
  granted: boolean,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(users)
    .set({ smsConsentAt: granted ? now : null })
    .where(eq(users.id, userId));
}

/** Remove codes nobody is going to use. Safe to call from a cron. */
export async function purgeExpiredCodes(now: Date = new Date()): Promise<void> {
  await db
    .delete(phoneVerificationCodes)
    .where(and(lt(phoneVerificationCodes.expiresAt, now)));
}
