# 46 — Login failure copy, campaign URLs in the sitemap, and the wallet permissions policy

**Date:** 2026-10-15
**Status:** Accepted and implemented
**Supersedes / amends:** the `payment` directive in `docs/06` §7.2; the
single-message login copy decided in `docs/32`
**Related:** `docs/32` (enumeration controls), `docs/34`/`src/db/build-phase.ts`
(hermetic build), `docs/37` (pool wedge), `docs/39` (register-page enumeration)

Three unrelated defects found by a live browser audit of production on
2026-10-15. They are recorded together because they were fixed together, not
because they share a cause.

Every claim below is marked **VERIFIED** (observed in the live site, in the
installed dependency source, or pinned by a test in this repo) or **ASSUMED**.

---

## 1. "An unexpected error occurred" is what a wrong password looked like

### What was observed

**VERIFIED (live, 2026-10-15).** `/login` with a correct email and a wrong
password rendered a single generic failure message. The sign-in callback had
returned

```json
{"url":"https://lastdonor.org/login?error=CredentialsSignin&code=invalid_credentials"}
```

so the server knew precisely what happened; the UI threw the distinction away.

**VERIFIED (live, during the 2026-10-14/15 database outage, `docs/37`).** The
*identical* string appeared for **correct** credentials, because the callback
returned `code=credentials` instead. One sentence therefore carried two
opposite instructions: "you typed it wrong" and "our database is down". A user
who mistyped retyped the same password or spent a password reset they did not
need; a user whose password was fine was told to check it.

### Why one message was there in the first place

`docs/32` collapsed four `CredentialsSignin` codes (`no_account`, `oauth_only`,
`invalid_password`, `account_locked`) into one `invalid_credentials`, with a
decoy bcrypt on the miss, because the old codes made `/login` an
account-existence oracle. That control is correct and is **not** what this
change touches. The error was reading "one code from `authorize()`" as "one
outcome at the client".

**VERIFIED (dependency source).** They are not the same thing.
`node_modules/next-auth/react.js:175` reads `code` out of the callback URL and
returns it to the caller, and `@auth/core` emits its own default
`CredentialsSignin` code `credentials` whenever `authorize()` returns `null` or
the provider itself fails. `src/lib/auth.ts`'s `authorize()` catches any
non-`CredentialsSignin` error and returns `null`, so **a database fault is
indistinguishable from a wrong password only at the UI layer, never at the
protocol layer.**

### Decided

Two messages, split on the **server's failure mode**:

| Client-visible code | Message |
|---|---|
| `invalid_credentials` | `Incorrect email or password. Check both, or continue with Google.` (plus a "Reset your password" link) |
| `password_reset_required` | the existing forced-reset message, unchanged |
| anything else — `credentials`, no code, a code a later version adds, or a thrown request | `We couldn't sign you in right now. Please try again shortly.` (no reset link) |

The same split applies on the redirect path, which carries
`?error=CredentialsSignin&code=<code>`; `oauthErrorMessage` now takes the `code`
param as a second argument.

### How the enumeration control survives

This is the part that matters, so it is stated as an invariant rather than as a
claim about copy:

- **The split is keyed on the server's failure mode, not on the account.**
  `authorize()` still throws exactly one `invalid_credentials` for unknown
  address, wrong password, OAuth-only account **and lockout**. The page cannot
  tell those apart because the code it receives is identical, so the rendered
  output is a pure function of that code. An enumerator cannot steer which
  branch fires by changing the address they submit; only an outage can, and an
  outage is global.
- **No new difference in message, status, timing or redirect.** `src/lib/auth.ts`
  is unchanged — same decoy bcrypt, same single code, same server-only
  `logAuthFailure`. The page still posts with `redirect: false` and still never
  navigates on failure.
- **"Incorrect email or password" is true of all four reasons** and names none
  of them. It deliberately does not say "that password is wrong", which would
  imply the account exists.
- **The OAuth-only user still has a working door.** The credential message ends
  "or continue with Google", and the Google button is rendered
  unconditionally above the form, so the path exists without the copy ever
  saying whose account uses it.

