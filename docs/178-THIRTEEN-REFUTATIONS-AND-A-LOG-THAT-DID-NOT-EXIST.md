# 178 — Thirteen refutations, and the log that did not exist

**Status:** BUILT and DEPLOYED — v181 (key), v182 (model rung), v183 (crawler log).
**Date:** 2026-11-06

---

## 1. What was reported

A campaign link shared into WhatsApp rendered **no card**: the title was the
bare domain `lastdonor.org`, the description was the URL itself, and there was
no image.

⚠️ **That is not a stale card, and the distinction set the whole investigation.**
A stale cache would have shown the *old* card — `docs/177`'s sideways
photograph with the oversized money line. Showing domain-plus-URL-plus-nothing
is what WhatsApp renders when it holds **no Open Graph data at all**.

---

## 2. Thirteen hypotheses, each measured against production

| # | hypothesis | measurement | verdict |
|---|---|---|---|
| 1 | og tags too deep in the HTML | `og:title` at byte **5,627**, `</head>` at 11,970. Meta's real limit is **1 MB** | ⛔ |
| 2 | Cloudflare/WAF challenging the crawler | `server: Fly/…`, **no `cf-ray`** — the edge is not in the path (`docs/142`) | ⛔ |
| 3 | page too slow | TTFB **0.25–0.65s** over five fetches, against a ~10s budget | ⛔ |
| 4 | cloaking / UA-dependent output | identical `og:image` for 4 crawler agents **and for no UA at all** | ⛔ |
| 5 | **gzip/deflate missing** — a Meta hard requirement | gzip **22,587** / deflate **22,575** / br, all honoured | ⛔ |
| 6 | **Next 15 streamed metadata / `htmlLimitedBots`** | `og:title` at byte **5,627 for every UA**, no `__next_metadata_boundary__` | ⛔ |
| 7 | Accept-header negotiation | four variants, always HTML carrying `og:image` | ⛔ |
| 8 | **`Range` requests** — Meta calls this out explicitly | header **ignored**, full body, 200 — exactly what Meta permits | ⛔ |
| 9 | the card route too slow | **cold 0.69s**, warm 0.42–0.80s | ⛔ |
| 10 | card cache headers wrong | `public, max-age=86400`, `content-length` present | ⛔ |
| 11 | **stale or wrong AAAA record** | DNS AAAA `2a09:8280:1::1b6:984b:0` **= Fly's dedicated IPv6 exactly** | ⛔ |
| 12 | **invalid TLS on the IPv6 path** | SSL Labs grades the **IPv6 endpoint A+** | ⛔ |
| 13 | duplicate `og:image` in the RSC payload | sources say the **first** wins, and ours is in `<head>`; nextjs.org duplicates identically | ⛔ |

### 2.1 ⚠️ Three of my own claims were wrong and are corrected here

- **The TLS reading was VOID.** My first `openssl s_client` returned
  `CN = Egress Gateway … Anthropic`: **this sandbox MITMs TLS**, so I was
  inspecting the agent proxy, not production. Any TLS observation made from
  here is about the proxy. Redone externally through SSL Labs.
- **The duplicate-tag "refutation" was weak.** I declared it refuted because
  nextjs.org does the same — an assumption, since I never checked that
  nextjs.org's previews work. It is now refuted on better grounds: the sources
  that address ordering say the **first** tag wins.
- **The `?x=1` cache-bust suggestion was unsound**, and the owner's test
  exposed it: `og:url` carries the **clean** URL, and the share sheet stripped
  the parameter anyway, so the attempt never ran.

### 2.2 What the research settled, and what it could not

