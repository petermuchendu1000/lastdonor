# 32 — Remediation Decisions (ADR), 2026-10-14

Decisions taken while implementing `docs/31` Phase 1–3. Each records what was
decided, what was rejected, and the trade-off accepted. Commits: `ec2482e`,
`53cfd61`, `c6fdfb9`, `d6450e3`, `e1fee65`.

Verification standard: every fix below has a test that was confirmed to fail
against the pre-fix code by reverting the change in place, not by reasoning
about it.

---

## 1. Private document storage + signed URLs (P0-1)

**Decided.** Verification documents move to a dedicated private bucket, served
only through 15-minute signed URLs behind `requireRole(['admin'])`. The
enforcement point is `getPublicUrl()`, which now **throws** for any key under a
private prefix — so no caller anywhere can mint a public URL for one, including
`/api/v1/upload`, whose caller-supplied `folder` param could previously have
written under that prefix.

**Rejected:**
- *Keep the public bucket, rely on unguessable keys.* Security by URL obscurity;
  a single leaked URL is permanent, and the URLs were already persisted in
  `verificationDocuments.fileUrl` and rendered into admin HTML.
- *Provision the bucket from application code.* Code that can create its own
  buckets can change its own storage ACLs — exactly the privilege this fix
  removes. Handed to the operator instead.
- *Add a `storage_bucket`/`storage_key` column pair.* Correct end state, blocked
  by the frozen migration state (`CLAUDE.md`). Interim: `file_url` carries a
  deliberately non-dereferenceable `supabase-private://` reference, and the
  parser still reads legacy public URLs so existing documents stay reviewable.

**Trade-offs accepted.** (a) Uploads **fail closed** with a 500 until the
operator creates the bucket — chosen over any fallback to public. (b) The admin
UI reads `fileUrl` directly, so new uploads render as **dead links** until that
read path moves to the signed-URL endpoint; a dead link is the correct failure
mode mid-transition. (c) The signed-URL endpoint is admin-only, so a campaigner
cannot re-view their own document — a product decision deliberately not taken
unilaterally.

**Not closed by code.** Every document uploaded before this change was
world-readable at a non-expiring URL for its entire existence. Migration does
not un-disclose them. Government IDs and medical records are special-category
data under **GDPR Art. 9**; whether this is a notifiable breach is an
owner/counsel decision.

---

## 2. The image-host allowlist is necessarily incomplete (P1-14)

**The constraint, verified.** `images.remotePatterns` is capped at **50 entries**
by Next.js (`next/dist/server/config-schema.js:559`, `.max(50)`, verified
2026-10-14 against installed next@15). Enumerating all ~110 RSS publishers at
apex plus wildcard produced 249 patterns and Next **rejected the config
outright**. A complete allowlist for this pipeline is therefore *impossible*,
not merely unwieldy. This is the load-bearing fact; any future attempt to "just
add the missing domains" will hit it again.

Matcher semantics were also verified empirically rather than recalled:
`**.example.com` matches `www.` and `a.b.`, does **not** match the apex, and
does not match `notexample.com` or `example.com.evil.net`.

**Decided.** 48 patterns — 5 first-party plus 43 `**.<news-domain>` — chosen
against the product's actual categories, plus wires and publisher-owned image
CDNs.

**Rejected:** the `hostname: "**"` wildcard (an unauthenticated,
unrate-limited open fetcher, since middleware does not match `/_next/image`);
full enumeration (impossible, above); and **multi-tenant CDN namespaces**
(`cloudfront.net`, `s3.amazonaws.com`, `wp.com`, `akamaized.net`, `*.pages.dev`,
`*.vercel.app`, `*.r2.dev`, `*.storage.googleapis.com`) — anyone can obtain a
subdomain in those, so allowing one restores the open-fetcher primitive under a
longer name. The single CloudFront entry is a pinned DVIDS distribution.

