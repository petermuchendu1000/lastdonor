/**
 * Who is allowed to make someone's phone ring.
 *
 * Both M-Pesa initiate routes — `payhero` and `palpluss` — have to be callable
 * by a guest: guest donation is a core product requirement and the Stripe
 * checkout route is public for the same reason (`src/middleware.ts`). But
 * unlike a Stripe checkout, these endpoints cause **a PIN prompt to appear on
 * a phone number supplied in the request body.** That is a different kind of
 * surface, and the obvious abuse is not fraud against us:
 *
 *   An attacker posts a stranger's number repeatedly. The stranger's handset
 *   fills with M-Pesa prompts they did not ask for. After 10 of them go
 *   unanswered, PayHero's own abuse protection blocks that number from
 *   receiving STK pushes **for 24 hours** — so the attacker has also denied a
 *   real person the ability to pay for anything through any merchant on this
 *   provider. And at 50 unanswered pushes in 6 hours, PayHero restricts OUR
 *   whole account, taking a payment rail down with it.
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
 * ── Why this counts BOTH rails, and why that is not optional ──────────────
 *
 * This module was `payhero-abuse-guard.ts` and read one table. The moment a
 * second M-Pesa rail exists (docs/180, docs/181), per-rail counting silently
 * **doubles** every ceiling here: five pushes through PayHero and five through
 * Palpluss is ten prompts on one handset, which is exactly the number that
 * gets its owner blocked. Nothing would have failed, and a control written to
 * protect a bystander would have halved in strength because of work in
 * another file — the shape `docs/83` and `docs/121` keep finding.
 *
 * The number does not care which rail rang it. So the rules are per NUMBER
 * across both tables, and the module is named after the thing it guards
 * rather than after whichever rail was built first.
 *
 * Three rules, all per phone number, all across both rails:
 *
 *  1. **One live prompt at a time.** While a push to that number is still
 *     `pending` and younger than `PROMPT_LIFETIME_MS`, a second is refused.
 *     A donor who taps twice gets their existing prompt, not two.
 *  2. **A cooldown after a resolved attempt**, so a retry loop cannot spin.
 *     ⚠️ PER RAIL, because the two providers throttle differently — see
 *     `cooldownMsFor`.
 *  3. **A ceiling per number per hour**, well under PayHero's 10, so the
 *     platform can never be the thing that gets a bystander blocked.
 *
 * The ceiling is deliberately below the provider's own threshold rather than
 * at it: ours is a guard, theirs is a punishment, and we should never be the
 * reason it fires.
 */

