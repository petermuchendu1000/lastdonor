/**
 * Audit P1-6 — permanent regression test for the public API surface.
 *
 * The audit proved the bug with a script that replayed the middleware's prefix
 * matcher over every route in the app. `docs/31` item 2.7 asks for that script
 * to become a test, so this is it: it walks `src/app/api/**` on disk, works out
 * which (pathname, method) pairs the middleware will serve WITHOUT a session,
 * and fails unless every one of them is in the inventory below.
 *
 * That makes the failure mode loud in both directions:
 *   - a new route that becomes publicly reachable fails this test, and
 *   - a route that silently stops being public fails it too.
 *
 * Adding an entry to INTENTIONALLY_PUBLIC is the moment to think, not a
 * formality. The default is deny.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

// `@/middleware` imports `@/lib/auth`, which imports `next-auth`; next-auth's
// own `next/server` import does not resolve under vitest. The public-route
// table under test does not touch any of it.
vi.mock('next-auth', () => {
  class CredentialsSignin extends Error {}
  return { default: () => ({ handlers: {}, auth: (fn: unknown) => fn, signIn: vi.fn(), signOut: vi.fn() }), CredentialsSignin };
});
vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: () => ({}) }));
vi.mock('@/db', () => ({ db: {} }));

const { PUBLIC_API_ROUTES, matchPublicApiRoute } = await import('@/middleware');

const API_ROOT = path.resolve(__dirname, 'app/api');
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/**
 * Every (method, pathname) pair that is allowed to be served without a
 * session, with the reason it is safe. Dynamic segments are rendered as
 * `[slug]` exactly as they appear on disk.
 */
