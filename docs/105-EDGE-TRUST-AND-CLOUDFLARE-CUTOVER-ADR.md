# 105 — Edge trust, and the Cloudflare cutover that was staged wrong

**Date:** 2026-10-24
**Status:** code DEPLOYED; proxy flip recorded in §7
**Supersedes:** the staged cutover block in `fly.toml` (deleted), the `cf`/`2`
pairing rule in `test/security/client-ip-trust-boundary.test.ts` (rewritten),
and the sequencing advice in `docs/104` §3
**Read with:** `docs/26` §1 (topology), `docs/32` §4 (one source of truth),
`docs/104` §3 (what was prepared), `docs/44` (the session-read limiter tier),
`docs/85` (why an IP limit does not protect a six-digit code)

---

## 1. What was about to happen, and why it was wrong

The task was the last step of the Cloudflare cutover: apply the staged
`CLIENT_IP_SOURCE = "cf"` / `TRUSTED_PROXY_HOPS = "2"` block in `fly.toml`,
deploy it, then turn the orange cloud on.

The staged block argued its own ordering carefully:

> Deploying `cf`/`2` first is safe: `cf-connecting-ip` is simply absent until
> the proxy is on, and the XFF fallback computes `index = max(0, 1 - 2) = 0`
> on Fly's single-entry header, which is still the real client.

**The first clause is false, and it is false permanently, not just during a
cutover window.** `cf-connecting-ip` is absent on requests that come *through*
Cloudflare before the flip — but that is not the set of requests that matters.
Two hostnames reach this origin without touching Cloudflare, and both are
deliberate:

| Hostname | Why it bypasses Cloudflare | Can it be removed? |
|---|---|---|
| `lastdonor.fly.dev` | A Fly-assigned hostname, outside the `lastdonor.org` zone entirely | No — the cron Worker targets it to dodge Cloudflare's 100s proxy ceiling (`docs/66`) |
| `origin.lastdonor.org` | Created grey-cloud on purpose (`docs/104` §3.3) | No — that is its entire job |

So after the flip, a caller reaches `https://lastdonor.fly.dev/api/v1/auth/...`
with `cf-connecting-ip: <anything>`, and the old resolver returned it:

```ts
const headerName = trustedClientIpHeader();   // 'cf-connecting-ip'
if (headerName) {
  const direct = normaliseIp(headers.get(headerName));
  if (direct) return direct;                  // ← no evidence required
}
```

That value becomes the rate-limit key. Rotate it per request and every
IP-keyed control is gone: the 10-per-60s sign-in limiter (`docs/32`), the `sms`
tier that is the only thing in front of a six-digit phone code (`docs/85`), and
the IP companion to PayHero's per-phone abuse guard (`docs/92`).

**[VERIFIED]** by mutation: restoring the unconditional trust fails four of the
new tests in `src/lib/rate-limit.client-ip.test.ts`, including a behavioural one
that drives `checkRateLimitAsync` through 8 requests against a 5-per-60s route
while rotating `cf-connecting-ip`, and gets no 429 at all.

## 2. The deeper reason: a hop count cannot describe two ingress paths

`TRUSTED_PROXY_HOPS` assumes every request traverses the same number of
proxies. The cutover breaks that assumption by construction:

| Path | `X-Forwarded-For` as we receive it | Appended hops |
|---|---|---|
| Visitor → Cloudflare → Fly → app | `<visitor>, <cf-edge>` | 2 |
| Caller → Fly → app | `<caller>` | 1 |

Both numbers are simultaneously correct, so no single setting is:

- **`2`** → on a direct hit, `index = max(0, entries.length - 2)` lands on the
  caller's own invented prefix. `rate-limit.ts` itself calls that value "not
  evidence of anything".
- **`1`** → on a proxied request, `index = entries.length - 1` returns the
  **Cloudflare edge address**. Every visitor through one Cloudflare datacentre
  then shares one login bucket, and real users are locked out. This is the
  outage `docs/104` §3 correctly predicted — it just prescribed the other
  unsafe value as the cure.

