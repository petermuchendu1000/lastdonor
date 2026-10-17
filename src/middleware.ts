import { auth } from '@/lib/auth';
import { checkRateLimitAsync } from '@/lib/rate-limit';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Default-deny: ALL matched routes require auth unless explicitly listed
 * in PUBLIC_API_ROUTES. This inverts the opt-in model so new routes are
 * protected by default.
 *
 * ## Why this is a table of anchored patterns and not a prefix list (audit P1-6)
 *
 * The previous implementation matched with `pathname.startsWith(prefix)`, which
 * silently made every *descendant* of a public prefix public too. The
 * `'/api/v1/campaigns'` entry therefore also exposed
 * `POST`/`DELETE /api/v1/campaigns/<slug>/subscribe` — two writes that act on
 * whatever email is in the request body, so anyone could subscribe or
 * unsubscribe a third party. Prefix matching cannot express "the collection is
 * public but this one sub-route is not", and it is method-blind, so it could
 * not express "GET is public, POST is not" either.
 *
 * Each entry below therefore:
 *   - matches the WHOLE pathname (anchored `^...$`), never a prefix, and
 *   - names the exact HTTP methods that are public, and
 *   - records WHY it is safe to reach without a session.
 *
 * Adding a route here is a security decision. `src/middleware.public-routes.test.ts`
 * enumerates every `route.ts` under `src/app/api` against this table and fails
 * if a route/method pair becomes public without being listed in that test's
 * intentionally-public inventory.
 */

const GET_ONLY = ['GET', 'HEAD'] as const;
/** NextAuth's own catch-all handler serves many verbs on many sub-paths. */
const ANY_METHOD = ['*'] as const;

export interface PublicApiRoute {
  /** Anchored matcher for the full pathname. */
  readonly pattern: RegExp;
  /** Methods that may be served without a session. `'*'` means every method. */
  readonly methods: readonly string[];
  /** Why this is safe unauthenticated. Reviewed on every change. */
  readonly reason: string;
}