**Trade-off accepted.** Images outside the list render **broken rather than
unoptimised**: unlisted feed publishers, arbitrary GNews publishers,
apex-hosted images, and campaigner-pasted `heroImageUrl` values (which
`user-campaign.ts:93` still accepts for any HTTPS host).

**Residual risk, recorded not hidden.** The optimiser still follows redirects,
so an open redirect on a *listed* publisher's domain can be chained. Only
first-party ingestion closes it.

**Deferred end state.** Fetch each resolved image once at publish through
`safe-fetch`, re-upload, serve our own URL — collapsing the list to ~5. Deferred
because it changes the resolver's return contract, adds a storage write to the
cron publish path, and still needs a backfill, i.e. a differently-shaped
regression rather than a smaller one. Rationale is written into
`next.config.ts` so it is not re-derived.

---

## 3. CSP: partial by necessity, stated as partial (P2-5)

**Decided.** `'unsafe-inline'` **stays** in `script-src`, and the test suite
says so out loud rather than omitting it. The App Router emits per-page inline
bootstrap scripts (`self.__next_f.push(...)`) whose contents differ per route,
so no static hash list or static nonce in `next.config.ts` can cover them.

Added instead the containment a static header *can* give: **`script-src-attr
'none'`**, which blocks every inline event-handler attribute — the execution
path essentially every payload in `canary-payloads.test.ts` would use given a
sanitiser bypass, and therefore most of what a nonce would buy — plus
`base-uri`, `form-action`, `object-src` and `frame-ancestors`.

**Rejected:** a static nonce (meaningless — a nonce must be per-request); and
half-implementing a per-request nonce across files the change did not own. The
exact middleware implementation is specified in `next.config.ts` for follow-up.

**Trade-off accepted.** Inline `<script>` injection remains theoretically
containable only by the sanitiser until the middleware nonce lands.

---

## 4. Client IP trust boundary (P1-5)

**Decided.** Resolve from the **right-most trusted hop**, with
`TRUSTED_PROXY_HOPS` (default 1) and `CLIENT_IP_SOURCE` (`xff` | `cf` |
`header:<name>`) making the trust boundary explicit and deployment-specific.
Resolved values are validated as IPs.

**Rejected:** the left-most `X-Forwarded-For` entry (client-controlled — the
original bug); and **auto-trusting `CF-Connecting-IP` when present**, because
off Cloudflare that header is attacker-controlled, so "trust it if it's there"
reintroduces the same defect. Nothing is trusted unless the deployment names it.

IP validation matters independently of hop logic: an unvalidated header value
goes straight into the rate-limit key, so a client could mint unlimited distinct
keys in Redis *and* the in-memory map and bypass every limit.

**⚠ Cutover requirement — and it cuts BOTH ways.** These two values must match
the number of proxies actually in front of the app at that moment. Setting them
*early* is as unsafe as setting them *late*.

| Topology | Correct values | What the wrong values do |
|---|---|---|
| Fly alone (today) | `xff` / `1` | `cf` / `2` here is unsafe twice over — see below |
| Cloudflare → Fly | `cf` / `2` | `xff` / `1` here reads Fly's hop, so every client shares one bucket |

