import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { ApiError } from '@/types/api';
import { isCloudflareIp } from '@/lib/cloudflare-ips';

// ─── Client IP resolution (audit P1-5) ──────────────────────────────────────
/**
 * Deriving the client IP from the FIRST `X-Forwarded-For` entry is forgeable:
 * XFF is append-only, so the left-most entry is whatever the *client* sent.
 * On Vercel today the value happens to be normalised, but `docs/26` moves the
 * app behind Cloudflare -> Fly, where the client's own XFF survives as a prefix
 * and every rate limit becomes bypassable by rotating that prefix.
 *
 * The only trustworthy entries are the ones appended by proxies we operate.
 * Each such proxy appends the address of the peer it received the request from,
 * so with `hops` proxies in front of us the real client sits at
 * `entries.length - hops` (the right-most hop, minus our own infrastructure).
 *
 * Configuration is explicit, because the correct answer is a property of the
 * deployment topology and cannot be detected at runtime:
 *
 *   CLIENT_IP_SOURCE   'xff' (default) | 'cf' | 'header:<name>'
 *   TRUSTED_PROXY_HOPS integer >= 1, default 1
 *
 * - `xff`  : right-most-hop rule over `X-Forwarded-For` (correct for Vercel
 *            with TRUSTED_PROXY_HOPS=1, and for Fly-without-Cloudflare).
 * - `cf`   : PER-REQUEST evidence. `CF-Connecting-IP` is trusted only when the
 *            request arrived FROM Cloudflare's published address space; a
 *            request that arrived from anywhere else is keyed by the address it
 *            actually came from, and its `CF-Connecting-IP` is ignored.
 *            `TRUSTED_PROXY_HOPS` is not consulted in this mode - see below.
 * - `header:<name>`: trust exactly the named header, unconditionally. Escape
 *            hatch for an edge whose address space cannot be enumerated.
 *            ⚠️ Only safe where the origin is unreachable except through that
 *            edge, which is NOT true of this deployment.
 *
 * ⚠️ A HOP COUNT CANNOT DESCRIBE TWO INGRESS PATHS, which is what the
 * Cloudflare cutover created (2026-10-24, `docs/105`). `TRUSTED_PROXY_HOPS`
 * assumes every request traverses the same number of proxies. Once the apex is
 * proxied, a request through Cloudflare carries two appended hops while a
 * request straight to `lastdonor.fly.dev` or `origin.lastdonor.org` carries
 * one - and both hostnames stay reachable forever. Configured for two, a
 * direct caller's own `X-Forwarded-For` prefix lands on the trusted index;
 * configured for one, every visitor through a Cloudflare datacentre shares
 * that datacentre's bucket and real users are locked out of login.
 *
 * Neither value is right, because the question is not "how many proxies does
 * this deployment have" but "did THIS request come through the edge". So `cf`
 * reads the one thing a caller cannot choose - the address our own
 * infrastructure saw the request arrive from - and decides per request.
 * See docs/26, docs/31 item 2.6, docs/104 §3 and docs/105.
 */

const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 10;

/** Sentinel used when no trustworthy client address can be derived. */
export const UNKNOWN_CLIENT_IP = 'unknown';

let warnedInvalidHops = false;
let warnedInvalidSource = false;

function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return DEFAULT_TRUSTED_PROXY_HOPS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TRUSTED_PROXY_HOPS) {
    if (!warnedInvalidHops) {
      warnedInvalidHops = true;
      console.error(
        `[RATE-LIMIT] TRUSTED_PROXY_HOPS="${raw}" is not an integer in 1..${MAX_TRUSTED_PROXY_HOPS}; ` +
        `falling back to ${DEFAULT_TRUSTED_PROXY_HOPS}.`,
      );
    }
    return DEFAULT_TRUSTED_PROXY_HOPS;
  }
  return parsed;
}

/**
 * The single header the trusted edge sets authoritatively, or `null` when the
 * deployment has not declared one (in which case only `X-Forwarded-For` is used).
 */
function clientIpSourceIsCloudflare(): boolean {
  return process.env.CLIENT_IP_SOURCE?.trim().toLowerCase() === 'cf';
}

