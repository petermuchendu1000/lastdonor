# 44 - Session read: rate limit tier, one read per load, and a tri-state client auth

**Date:** 2026-10-15
**Status:** Accepted, implemented in the same change
**Supersedes nothing.** Amends the limiter tiers described in `docs/31` item 2.6
and `docs/32`; the client-IP trust boundary from those documents is unchanged.

---

## 1. The defect

A logged-in user was visibly logged out after five page views.

```
nav#1 /                          session=[200,200]  header: "... About  JT  Donate"
nav#2 /campaigns                 session=[200,200]  header: "... About  JT  Donate"
nav#3 /campaigns/marcus-delgado  session=[200,200]  header: "... About  JT  Donate"
nav#4 /about                     session=[200,200]  header: "... About  JT  Donate"
nav#5 /how-it-works              session=[429,429]  header: "... About  Sign in  Donate"
nav#6 /campaigns/mila-ostrowski  session=[429,429]  header: "... About  Sign in  Donate"
```

The session cookie stayed valid throughout (`/dashboard` server-rendered fine).
The campaign page swapped its composer for "Sign in to leave a message of
support." Recovery took about 65 seconds of total inactivity. Reloading made it
worse, because each reload burned more quota.

Three independent faults compounded:

1. the bucket the session read was in was sized for sign-in attempts,
2. one navigation spent two requests from it, and
3. a 429 was rendered as "signed out" rather than as "could not determine".

## 2. The numbers, as found (verified by reading the code, 2026-10-15)

**Verified.** `GET /api/auth/session` was classified by
`getLimiterTier` in `src/lib/rate-limit.ts`, which matched the `/api/auth`
prefix and returned the `auth` tier:

| Path | Tier | Limiter | Key |
|---|---|---|---|
| `/api/auth/session` (before) | `auth` | `Ratelimit.slidingWindow(10, '60 s')` | `rl:lastdonor:auth:<ip>:/api/auth/session` |

So the real production bucket was **10 requests per 60-second sliding window,
per IP**, shared in sizing (not in key) with password sign-in. The in-memory
fallback used in dev and during an Upstash outage had no `/api/auth` entry in
`ROUTE_LIMITS`, so it fell through to the default of **100 per 60 s** - which is
why this never reproduced locally.

**Verified** (arithmetic against the reproduction): signing in spends two
session reads, then four navigations spend eight, which is ten. The fifth
navigation is requests 11 and 12, and both are refused. `Retry-After: 11` is the
sliding window's own reset. The observed trace matches the 10/60 s bucket
exactly.

**Verified** (`node_modules/next-auth/lib/client.js`, `fetchData`): every
non-2xx answer is caught, logged, and returned as `null`. `SessionProvider`
stores that `null` as the session, so a 429, a 502, an offline tab and a
genuinely signed-out visitor are all indistinguishable at the component
boundary. This is the mechanism that turned a rate limit into a logout.

**Verified by measurement** (a throwaway Vitest render of a bare
`SessionProvider` with `fetch` stubbed): **two** `GET /api/auth/session` per
mount. Cause, from `node_modules/next-auth/react.js` 5.0.0-beta.30:

- line 283, mount effect: `__NEXTAUTH._getSession()` with no initial session
  prop, which fetches;