const INTENTIONALLY_PUBLIC: Record<string, string> = {
  // Authentication itself cannot require authentication.
  'POST /api/auth/register': 'Sign-up.',
  // The NextAuth catch-all re-exports `handlers`, so the verb set is not
  // statically visible here; the whole handler is public by design.
  'GET /api/auth/[...nextauth]': 'NextAuth sign-in/callback/session/csrf handlers.',
  'HEAD /api/auth/[...nextauth]': 'NextAuth handlers.',
  'POST /api/auth/[...nextauth]': 'NextAuth sign-in/callback handlers.',
  'PUT /api/auth/[...nextauth]': 'NextAuth handlers.',
  'PATCH /api/auth/[...nextauth]': 'NextAuth handlers.',
  'DELETE /api/auth/[...nextauth]': 'NextAuth handlers.',
  'OPTIONS /api/auth/[...nextauth]': 'NextAuth handlers.',
  'POST /api/v1/auth/forgot-password': 'Used by someone who cannot sign in.',
  'POST /api/v1/auth/reset-password': 'Token-gated password reset.',

  /*
    No shared secret, by design (docs/81): this route reads only a session
    id from the body and then asks Didit what the decision is over an
    authenticated call of our own, so a forged request cannot assert an
    outcome - the worst it achieves is making us re-read a decision we are
    entitled to read.
  */
  'POST /api/v1/verification/didit/webhook': 'Didit verification webhook; the body is a hint, the decision is re-fetched.',

  // Public reads.
  'GET /api/v1/campaigns': 'Public campaign listing.',
  'HEAD /api/v1/campaigns': 'Public campaign listing.',
  'GET /api/v1/campaigns/[slug]': 'Public campaign detail.',
  'HEAD /api/v1/campaigns/[slug]': 'Public campaign detail.',
  'GET /api/v1/campaigns/[slug]/messages': 'Public wall of support.',
  'HEAD /api/v1/campaigns/[slug]/messages': 'Public wall of support.',
  'GET /api/v1/campaigns/[slug]/donors': 'Public donor list.',
  'HEAD /api/v1/campaigns/[slug]/donors': 'Public donor list.',
  'GET /api/v1/blog': 'Public blog index.',
  'HEAD /api/v1/blog': 'Public blog index.',
  'GET /api/v1/blog/[slug]': 'Public blog post.',
  'HEAD /api/v1/blog/[slug]': 'Public blog post.',
  'GET /api/v1/search': 'Public campaign search.',
  'HEAD /api/v1/search': 'Public campaign search.',
  'GET /api/v1/stats': 'Public aggregate statistics.',
  'HEAD /api/v1/stats': 'Public aggregate statistics.',
  'GET /api/v1/health': 'Deep readiness/diagnostic probe.',
  'HEAD /api/v1/health': 'Deep readiness/diagnostic probe.',
  // Fly liveness probe (remediation P1-13). A restart probe cannot carry a
  // credential; the handler reads no database, Redis or Stripe and returns
  // only process-local facts. Deliberately public, and anchored so nothing
  // under /api/v1/live inherits it.
  'GET /api/v1/live': 'Fly liveness probe; process-local facts only.',
  'HEAD /api/v1/live': 'Fly liveness probe; process-local facts only.',
  'GET /api/v1/og/page': 'Share-card image, fetched by social crawlers.',
  'HEAD /api/v1/og/page': 'Share-card image, fetched by social crawlers.',
  'GET /api/v1/og/campaign/[slug]': 'Share-card image, fetched by social crawlers.',
  'HEAD /api/v1/og/campaign/[slug]': 'Share-card image, fetched by social crawlers.',

  // Own-state read: answers `subscribed: false` with no session.
  'GET /api/v1/campaigns/[slug]/subscribe': 'Reports the caller\'s own subscription state only.',
  'HEAD /api/v1/campaigns/[slug]/subscribe': 'Reports the caller\'s own subscription state only.',

  // Consent withdrawal must work from an email link with no login
  // (CAN-SPAM, GDPR Art. 7(3)). Authorised in-route by a signed token.
  'DELETE /api/v1/campaigns/[slug]/subscribe': 'Signed-token or session-owned unsubscribe.',
  'GET /api/v1/newsletter/unsubscribe': 'Signed-token unsubscribe link from an email.',
  'HEAD /api/v1/newsletter/unsubscribe': 'Signed-token unsubscribe link from an email.',
  'POST /api/v1/newsletter/unsubscribe': 'RFC 8058 one-click unsubscribe; signed token.',
  'POST /api/v1/newsletter/subscribe': 'Public newsletter opt-in form.',

  // Payments: authenticated by provider signature or inherently guest-facing.
  'POST /api/v1/donations/webhook': 'Stripe signature verification.',
  'POST /api/v1/stripe-connect/webhook': 'Stripe signature verification.',
  'POST /api/v1/donations/create-checkout': 'Guest donation is a product requirement.',
  'POST /api/v1/donations/confirm': 'Return leg of the guest donation flow.',
  'POST /api/v1/donations/payhero/initiate': 'Guest M-Pesa donation; per-number abuse guard.',
  'POST /api/v1/donations/payhero/callback': 'No shared secret by design; outcome re-fetched. docs/92.',
  'GET /api/v1/donations/payhero/status': 'Guest polls their own payment while the prompt is live.',
  'HEAD /api/v1/donations/payhero/status': 'Guest polls their own payment while the prompt is live.',

  // Scheduler cannot hold a session; every handler calls verifyCronAuth.
  'GET /api/v1/cron/refresh-fx-rates': 'verifyCronAuth.',
  'HEAD /api/v1/cron/refresh-fx-rates': 'verifyCronAuth.',
  'GET /api/v1/cron/verification-reminders': 'verifyCronAuth.',
  'HEAD /api/v1/cron/verification-reminders': 'verifyCronAuth.',
  'GET /api/v1/cron/screen-documents': 'verifyCronAuth.',
  'HEAD /api/v1/cron/screen-documents': 'verifyCronAuth.',
  'GET /api/v1/cron/blog-generate': 'verifyCronAuth.',
  'HEAD /api/v1/cron/blog-generate': 'verifyCronAuth.',
  'GET /api/v1/cron/blog-refresh': 'verifyCronAuth.',
  'HEAD /api/v1/cron/blog-refresh': 'verifyCronAuth.',
  'GET /api/v1/cron/blog-topics': 'verifyCronAuth.',
  'HEAD /api/v1/cron/blog-topics': 'verifyCronAuth.',
  'GET /api/v1/cron/fetch-news': 'verifyCronAuth.',
  'HEAD /api/v1/cron/fetch-news': 'verifyCronAuth.',
  'GET /api/v1/cron/ingest-news': 'verifyCronAuth.',
  'HEAD /api/v1/cron/ingest-news': 'verifyCronAuth.',
  'GET /api/v1/cron/publish-campaigns': 'verifyCronAuth.',
  'HEAD /api/v1/cron/publish-campaigns': 'verifyCronAuth.',
  'GET /api/v1/cron/reconcile': 'verifyCronAuth.',
  'HEAD /api/v1/cron/reconcile': 'verifyCronAuth.',
  'GET /api/v1/cron/send-newsletter': 'verifyCronAuth.',
  'HEAD /api/v1/cron/send-newsletter': 'verifyCronAuth.',
  'GET /api/v1/cron/simulate-donations': 'verifyCronAuth.',
  'HEAD /api/v1/cron/simulate-donations': 'verifyCronAuth.',
  'GET /api/v1/cron/update-phases': 'verifyCronAuth.',
  'HEAD /api/v1/cron/update-phases': 'verifyCronAuth.',
};