function trustedClientIpHeader(): string | null {
  const raw = process.env.CLIENT_IP_SOURCE?.trim().toLowerCase();
  if (!raw || raw === 'xff') return null;
  if (raw === 'cf') return 'cf-connecting-ip';
  if (raw.startsWith('header:')) {
    const name = raw.slice('header:'.length).trim();
    if (name) return name;
  }
  if (!warnedInvalidSource) {
    warnedInvalidSource = true;
    console.error(
      `[RATE-LIMIT] CLIENT_IP_SOURCE="${raw}" is not one of 'xff' | 'cf' | 'header:<name>'; ` +
      `using X-Forwarded-For right-most-hop instead.`,
    );
  }
  return null;
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_RE = /^[0-9a-f:]+(?:\.\d{1,3}){0,3}$/i;

/**
 * Normalise one forwarded-for entry to a bare IP, or `null` if it is not one.
 *
 * Rejecting non-IP values matters beyond tidiness: the result becomes part of
 * the rate-limit key, so an unvalidated header lets a client mint unlimited
 * distinct keys (in Redis and in the in-memory Map) and sidestep every limit.
 */
function normaliseIp(value: string | null | undefined): string | null {
  if (!value) return null;
  let candidate = value.trim();
  if (!candidate || candidate.length > 64) return null;

  // "[2001:db8::1]:443" / "[2001:db8::1]"
  if (candidate.startsWith('[')) {
    const close = candidate.indexOf(']');
    if (close === -1) return null;
    candidate = candidate.slice(1, close);
  } else if (candidate.includes('.') && candidate.includes(':')) {
    // "1.2.3.4:5678"
    candidate = candidate.slice(0, candidate.indexOf(':'));
  }

  if (IPV4_RE.test(candidate)) return candidate;
  if (candidate.includes(':') && IPV6_RE.test(candidate)) return candidate.toLowerCase();
  return null;
}

/**
 * Resolve the client IP for rate-limiting purposes.
 *
 * Returns {@link UNKNOWN_CLIENT_IP} when no trustworthy address is available.
 * Callers must treat that as a single shared bucket, never as "skip the limit".
 */
export function getClientIp(headers: Headers): string {
  // `cf` is evidence-based and does not use the hop count. See the note above.
  if (clientIpSourceIsCloudflare()) return cloudflareAwareClientIp(headers);

  const headerName = trustedClientIpHeader();
  if (headerName) {
    const direct = normaliseIp(headers.get(headerName));
    if (direct) return direct;
    // Fall through: the edge header is missing (direct hit, health probe,
    // misconfiguration). Never fall back to the left-most XFF entry.
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (entries.length > 0) {
      // Skip the hops our own infrastructure appended; anything to the LEFT of
      // that index was supplied by the client and is not evidence of anything.
      const index = Math.max(0, entries.length - trustedProxyHops());
      const hop = normaliseIp(entries[index]);
      if (hop) return hop;
    }
  }

  return normaliseIp(headers.get('x-real-ip')) ?? UNKNOWN_CLIENT_IP;
}

/**
 * The address our own infrastructure saw this request arrive from.
 *
 * This is the one value in a request that the caller cannot choose. Fly's proxy
 * APPENDS the peer address to `X-Forwarded-For`, so the RIGHT-MOST entry is
 * always the peer, whatever prefix the caller invented - the same property the
 * `xff` right-most-hop rule has relied on since the audit (P1-5).
 *
 * `fly-client-ip` is consulted only as a fallback, for a request that reached
 * us with no `X-Forwarded-For` at all. A caller who sends their own copy of it
 * produces a comma-joined header value, which `normaliseIp` rejects, so the
 * forgery degrades to `UNKNOWN_CLIENT_IP` rather than to the forged value.
 */
function peerAddress(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const peer = normaliseIp(entries[i]);
      if (peer) return peer;
    }
  }
  return normaliseIp(headers.get('fly-client-ip')) ?? normaliseIp(headers.get('x-real-ip'));
}