Meta's [Webmasters](https://developers.facebook.com/docs/sharing/webmasters/)
and [Crawler](https://developers.facebook.com/docs/sharing/webmasters/crawler/)
docs give three numbers the third-party guides get wrong: the limit is **1 MB**
not 300 KB, **gzip and deflate are mandatory**, and `Range` must either be
honoured correctly or ignored. We satisfy all three.

⛔ What no source could settle: **whether WhatsApp builds the preview on the
sending device or on Meta's servers.** Third-party sources contradict each
other outright, Meta documents none of it, and the owner tested on WhatsApp
Web — the half nobody agrees about.

---

## 3. The gap that was ours: no access log

Thirteen refutations left exactly one question, and it is not answerable from
outside:

> Did Meta fetch us and reject what it got, or did it never fetch us at all?

[VERIFIED] production keeps **no access log** — `flyctl logs` carries none, and
`docs/142` established the same with its own probe's user agent absent as the
control. So the two cases are indistinguishable. That is `docs/123`'s shape
exactly: *a silent path cannot be told from one that never ran.*

### 3.1 What the log observes, and what it cannot

`src/lib/crawler-log.ts`, called from both OG routes.

| observation | meaning |
|---|---|
| a line appears | the crawler read our HTML, parsed `og:image`, and came back for the bytes |
| no line at all | it never got that far — either it never fetched the page, or it extracted nothing |

⛔ **The PAGE cannot be observed without a regression, and that was checked
rather than assumed.** `/campaigns/[slug]` is ISR (`revalidate = 60`), so its
server component does not run per request. The only per-request hook above it
is the middleware — and `middleware.ts` is `export default auth(…)` and calls
`checkRateLimitAsync` as its **first statement**, so adding `/campaigns/:path*`
to its matcher would put a session decode *and rate limiting* on the busiest
public route. `docs/169` records that no public page is rate limited today. A
log line is not worth that.

### 3.2 ⛔ No personal data, by construction

No IP is read, and a test forbids `getClientIp` and the three IP headers in the
module. `docs/140` PART B declined to populate `actor_ip` across 27 admin
routes because nothing displays it, nothing purges it, erasure never reaches it
and `/privacy` discloses no IP collection — that reasoning binds harder on a
public route than on an admin one.

A user agent is written **only after a known bot has matched**. An ordinary
visitor produces no line at all, because `identifyCrawler` answers `null` and
the caller returns. That is a property of the control flow, not a promise in a
comment — and the mutation that makes the matcher answer for everyone fires two
tests.

### 3.3 Why `console`, not an audit row

An `audit_logs` row per hit is an unbounded write on a route a crawler may call
at will, against `docs/87`'s three-query cap. The Fly log is readable — it
answered twice during this very diagnosis — and costs nothing. This is a
diagnostic for a live question, not a permanent record.

### 3.4 ⛔ The bug the log found in itself

Telegram identifies as **`TelegramBot (like TwitterBot)`** — the string
*contains* `twitterbot`. With `twitter` ordered first, **every Telegram fetch
was recorded as Twitter.**

The test uses the **real** agent strings rather than invented ones, which is
the only reason it was caught. A substring matcher is an **ordered** matcher
whether or not its author meant it to be; the more specific token goes above
the one it contains. The same trap already applied to WhatsApp, which sends
both its own string and `facebookexternalhit` — I had reasoned about that pair
and then walked into the identical problem with another.

### 3.5 Verification, with the control

Driven against live v183:

```
[crawler] whatsapp og-card subject=keisha-wallace v=3 ua="WhatsApp/2.23.20.0 A"
[crawler] facebook og-card subject=keisha-wallace v=3 ua="facebookexternalhit/1.1 (+http…)"
[crawler] telegram og-card subject=keisha-wallace v=3 ua="TelegramBot (like TwitterBot)"
```

…and the **control**: the same card fetched as `Chrome/131` produced **0**
lines. A logger that recorded everything, and one that recorded nothing, would
each pass half of this and fail the other.

**9 of 9 mutations behave**, including the silent logger, the log-for-everyone
hazard, both ordering regressions, and an IP read.

---

## 4. Incidental: the AI fallback rung had rotted

Found while reading production logs for crawler evidence — they were flooding
with `[ai] qwen/qwen3-coder error (402): This request requires more credits`,
dozens per pipeline run.

The owner supplied a new OpenRouter key (v181). Validating it turned up a
**separate defect the key does not fix**: `FALLBACK_MODEL` was
`nvidia/nemotron-3-super-120b-a12b:free`, and the catalogue has withdrawn it:

> `404 "This model is unavailable for free. The paid version is available now —
> use this slug instead: nvidia/nemotron-3-super-120b-a12b"`

⛔ **Taking that suggestion is the wrong fix, and this is the rejected
alternative worth recording.** The free rungs exist so a primary outage cannot
spend money, and `openrouter.test.ts:69` pins the intent by asserting the
fallback contains `:free`. The paid slug answers 200 — adopting it would have
turned the safety net into a bill **with every test still green**.

Instead the promotion `openrouter.ts`'s own header had already prescribed was
taken: `dots-studio/dots-3-note-preview:free`, named on 2026-10-18 as *"the
next candidate if one of these rots."* Re-measured rather than trusted:

| model | result |
|---|---|
| `dots-studio/dots-3-note-preview:free` | 200 `{"category":"medical","ok":true}` |
| `nvidia/nemotron-3.5-super-vl:free` | 200 `{"category":"medical","ok":true}` |
| `nvidia/nemotron-3-super-120b-a12b:free` | **404** (quoted above) |
| `qwen/qwen3-coder` (primary, paid) | 200 `"ready"` |

⚠️ **A prediction of mine was refuted by execution.** The key reports
`is_free_tier: true`, `usage: 0` and no credit limit, so I expected the paid
primary to 402 — the very error flooding the log. It answered **200** and
billed **$0.000006**. Reasoning from the key's metadata was wrong; only the
call settled it.

✅ Verified by a paired comparison in the same log window: the 15:30 and 16:00
runs produced **dozens** of 402s each; the 17:00 run, after the key landed,
produced **zero**, with its `[newsdata] 3 request(s), 13 article(s)` line
present and no AI errors following it.

⚠️ **Spend is now unbounded**: the key carries no credit limit and the primary
is paid. `openrouter.ts` measures a full `fetch-news` run at **$0.0146**, and
that cron runs every 30 minutes — roughly **$0.70/day** if every run is full.
Capping it is an owner action on OpenRouter's side.

---

## 5. ⛔ What was NOT checked

- **Whether any of this fixes the WhatsApp preview.** Nothing here changes what
  we serve; the card was already correct before the investigation started.
- **Whether Meta ever fetches us.** That is what the log is *for*; it has
  recorded only my own synthetic probes so far.
- **The page fetch**, for the ISR/middleware reason in §3.1. A line's absence
  therefore has two readings, and §3.1's table says which.
- **Any platform other than WhatsApp** — X, Slack, Signal, Telegram, LinkedIn
  and iMessage each have their own cache and were not tested.
- **Two credentials are exposed and unrotated**: the OpenRouter key and the
  production database password, both pasted in plaintext into a session
  transcript.

---

## 6. The experiment this was built to enable

The owner shares a campaign link into WhatsApp. Within minutes:

```
flyctl logs --app lastdonor --no-tail | grep '\[crawler\]'
```

| result | conclusion |
|---|---|
| `whatsapp` or `facebook` lines appear | Meta fetches us and the markup is read — the failure is in rendering or caching on their side |
| nothing | Meta never reached the card; the page fetch is the next thing to instrument, and §3.1 says what that would cost |