export const PUBLIC_API_ROUTES: readonly PublicApiRoute[] = [
  {
    pattern: /^\/api\/auth(?:\/.*)?$/,
    methods: ANY_METHOD,
    reason: 'NextAuth handlers (sign-in, callback, csrf, session) plus /api/auth/register. Sign-up and sign-in must be reachable without a session.',
  },
  {
    pattern: /^\/api\/v1\/auth\/(?:forgot-password|reset-password)$/,
    methods: ['POST'],
    reason: 'Password recovery: by definition used by someone who cannot sign in. Both routes are token-gated and enumeration-safe internally.',
  },

  // ─── Campaigns: public reads only ────────────────────────────────────────
  {
    pattern: /^\/api\/v1\/campaigns$/,
    methods: GET_ONLY,
    reason: 'Public campaign listing. POST (create) requires editor/admin and is NOT public.',
  },
  {
    pattern: /^\/api\/v1\/campaigns\/[^/]+$/,
    methods: GET_ONLY,
    reason: 'Public campaign detail page data. PUT/DELETE are NOT public.',
  },
  {
    pattern: /^\/api\/v1\/campaigns\/[^/]+\/messages$/,
    methods: GET_ONLY,
    reason: 'Public wall of support. POST (leave a message) requires a session and is NOT public.',
  },
  {
    pattern: /^\/api\/v1\/campaigns\/[^/]+\/donors$/,
    methods: GET_ONLY,
    reason: 'Public donor list (already filtered to non-anonymous donors by the route).',
  },
  {
    pattern: /^\/api\/v1\/campaigns\/[^/]+\/subscribe$/,
    methods: ['GET', 'HEAD', 'DELETE'],
    reason:
      'GET reports the caller\'s own subscription state (returns `subscribed:false` with no session). ' +
      'DELETE must stay reachable without a session because unsubscribe links are clicked from email ' +
      'clients (CAN-SPAM / GDPR); the route itself requires an HMAC-signed token bound to ' +
      '(email, campaignId) or a session owning that email. POST (subscribe) is NOT public: ' +
      'adding an address to a mailing list on an anonymous caller\'s word is the P1-6 defect.',
  },

  // ─── Blog: public reads only ─────────────────────────────────────────────
  {
    pattern: /^\/api\/v1\/blog$/,
    methods: GET_ONLY,
    reason: 'Public blog index.',
  },
  {
    pattern: /^\/api\/v1\/blog\/[^/]+$/,
    methods: GET_ONLY,
    reason: 'Public blog post.',
  },

  // ─── Newsletter ──────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/v1\/newsletter\/subscribe$/,
    methods: ['POST'],
    reason: 'Public newsletter opt-in form. Double opt-in / confirmation is handled by the route.',
  },
  {
    pattern: /^\/api\/v1\/newsletter\/unsubscribe$/,
    methods: ['GET', 'HEAD', 'POST'],
    reason:
      'Unsubscribe-by-email-link, including RFC 8058 one-click (List-Unsubscribe-Post). Must work ' +
      'without a session. The route requires an HMAC-signed token identifying the subscriber, or a ' +
      'session owning the address.',
  },

  // ─── Payments ────────────────────────────────────────────────────────────
  {
    pattern: /^\/api\/v1\/verification\/didit\/webhook$/,
    methods: ['POST'],
    reason:
      'Didit verification webhook. Deliberately has no shared secret: the route reads only a session id from the body and then asks Didit what the decision is over an authenticated call of our own, so a forged request cannot assert an outcome. See docs/81.',
  },
  {
    pattern: /^\/api\/v1\/donations\/webhook$/,
    methods: ['POST'],
    reason: 'Stripe webhook; authenticated by Stripe signature verification, not by session.',
  },
  {
    pattern: /^\/api\/v1\/stripe-connect\/webhook$/,
    methods: ['POST'],
    reason: 'Stripe Connect webhook; authenticated by Stripe signature verification.',
  },
  {
    pattern: /^\/api\/v1\/donations\/create-checkout$/,
    methods: ['POST'],
    reason: 'Guest donation is a core product requirement; donors are not required to hold an account.',
  },
  {
    pattern: /^\/api\/v1\/donations\/confirm$/,
    methods: ['POST'],
    reason: 'Return leg of the guest donation flow; keyed by the Stripe session/intent id.',
  },

  // ─── Operational / read-only ─────────────────────────────────────────────
  {
    // Fly's liveness probe. A restart probe cannot carry a credential, and the
    // handler reads nothing: no database, no Redis, no Stripe, no outbound
    // call. It returns only process-local facts (status, pid, uptime,
    // timestamp), so there is nothing here to protect.
    //
    // The pattern is anchored, so this entry covers exactly `/api/v1/live` and
    // nothing beneath it. That path is reserved for the probe: anything added
    // under it is protected by default and will fail
    // `middleware.public-routes.test.ts` until it is listed deliberately.
    pattern: /^\/api\/v1\/live$/,
    methods: GET_ONLY,
    reason:
      'Fly liveness probe (remediation P1-13). Must answer unauthenticated or every machine is ' +
      'killed as unhealthy. Process-local facts only; no dependency is read.',
  },
  {
    pattern: /^\/api\/v1\/health$/,
    methods: GET_ONLY,
    reason: 'Deep readiness/diagnostic probe; must answer before any session exists.',
  },
  {
    pattern: /^\/api\/v1\/stats$/,
    methods: GET_ONLY,
    reason: 'Aggregate public platform statistics shown on the marketing site.',
  },
  {
    pattern: /^\/api\/v1\/search$/,
    methods: GET_ONLY,
    reason: 'Public campaign search.',
  },
  {
    pattern: /^\/api\/v1\/og\/page$/,
    methods: GET_ONLY,
    reason: 'Open Graph image generation for share cards; fetched by social crawlers that hold no session.',
  },
  {
    pattern: /^\/api\/v1\/og\/campaign\/[^/]+$/,
    methods: GET_ONLY,
    reason: 'Open Graph image generation for campaign share cards; fetched by social crawlers that hold no session.',
  },
  {
    pattern: /^\/api\/v1\/cron\/[^/]+$/,
    methods: GET_ONLY,
    reason:
      'Invoked by the platform scheduler, which cannot hold a session. Every handler authenticates ' +
      'with `verifyCronAuth` (timing-safe Bearer compare) as its first statement.',
  },
];

/**
 * Returns the matching public-route entry, or `null` when the request must be
 * authenticated. Exported for the enumeration regression test.
 */
export function matchPublicApiRoute(pathname: string, method: string): PublicApiRoute | null {
  const upper = method.toUpperCase();
  for (const route of PUBLIC_API_ROUTES) {
    if (!route.pattern.test(pathname)) continue;
    if (route.methods.includes('*') || route.methods.includes(upper)) return route;
  }
  return null;
}

export default auth(async function middleware(request) {
  // Rate limiting for API routes (distributed via Upstash, in-memory fallback)
  const rateLimitResponse = await checkRateLimitAsync(request as unknown as NextRequest);
  if (rateLimitResponse) return rateLimitResponse;

  const { pathname } = request.nextUrl;

  // Public API routes: skip auth (they handle their own auth if needed)
  if (pathname.startsWith('/api/') && matchPublicApiRoute(pathname, request.method)) {
    return NextResponse.next();
  }

  // Auth check - auth() wraps and populates request.auth
  const session = request.auth;
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }
    // Keep the query string: `pathname` alone turns
    // /dashboard/campaigns?status=active&page=3 into /dashboard/campaigns and
    // drops whatever the user was actually looking at.
    const callbackTarget = `${pathname}${request.nextUrl.search}`;
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(callbackTarget)}`, request.url),
    );
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Protected page routes
    '/dashboard/:path*',
    '/notifications/:path*',
    '/profile/:path*',
    '/settings/:path*',
    '/admin/:path*',
    // Default-deny: ALL API routes go through middleware
    '/api/:path*',
  ],
};