import { and, count, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { palplussPaymentRequests, payheroPaymentRequests } from '@/db/schema';
import { PROMPT_LIFETIME_MS } from './payhero-prompt';
import { MIN_PUSH_INTERVAL_MS } from './palpluss';

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
 * live test recorded in `docs/92`.
 *
 * ⛔ The value itself lives in `src/lib/payhero-prompt.ts`, which imports
 * nothing, because the donor's BROWSER needs it too and this module imports
 * `@/db` (`docs/159`; the boundary rule is `docs/139` §7). It is re-exported
 * here so existing server callers are unaffected. It is rail-independent: the
 * prompt is Safaricom's either way.
 */
export { PROMPT_LIFETIME_MS } from './payhero-prompt';

/** Which rail the push being considered would go out on. */
export type MpesaRail = 'payhero' | 'palpluss';

/** Cooldown after an attempt that already resolved, on PayHero. */
export const RETRY_COOLDOWN_MS = 20_000;

/**
 * Pushes allowed to one number per hour, ACROSS BOTH RAILS.
 *
 * PayHero blocks a number after 10 successive failed or cancelled requests.
 * Five leaves room for a donor to genuinely fumble a PIN a few times without
 * this platform ever being what triggers their 24-hour block.
 *
 * ⚠️ It used to be five per rail-table, which is five *more* than the rule
 * intends the moment two tables exist. Counting both is a tightening, and it
 * is the number this constant always claimed to be.
 */
export const MAX_PUSHES_PER_NUMBER_PER_HOUR = 5;

/**
 * The shortest gap this platform will allow between two pushes to one number,
 * for the rail the next one would use.
 *
 * ⛔ DERIVED per rail, never one shared number. Palpluss throttles at **2
 * pushes per phone per minute** and reports it as `result_code: "17"`
 * ("Rule limited.") rather than an HTTP error — so PayHero's 20s cooldown,
 * which permits three a minute, would let a donor's third tap be silently
 * swallowed by Palpluss while this platform believed it had sent a prompt.
 * `MIN_PUSH_INTERVAL_MS` is derived from the measured throttle in
 * `palpluss.ts`; `RETRY_COOLDOWN_MS` is PayHero's.
 */
export function cooldownMsFor(rail: MpesaRail): number {
  return rail === 'palpluss' ? MIN_PUSH_INTERVAL_MS : RETRY_COOLDOWN_MS;
}

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

/** The most recent attempt on one rail, or null. */
interface Attempt {
  readonly pending: boolean;
  readonly createdAt: Date;
}

/**
 * The newer of two attempts.
 *
 * Pure, and exported so a test can drive it: picking the wrong one of two
 * rows is a silent weakening (the older row is likelier to have aged past
 * both windows), and the branch is not otherwise reachable without two rails
 * holding rows for the same number.
 */
export function newerAttempt(a: Attempt | null, b: Attempt | null): Attempt | null {
  if (!a) return b;
  if (!b) return a;
  return a.createdAt.getTime() >= b.createdAt.getTime() ? a : b;
}

/**
 * Decide whether we may send an STK push to this number right now.
 *
 * Four queries, run SEQUENTIALLY — two rails x two rules. Sequential on
 * purpose: the pool is `max: 5` and no request may issue more than three
 * CONCURRENT queries (`src/db/pool-fanout.ratchet.test.ts`), and the initiate
 * routes have their own campaign lookup and insert to pay for. Two extra
 * round trips are nothing beside the 20s HTTP call that follows.
 *
 * ⛔ Not collapsed into a `UNION ALL`, which would halve the round trips: the
 * two `status` columns are DIFFERENT Postgres enum types, so a union needs a
 * cast, and a cast means a `sql` template on a money path. `docs/101` (an
 * unqualified identifier that made a cap silently never fire) and `docs/107`
 * (a bare `Date` that 500'd every load of a page) are both exactly that, and
 * neither was visible to anything but a real database. Two typed queries and
 * a comparison in TypeScript cannot have either defect.
 *
 * @param rail Which rail the push would use. REQUIRED, with no default, so
 *        `tsc` names every call site rather than letting one silently inherit
 *        the other rail's cooldown (`docs/125`: a defaulted parameter is
 *        invisible at the call site).
 */
export async function checkPhoneAbuseGuard(
  phoneE164: string,
  rail: MpesaRail,
): Promise<AbuseVerdict> {
  const now = Date.now();

  // 1 + 2. The most recent attempt for this number decides both the
  // in-flight rule and the cooldown, so one row answers both — but it has to
  // be the most recent across BOTH rails.
  const [latestPayhero] = await db
    .select({
      status: payheroPaymentRequests.status,
      createdAt: payheroPaymentRequests.createdAt,
    })
    .from(payheroPaymentRequests)
    .where(eq(payheroPaymentRequests.phoneE164, phoneE164))
    .orderBy(desc(payheroPaymentRequests.createdAt))
    .limit(1);

  const [latestPalpluss] = await db
    .select({
      status: palplussPaymentRequests.status,
      createdAt: palplussPaymentRequests.createdAt,
    })
    .from(palplussPaymentRequests)
    .where(eq(palplussPaymentRequests.phoneE164, phoneE164))
    .orderBy(desc(palplussPaymentRequests.createdAt))
    .limit(1);

  const latest = newerAttempt(
    latestPayhero
      ? {
          pending: latestPayhero.status === 'pending',
          createdAt: new Date(latestPayhero.createdAt),
        }
      : null,
    latestPalpluss
      ? {
          pending: latestPalpluss.status === 'pending',
          createdAt: new Date(latestPalpluss.createdAt),
        }
      : null,
  );

  if (latest) {
    const ageMs = now - latest.createdAt.getTime();

    if (latest.pending && ageMs < PROMPT_LIFETIME_MS) {
      return {
        allowed: false,
        rule: 'prompt_in_flight',
        message:
          'There is already an M-Pesa request waiting on this number. Check your phone for ' +
          'the PIN prompt, or wait a moment and try again.',
        retryAfterSeconds: Math.ceil((PROMPT_LIFETIME_MS - ageMs) / 1000),
      };
    }

    const cooldownMs = cooldownMsFor(rail);
    if (!latest.pending && ageMs < cooldownMs) {
      return {
        allowed: false,
        rule: 'cooldown',
        message: 'Please wait a few seconds before trying again.',
        retryAfterSeconds: Math.ceil((cooldownMs - ageMs) / 1000),
      };
    }
  }

  // 3. The hourly ceiling, which is what actually protects a bystander.
  const since = new Date(now - 60 * 60_000);

  const [recentPayhero] = await db
    .select({ n: count() })
    .from(payheroPaymentRequests)
    .where(
      and(
        eq(payheroPaymentRequests.phoneE164, phoneE164),
        gte(payheroPaymentRequests.createdAt, since),
      ),
    );

  const [recentPalpluss] = await db
    .select({ n: count() })
    .from(palplussPaymentRequests)
    .where(
      and(
        eq(palplussPaymentRequests.phoneE164, phoneE164),
        gte(palplussPaymentRequests.createdAt, since),
      ),
    );

  const recent = (recentPayhero?.n ?? 0) + (recentPalpluss?.n ?? 0);

  if (recent >= MAX_PUSHES_PER_NUMBER_PER_HOUR) {
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