Amended 2026-10-14. The original text above read one-directionally ("the
migration must set `cf` / `2`, without them every rate limit becomes
bypassable"), and `fly.toml` was written with the end-state values while
Cloudflare was **not** yet in front. Verified against `src/lib/rate-limit.ts`,
that interim state is unsafe in two independent ways:

1. `CLIENT_IP_SOURCE=cf` makes `cf-connecting-ip` authoritative and it is
   consulted **first** (`trustedClientIpHeader`, line 72). With no Cloudflare
   in front to overwrite that header, any client sets it freely and mints
   unlimited distinct rate-limit keys — the precise defect this section's
   "Rejected" paragraph above was written to prevent, reintroduced through
   configuration rather than code.
2. Even on fallthrough, `TRUSTED_PROXY_HOPS=2` against Fly's single appended
   hop computes `index = entries.length - 2 = 0` on a two-entry header: the
   **left-most, client-supplied** entry, which `rate-limit.ts:141` describes as
   "not evidence of anything".

So the code was right, the decision here was right, and the deployment config
applied the end-state value prematurely. Lesson recorded: a config value that is
only correct *after* a future topology change must not be committed in its
future form. `fly.toml` now carries `xff` / `1` with the flip documented inline.

**One source of truth.** These are plain configuration, not secrets. They live
in `fly.toml` `[env]`, where they are version-controlled and reviewable, and
**not** in the Fly secret store. They were briefly in both with opposite values
(2026-10-14, never deployed); the secret-store copies were removed rather than
corrected, because two sources for one security control is the more dangerous
defect. Both remain in `.env.example` for local development.

---

## 5. Session expiry and role revocation, keeping JWT (P1-4)

**Three defects, not one** — the third found by reading `@auth/core` rather than
assuming: no `maxAge` (30-day default applied); `session.expires = new Date(0)`
which nothing read; and **`iat` is re-stamped on every session read**
(`@auth/core/lib/actions/session.js:46`), so any `iat`-based expiry was dead on
arrival.

**Decided.** Keep `strategy: 'jwt'`. Add explicit `maxAge`, an own `authAt`
claim for a role-scoped **absolute** cap (donor 7d / editor 24h / admin 8h)
enforced by returning `null` from the `jwt` callback, and role revalidation
every 60s for privileged roles.

**Rejected:** **database sessions** (and therefore Better Auth's default) — per
`docs/26` §1 and `docs/28` §4, stateless JWT is what makes horizontal scale-out
free; DB sessions would add a read to every authenticated request to fix a
revocation-lag problem that a 60s revalidation window already bounds.

**Trade-offs accepted.** A privileged role carries up to 60s of revocation lag
and costs one indexed PK `SELECT` per session read per minute. A missing user
row **ends** the session (covering deleted and GDPR-erased users) while a
transient DB error **keeps** the claim and retries — logging the platform out on
a pooler blip is worse, and every privileged route hits the same DB anyway.

**Release note.** Tokens minted before this carry no `authAt` and are rejected,
so this **signs all existing sessions out once**. Intentional: those are
precisely the unexpirable, unrevokable tokens.

---

## 6. Anchored, method-aware public route table (P1-6)

**Decided.** Replace `PUBLIC_API_PREFIXES` (`startsWith`) with anchored
`^...$` patterns plus explicit methods and a reason per entry.

**Why the model, not just the bug.** `startsWith` cannot express "the collection
is public but this sub-route is not" and is method-blind. Enumerating the old
matcher found **six** route/method pairs publicly reachable that were not meant
to be; five self-authenticated in-route and so were not exploitable, but had no
middleware backstop. Two further latent defects surfaced: `/api/v1/og` matched
nothing (those routes are `route.tsx`), and `/api/v1/campaign-photos` was public
despite requiring a session.

**Decided also.** A permanent regression test walks `src/app/api` on disk,
derives each route's verbs, and fails unless every publicly-reachable
(path, method) pair is in an explicit inventory with a reason — failing in
**both** directions, so a route silently becoming public *and* the Fly liveness
probe silently becoming authenticated both break the build.

---

## 7. Unsubscribe: signed token, not auth (P1-6)

**A second unlogged bug found here:** `cron/send-newsletter` mails a **GET**
link, but the route exported only `POST` and never read the token — **the real
unsubscribe link in every newsletter answered 405 while the forgeable path
worked.**

**Decided.** Accept a session **or** an HMAC-signed token, in the byte-for-byte
format `createUnsubscribeToken` already mints, so links already in inboxes start
working with no change to the minter. Purpose+version prefixes domain-separate
campaign from newsletter signatures. Fails closed with no secret configured.

**Rejected:** requiring authentication (an unsubscribe link must work from an
email without login — CAN-SPAM §316.5, GDPR Art. 7(3)); and single-use tokens,
which need persisted redemption state and therefore a migration. Replay is
harmless: idempotent, terminal, cannot resubscribe anyone, discloses nothing.

**Trade-off accepted.** `GET` performs the unsubscribe, so a prefetching mail
client can unsubscribe someone who never clicked. The alternative needs an
interstitial page outside this change's scope, and the failure direction
(fail-quiet) is the safe one for a consent flow.

**⚠ Blocking follow-up.** Campaign unsubscribe links already in inboxes answer
**403** until the mint side (`email-adaptive.ts:1014,1055`) and the forwarding
side (`app/unsubscribe/client.tsx`) land. Ship in the same release — this is a
CAN-SPAM/GDPR exposure.

---

## 8. Generic auth failure, and closing the timing oracle too (A4)

**Decided.** Collapse `no_account`, `oauth_only`, `invalid_password` **and
`account_locked`** into one `invalid_credentials`. `account_locked` was its own
oracle: the failure counter never increments for an address with no user row, so
after five attempts an existing account says locked and a non-existent one does
not.

**The code collapse alone would have left a timing oracle** — the miss paths
returned in microseconds while a wrong password cost a full bcrypt round. Both
now run a verification against a fixed decoy hash and discard the result.

**Kept distinct:** `password_reset_required`, reachable only by a caller who
already supplied the *correct* password, so it discloses nothing to an
enumerator.

**Trade-off accepted.** Google-only users lose a targeted hint. The login page
renders "Continue with Google" unconditionally, so a working path always exists;
the generic copy should name it. **Follow-up:** `login/page.tsx:69-73,112-142`
still switches on the removed codes, so every credential failure currently falls
through to "An unexpected error occurred."

---

## 9. Cron lock-failure policy: per job, because there is no safe default (P1-11)

**Decided.** A **held** lock always skips, for every job, returning 200 with an
explicit `skipped` marker — a guard working correctly is not an error, and a
non-2xx would make the dispatcher and uptime monitors alarm during normal
operation.

A **lock backend unreachable** is per job: nine fail **closed** (they write
donations, publish public appeals, send unrecallable email, or spend on AI), and
`reconcile` alone fails **open**, because it is convergent and self-healing and
is what bounds echo-column drift to ~24h — skipping it would extend the very
drift it repairs. A test asserts `reconcile` is the only fail-open job, so
adding another breaks the build and must be argued for.

**Also decided.** The 150% overfund cap moves into SQL on the tally `UPDATE`,
which runs first and takes the row lock. A transaction alone does not stop the
breach, because the cap was checked against a per-run in-memory copy of the
campaign. This is the defence that still holds when the lock backend is
degraded.

---

## 10. AI transport: exactly one layer owns retry (P1-12)

**Decided.** Explicit `timeout` and **`maxRetries: 0`** on both OpenRouter
clients, so `call-ai.ts` alone owns retry policy; plus a per-call attempt
ceiling, a deadline so no attempt starts past it, and a **rolling per-run
attempt and spend breaker**.

**Why.** `openai@6` defaults are a 10-minute timeout and 2 internal retries
*beneath* `call-ai`'s own 8-attempt ladder — up to **24 HTTP requests per
`callAI`**, invoked 3× per story inside a 5-item loop. Attempts are now 1:1 with
requests. The breaker covers the case the per-call caps do not: a provider
erroring instantly across many `callAI` invocations. Attempts are charged
*before* the request is issued, so a provider that hangs or throws every time
still trips it. Free models are charged zero so the free pool is not throttled.

**Preserved.** No model hardcoded, no provider changed, fallback-key rotation
and the free-model ladder intact — `docs/28` §5 holds: model identity stays
config, not code.

---

## 11. Liveness and readiness are different questions (P1-13)

**Decided.** New `/api/v1/live` — shallow, process-only, imports *only*
`next/server`, no `async`, no `await`, with a test asserting its import list so
a dependency cannot be added by accident. This is the Fly probe.
`/api/v1/health` stays the deep readiness/diagnostic endpoint and **now also
checks Redis**, which it never did — correct there precisely because nothing
restarts on it.

**Rejected:** pointing Fly at `/api/v1/health` (what `docs/26` originally
said) — it calls `stripe.balance.retrieve()` and 503s on any dependency
failure, so a Stripe blip would fail the probe fleet-wide and Fly would kill
every machine. Also rejected nesting the probe under `/api/v1/health/live`,
which would have inherited the public prefix but re-coupled the two endpoints
that must not be confused.

`docs/26` §10 step 4 must name `/api/v1/live` as the probe path; `fly.toml` does
not exist yet, so there is no probe config to repoint.

---

## 12. Typography plugin registered rather than migrated (P2-1)

**Decided.** Register `@plugin "@tailwindcss/typography"`.

**Rejected:** migrating the 11 `prose` call sites to `.blog-article`. Dropping
the dependency needs `package.json`, which `CLAUDE.md` flags as CI-fatal if
desynced; the call sites already speak the plugin's vocabulary (`prose-sm`,
`dark:prose-invert`, `prose-headings:`), so migration would mean hand-rolling a
`-sm` scale; and `campaigns/[slug]/page.tsx:339` names `.prose` in
`speakable` JSON-LD, so migrating would have pointed structured data at a
selector that does not exist.

**Trade-off accepted.** +27 KB uncompressed stylesheet. `.blog-article` remains
as the blog pipeline's own class contract; collapsing the blog onto the plugin
would restyle every published post and is a separate decision.

---

## 13. Contrast fixed through tokens, not call sites (P2-4)

**Decided.** Split the amber role: a new `--color-cta-amber` (amber-700) carries
white labels on solid CTA surfaces, while the brand ink role keeps `#D97706`,
which it needs for dark mode. Light `--accent-foreground` flips to ink.

**Rejected:** darkening `--accent` itself, which would have taken
`hover:bg-accent` surfaces to 3.47:1; and editing the five CTA call sites
directly, three of which were outside the change's scope. Brand hue unchanged.

**Recorded, not fixed:** `hover:bg-accent` with no foreground class is 1.52:1 in
dark mode at four call sites — unfixable from a token, since no single amber
carries both `--foreground` and `--accent-foreground`.

---

## Open items this work did not close

| Item | Status |
|---|---|
| **P0-1b** — `info-requests/[requestId]/route.ts:263` puts info-request response documents in the **public** bucket. Same class as P0-1, missed by `docs/29`. | **OPEN, P0** |
| P0-1 production closure — operator must create the private bucket and run the migration script | **OPEN, operator** |
| Breach assessment for pre-fix documents (GDPR Art. 9) | **OPEN, owner/counsel** |
| Campaign unsubscribe links answer 403 until the mint + forward sides land (§7) | **OPEN, ship same release** |
| `login/page.tsx` copy still switches on removed auth codes (§8) | **OPEN** |
| Admin UI reads `fileUrl` directly → dead links for new uploads (§1) | **OPEN** |
| Middleware CSP nonce (§3); first-party image ingestion (§2) | **OPEN, specified** |
| `api-handler.ts:56-58` derives IP with the old forgeable pattern — logs only, but will misattribute after cutover | **OPEN** |
| Migration-blocked: `donations.receipt_status`, a `webhook_events` ledger, single-use unsubscribe tokens, `verification_documents.storage_bucket/key` | **BLOCKED on `docs/29` §2** |
| P0-6 GDPR erasure, P1-7 RLS, P1-9 index deployment, P0-2 seed purge | **BLOCKED on DB access / owner decision** |