/**
 * Resolve the client address when Cloudflare *may* be in front of this request.
 *
 * Trusting `CF-Connecting-IP` requires evidence that Cloudflare sent the
 * request, and the evidence is the peer address. Everything else in the request
 * is caller-controlled.
 */
function cloudflareAwareClientIp(headers: Headers): string {
  const peer = peerAddress(headers);

  if (peer && isCloudflareIp(peer)) {
    // Through Cloudflare: the edge overwrites this header on every request.
    const claimed = normaliseIp(headers.get('cf-connecting-ip'));
    if (claimed) return claimed;
    /*
      Through Cloudflare but with no CF-Connecting-IP. Not expected; keying by
      the edge address over-counts (everyone behind that datacentre shares one
      bucket) and is the safe direction - it cannot be used to escape a limit.
    */
    return peer;
  }

  /*
    Direct hit on the origin - `lastdonor.fly.dev`, `origin.lastdonor.org`, a
    health probe, or an attacker who found the Fly address. Any
    `CF-Connecting-IP` here was typed by the caller, so it is ignored entirely
    and the peer is the key.
  */
  return peer ?? UNKNOWN_CLIENT_IP;
}

// ─── In-memory fallback store (per-instance backstop for dev / Upstash outage) ──

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 50_000;
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
  if (rateLimitStore.size > MAX_STORE_SIZE) {
    const entries = [...rateLimitStore.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const toDelete = entries.slice(0, rateLimitStore.size - MAX_STORE_SIZE);
    for (const [key] of toDelete) rateLimitStore.delete(key);
  }
}

// ─── Distributed (Upstash Redis) rate limiters – one per route tier ─────────

type UpstashLimiter = InstanceType<typeof Ratelimit>;
let distributedLimiters: Record<string, UpstashLimiter> | null = null;
let distributedInitAttempted = false;

function initDistributedLimiters(): Record<string, UpstashLimiter> | null {
  if (distributedInitAttempted) return distributedLimiters;
  distributedInitAttempted = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[RATE-LIMIT] WARNING: UPSTASH_REDIS_REST_URL/TOKEN not set. ' +
        'In-memory-only rate limiting is insufficient for production serverless.',
      );
    }
    return null;
  }

  try {
    const redis = new Redis({ url, token });

    distributedLimiters = {
      auth: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:auth',
      }),
      newsletter: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:newsletter',
      }),
      donations: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:donations',
      }),
      users: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(30, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:users',
      }),
      /*
        Its own tier, tighter than `users` (30/60 s), because every request
        here can put a charged SMS on a stranger's handset. The per-user
        cooldown in `phone-verification.ts` is the real guard; this bounds
        one address cycling through accounts to get past it.
      */
      sms: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(SMS_LIMIT.maxRequests, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:sms',
      }),
      payhero_initiate: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(PAYHERO_INITIATE_LIMIT.maxRequests, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:payhero_initiate',
      }),
      payhero_status: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(PAYHERO_STATUS_LIMIT.maxRequests, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:payhero_status',
      }),
      payhero_callback: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(PAYHERO_CALLBACK_LIMIT.maxRequests, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:payhero_callback',
      }),
      // See SESSION_READ_LIMIT below. Its own prefix, so the bucket is not
      // shared with sign-in attempts.
      session: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(SESSION_READ_LIMIT.maxRequests, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:session',
      }),
      default: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(60, '60 s'),
        analytics: false,
        prefix: 'rl:lastdonor:default',
      }),
    };
  } catch (err) {
    console.error('[RATE-LIMIT] Failed to initialise Upstash limiters:', err);
    distributedLimiters = null;
  }
  return distributedLimiters;
}

