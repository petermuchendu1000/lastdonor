import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * ⚑ THIS IS THE FLY HEALTH CHECK. Point `fly.toml`'s `[[http_service.checks]]`
 * (and any orchestrator restart probe) at `/api/v1/live` — never at
 * `/api/v1/health`.
 *
 * Shallow, process-only liveness: it answers exactly one question, "can this
 * Node process accept and serve an HTTP request", and it must never grow a
 * dependency. No database, no Stripe, no Redis, no outbound call, no `await`.
 *
 * Why this endpoint exists (remediation P1-13, `docs/29` / `docs/31` §2.14):
 * `docs/26` originally told the operator to point Fly's health check at
 * `/api/v1/health`, which calls `stripe.balance.retrieve()` and returns 503 if
 * *any* dependency check fails. Shared dependencies fail on every machine at
 * once, so a Stripe or Supabase blip would have failed the probe fleet-wide and
 * Fly would have killed every machine simultaneously — an outage caused
 * entirely by the monitoring. A liveness probe must only be able to fail for
 * reasons local to the one process it can actually restart to fix.
 *
 * Readiness and diagnostics live in `/api/v1/health` instead. Keep them split:
 * if a dependency check is ever added here, a third-party outage becomes a
 * self-inflicted fleet restart again.
 */
export function GET() {
  return NextResponse.json(
    {
      status: 'alive',
      // Process-local facts only - all available without touching anything.
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    },
    {
      status: 200,
      headers: {
        // Never let a CDN or proxy answer the probe from cache.
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}

/** Same probe for orchestrators that use HEAD. */
export function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