- lines 102-112, `getSession()`: announces itself by posting
  `{event:'session'}` on a **freshly constructed** `BroadcastChannel('next-auth')`
  (added in next-auth PR #11470 to break a loop);
- line 301: the provider listens for `message` on its own **separate** channel
  object. A BroadcastChannel never receives its own messages, but these are two
  different objects in the same document, so the provider receives its own
  announcement, treats it as a cross-tab `storage` event and refetches.

The second fetch passes `broadcast: false`, which is why it stops at two rather
than looping.

**Verified** (`src/lib/auth.ts`): the session read is *not* free. The `jwt`
callback calls `resolveSessionToken`, which re-reads the user's role from
Postgres when `nowSec - roleCheckedAt >= ROLE_REVALIDATION_INTERVAL[role]` (1
hour for donors, 60 seconds for editors and admins). That gate is keyed on
`roleCheckedAt` **inside the token the caller presented**, so replaying one
stale cookie forces an indexed SELECT on *every* request. This is what rules out
exempting the path.

## 3. Decisions

### 3.1 The session read gets its own limiter tier: 120 per 60 s per IP

`getLimiterTier(pathname, method)` now returns a `session` tier for
`GET`/`HEAD` on exactly `/api/auth/session`, backed by its own Upstash prefix
`rl:lastdonor:session` and `slidingWindow(120, '60 s')`. `ROUTE_LIMITS` carries
the same number so the in-memory fallback agrees with the distributed limiter
instead of being four times looser.

Why 120: after the fix below, one page view costs at most one read, so 120 per
minute per IP is about two page views per second sustained from a single
address - far above any human browsing rate, and it also bounds the
stale-cookie database amplifier at 120 indexed single-row SELECTs per minute per
IP. For comparison, `/api/v1/campaigns` already allows 60 per minute of much
heavier queries.

**This is a limiter change only.** Nothing was added to `PUBLIC_API_ROUTES` in
`src/middleware.ts`. `/api/auth/*` was already public there (it has to be:
sign-in happens without a session), and that entry is untouched, so the
default-deny posture described in CLAUDE.md is unchanged. Exempting a path from
the *limiter* and making a path *public* are different decisions and this change
makes only the first.

Money and mail are untouched: `create-checkout` stays in the `donations` tier
(10/60 s), newsletter in `newsletter` (5/60 s), cron unchanged. A regression
test asserts those tiers explicitly.

**Rejected: exempt `/api/auth/session` from the limiter entirely** (the shape
of the `/webhook` exemption). It is attractive - page navigations themselves are
not rate limited at all, so limiting the cookie read at 10/minute was
incoherent. It was rejected because of the role-revalidation path above: an
unlimited session read is an unauthenticated-ish database amplifier, since the
revalidation gate lives in the caller's own token and a replayed stale cookie
defeats it. A large bucket keeps the amplification bounded.

**Rejected: key the session bucket on the session cookie instead of the IP.**
This would make the limit immune to NAT, which is the residual weakness of a
per-IP bucket. It was rejected because the cookie value is attacker-supplied in
the middleware, where nothing has verified it yet, so a client could mint
unlimited distinct keys and bypass the limit entirely - the exact failure the
`normaliseIp` comment in `src/lib/rate-limit.ts` already warns about.

**Accepted trade-off:** a very large NAT (carrier-grade, a big campus) can still
exhaust 120 per minute. That is now a degraded-but-honest experience rather than
a logout, because of 3.3: the UI holds its previous state and the client retries
on `Retry-After`.

### 3.2 One session read per document load, zero per client-side navigation

`src/components/SessionBootstrap.tsx` replaces the bare `SessionProvider` in
`src/components/Providers.tsx`:

```
<SessionProvider session={null}>   // never fetches
  <SessionGate>                    // owns the truth, probes once
    <SessionContext.Provider>      // what every useSession() reads
```

Handing the outer provider an explicit `session` makes its `hasInitialSession`
branch true, so the mount effect returns before fetching; because the value is
`null`, its visibility-change handler also returns early. It therefore issues no
request of its own, and with no mount fetch there is no broadcast and no echo.
It stays mounted because two behaviours live only inside it: `signIn()` and
`signOut()` reach the client through `__NEXTAUTH._getSession`, which exists only
while a provider is mounted, and the cross-tab BroadcastChannel listener.

`SessionGate` reads that outer context with `useSession()` and republishes its
own value through next-auth's exported `SessionContext`, so every consumer sees
a three-state session: `loading` until a conclusive answer exists. It performs
exactly one status-code-aware read per mount. Both providers stay mounted for
the document's lifetime and never change element type, so nothing below them
remounts when the answer arrives.

Cost: **one** read per full document load, **zero** per `<Link>` navigation
(the provider does not remount). Previously: two per full load.

`TawkProvider` moved inside `SessionBootstrap` for the same reason it had to be
inside `SessionProvider` before - it calls `useSession()`, and outside the inner
provider it would read the `null` placeholder the outer provider is seeded with.

**Rejected: pass the server session into `SessionProvider` from the root
layout** (`const session = await auth()`), which is what the Auth.js docs
suggest and would also reach zero client reads. Rejected because `auth()` reads
cookies, and a cookie read in the root layout opts **every** route out of static
generation. 26 pages use `revalidate` (`docs/26` §5) and the navbar already
wraps `useSearchParams` in Suspense specifically to keep pages prerenderable.
Trading all ISR for one request per load is the wrong trade.

**Rejected: cache the session in `sessionStorage` and seed the provider from
it.** This would make warm hard-loads cost zero reads. Rejected as not worth the
staleness: a cached session is not evidence the cookie is still valid, so a
sign-out or revocation elsewhere would leave the signed-in header rendered for
the cache's lifetime, and it buys nothing for in-app navigation, which is
already free.

**Rejected: monkeypatch `BroadcastChannel` (or `fetch`) to swallow the echo.**
Targeted at the real cause, but it means patching a web API globally for every
channel and every request in the app, and a mistake silently breaks cross-tab
sign-out. Giving the provider an initial session removes the echo without
touching anything global.

**Not changed: `refetchOnWindowFocus`.** It stays at its default. With
`session={null}` next-auth's own focus handler returns early anyway, and
deliberately disabling session refresh on focus is a freshness decision that
does not belong in a rate-limit fix.

### 3.3 A failed session read is "unknown", never "signed out"

`src/lib/auth-state.ts` adds:

- `probeSessionRead()` - the one read that keeps the HTTP status. **Only a 200
  concludes anything**: a 200 with a `user` is `authenticated`, a 200 without
  one is `anonymous`, and 429 / 5xx / any other status / a network error / a
  malformed body are all `indeterminate`, carrying the clamped `Retry-After`
  (1 s to 30 s).
- a module-level "was the last read conclusive?" flag, subscribed to with
  `useSyncExternalStore`.
- `useAuthState()` - returns `'authenticated' | 'anonymous' | 'unknown'`.
  `status === 'unauthenticated'` is believed **only** when the last read was
  conclusive; otherwise the answer is `unknown`.

`SessionGate` retries an indeterminate read up to four times, waiting the
server's `Retry-After` each time, so the 65-second manual recovery becomes
automatic. If all four fail the state stays `unknown` - honest, not anonymous.
It also re-probes whenever next-auth flips from `authenticated` to
`unauthenticated` on its own (cross-tab events, `signIn({redirect:false})`),
because next-auth cannot tell a real sign-out from a 429 and this is the one
remaining path where its own non-status-aware fetch is used.

Consumers changed:

- `src/components/layout/Navbar.tsx` - renders a neutral avatar placeholder
  (`data-testid="auth-indeterminate"`) for `unknown`, and gates both the
  desktop and the mobile-sheet "Sign in" links on `state === 'anonymous'`
  rather than on `!isAuthed`. The mobile sheet's link was the second, quieter
  instance of the same bug.
- `src/components/campaign/MessageForm.tsx` - returns nothing for `unknown`.
  An auth-gated empty state is a claim about the viewer, and a 429 is not
  evidence for it.

`src/components/campaign/SubscribeButton.tsx` and
`src/components/NotificationBell.tsx` already render nothing unless
authenticated, which is correct for `unknown` (no false claim either way), so
they were left alone.

**Rejected: remember the last authenticated identity and keep rendering it
whenever the status flips to unauthenticated.** It would hide the defect in
every case, including a genuine expiry, and it inverts the safe default: the
anonymous rendering would then be unreachable for anyone who had ever been
signed in. The conclusiveness flag defaults to "believe it", and only positive
evidence of a failed read overrides it.

## 4. Tests

| File | Asserts |
|---|---|
| `src/lib/rate-limit.session.test.ts` | the session read is in its own tier, not `auth`; 40 consecutive reads (4x the old threshold) all pass; there is still a ceiling at 120; `POST /api/auth/session` and every other `/api/auth` path stay in the sign-in tier; donations and newsletter tiers unchanged |
| `src/lib/auth-state.test.tsx` | 200-with-user, 200-empty, 429, 5xx, network error and malformed body each classify correctly; `Retry-After` parsed and clamped; `useAuthState` returns `unknown` (not `anonymous`) for `unauthenticated` + inconclusive |
| `src/components/SessionBootstrap.test.tsx` | exactly one `GET /api/auth/session` per mount, against the real next-auth provider; initial state is `loading`, never `unauthenticated`; a 429 holds `loading`; the retry recovers without a reload |
| `src/components/layout/Navbar.session-degraded.test.tsx` | no "Sign in" link when the read was rate limited or is in flight; the link is present when conclusively anonymous |
| `src/components/campaign/MessageForm.indeterminate.test.tsx` | no "Sign in to leave a message" state on an inconclusive read; it is present when conclusively anonymous |

## 5. Known remaining gaps

- **Assumed**, not measured on production: that the deployed instance has
  `UPSTASH_REDIS_REST_URL`/`TOKEN` set, and therefore that the 10/60 s Upstash
  `auth` tier (not the 100/60 s in-memory fallback) is what produced the
  observed 429s. The arithmetic in §2 only fits the 10/60 s bucket, so this is
  near-certain, but it was not confirmed against the live Redis.
- A single IP can still exhaust 120 reads per minute; see the accepted
  trade-off in 3.1.
- Cross-tab sign-in/sign-out still travels through next-auth's own,
  non-status-aware fetch. A 429 on that path is caught by the re-probe in 3.3
  rather than prevented.
- `next-auth` 5.0.0-beta.30 internals (`SessionContext`, `__NEXTAUTH`,
  `hasInitialSession`) are load-bearing for 3.2. Both symbols are exported from
  `next-auth/react`, but a beta upgrade should re-run
  `src/components/SessionBootstrap.test.tsx`, which fails loudly if the mount
  stops costing exactly one read.