// ─── The session read is not a sign-in attempt (docs/44) ──────────────────
/**
 * `GET /api/auth/session` is NextAuth's read of the caller's own cookie. Every
 * client-rendered page performs it once, so its request rate is the user's
 * *browsing* rate, not an attack rate.
 *
 * Before docs/44 it fell into the `auth` tier (10 requests / 60 s, shared with
 * password sign-in) because `getLimiterTier` matched the `/api/auth` prefix.
 * Five page views were enough to exhaust it, and `fetchData` in
 * `next-auth/lib/client.js` turns any non-2xx into `null`, which
 * `SessionProvider` stores as "no session" - so the limiter logged real users
 * out. The limit is keyed per IP, so one NAT shared the bucket.
 *
 * It gets its own tier rather than an exemption. The handler is NOT free: the
 * `jwt` callback in `src/lib/auth.ts` re-reads the user's role from Postgres
 * once per `ROLE_REVALIDATION_INTERVAL`, and that gate is keyed on
 * `roleCheckedAt` *inside the presented token*, so replaying one stale cookie
 * forces a database SELECT on every request. An unlimited path would therefore
 * be a database amplifier. A large bucket keeps that bounded while sitting far
 * above any plausible browsing rate.
 */
// ─── Sending an SMS costs money and lands on a handset (docs/85) ──────────
/**
 * `/api/v1/users/phone` mints and texts a verification code.
 *
 * It sits under `/api/v1/users`, whose tier is 30/60 s — far too generous
 * for a path where each accepted request bills us for a message delivered
 * to somebody's phone. The binding guard is the 60-second per-user
 * cooldown in `src/lib/phone-verification.ts`; this tier bounds the way
 * around it, which is one address cycling through accounts.
 *
 * Five per minute per IP: above any honest use (a person sends one code
 * and maybe resends once), far below a useful volume for anyone paying
 * for the messages with our balance.
 */
export const SMS_PATH_PREFIX = '/api/v1/users/phone';

/** Bucket for {@link isSmsSendRequest}: 5 requests / 60 s / IP. */
export const SMS_LIMIT: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };

/**
 * True when this request would actually put a message on a handset.
 *
 * **POST only, and that is load-bearing.** The first version of this tier
 * matched the whole path, and walking the flow against production showed
 * what that costs: GET (the page loads and reads state), POST (send),
 * PUT (verify), PUT again (the code was mistyped), PATCH (consent) is
 * FIVE requests of ordinary, honest use — so the limiter answered 429 to
 * a person typing a code we had just texted them.
 *
 * The other verbs are free for us and must not share the budget. `PUT` is
 * the one that looks like it needs a limit, and it does not: guessing a
 * code is bounded by the per-code attempt counter in
 * `phone-verification.ts`, which is the control that actually works
 * (an IP limit does not — see `docs/85`).
 */
export function isSmsSendRequest(pathname: string, method: string): boolean {
  return pathname.startsWith(SMS_PATH_PREFIX) && method.toUpperCase() === 'POST';
}

/*
  ── M-Pesa collection tiers (docs/92) ─────────────────────────────────────

  Three paths under `/api/v1/donations/payhero/` that must NOT inherit the
  `donations` tier (10/60 s), for opposite reasons.

  `initiate` is the one that puts a PIN prompt on a phone number taken from
  the request body, so it is the tightest tier on the platform alongside
  `sms`. Note that the IP limit is the OUTER bound and not the real control:
  the protection that matters is per phone number and lives in
  `src/lib/payhero-abuse-guard.ts`, because the party at risk is the number
  (whose owner PayHero blocks for 24 hours after 10 unanswered pushes) and a
  distributed caller changes IP freely. docs/85 reached the same conclusion
  about six-digit codes.

  `status` is polled by the donor's own browser while the prompt is live.
  Published M-Pesa guidance is to poll every few seconds when no callback has
  arrived, which over a three-minute prompt is tens of requests from one
  honest donor. Under the `donations` tier that donor is 429'd within the
  first minute of their own payment - the same defect the SMS tier had, where
  five requests of ordinary use tripped a five-request limit. Generous on
  purpose: it reads one row and makes at most one outbound call, only for a
  payment that is genuinely still pending.

  `callback` is PayHero's. It does NOT contain the string `/webhook`, so it
  is deliberately NOT covered by the blanket webhook exemption in
  `checkRateLimitAsync` - provider traffic is still bounded here. It can
  afford to be: a reference outside the LastDonor namespace is rejected
  before any database call, and only a reference matching a real pending row
  of ours causes an outbound request.
*/
export const PAYHERO_PATH_PREFIX = '/api/v1/donations/payhero';
export const PAYHERO_INITIATE_PATH = `${PAYHERO_PATH_PREFIX}/initiate`;
export const PAYHERO_STATUS_PATH = `${PAYHERO_PATH_PREFIX}/status`;
export const PAYHERO_CALLBACK_PATH = `${PAYHERO_PATH_PREFIX}/callback`;