interface DiscoveredRoute {
  /** Pathname with dynamic segments left as `[slug]` / `[...all]`. */
  readonly template: string;
  /** Pathname with dynamic segments filled in, for matching. */
  readonly concrete: string;
  readonly methods: readonly string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'route.ts' || entry === 'route.tsx') out.push(full);
  }
  return out;
}

function exportedMethods(source: string): string[] {
  return HTTP_METHODS.filter((method) =>
    new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b`).test(source),
  );
}

function discoverRoutes(): DiscoveredRoute[] {
  return walk(API_ROOT)
    .map((file) => {
      const template = path.posix.join(
        '/api',
        path
          .relative(API_ROOT, file)
          .replace(/\\/g, '/')
          .replace(/\/route\.tsx?$/, ''),
      );
      const concrete = template
        .split('/')
        .map((segment) =>
          /^\[\.\.\..+\]$/.test(segment) ? 'catchall' : /^\[.+\]$/.test(segment) ? 'sample' : segment,
        )
        .join('/');
      return { template, concrete, methods: exportedMethods(readFileSync(file, 'utf8')) };
    })
    .sort((a, b) => a.template.localeCompare(b.template));
}

/**
 * The method set to probe for a route. A route that exports `GET` also serves
 * `HEAD` (Next.js derives it), and the catch-all NextAuth handler serves
 * whatever its provider flow needs, so probe the full verb list there.
 */
function methodsToProbe(route: DiscoveredRoute): readonly string[] {
  if (route.methods.length === 0) return HTTP_METHODS;
  const methods = new Set(route.methods);
  if (methods.has('GET')) methods.add('HEAD');
  return [...methods];
}

describe('middleware public API surface (audit P1-6)', () => {
  const routes = discoverRoutes();

  it('finds the API routes on disk', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('serves nothing unauthenticated that is not in the intentionally-public inventory', () => {
    const unexpected: string[] = [];

    for (const route of routes) {
      for (const method of methodsToProbe(route)) {
        if (!matchPublicApiRoute(route.concrete, method)) continue;
        const key = `${method} ${route.template}`;
        if (!(key in INTENTIONALLY_PUBLIC)) unexpected.push(key);
      }
    }

    expect(unexpected.sort()).toEqual([]);
  });

  it('still serves every route the inventory says is public', () => {
    const missing: string[] = [];

    for (const key of Object.keys(INTENTIONALLY_PUBLIC)) {
      const [method, template] = key.split(' ');
      const route = routes.find((r) => r.template === template);
      expect(route, `inventory names a route that does not exist: ${template}`).toBeTruthy();
      const concrete = route!.concrete;
      if (!matchPublicApiRoute(concrete, method)) missing.push(key);
    }

    expect(missing.sort()).toEqual([]);
  });

  it('every public-route entry is anchored, so a prefix cannot drag sub-routes public', () => {
    for (const route of PUBLIC_API_ROUTES) {
      expect(route.pattern.source.startsWith('^'), String(route.pattern)).toBe(true);
      expect(route.pattern.source.endsWith('$'), String(route.pattern)).toBe(true);
      expect(route.reason.length).toBeGreaterThan(10);
    }
  });

  // ── The two specific writes the audit found (P1-6) ──────────────────────
  it('does not expose the third-party campaign subscribe write', () => {
    expect(matchPublicApiRoute('/api/v1/campaigns/some-campaign/subscribe', 'POST')).toBeNull();
  });

  it('keeps the campaign listing public while the subscribe write is not', () => {
    expect(matchPublicApiRoute('/api/v1/campaigns', 'GET')).not.toBeNull();
    expect(matchPublicApiRoute('/api/v1/campaigns', 'POST')).toBeNull();
  });

  it('does not expose any other method on a public sub-route by accident', () => {
    expect(matchPublicApiRoute('/api/v1/campaigns/x', 'PUT')).toBeNull();
    expect(matchPublicApiRoute('/api/v1/campaigns/x', 'DELETE')).toBeNull();
    expect(matchPublicApiRoute('/api/v1/campaigns/x/messages', 'POST')).toBeNull();
    expect(matchPublicApiRoute('/api/v1/campaign-photos', 'POST')).toBeNull();
  });

  it('keeps the unauthenticated unsubscribe paths reachable (CAN-SPAM / GDPR)', () => {
    expect(matchPublicApiRoute('/api/v1/newsletter/unsubscribe', 'GET')).not.toBeNull();
    expect(matchPublicApiRoute('/api/v1/newsletter/unsubscribe', 'POST')).not.toBeNull();
    expect(matchPublicApiRoute('/api/v1/campaigns/x/subscribe', 'DELETE')).not.toBeNull();
  });

  /**
   * Remediation P1-13: Fly restarts a machine whose liveness probe fails, and
   * a probe cannot carry a credential. A 401 here kills the whole fleet, so
   * this is asserted separately from the inventory sweep (which can only catch
   * a route that becomes public, not one that stops being public).
   */
  it('keeps the Fly liveness probe reachable unauthenticated', () => {
    expect(matchPublicApiRoute('/api/v1/live', 'GET')).not.toBeNull();
    expect(matchPublicApiRoute('/api/v1/live', 'HEAD')).not.toBeNull();
    // Reserved for the probe: nothing below it inherits the exemption.
    expect(matchPublicApiRoute('/api/v1/live/anything', 'GET')).toBeNull();
    expect(matchPublicApiRoute('/api/v1/live', 'POST')).toBeNull();
  });

  it('keeps cron routes reachable by the scheduler (verifyCronAuth is their gate)', () => {
    expect(matchPublicApiRoute('/api/v1/cron/reconcile', 'GET')).not.toBeNull();
    // ...but nothing deeper, and no writes.
    expect(matchPublicApiRoute('/api/v1/cron/reconcile/anything', 'GET')).toBeNull();
    expect(matchPublicApiRoute('/api/v1/cron/reconcile', 'POST')).toBeNull();
  });

  it('leaves the admin surface entirely protected', () => {
    for (const route of routes.filter((r) => r.template.startsWith('/api/v1/admin'))) {
      for (const method of HTTP_METHODS) {
        expect(
          matchPublicApiRoute(route.concrete, method),
          `${method} ${route.template} must not be public`,
        ).toBeNull();
      }
    }
  });
});
