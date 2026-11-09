# 179 — The proxy was reverted, and nobody wrote it down

**Status:** DONE — the apex is proxied again, verified live.
**Date:** 2026-11-07

---

## 1. What was asked

> "turn on the cloudflare proxy for the apex"

Arising from `docs/178`, whose §6 experiment had just returned **nothing**: a
campaign link shared into WhatsApp produced no `whatsapp` or `facebook` line in
the crawler log, so Meta never reached the card. `docs/178` §3.1 priced the
obvious next instrument — logging the PAGE fetch — as a session decode *and*
rate limiting on the busiest public route, and refused to build it. Cloudflare's
own analytics answers the same question for nothing, and the proxy was off.

---

## 2. ⛔ The finding: the `docs/105` cutover was reverted the same evening

`docs/105` §7 records a cutover completed 2026-10-24 — `ssl` → `strict` at
`12:28:10Z`, the WAF skip rule at `12:37:43Z`, app v96 at `14:41:33Z`, then
`www` proxied and verified alone, then the apex `A` + `AAAA` read back
`proxied=true`. `docs/142` §7 found the apex grey on 2026-11-01 and concluded
that `docs/105`'s status line was stale.

**It was not merely stale. It was true, and then someone undid it.** Read from
the Cloudflare API this session, before changing anything:

| record | `proxied` | `modified_on` |
|---|---|---|
| `A lastdonor.org` | False | **2026-10-24T21:02:06.722586Z** |
| `AAAA lastdonor.org` | False | **2026-10-24T21:02:07.089250Z** |
| `CNAME www.lastdonor.org` | False | **2026-10-24T21:02:07.537635Z** |
| `A origin.lastdonor.org` | False | 2026-10-24T12:34:01.448291Z |
| `send.` / `rsend.` | False | 2026-10-15T02:00:25Z |

Three records inside **0.82 seconds**, about **6 hours 20 minutes** after the
v96 deploy that completed the cutover. That is one deliberate action, not drift.

⚠️ `modified_on` says *when* a record changed, never *what* changed, so "21:02
is when it went grey" is **[INFERRED]**. What makes it near-certain is that the
current value is `False` while `docs/105` read back `true`, so a later change
must exist, and 21:02 is the latest one.

⛔ **Nothing in `docs/` records it.** A grep across the whole directory for any
mention of disabling, reverting or grey-clouding the apex finds only
descriptions of `origin.` and the Fly hostname, which are grey by design. So
**why** it was reverted is **[UNKNOWN]**, and that is the one open risk in this
change: if it was turned off because it broke something, that reason still
applies.

### 2.1 What survived the revert, and what that tells us

Zone settings were **not** touched:

- `ssl = strict`, `modified_on` **`2026-10-24T12:28:10.428808Z`** — the exact
  timestamp `docs/105` §7.1 records, to the millisecond.
- The WAF custom ruleset still holds exactly **one** enabled `skip` rule,
  `last_updated 2026-10-24T12:37:43.38884Z`, described *"Skip security for
  signature-authed machine webhooks (docs/104)"*, covering
  `/api/v1/donations/webhook`, `/api/v1/stripe-connect/webhook`,
  `/api/v1/verification/didit/webhook` and
  **`/api/v1/donations/payhero/callback`**, skipping
  `waf, bic, securityLevel, rateLimit, hot, uaBlock, zoneLockdown`.

So the revert touched the `proxied` flag on three DNS records and nothing else.
That is what made re-flipping cheap: the dangerous preparation was all intact.

---

## 3. The preconditions, verified before touching anything

`docs/105` exists because doing this wrong keys every visitor behind one
Cloudflare datacentre into a single rate-limit bucket and locks real users out
of login. Four things had to hold.

