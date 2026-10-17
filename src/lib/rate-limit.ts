import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { ApiError } from '@/types/api';

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
 * - `cf`   : prefer `CF-Connecting-IP`, which Cloudflare *overwrites* on every
 *            request so a client cannot forge it; falls back to the `xff` rule
 *            when the header is absent.
 * - `header:<name>`: trust exactly the named header. Escape hatch for another
 *            edge (e.g. `header:fly-client-ip`, `header:true-client-ip`).
 *
 * This is deliberately NOT "trust CF-Connecting-IP whenever it is present":
 * off Cloudflare that header is attacker-controlled, so auto-trusting it would
 * reintroduce exactly the bug being fixed. The Cloudflare/Fly cutover must set
 * `CLIENT_IP_SOURCE=cf` and `TRUSTED_PROXY_HOPS=2` (Cloudflare + Fly both
 * append a hop). See docs/26 and docs/31 item 2.6.
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