/** Bucket for {@link PAYHERO_INITIATE_PATH}: 5 pushes / 60 s / IP. */
export const PAYHERO_INITIATE_LIMIT: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };

/** Bucket for {@link PAYHERO_STATUS_PATH}: 120 polls / 60 s / IP. */
export const PAYHERO_STATUS_LIMIT: RateLimitConfig = { maxRequests: 120, windowMs: 60_000 };

/** Bucket for {@link PAYHERO_CALLBACK_PATH}: 60 callbacks / 60 s / IP. */
export const PAYHERO_CALLBACK_LIMIT: RateLimitConfig = { maxRequests: 60, windowMs: 60_000 };

export const SESSION_READ_PATH = '/api/auth/session';

/** Bucket for {@link SESSION_READ_PATH}: 120 reads / 60 s / IP. */
export const SESSION_READ_LIMIT: RateLimitConfig = { maxRequests: 120, windowMs: 60_000 };

/**
 * True when this request is the cookie read described above.
 *
 * Deliberately GET/HEAD only. `POST /api/auth/session` is NextAuth's
 * `update()`, which re-mints the token and can hit the database unconditionally;
 * it stays in the `auth` tier.
 */
export function isSessionReadRequest(pathname: string, method: string): boolean {
  if (pathname !== SESSION_READ_PATH) return false;
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'HEAD';
}

/**
 * Map a request to its distributed limiter tier key.
 *
 * Exported for `rate-limit.session.test.ts`, which asserts the session read is
 * no longer in the `auth` tier.
 */
export function getLimiterTier(pathname: string, method: string = 'GET'): string {
  if (isSessionReadRequest(pathname, method)) return 'session';
  // Before the `/api/v1/users` line below, which would otherwise swallow it.
  if (isSmsSendRequest(pathname, method)) return 'sms';
  if (pathname.startsWith('/api/v1/auth') || pathname.startsWith('/api/auth')) return 'auth';
  if (pathname.startsWith('/api/v1/newsletter')) return 'newsletter';
  /*
    BEFORE the `/api/v1/donations` line below, which would otherwise swallow
    all three. Same ordering trap docs/85 records for the `sms` tier sitting
    ahead of `/api/v1/users`: a prefix match is first-wins, so a more
    specific tier placed after a more general one never fires.
  */
  if (pathname.startsWith(PAYHERO_INITIATE_PATH)) return 'payhero_initiate';
  if (pathname.startsWith(PAYHERO_STATUS_PATH)) return 'payhero_status';
  if (pathname.startsWith(PAYHERO_CALLBACK_PATH)) return 'payhero_callback';
  if (pathname.startsWith('/api/v1/donations')) return 'donations';
  if (pathname.startsWith('/api/v1/users')) return 'users';
  return 'default';
}

// ─── Per-route in-memory config (used as fallback) ──────────────────────────

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const ROUTE_LIMITS: Record<string, RateLimitConfig> = {
  // Must come first: the in-memory fallback matches by prefix and in insertion
  // order, and this path must not inherit a narrower /api/auth entry if one is
  // ever added below.
  [SESSION_READ_PATH]: SESSION_READ_LIMIT,
  '/api/v1/donations/create-intent': { maxRequests: 10, windowMs: 60_000 },
  '/api/v1/auth': { maxRequests: 10, windowMs: 60_000 },
  '/api/v1/newsletter': { maxRequests: 5, windowMs: 60_000 },
  // Before '/api/v1/users': insertion order decides, and the broader entry
  // would otherwise give a route that sends charged SMS a 30/60 s bucket.
  [SMS_PATH_PREFIX]: SMS_LIMIT,
  '/api/v1/users': { maxRequests: 30, windowMs: 60_000 },
  '/api/v1/blog': { maxRequests: 60, windowMs: 60_000 },
  '/api/v1/campaigns': { maxRequests: 60, windowMs: 60_000 },
  '/api/v1/admin': { maxRequests: 60, windowMs: 60_000 },
};