**VERIFIED (tests).** All 47 assertions in `src/lib/auth.enumeration.test.ts`
pass unchanged. `src/app/login/page.test.tsx` adds the invariant directly: four
different addresses standing for the four collapsed reasons produce
**byte-identical** `innerHTML` in the alert region, one credentials request
each, and no navigation.

### The lockout path — what was found and what was chosen

**VERIFIED (code).** `src/lib/auth.ts` can signal a lockout.
`checkAccountLocked()` (threshold 5 failures, 15-minute sliding window) runs
*before* the user lookup and, on a hit, calls
`logAuthFailure('account_locked', email)` and throws
`InvalidCredentialsError` — i.e. the client sees `invalid_credentials`,
identical to a wrong password.

**Chosen: leave it collapsed. Do not give lockout its own message or code.**
Only an account that exists can be locked, so any lockout-specific signal is a
direct existence oracle, and a cheap one: five junk submissions per address
converts "is this address registered" into an observable. That is exactly the
oracle `docs/32` closed, and on a platform publishing medical and hardship
appeals the answer is itself sensitive.

**Rejected — distinct lockout copy ("Too many attempts, try again in 15
minutes").** More accurate for the locked user, but it hands back the oracle.
Rejected.

**Rejected — unconditional lockout copy appended to the credential message for
everyone** ("If you have tried several times, wait 15 minutes"). Non-disclosing,
because it is shown on every failure. Rejected anyway: it is noise for the
overwhelmingly common case (one mistyped password), it invites users to wait
when waiting is not the fix, and `recordFailedAttempt()` only increments for
rows that exist, so the sentence is simply untrue for a non-existent address —
a claim the platform cannot substantiate.

**Accepted trade-off, stated plainly:** a locked-out user is told "Incorrect
email or password" and is not told that further correct attempts will also fail
for up to 15 minutes. They will retry, fail, and most likely use "Forgot
password?" — which clears the counters
(`src/app/api/v1/auth/reset-password`, per `docs/32`), so the path out is
reachable, just not signposted. We take a worse experience for ~5-attempt users
over a working enumeration oracle for everyone.

**Residual issue, NOT fixed here, reported rather than changed:**
`checkAccountLocked()` returns before any bcrypt call, so a locked account
answers measurably faster than a wrong password — a *timing* oracle that
survives the collapsed codes and partially defeats the decoy hash. It is in
`src/lib/auth.ts`, which this change deliberately did not touch. The fix is to
spend the decoy bcrypt on the lockout path too, before throwing. **ASSUMED**
that the window is large enough to be measurable over the internet; not
instrumented.

### Files

- `src/app/login/page.tsx` — two messages plus the forced-reset text; the
  inline branch now distinguishes `invalid_credentials`,
  `password_reset_required` and transient; `oauthErrorMessage(error, code)`.
- `src/app/login/page.test.tsx` — new, 19 tests.
- `src/lib/validators/instant-live-architecture.test.ts` — updated. It asserted
  the old single string; the copy changed deliberately, so the assertions were
  updated rather than the code reverted.

---

## 2. Not one campaign page was in the sitemap

### What was observed

**VERIFIED (live, 2026-10-15).** `/sitemap.xml` served 42 URLs: the marketing
and policy pages plus all `/campaigns/category/<slug>` landing pages, and
**zero** `/campaigns/<slug>` detail pages. (This repo's static list is 19 pages
plus 23 categories = 42 — the audit's "24 category pages" was one high and its
total matches the list here exactly.) Zero `/blog/<slug>` posts were listed
either. The only pages that can accept money were invisible to search engines
while ~20 thin category pages were offered to Google.

### Root cause — not the query

`src/app/sitemap.ts` already queried for campaign and blog URLs. The defect was
that the route was **fully static**:

1. It exported no `revalidate` and no `dynamic`, so Next rendered it once
   during `next build`.
2. **VERIFIED (`src/db/build-phase.ts`, `Dockerfile:157`).** The build is
   deliberately hermetic: a database read that fails during `next build`
   resolves to **zero rows** instead of throwing, and the `database_url` build
   secret is **optional**.
3. So the sitemap was generated against an empty database and then frozen into
   the image for its whole life. No error, no warning at runtime, a 200
   response, and a permanently wrong sitemap.

`src/db/build-phase.ts` states the assumption that broke: "the route
pre-renders empty and fills in on first request, **because every one of these
routes sets `revalidate`**". The sitemap was simply not one of the 24 that do.

### Decided

- **`export const revalidate = 3600`.** This is the fix. One hour rather than
  the 60s used by `/campaigns/[slug]`: a sitemap is crawler input, crawlers
  refetch on their own schedule, and an hour costs one query per hour per
  instance instead of one per minute.
  - **Rejected: `dynamic = 'force-dynamic'`.** Removes staleness entirely but
    puts an uncached database query behind an anonymous, crawler-driven,
    unrate-limited path. Rejected.
  - **Rejected: `revalidatePath('/sitemap.xml')` from the publish cron.**
    Precise, but it adds a coupling that must be remembered at every future
    write site, and per `CLAUDE.md`/`docs/26` §5 `revalidatePath` is
    per-instance without a shared cache handler, so above one instance it would
    silently only fix one machine. Rejected as the primary mechanism; it can be
    added later as an accelerator on top of `revalidate`.

- **Statuses included: `active`, `last_donor_zone`, `completed`.**
  This is deliberately the **same set** as `isIndexable` in
  `src/app/campaigns/[slug]/page.tsx:211`, which drives `robots: { index }` on
  the page itself. **VERIFIED (code):** the detail route serves 200 for
  `paused`, `suspended` and `cancelled` but marks them `noindex`, and it does
  not return `draft`, `under_review` or `archived` at all.
  - `active` / `last_donor_zone` — live and donatable; the reason the sitemap
    exists.
  - `completed` — funded and closed, still a true public record and still
    useful to a searcher. Low priority (0.3), `monthly`.
  - **Excluded and why:** `draft`, `under_review`, `archived` are not public —
    a sitemap entry would resolve to 404. `paused` is transient. `suspended`
    and `cancelled` are trust-and-safety outcomes: submitting them would be the
    platform soliciting search traffic to a fundraiser it has itself stopped
    trusting, and a URL that is both sitemap-submitted and `noindex` is a
    contradiction Google reports as "Submitted URL marked noindex".
  - **The two lists must move together.** If a status is added here, change
    `isIndexable` in the same commit. Pinned by `src/app/sitemap.test.ts`,
    which asserts the exact status list reaching the SQL.

- **`lastModified` from the row** (`updatedAt`, falling back to `publishedAt`,
  then to the static content date), never `new Date()`. A lastmod that changes
  on every regeneration tells Google every campaign changed every hour and
  devalues the signal for the ones that did.

- **Empty category pages stay listed.** Considered dropping them, kept, on
  purpose: each renders its own editorial copy from `src/lib/category-content.ts`
  and is a real landing page, all 23 return 200 whether or not they currently
  hold a campaign, removing a URL from a sitemap does not deindex it (it only
  stops declaring a `lastmod`), and gating them on a live campaign count would
  make the listed URL set flap as campaigns open and close — worse for crawl
  budget than a stable list. All 42 URLs that returned 200 before this change
  are still listed, pinned by test.

- **A database failure degrades, per section.** Each database-backed section
  runs inside `sitemapSection()`, which logs and returns no URLs on failure, so
  `/sitemap.xml` answers 200 with the static sitemap rather than 500. A 500 is
  not a degraded sitemap, it is no sitemap. Per-section granularity is
  deliberate: a blog-table failure must not also cost the campaign URLs.
  - This is a **narrow, argued exception** to the rule in
    `src/db/build-phase.ts` that a serving instance which cannot reach Postgres
    must fail loudly. It holds only here: nothing a crawler does with a short
    sitemap is irreversible, and `revalidate` means the next regeneration
    repairs it with no deploy. It is **not** a licence to fail soft on
    user-facing or money-handling routes.

### Known remaining issue — NOT fixed

`src/app/blog/sitemap.ts` (`/blog/sitemap.xml`) has the **identical** freeze:
no `revalidate`, so it too was baked empty at build time. It was left alone to
keep this change inside its brief. One line fixes it.

### Files

- `src/app/sitemap.ts` — `revalidate`, explicit status constants, per-section
  fail-soft, single campaign query.
- `src/app/sitemap.test.ts` — new, 16 tests.

---

## 3. `permissions-policy` silently disabled Apple Pay and Google Pay

### What was observed

**VERIFIED (live, 2026-10-15).** Every response carried

```
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(self)
```

and the browser console logged `Potential permissions policy violation: payment
is not allowed in this document` on every page that loaded Stripe.js.

### Cause

The Payment Request API — which is what renders the Apple Pay and Google Pay
buttons — does not run in our document. Stripe mounts it inside a **cross-origin
iframe from `js.stripe.com`** (the same iframe the CSP already allows via
`frame-src https://js.stripe.com`). `payment=(self)` allowlists our origin only,
so the wallet iframe is refused the feature.

### Decided

```
payment=(self "https://js.stripe.com")
```

`(self "<origin>")` is the structured-header allowlist form: a space-separated
list of `self` and double-quoted serialised origins (W3C Permissions Policy,
"Allowlists"; **checked 2026-10-15**). It widens `payment` to exactly one
third-party origin and nothing else.

Nothing else moved. `camera`, `microphone` and `geolocation` keep empty
allowlists — denied to every origin including ours, since nothing in `src/`
requests them — and `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and
HSTS are untouched.

- **Rejected: `payment=*`.** Grants the feature to every embedded origin,
  including anything a future embed introduces, to fix one known iframe.
  Rejected.
- **Rejected: dropping the `payment` directive entirely.** The Permissions
  Policy default allowlist for `payment` is `self`, so omitting it would be
  equivalent to the broken value and the breakage would come back silently.
  Rejected.
- **Rejected: emitting the header from `src/middleware.ts` instead.** No
  per-request input is needed, and splitting the security headers across two
  files is how one quietly shadows the other. It stays in `next.config.ts`.

### Verification status — read this before reporting it as working

**NOT VERIFIED END TO END.** The deployed `NEXT_PUBLIC_STRIPE_*` publishable key
is an empty string, so no wallet button can render and **no real Apple Pay or
Google Pay payment has been exercised against this header**. What is verified is
the **emitted header value**, pinned by `test/security/csp-headers.test.ts`:
`payment` allows exactly `self` and `"https://js.stripe.com"`, it is the only
widened directive, `camera`/`microphone`/`geolocation` allowlists are still
empty, and the allowed payment origin is one the CSP will actually let us frame.

**ASSUMED** (from Stripe's documented architecture, not measured here) that
allowing `js.stripe.com` is sufficient and that no further origin
(e.g. a nested `m.stripe.network` frame) needs the `payment` feature. The first
real wallet test with a live publishable key should re-check the console for the
same violation message before this is called done.

### Files

- `next.config.ts` — the `Permissions-Policy` value.
- `test/security/csp-headers.test.ts` — 6 new assertions.
- `docs/06` §7.2 — amended, with the reversal noted inline.

---

## Test results (2026-10-15, as run)

```
npx vitest run src/app/login/page.test.tsx src/app/sitemap.test.ts \
  test/security/csp-headers.test.ts
  → 3 files passed, 57 tests passed

npx vitest run src/lib/validators/instant-live-architecture.test.ts \
  src/lib/auth.enumeration.test.ts src/app/register/page.test.tsx
  → 3 files passed, 219 tests passed
```

`npm run test:unit` in full was deliberately **not** run in this change; other
agents were editing unrelated files concurrently, so a full-suite result would
not have been attributable. `npm run typecheck` and `npm run lint` were run and
pass.