The question the configuration was trying to answer ("how many proxies does
this deployment have") has no answer. The useful question is per request: **did
*this* request come through the edge?**

## 3. The decision

`CLIENT_IP_SOURCE=cf` now means *Cloudflare may be in front of some requests*,
and the resolver decides per request from the one value a caller cannot choose:
**the address the request arrived from.**

```
peer = right-most X-Forwarded-For entry      (Fly appends it; a caller's
                                              invented prefix sits to its left)
if peer ∈ Cloudflare's published ranges  →  trust CF-Connecting-IP
else                                     →  the key IS the peer; ignore
                                            CF-Connecting-IP entirely
```

- `src/lib/cloudflare-ips.ts` — the published ranges, pinned, plus containment.
- `src/lib/rate-limit.ts` — `peerAddress()` and `cloudflareAwareClientIp()`.
- `TRUSTED_PROXY_HOPS` is **not read** in `cf` mode, and stays `"1"` because
  that is the correct value for the direct path, which always exists.

Why the right-most XFF entry is sound evidence: Fly's proxy appends the peer it
received the request from, and this codebase has relied on exactly that since
the P1-5 audit — the existing `xff` right-most-hop rule *is* this value. So no
new trust is introduced. `fly-client-ip` is consulted only when a request
arrives with no `X-Forwarded-For` at all; a caller who sends their own copy
produces a comma-joined header, which `normaliseIp` rejects, so the forgery
degrades to `UNKNOWN_CLIENT_IP` (one shared bucket) rather than to the forged
value. **[VERIFIED]** by a test.

### What this buys, stated plainly

Both failure modes close at once, with no window to sequence and nothing to
remember on flip day:

| | via Cloudflare | direct to origin |
|---|---|---|
| key | the visitor (from `CF-Connecting-IP`) ✅ | the caller's real address ✅ |
| forgeable? | no — Cloudflare overwrites the header | no — the peer is not a header the caller sets |

## 4. Rejected alternatives

**Keep `cf`/`2` and accept the direct-hit hole.** Rejected: it is not a
transient cutover risk, it is permanent, and it defeats the only control in
front of a six-digit SMS code.

**Block direct access to the origin instead.** The clean fix in principle —
Cloudflare Authenticated Origin Pulls, or a Fly-level deny of everything but
Cloudflare's ranges. Rejected for now because the cron Worker must reach
`lastdonor.fly.dev` directly (`docs/66`: Cloudflare's 100s proxy ceiling would
kill `reconcile`), and `origin.lastdonor.org` exists precisely to be a
non-proxied path. Locking the origin down means first giving the Worker another
way in. Worth doing later; it is defence in depth, not a substitute for §3,
because a resolver that trusts a forgeable header is wrong even behind a
perfect firewall.

**A shared secret header set by a Cloudflare Transform Rule.** Works, and does
not go stale. Rejected as the primary mechanism: if the rule is ever deleted or
edited, *every* proxied request reads as direct and gets keyed by the
Cloudflare edge — the login lockout of §2, triggered by a dashboard click in a
product with no review on rule changes. The IP-range check fails the other way
(see §5).

**`header:cf-connecting-ip`.** Identical hole, with the escape hatch's name on
it. The mode is kept for an edge whose address space cannot be enumerated, and
its doc comment now says it is unsafe where the origin is reachable — which it
is here.

**Bumping the TypeScript target to ES2020 for BigInt.** The first CIDR
implementation used BigInt literals, which do not compile at this project's
`ES2017` target. Rejected: changing a global compiler target to suit one file is
a large blast radius for nothing. An IPv4 address fits exactly in a double
(max 4,294,967,295) and IPv6 is held as eight 16-bit groups, so nothing is
approximated.

## 5. Staleness, and which way it fails

**[VERIFIED 2026-10-24]** `https://api.cloudflare.com/client/v4/ips` answered
`success: true` with **15 IPv4 and 7 IPv6** prefixes,
`etag: 38f79d050aa027e3be3865e495dcc9bc`. The pinned constants match it exactly
— checked by `src/lib/cloudflare-ips.contract.live.test.ts`, which is skipped
unless `CF_IPS_LIVE_CONTRACT=1`:

```
CF_IPS_LIVE_CONTRACT=1 npx vitest run src/lib/cloudflare-ips.contract.live.test.ts
  ipv4: 15 live, 15 pinned, etag=38f79d050aa027e3be3865e495dcc9bc
  ipv6: 7 live, 7 pinned
  4 passed
```

Cloudflare adds ranges rarely but does add them. If the pin goes stale, a
request from a *new* Cloudflare range reads as a direct hit and gets keyed by
the edge address: it **over-counts** (visitors behind that one new edge share a
bucket) and can never **under-count**, so staleness cannot be used to escape a
limit. That asymmetry is why the list is pinned rather than fetched at runtime
— a runtime fetch would put a third party in the path of every rate-limit
decision, and its failure mode would be whatever the cache did.

It is also why the contract test is **not** part of the normal run: it would
make the build depend on Cloudflare being reachable, to guard against something
that is not an emergency.

⚠️ **`1.1.1.1` is not a Cloudflare edge.** It is their public DNS resolver and
is absent from the proxy ranges, so a request from it did not come through the
reverse proxy. The most tempting wrong answer, and a test pins it.

## 6. The tests, and what each one would have caught

| Test | Catches |
|---|---|
| `IGNORES CF-Connecting-IP on a request that did not come through Cloudflare` | the §1 hole |
| `ignores a forged XFF prefix as well, on a direct hit` | the `2` half of §2 |
| `does not consult TRUSTED_PROXY_HOPS in cf mode` | someone "fixing" the cutover by tuning the number again |
| `a real visitor through Cloudflare is still bucketed per visitor, not per edge` | the `1` half of §2 — the login lockout |
| `a forged CF-Connecting-IP cannot reset the limit WITH CLIENT_IP_SOURCE=cf either` | the behavioural form of §1 |
| `treats an IPv4-mapped IPv6 address as the IPv4 address it is` | a v4 edge arriving as `::ffff:104.16.0.1` reading as direct → login lockout |
| `declares the hop count for DIRECT ingress, which is always one` (fly.toml) | the config drifting back to `2` |

**The pre-existing test that did not catch it, and why.** The old suite had
`a forged CF-Connecting-IP cannot reset the limit when CLIENT_IP_SOURCE is
unset` — and the qualifier is the whole problem. The cutover *sets* it. Nobody
tested the configuration the cutover was going to produce.

The old `prefers CF-Connecting-IP when CLIENT_IP_SOURCE=cf` used `172.16.0.1`
— a **private** address — as the stand-in for the Cloudflare edge. That it
passed with a peer Cloudflare could never have is the tell: the rule never
looked at where the request came from.

⚠️ **The transferable lesson.** `test/security/client-ip-trust-boundary.test.ts`
was written *specifically* to prevent a bad Cloudflare cutover, and it encoded
`cf → 2` as the safe target. A test that asserts the wrong end state is worse
than no test: it would have gone green on the unsafe change and been cited as
evidence. Both halves of a security control — the resolver and the config that
selects its mode — were self-consistent and jointly wrong.

Mutation results, each run and each killed:

| Mutation | Result |
|---|---|
| `if (peer && isCloudflareIp(peer))` → `if (peer)` (the old behaviour) | 4 tests fail |
| drop the IPv4-mapped branch | 1 test fails |
| `(0xffff << (16 - r)) & 0xffff` → `0xffff >>> (16 - r)` | 1 test fails |

## 7. The cutover, as performed

Completed 2026-10-24. Everything below was measured, not inferred.

### 7.1 Sequence and timestamps

| Step | Result |
|---|---|
| `ssl` `full` → `strict` | `12:28:10Z`, read back from the API |
| `origin.lastdonor.org` grey-cloud, Fly cert | issued, verified 401 on a cron route |
| WAF skip rule, four signed webhooks | 1 rule in `http_request_firewall_custom` |
| **App deployed** | **v96**, `14:41:33Z`, machine `d8d1116b5161d8` |
| **Cron Worker redeployed** | version `535b71e6-29ef-4d98-9983-6d609112c28a` |
| **`www` proxied** | verified alone first, before the apex |
| **Apex `A` + `AAAA` proxied** | both `proxied=true` |

Final record state — the split is the whole point, so it is recorded in full:

```
A     lastdonor.org          proxied=True     AAAA  lastdonor.org          proxied=True
CNAME www.lastdonor.org      proxied=True
A     origin.lastdonor.org   proxied=False    AAAA  origin.lastdonor.org   proxied=False
CNAME send.lastdonor.org     proxied=False    CNAME rsend.lastdonor.org    proxied=False
```

`send.`/`rsend.` are Resend's mail records and would break if proxied. `origin.`
stays grey because being non-proxied is its job.

### 7.2 ⚠️ Two build traps, both costing a cycle

**Fly's default depot builder cannot be used from this sandbox.** It fails with
`tls: failed to verify certificate: x509: certificate signed by unknown
authority`, because its gRPC client does not read `SSL_CERT_FILE` and the egress
proxy's CA is therefore invisible to it. Setting `SSL_CERT_FILE` and
`SSL_CERT_DIR` changed nothing. **`--depot=false`** uses Fly's own remote
builder and works.

**`--build-only` does not push the image.** It tags
`registry.fly.io/lastdonor:deployment-…` on the builder, which reads like a
push, and a later `--image` release then fails with `Could not find image`.
An unreleased build image is also garbage-collected within the hour, so an
image built "ready to release later" may simply be gone. Either pass `--push`,
or just run the full `flyctl deploy --depot=false` — with warm layers the whole
thing took under two minutes.

### 7.3 The deploy, verified

The discriminating probe of `docs/104` §5.1a, now the right way round:

| | before v96 | after v96 |
|---|---|---|
| `GET /api/v1/cron/refresh-fx-rates` | 404 | **401** |
| `GET /api/v1/cron/update-phases` (control: exists) | 401 | 401 |
| `GET /api/v1/cron/definitely-not-a-real-job-xyz` (control: absent) | 404 | **404** |

`flyctl config env` confirms `CLIENT_IP_SOURCE = cf` and
`TRUSTED_PROXY_HOPS = 1` were applied.

### 7.4 ✅ The security property, proven against production

Unit tests prove the resolver; these prove the deployment. Both halves of §3
were measured on the live system.

**Half one — a forged header is ignored.** Eight `GET`s to a 5-per-60s path,
straight at `lastdonor.fly.dev` (which bypasses Cloudflare), rotating
`cf-connecting-ip` on every request:

```
req 1..5  cf-connecting-ip=203.0.113.{1..5} -> 401
req 6..8  cf-connecting-ip=203.0.113.{6..8} -> 429
```

The limiter bit at the sixth request. Under the old resolver each forged value
was its own bucket and **no 429 could ever appear**.

**Half two — a proxied request keys to the visitor, not the edge.** This is the
login-lockout failure mode, and it cannot be settled by reasoning about
headers. Exhaust the bucket on one path directly, then request **the same
path** through the proxied hostname in the same minute:

```
direct  lastdonor.fly.dev/api/v1/newsletter/probe-cf-trust  -> 401 x5, then 429
via CF  www.lastdonor.org/api/v1/newsletter/probe-cf-trust  -> 429   (cf-ray present)
```

The proxied request landed in **the same bucket**. Since the rate-limit key is
`${ip}:${path}`, that is only possible if `cf-connecting-ip` was *trusted* on
the Cloudflare path — so the edge address serving us is inside the pinned
ranges — *and* resolved to the same address the direct path derived from the
peer. A 401 there would have meant a separate, edge-keyed bucket.

### 7.5 What the flip actually bought, and what it did not

**[VERIFIED]** `cf-cache-status` across ten routes:

| Route | `cache-control` | `cf-cache-status` |
|---|---|---|
| `/`, `/campaigns`, `/blog` | `private, no-cache, no-store` | DYNAMIC |
| `/donate` | `s-maxage=300` | DYNAMIC |
| `/login`, `/about` | `s-maxage=31536000` | DYNAMIC |
| `/api/auth/session` | `private, no-cache, no-store` | DYNAMIC |
| `/robots.txt` | `public, max-age=14400` | EXPIRED |
| `/icon.svg` | — | MISS |

No HTML and no session response is cached at the edge, which is the thing most
worth checking on a proxy cutover: a cached `/api/auth/session` would hand one
visitor's identity to the next.

⚠️ **And a new finding: `s-maxage` on an HTML route is inert at the edge too.**
`/login` and `/about` send `s-maxage=31536000` and are still DYNAMIC, because
Cloudflare's default cache rules select by **file extension** and an extensionless
HTML path is never eligible. So those directives join the inert-`revalidate`
family of `docs/104` §4 and `docs/88` F14 — they would need an explicit Cache
Rule to do anything. Not added: caching this app's HTML needs a deliberate
decision about which routes are safe, and `docs/104` already records that
almost none are.

So the flip buys WAF, DDoS absorption and edge TLS. It buys **no HTML caching**,
exactly as `docs/104` predicted.

### 7.6 Everything else, checked after the flip

| Check | Result |
|---|---|
| `/`, `/campaigns`, `/blog`, `/donate`, `/login`, `/about` | all 200, 0.37-0.87s |
| `/api/v1/live`, `/sitemap.xml`, `/robots.txt` | 200 |
| `/api/v1/health` | 503 `degraded` — the dead Stripe rail (`docs/72`), unchanged |
| `/api/auth/session`, `/api/auth/csrf`, `/api/auth/providers` | 200; session body `null`, uncached |
| `/s/<bogus-token>` | 302 (share loop intact, `docs/57`) |
| The four signed webhooks through Cloudflare | app responses (400 / 500 / 200 / 200), **no** Cloudflare challenge — the WAF skip rule works |
| `origin.lastdonor.org`, `lastdonor.fly.dev` | **no `cf-ray`** — still bypass Cloudflare, so the 100s proxy ceiling still does not apply to cron (`docs/66`) |
| Fly certs for `lastdonor.org`, `www.`, `origin.` | all Issued; direct TLS to the origin IP per hostname gives `ssl_verify=0`, which is what `ssl=strict` requires |

### 7.7 The Worker, verified twice

Its own log, across a tick after the redeploy:

```
"*/5 * * * *" @ 10/24/2026, 2:55:03 PM - Ok
  (log) [cron] 2026-10-24T14:55:03.916Z dispatching 1: update-phases
  (log) [cron] update-phases ok 200
```

and independently from the database, for a `minute % 30 === 0` tick:
`cron.publish_campaigns` at **15:00:05Z**.

Also confirmed it still has **no HTTP surface**: the `workers.dev` URL wrangler
prints answers 500, because no `fetch` handler is exported (`docs/66`).

### 7.7a ✅ `refresh-fx-rates` fired — RESOLVED 2026-10-25

The one thing §7.7 left open. It could not be checked by hand: its `isDue` is
`minute === 0 && hour === 2` and the Worker exports no `fetch` handler, so the
only way to settle it was to wait for 02:00 UTC and read production.

**[VERIFIED 2026-10-25T03:24Z, read from the production database]**

```
event_type=cron.refresh_fx_rates | severity=info | timestamp=2026-10-25 02:00:05.845806+00
```

Exactly **one** run, which is right for a daily job, and the snapshot it wrote:

| | |
|---|---|
| key | `fx:usd-rates:v1` |
| rates stored | **151** |
| `asOf` | `2026-10-25T00:02:31.000Z` (3.4h old, against `MAX_FX_AGE_HOURS` = 48) |
| `fetchedAt` | `2026-10-25T02:00:05.824Z` |
| provider | `open.er-api.com` (the primary; no fallback needed) |
| base | `USD` |

151 of 152 — the same count the local end-to-end run against the live
providers produced, so the provider's coverage of `WORLD_CURRENCY_EXPONENTS`
is stable rather than coincidental. Spot-checked: `USD 1`, `KES 129.836385`,
`UGX 4113.321463`, `IQD 1517.423635` — both collectable currencies present,
and two of the zero-decimal/ISO-disputed ones from `docs/103` carried through.

Two things rule out a false positive. `fetchedAt` (02:00:05.824Z) matches the
audit row's timestamp (02:00:05.845Z) to **21ms**, so the row was written by
that run and not by anything else. And the control query — every `cron.%` event
in the last 36 hours — returns six distinct jobs with sane counts
(`ingest_news` 69, `publish_campaigns` 69, `update_phases` 9, `fetch_news` 6,
`reconcile` 1, `refresh_fx_rates` 1), so the filter is not silently matching
nothing.

So the Worker bundle was never the problem, and **every job in `CRON_SCHEDULE`
is now observed firing in production.** The FX display path (`docs/102`,
`docs/104`) is live end to end: a snapshot is refreshed daily, it covers 151
currencies, and the reader accepts all of them.
