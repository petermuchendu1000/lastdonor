/**
 * Who is allowed to make someone's phone ring.
 *
 * `POST /api/v1/donations/payhero/initiate` has to be callable by a guest —
 * guest donation is a core product requirement and the Stripe checkout route
 * is public for the same reason (`src/middleware.ts`). But unlike a Stripe
 * checkout, this endpoint causes **a PIN prompt to appear on a phone number
 * supplied in the request body.** That is a different kind of surface, and
 * the obvious abuse is not fraud against us:
 *
 *   An attacker posts a stranger's number repeatedly. The stranger's handset
 *   fills with M-Pesa prompts they did not ask for. After 10 of them go
 *   unanswered, PayHero's own abuse protection blocks that number from
 *   receiving STK pushes **for 24 hours** — so the attacker has also denied a
 *   real person the ability to pay for anything through any merchant on this
 *   provider. And at 50 unanswered pushes in 6 hours, PayHero restricts OUR
 *   whole account, taking the platform's only working payment rail down with
 *   it.
 *
 * An IP rate limit does not address this. The protected party is the phone
 * number, and a distributed caller changes IP freely while the victim's
 * number stays the same. `docs/85` reached the same conclusion about
 * six-digit codes: "an IP rate limit does NOT protect a six-digit code", and
 * put the attempt counter on the row. The same reasoning applies here, so the
 * counter is per number and lives in the database rather than in Redis —
 * Upstash is best-effort in this codebase and a limit that evaporates is not
 * a limit on something that ends in a 24-hour block for a bystander.
 *
 * Three rules, all per phone number:
 *
 *  1. **One live prompt at a time.** While a push to that number is still
 *     `pending` and younger than `PROMPT_LIFETIME_MS`, a second is refused.
 *     A donor who taps twice gets their existing prompt, not two.
 *  2. **A short cooldown after a resolved attempt**, so a retry loop cannot
 *     spin.
 *  3. **A ceiling per number per hour**, well under PayHero's 10, so the
 *     platform can never be the thing that gets a bystander blocked.
 *
 * The ceiling is deliberately below PayHero's own threshold rather than at
 * it: ours is a guard, theirs is a punishment, and we should never be the
 * reason it fires.
 */

import { and, count, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { payheroPaymentRequests } from '@/db/schema';

/**
 * How long an M-Pesa prompt can plausibly still be answered.
 *
 * **Not measured yet.** Published figures for the STK prompt timeout
 * disagree: 30 seconds, 60, "about 90", and "1 to 3 minutes depending on the
 * handset" all appear in current integration guides, and none is from
 * Safaricom's own documentation. So this is set generously at three minutes —
 * the long end of the range — because the cost of being too long is a donor
 * waiting a little before they may retry, while the cost of being too short
 * is two prompts on one handset and a step towards getting that number
 * blocked.
 *
 * It is written as an assumption on purpose. The real figure comes from the
 * live test recorded in `docs/92`, and this constant is where it goes.
 */
export const PROMPT_LIFETIME_MS = 3 * 60_000;

/** Cooldown after an attempt that already resolved. */
export const RETRY_COOLDOWN_MS = 20_000;

/**
 * Pushes allowed to one number per hour.
 *
 * PayHero blocks a number after 10 successive failed or cancelled requests.
 * Five leaves room for a donor to genuinely fumble a PIN a few times without
 * this platform ever being what triggers their 24-hour block.
 */
export const MAX_PUSHES_PER_NUMBER_PER_HOUR = 5;

export type AbuseVerdict =
  | { allowed: true }
  | {
      allowed: false;
      /** Which rule refused, for logging and metrics. */
      rule: 'prompt_in_flight' | 'cooldown' | 'hourly_cap';
      /** Written for the person holding the phone, not for a developer. */
      message: string;
      /** Seconds until the same request could succeed, when knowable. */
      retryAfterSeconds: number;
    };

/**
 * Decide whether we may send an STK push to this number right now.
 *
 * Two queries, run sequentially. Kept to two deliberately: the pool is
 * `max: 5` and no request may issue more than three concurrent queries
 * (`src/db/pool-fanout.ratchet.test.ts`), and the initiate route has its own
 * campaign lookup and insert to pay for.
 */
export async function checkPhoneAbuseGuard(phoneE164: string): Promise<AbuseVerdict> {
  const now = Date.now();

  // 1 + 2. The most recent attempt for this number decides both the
  // in-flight rule and the cooldown, so one row answers both.
  const [latest] = await db
    .select({
      status: payheroPaymentRequests.status,
      createdAt: payheroPaymentRequests.createdAt,
    })
    .from(payheroPaymentRequests)
    .where(eq(payheroPaymentRequests.phoneE164, phoneE164))
    .orderBy(desc(payheroPaymentRequests.createdAt))
    .limit(1);

  if (latest) {
    const ageMs = now - new Date(latest.createdAt).getTime();

    if (latest.status === 'pending' && ageMs < PROMPT_LIFETIME_MS) {
      return {
        allowed: false,
        rule: 'prompt_in_flight',
        message:
          'There is already an M-Pesa request waiting on this number. Check your phone for ' +
          'the PIN prompt, or wait a moment and try again.',
        retryAfterSeconds: Math.ceil((PROMPT_LIFETIME_MS - ageMs) / 1000),
      };
    }

    if (latest.status !== 'pending' && ageMs < RETRY_COOLDOWN_MS) {
      return {
        allowed: false,
        rule: 'cooldown',
        message: 'Please wait a few seconds before trying again.',
        retryAfterSeconds: Math.ceil((RETRY_COOLDOWN_MS - ageMs) / 1000),
      };
    }
  }

  // 3. The hourly ceiling, which is what actually protects a bystander.
  const [recent] = await db
    .select({ n: count() })
    .from(payheroPaymentRequests)
    .where(
      and(
        eq(payheroPaymentRequests.phoneE164, phoneE164),
        gte(payheroPaymentRequests.createdAt, new Date(now - 60 * 60_000)),
      ),
    );

  if ((recent?.n ?? 0) >= MAX_PUSHES_PER_NUMBER_PER_HOUR) {
    return {
      allowed: false,
      rule: 'hourly_cap',
      message:
        'This number has had several payment requests in the last hour. Please try again ' +
        'later, or email support@lastdonor.org if you did not make them.',
      /*
        No precise answer without a second query for the oldest request in the
        window, and the exact number matters less than it sounds: this is the
        rule that fires when something is wrong, and a caller being told "an
        hour" is correct enough.
      */
      retryAfterSeconds: 3600,
    };
  }

  return { allowed: true };
}