function getConfig(pathname: string, method: string = 'GET'): RateLimitConfig {
  for (const [route, config] of Object.entries(ROUTE_LIMITS)) {
    if (!pathname.startsWith(route)) continue;
    // The generous session bucket is for the GET/HEAD cookie read only; see
    // `isSessionReadRequest`.
    if (route === SESSION_READ_PATH && !isSessionReadRequest(pathname, method)) continue;
    // The tight SMS bucket is for the verb that actually sends a message;
    // the rest of the path falls through to the `/api/v1/users` entry.
    if (route === SMS_PATH_PREFIX && !isSmsSendRequest(pathname, method)) continue;
    return config;
  }
  return { maxRequests: 100, windowMs: 60_000 };
}

// ─── In-memory check (synchronous) ─────────────────────────────────────────

function checkInMemory(key: string, config: RateLimitConfig): NextResponse | null {
  cleanup();
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    return build429(config.maxRequests, entry.resetAt);
  }

  return null;
}

function build429(limit: number, resetAt: number): NextResponse {
  const now = Date.now();
  const retryAfter = Math.ceil((resetAt - now) / 1000);
  const requestId = crypto.randomUUID();
  const body: ApiError = {
    ok: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
      requestId,
    },
  };
  return NextResponse.json(body, {
    status: 429,
    headers: {
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
    },
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Async rate-limit check. Uses Upstash as the **primary synchronous**
 * enforcement across all serverless instances. Falls back to in-memory
 * only when Upstash is unavailable (dev mode or outage).
 */
export async function checkRateLimitAsync(request: NextRequest): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith('/api/')) return null;
  if (pathname.includes('/webhook')) return null;

  const ip = getClientIp(request.headers);
  const method = request.method ?? 'GET';
  const config = getConfig(pathname, method);
  const tier = getLimiterTier(pathname, method);
  const key = `${ip}:${pathname.split('/').slice(0, 5).join('/')}`;

  // ── Try distributed (Upstash) limiter first ──────────────────────────────
  const limiters = initDistributedLimiters();
  if (limiters) {
    const limiter = limiters[tier] ?? limiters.default;
    try {
      const result = await limiter.limit(key);
      if (!result.success) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests. Please try again later.',
              requestId: crypto.randomUUID(),
            },
          } satisfies ApiError,
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil(Math.max(result.reset - Date.now(), 1000) / 1000)),
              'X-RateLimit-Remaining': String(result.remaining),
            },
          },
        );
      }
      // Distributed check passed - skip in-memory
      return null;
    } catch (err) {
      // Upstash request failed - fall through to in-memory backstop
      console.warn('[RATE-LIMIT] Upstash error, falling back to in-memory:', err);
    }
  }

  /*
    ── In-memory fallback (per-instance, dev, or Upstash outage) ────────────

    Keyed by TIER as well as IP and path. Upstash gives each tier its own
    prefix, so its buckets are already independent; the in-memory store
    had no such separation, and two tiers sharing a path shared one
    counter with two different ceilings. That first showed up on
    `/api/v1/users/phone`, where a handful of free verifies could spend
    the tight send budget and 429 the next send. Without the tier in the
    key, the narrower limit silently governs every verb on the path.
  */
  return checkInMemory(`${tier}:${key}`, config);
}

/**
 * Synchronous in-memory-only rate-limit check (legacy).
 * Kept for backwards compatibility; callers should migrate to checkRateLimitAsync.
 */
export function checkRateLimit(request: NextRequest): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith('/api/')) return null;
  if (pathname.includes('/webhook')) return null;

  const ip = getClientIp(request.headers);
  const method = request.method ?? 'GET';
  const config = getConfig(pathname, method);
  const tier = getLimiterTier(pathname, method);
  const key = `${ip}:${pathname.split('/').slice(0, 5).join('/')}`;

  // Tier in the key, for the reason given in `checkRateLimitAsync`.
  return checkInMemory(`${tier}:${key}`, config);
}
