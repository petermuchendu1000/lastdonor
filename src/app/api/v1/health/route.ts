import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { stripe } from '@/lib/stripe';
import { pingRedis } from '@/lib/locks';
import { getWalletBalance, isPayHeroConfigured } from '@/lib/payhero';
import { assessFloat } from '@/lib/payhero-float';

/*
  The fee, the threshold and the verdict all moved to
  `src/lib/payhero-float.ts` so that `cron/payhero-float` evaluates the SAME
  question - this route could detect a low float and could not tell anybody,
  and a second copy of the threshold in the cron would have been a threshold
  that drifts (`docs/146`, `docs/138`). The owner raised the line from 25
  collections (KES 222.50) to KES 500 on 2026-10-29.
*/

export const dynamic = 'force-dynamic';

/**
 * ⚠️ NOT A LIVENESS PROBE. Do **not** point Fly's health check, or any probe
 * that can restart or remove a machine, at this route. Use `/api/v1/live` for
 * that — it is shallow and process-only.
 *
 * This is the **deep readiness and diagnostic** endpoint, for humans and for an
 * external uptime monitor that pages someone rather than restarting anything.
 * It deliberately reaches out to every shared dependency (Postgres, Stripe,
 * Upstash Redis) and returns 503 when any of them is unreachable.
 *
 * That 503 is the whole reason it is unsafe as a liveness probe (P1-13,
 * `docs/29` / `docs/31` §2.14): the dependencies it checks are shared, so they
 * fail on every machine at the same instant, and a restart cannot fix any of
 * them. Pointed at Fly, one Stripe blip would have taken down the entire fleet.
 *
 * Redis is checked here because it was previously missing entirely while being
 * load-bearing for distributed rate limiting (`src/lib/rate-limit.ts`) and, as
 * of P1-11, for cron overlap locks (`src/lib/locks.ts`) — nine of the ten cron
 * jobs refuse to run when it is unreachable, so its absence is operationally
 * significant and must be visible here.
 */
export async function GET() {
  const timestamp = new Date().toISOString();
  const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; error?: string }> = {};

  // Database check
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (err) {
    console.error('[health] Database check failed:', err instanceof Error ? err.message : err);
    checks.database = {
      status: 'error',
      latencyMs: Date.now() - dbStart,
      error: 'Database connection failed',
    };
  }

  // Stripe check
  const stripeStart = Date.now();
  try {
    await stripe.balance.retrieve();
    checks.stripe = { status: 'ok', latencyMs: Date.now() - stripeStart };
  } catch (err) {
    console.error('[health] Stripe check failed:', err instanceof Error ? err.message : err);
    checks.stripe = {
      status: 'error',
      latencyMs: Date.now() - stripeStart,
      error: 'Payment service check failed',
    };
  }

  /*
    PayHero / FinoQ - the KES collection rail (docs/92).

    Checked here for the reason docs/72 gives: a dead Stripe key made every
    donation fail for three weeks while this endpoint correctly reported
    `degraded` and nobody read it. The second rail gets the same visibility
    from the start rather than after its own three weeks.

    Two distinct failures are reported, because they need different responses:
    absent credentials are a deploy mistake, and a rejected credential is an
    account problem.

    **The float matters as much as reachability.** Measured on the first real
    collection: PayHero debits the service wallet a flat KES 8.9 per
    collection and the donation itself settles to the bank channel, so the
    service wallet is a FEE FLOAT that collections drain. When it runs out,
    collections fail - not loudly, and not for a reason any donor could act
    on. So a low float is reported as an error here while it is still fixable.

    **No figures are returned.** This route is in `PUBLIC_API_ROUTES`, and the
    balance belongs to an account shared with BETWOIN LTD - publishing it
    would leak another company's operating float to anyone who curls this
    URL. Only a derived state crosses the boundary.
  */
  const payheroStart = Date.now();
  if (!isPayHeroConfigured()) {
    checks.payhero = {
      status: 'error',
      error:
        'PayHero not configured (PAYHERO_API_USERNAME/PASSWORD/CHANNEL_ID unset); ' +
        'M-Pesa donations cannot be collected',
    };
    console.error('[health] PayHero is not configured; the KES rail is down.');
  } else {
    try {
      const wallet = await getWalletBalance();
      const { collectionsRemaining, isLow } = assessFloat(wallet.availableBalance);

      checks.payhero =
        !isLow
          ? { status: 'ok', latencyMs: Date.now() - payheroStart }
          : {
              status: 'error',
              latencyMs: Date.now() - payheroStart,
              // A count, not a balance: enough to act on, nothing to leak.
              error:
                `PayHero fee float is low (roughly ${collectionsRemaining} more collections ` +
                'before M-Pesa donations start failing). Top up the service wallet.',
            };

      if (isLow) {
        console.error(
          `[health] PayHero fee float is low: ~${collectionsRemaining} collections remaining.`,
        );
      }
    } catch (err) {
      console.error('[health] PayHero check failed:', err instanceof Error ? err.message : err);
      checks.payhero = {
        status: 'error',
        latencyMs: Date.now() - payheroStart,
        error: 'M-Pesa collection service check failed',
      };
    }
  }

  // Redis (Upstash) check - backs distributed rate limiting and cron locks.
  const redisStart = Date.now();
  try {
    const result = await pingRedis();
    checks.redis = result.ok
      ? { status: 'ok', latencyMs: Date.now() - redisStart }
      : {
          status: 'error',
          latencyMs: Date.now() - redisStart,
          // Distinguish "never configured" from "configured but unreachable":
          // the first is a deploy mistake, the second an Upstash incident.
          error: result.configured
            ? 'Redis unreachable (rate limiting degraded to in-memory; cron locks unavailable)'
            : 'Redis not configured (UPSTASH_REDIS_REST_URL/TOKEN unset)',
        };
    if (!result.ok) {
      console.error('[health] Redis check failed:', result.error);
    }
  } catch (err) {
    console.error('[health] Redis check failed:', err instanceof Error ? err.message : err);
    checks.redis = {
      status: 'error',
      latencyMs: Date.now() - redisStart,
      error: 'Redis check failed',
    };
  }

  const allHealthy = Object.values(checks).every((c) => c.status === 'ok');

  return NextResponse.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp,
      checks,
      version: process.env.npm_package_version ?? '0.1.0',
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    },
    { status: allHealthy ? 200 : 503 },
  );
}