| precondition | method | result |
|---|---|---|
| resolver deployed | read the **running machine's** config, not `fly.toml` | `080776daee2d48`: `CLIENT_IP_SOURCE='cf'`, `TRUSTED_PROXY_HOPS='1'` ✅ |
| pinned CF ranges current | `CF_IPS_LIVE_CONTRACT=1 npx vitest run src/lib/cloudflare-ips.contract.live.test.ts` | 15/15 IPv4, 7/7 IPv6, **etag unchanged since 2026-10-24** ✅ |
| `ssl=strict` | zone settings API | `strict` ✅ |
| WAF skip rule for signed webhooks | ruleset expanded by id | 1 rule, enabled, all four paths ✅ |

⛔ **The machine config, not `fly.toml`.** `[env]` is baked in at deploy time, so
the file says what the *next* deploy would apply, not what is running. Reading
the file would have been the `docs/119` `_hasCampaigns` shape: a value computed
and not actually in force.

⛔ **The pinned-range diff is the one that decides safety.** `docs/105` says
staleness "fails SAFE", and that is true of the *security* property — an
unpinned range reads as a direct request, so no forged header is ever trusted.
It is **not** safe for *availability*: requests through an unpinned datacentre
get keyed by the edge address, which is exactly the login lockout. A stale pin
is therefore a reason not to flip.

### 3.1 ⛔ I hand-rolled that check, the repo already had it, and mine was wrong

**`src/lib/cloudflare-ips.contract.live.test.ts` has existed since `docs/105`**
and does exactly this job — four tests, read-only, keyless, gated behind
`CF_IPS_LIVE_CONTRACT=1` so the build never depends on Cloudflare being
reachable. I wrote a shell diff instead, and only noticed the real one when it
appeared as `4 skipped` in the unit-test output afterwards.

Mine produced a **false alarm in the dangerous direction**: it reported a
**published-but-unpinned** range — the availability hazard, the one finding that
should stop the change — because `cloudflare.com/ips-v4` ends **without a
trailing newline**, so `cat`ting it with `ips-v6` welded `131.0.72.0/22` onto
`2400:cb00::/32`, yielding one garbage entry and two phantom absences with a
count of 21 against 22. Caught by printing the raw files beside the diff; redone
with a newline guard and two mutation controls that both fire.

The repo's own test is strictly better, and says more: it compares counts **and
the `etag`**, which came back `38f79d050aa027e3be3865e495dcc9bc` — **identical to
the value its own header records from 2026-10-24**. So Cloudflare has not
republished the list since the original cutover, which no diff of mine could
have told me.

⚠️ This is the `docs/150` lesson repeated: there, the PayHero float check
already existed and I asserted twice that nothing read it, repeating `docs/147`
without running one grep. **Look for the instrument before building one** — and
a `↓ (n skipped)` line in the test output is where the gated ones announce
themselves.

---

## 4. The change

`PATCH /zones/{zone}/dns_records/{id}` with `{"proxied":true}` on the apex `A`
and `AAAA`, 0.32s apart, then read back from a **separate** list call rather
than trusting the PATCH responses.

⛔ **Both together, not one then the other.** A split where `A` is proxied and
`AAAA` is not gives dual-stack clients either path at random, which is worse
than either consistent state and makes any measurement afterwards
non-reproducible.

⛔ **The apex only, as asked.** `www.lastdonor.org` is its own `CNAME` to
`lastdonor.fly.dev`, not an alias of the apex, so flipping the apex does not
touch it — it remains grey, and `docs/105` §7.1's "verify `www` alone first"
ordering is still available if anyone wants it proxied too. `origin.` stays grey
because being non-proxied is its job, `send.`/`rsend.` are Resend's mail records
and would break if proxied, and `lastdonor.fly.dev` is outside the zone
entirely, so `docs/66`'s cron Worker target is untouched.

---

## 5. Verification

### 5.1 The proxy is in the path, on the apex alone

Two independent DoH resolvers agree the apex now answers `104.21.11.165` and
`172.67.149.150`, and **both are inside Cloudflare's published space** (tested
against the freshly fetched list, not against memory).

| host | status | `cf-ray` | `server` |
|---|---|---|---|
| `lastdonor.org` | 200 | **present** | `cloudflare` |
| `www.lastdonor.org` | 200 | absent | `Fly/366e4bf88` |
| `origin.lastdonor.org` | 200 | absent | `Fly/366e4bf88` |
| `lastdonor.fly.dev` | 200 | absent | `Fly/366e4bf88` |

