import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { stripe } from '@/lib/stripe';
import { pingRedis } from '@/lib/locks';

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