Control: `lastdonor.org/definitely-not-a-page` → **404**, so the status column
can fail.

### 5.2 ⛔ The money path reaches the app, not a challenge page

PayHero's callback now traverses the edge, so this had to be established rather
than assumed. Each of the four signed webhooks answers with **our own
application's JSON**:

| path | status | body |
|---|---|---|
| `/api/v1/donations/payhero/callback` | 200 | `{"ok":true,"data":{"ignored":"no external reference"}}` |
| `/api/v1/donations/webhook` | 400 | `{"error":"Missing stripe-signature header"}` |
| `/api/v1/stripe-connect/webhook` | 500 | `{"error":"Webhook not configured"}` |
| `/api/v1/verification/didit/webhook` | 200 | `{"ok":true,"data":{"ignored":"no session id"}}` |

No `cf-mitigated` header, no challenge body. **Control:**
`/api/v1/donations/not-a-real-webhook` → **401**, the middleware's default-deny —
so the probe discriminates a real route's own logic from a path that does not
exist. (The `payhero/callback` 200 on an empty POST and the
`stripe-connect` 500 are both pre-existing: `docs/92`'s reference-less refusal
and `docs/72`'s dead Stripe key.)

### 5.3 ✅ A proxied request keys to the VISITOR, not the edge

`docs/105` §7.4's method, which is the only way to settle the lockout question:
exhaust a 5-per-60s bucket **directly** at `lastdonor.fly.dev` (bypassing
Cloudflare), then request the **same path** through the proxied apex in the same
minute.

```
direct  lastdonor.fly.dev/api/v1/newsletter/probe-cf-trust -> 401 x5, then 429
via CF  lastdonor.org/api/v1/newsletter/probe-cf-trust     -> 429
                                                              {"code":"RATE_LIMITED"}
                                                              x-ratelimit-remaining: 0
direct  again (control: my egress IP did not move)         -> 429
```

The rate-limit key is `${ip}:${path}`, so the proxied request landing in the
**same** bucket is only possible if `cf-connecting-ip` was trusted *and* resolved
to the same address the direct path derived from the peer. A 401 there would
have meant a separate, edge-keyed bucket — the lockout.

⚠️ **The third-request control is not decoration.** If this sandbox's egress
address had changed mid-test, the proxied request would read 401 for a reason
that has nothing to do with the resolver, and the measurement would be void
while looking like a failure.

### 5.4 ⚠️ Two of my own probes were broken, and one read as a pass

**The lockout measurement first reported `200`** — not one of the three outcomes
I had written down, which is what made me look instead of interpret.
`curl -D -` through this sandbox prints the HTTPS proxy's own
`HTTP/1.1 200 Connection Established` CONNECT line **before** the site's status
line, and `grep -m1` took the first match. The site had actually answered
`HTTP/2 429` all along — the correct result.

⛔ **The same pattern silently voided the per-hostname status column**, which
reported `status=200` for all four hosts. It would have reported 200 for a 500.
Redone with `-w '%{http_code}'`, which curl computes from the real response, and
given a 404 control.

This is the third instance this session of one class: **a measuring tool
reporting a plausible number about the wrong subject** — `grep -oc` counting
lines on minified JS (`docs/175`), `cat` welding two files (§3.1 above), and now
a proxy's CONNECT line being read as the site's status. The cure each time was a
control that could fail, not more care.

### 5.5 The crawler log still fires through the edge

The reason for the whole change is not to break what `docs/178` just built:

```
13:44:31Z [crawler] whatsapp og-card subject=keisha-wallace v=3 ua="WhatsApp/2.23.20.0 A"
```

Fetched through the proxied apex, user agent intact — so Cloudflare is not
rewriting it. **Control:** the same card fetched through the proxy as
`Chrome/131` produced **0** lines. A logger that recorded everything and one
that recorded nothing would each pass half of that.

And the page, card, sitemap and robots all serve through the edge:
`/campaigns/keisha-wallace` 200 `text/html`,
`/api/v1/og/campaign/keisha-wallace?v=3` **200 `image/jpeg` 57,177 bytes**,
`/sitemap.xml` 200 `application/xml` 8,522 bytes, `/robots.txt` 200.

⚠️ `cf-cache-status: DYNAMIC` on the homepage, an API route and the probe path
alike — confirming `docs/104`'s prediction that proxying buys this site no
caching. The flip is for observability, not speed.

---

## 6. ✅ The instrument this was for

The Cloudflare GraphQL analytics API answers with the token already configured,
and `httpRequestsAdaptiveGroups` exposes `userAgent`, `clientRequestPath` and
`edgeResponseStatus` per request group. That is precisely the per-request
visibility `docs/178` §3.1 declined to build in application code, and it needs
no deploy, no middleware change and no rate limiting on a public route.

`scripts/cf-crawler-reach.sh` wraps it: given a start time it reports every
request group whose user agent matches a link-preview crawler.

✅ **Proven by positive control, on both surfaces.** A WhatsApp-UA fetch of the
CARD and a `facebookexternalhit` fetch of the **PAGE**, both issued through the
proxy, both found:

```
window start 2026-11-07T13:35:00Z - 17 request groups at the edge
2 of them from a recognised crawler

      1  /api/v1/og/campaign/keisha-wallace   WhatsApp/2.23.20.0 A
      1  /campaigns/keisha-wallace            facebookexternalhit/1.1 (+http://www.facebook.com/…
```

The second row is the whole point: **the page fetch, which the application log
structurally cannot see.**

⛔ **It cannot answer retroactively.** Analytics begins at the moment the proxy
went on (`13:41:48Z`), so the share that prompted `docs/178` — hours earlier —
is not in it. This answers the *next* share.

⚠️ **Ingestion lags, so a single read proves nothing.** The page fetch issued at
`13:45:17Z` was absent at `13:45:29Z`, absent at `13:45:50Z`, absent at
`13:47:29Z`, and present moments later. Measured lag here was over two minutes.
Read it twice a few minutes apart before concluding anything — the same rule
`docs/119` established for an ISR page and `docs/169` met three times in one day
on the sitemap.

### 6.1 Why this beats the crawler log for the open question

`docs/178` §3.1's limitation is structural: `/campaigns/[slug]` is ISR, so its
server component does not run per request and cannot log one, and the only
per-request hook above it is the middleware. Cloudflare sits in front of all of
that, so it sees the **page** fetch — which is the exact discriminator
`docs/178` could not reach:

| Cloudflare shows | conclusion |
|---|---|
| a Meta fetch of `/campaigns/<slug>` **and** of the og route | we are read end to end; the failure is on their side |
| a fetch of the page only | Meta reads our HTML and extracts no `og:image` |
| no Meta request at all | Meta never reaches us; the problem is upstream of our origin |

---

### 6.2 ⛔ The first version of that script silently dropped the row that matters

Its query asked for three dimensions — `userAgent`, `clientRequestPath` and
`edgeResponseStatus` — and reported **1** crawler where there were **2**. Run
back to back against the same window at the same instant:

| dimensions | groups | crawlers found |
|---|---|---|
| `clientRequestPath`, `userAgent` | 17 | **2** |
| + `edgeResponseStatus` | 15 | 1 |

`httpRequestsAdaptiveGroups` is a sampled dataset, and asking for a third
dimension **drops groups** — more dimensions returning fewer rows, which is
backwards from how a GROUP BY behaves and is why it is written down here rather
than left to be met again. The row it dropped was the `facebookexternalhit`
page fetch.

⚠️ Had that shipped, it would have reported *"no Meta fetch"* for a window in
which Meta demonstrably did fetch — a false negative of exactly the kind this
entire investigation keeps generating. It was caught only by running a second,
simpler query beside it and noticing the counts disagreed.

So the script now carries an **anti-vacuity guard**: on zero groups it refuses
to answer at all and says so, because *"no crawler reached us"* and *"this query
saw nothing"* look identical in output and mean opposite things. Verified by
execution — a window in 2027 exits **3** with the warning, while the real window
exits 0 with both rows.

### 6.3 ⛔ THE ANSWER, and my own instrument gave me the wrong one first

**Meta fetches us, end to end.** On 2026-11-09 the owner shared
`/campaigns/danielle-sutton` — a URL Meta had never seen — and two independent
systems recorded it:

```
# the application log (docs/178's own logger)
2026-11-09T00:50:39Z [crawler] whatsapp og-card subject=danielle-sutton v=3 ua="WhatsApp/2.2642.101 W"

# Cloudflare analytics, same window
1  /campaigns/danielle-sutton           WhatsApp/2.2642.101 W     HTTP 200
1  /api/v1/og/campaign/danielle-sutton  WhatsApp/2.2642.101 W     HTTP 200
```

So WhatsApp fetched **the page AND the card**, and we answered **200 on both**.

⚠️ **That status claim needed a second query, and my first one could not have
supported it.** The obvious query filters by `clientRequestPath_like` and
groups by path and status — which returned `6 × 200` on the page, `2 × 200` on
the card and **`1 × 301`** on the page. Those are aggregated across *every*
user agent, so nothing in them says which agent got the 301; the WhatsApp
client could have been it. Re-asked with `userAgent_like: "%WhatsApp%"` and
grouped by `{userAgent edgeResponseStatus}`:

```
2  HTTP 200  WhatsApp/2.2642.101 W      <- the real client, both its requests
1  HTTP 200  WhatsApp/2.23.20.0 A       <- my own synthetic probe
```

Now it is established rather than inferred. **Filter by the subject you are
making a claim about, not by the path it happens to share with everything
else.**

That closes the question `docs/178` was built to answer — *"did Meta fetch us
and reject what it got, or did it never fetch us at all?"* — after thirteen
refuted hypotheses: **it fetches us, and the failure is downstream of our
origin.** `docs/178` §5 and §6 are amended.

⛔ **But I reported the opposite first, and the cause was this script.** The
broad pass asked for `limit: 200` with `orderBy: count_DESC`. A crawler fetch
has `count: 1`, so it sorts **last** and the limit cuts it off **first**. The
run returned exactly 200 groups and I reported *"still no Meta fetch"*; the
real figure over the same window was **982 groups containing 4 preview
fetches**, two of them the real client above.

⚠️ **The only tell was that the group count equalled the limit I had chosen** —
a number I wrote, matched by a number the API returned. Nothing in the output
said "truncated". This is the same class as §6.2's dimension-dropping bug:
**two independent silent-undercount defects in one 60-line script**, both of
which report a confident, precise, wrong negative.

So the script now runs **two passes that must agree**: a broad pass with a
**truncation guard** (it refuses to answer when the group count reaches the
limit) and a **targeted** server-side `userAgent_like` query per preview
crawler, which cannot be crowded out by volume at all. Both guards are proven
to fire — `CF_BROAD_LIMIT=200` exits **4**, an empty window exits **3**, and
crippling the broad regex while leaving the targeted pass intact exits **5**.

### 6.4 ⛔ `userAgent_like` is CASE-SENSITIVE, which was the second false negative

The targeted pass was written with an all-lowercase token list, and it reported
**1** preview group where the broad pass found 4. Measured by paired query:

| filter | groups |
|---|---|
| `userAgent_like: "%whatsapp%"` | **0** |
| `userAgent_like: "%WhatsApp%"` | 2 |
| `userAgent_like: "%googlebot%"` | **0** |
| `userAgent_like: "%Googlebot%"` | 5 |

Eleven of the twelve tokens matched nothing, which reads exactly like *"no
preview crawler came"*. ⚠️ And the one that worked — `facebookexternalhit`,
genuinely lowercase in the real agent string — **masked the cause**, because a
list where one entry returns data looks like a list that works.

⚠️ **The guard added for §6.3's mistake is what caught it.** Nothing else in
the run would have: both numbers were plausible, and the lower one was the one
I was predisposed to believe. The tokens now carry the real capitalisation from
`crawler-log.test.ts`'s live agent strings.

⛔ **The two cross-check directions mean different things and no longer share an
exit code.** *Targeted finds what broad missed* is the serious one — it is the
§6.3 failure mode — so the script refuses to answer. *Broad finds what targeted
missed* means a token's casing is wrong, and since the broad pass is now
truncation-guarded its answer still stands, so that warns and names the token.

⚠️ Also: group counts depend on the dimensions requested. The same two WhatsApp
requests are 2 groups under `{clientRequestPath userAgent}` and 1 under
`{userAgent}` alone. That is aggregation, not a discrepancy — compare like with
like before calling it one.

### 6.5 ⚠️ And the experiment `docs/178` §6 prescribed is confounded on a re-share

Before the `danielle-sutton` share, the owner re-shared a URL Meta had already
seen and the log stayed empty — which I began to read as *"Meta never reaches
us"*. That inference does not hold, and this repository already said why:

- `docs/142`: *"`facebook-rescrape.ts` exists solely to ask Facebook to fetch
  those URLs."*
- `docs/112` §9.2: *"`CARD_VERSION` 2 → 3 changes the `og:image` URL but does
  **NOT** force a re-scrape."*

Meta caches scraped Open Graph data **per URL**, so no fetch on a re-share is
*expected*. `docs/178` §6's table offered *"nothing → Meta never reached the
card"* with no second reading, and that is a defect in the doc. The test only
discriminates on a URL Meta has never seen — which is why the
`danielle-sutton` share settled it and the `keisha-wallace` re-share could not.
⚠️ `?x=1` cannot substitute: `og:url` carries the clean URL and the share sheet
strips the parameter (`docs/178` §2.1).


## 7. ⛔ What was NOT checked

- **Why the proxy was reverted on 2026-10-24.** [UNKNOWN], and it is the one
  risk here. If it was turned off deliberately, that reason still applies. The
  change is reversible by setting `proxied` back to `false` on the two records.
- **Whether any of this fixes the WhatsApp preview.** It changes nothing about
  what we serve. It is an instrument, not a fix.
- **`www` was left grey.** The apex was what was asked for. `www` therefore
  serves direct from Fly while the apex goes through Cloudflare — two ingress
  paths for the same site, which is the condition `docs/105`'s resolver is built
  to handle per request, but it has not been re-measured on `www` today.
- **Long-running routes through the edge.** Cloudflare imposes a 100s ceiling
  (`docs/26`, `docs/66`). Nothing user-facing was measured above 0.8s, and cron
  targets `lastdonor.fly.dev` outside the zone, but no route was deliberately
  driven past 100s.
- ~~**Bot Fight Mode and the managed ruleset's behaviour toward real
  crawlers.**~~ ✅ **Answered by the §6.3 fetch**: a real WhatsApp client got
  **HTTP 200** on the page and **200** on the card through the edge, so nothing
  Cloudflare runs challenged it. ⚠️ That is one client on one URL on one day —
  not a general guarantee for every preview agent.
- ⛔ **WHETHER THE PREVIEW ACTUALLY RENDERED.** This is now the whole open
  question and it cannot be answered from our side at all. We know Meta fetched
  the page and the card and got 200 on both (§6.3); we do **not** know what it
  then displayed. The owner has not reported what the `danielle-sutton` share
  looked like. **Ask that first in the next session** — the answer decides
  everything:
  - **card renders** → the defect was only ever Meta's stale cache of the
    already-shared URLs, and the fix is a re-scrape, not code.
  - **card still blank** → Meta reads a 200 page and a 200 JPEG and renders
    nothing, which is a new and much narrower problem than `docs/178` was
    chasing.
- **Whether a re-scrape would heal the old URLs.** `facebook-rescrape.ts`
  exists for exactly this and needs `FACEBOOK_ACCESS_TOKEN`, which is **not**
  among the 32 secrets on Fly — so it has never been run. Owner action.
- **Every platform but WhatsApp.** The §6.3 evidence is one WhatsApp Web
  client. X, Slack, Telegram, LinkedIn, Signal and iMessage each hold their own
  cache and none was tested.
