# 90 · News source coverage: the GNews replacement, and the 48 dead feeds

**Date:** 2026-10-18
**Status:** Decided and deployed, with one item left to the owner
**Supersedes nothing. Amends:** docs/65 (the pipeline the scheduler woke up),
docs/89 (the AI ladder it depends on)

---

## The question that was asked

> *"find an alternative to GNews that covers almost every country or specific
> countries"*

`GNEWS_API_KEY` has never been set. `ingest-news` therefore lost one of its
three sources on every run and filed a `pipeline.source_failures` audit row
saying so — 48 of them a day since the scheduler went live.

Answering the question properly meant measuring three things rather than
reading about them: what GNews actually covers, what the candidates actually
return, and whether the coverage we already have works. The third turned out
to matter most.

---

## Decision summary

| | Decision |
|---|---|
| **Replacement for GNews** | **NewsData.io**, when the owner wants a keyword search API. Not built yet — no key exists, and docs/81 forbids shipping an unexercised provider path. |
| **Google News RSS** | **Rejected.** Its links are opaque tokens the body fetcher cannot follow. |
| **GDELT 2.0 DOC API** | **Rejected.** Rate-limited to the point of uselessness from our own egress. |
| **NewsAPI.org, Mediastack, Currents, TheNewsAPI, Webz.io** | Not pursued; see *Rejected alternatives*. |
| **Shipped now, without any credential** | 48 dead RSS feeds found and fixed, 9 feeds added, feed health reported every run, and GNews's absence no longer logged as a failure. |

---

## 1. What GNews actually covers (verified)

From **GNews's own OpenAPI specification**, `https://docs.gnews.io/openapi.yaml`,
fetched 2026-10-18:

- `country` accepts **37 values**:
  `ar au bd br ca cn co eg fr de gr hk in id ie il it jp my mx nl no pk pe ph pt ro ru sg es se ch tw tr ua gb us`
- `lang` accepts **26 values**.

**Egypt is the only African country in that list.** No Kenya, no Nigeria, no
South Africa, no Ghana, no Tanzania, no Uganda. For a platform whose
`SMS_DEFAULT_REGION` is `KE` (docs/82), that is a pointed gap.

From **`https://gnews.io/docs/v4`**, read the same day, the Free plan is:

| Requests / day | Articles / request | Historical archive | Data freshness | Full content |
|---|---|---|---|---|
| 100 | 10 | Last 30 days | **12-hour delay** | Truncated |

So GNews free tops out at **1,000 articles a day, none of them fresher than
12 hours**. The existing client issues one request per category — 23 per run —
which at a 30-minute schedule would exhaust the daily quota before 07:00.
The incumbent was never sized for the schedule it now runs on.

---

## 2. The replacement: NewsData.io

Verified from **NewsData.io's own OpenAPI specification**
(`https://newsdata.io/openapi.json`) and its pricing page (rendered with a
real browser, because the page is a JavaScript shell that serves 69 characters
of text to `curl`), both 2026-10-18:

- `country` accepts **any ISO 3166-1 alpha-2 code**, comma-separated, up to the
  plan's filter limit (**5 per request** by default). It is not an enum of 37.
- `language` likewise accepts any ISO 639-1 code, 5 per request.
- Free plan: **$0, 200 API credits/day, 1–10 articles per credit**, Latest News
  API included, **delayed by 12 hours**.
- `/1/latest` and `/1/news` cost 1 credit; `/1/archive` costs 5; the `count`
  endpoints cost 50.
- Page size is **10 on the free plan**, 50 on paid.
- Every response carries `X-RateLimit-Remaining` and `X-API-Limit-Remaining`.
- Filters that cannot be combined: at most one of `q` / `qInTitle` / `qInMeta`;
  `country` or `excludecountry`; `language` or `excludelanguage`;
  `timeframe` or `from_date`/`to_date`.

Against GNews that is **twice the daily article ceiling** (2,000 vs 1,000),
**open-ended country coverage** instead of 37 fixed values, five countries per
request instead of one, and — the part that matters operationally — **the API
reports its own remaining budget in a header**, so the code can log what is
left rather than a document asserting a number that will rot.

Freshness is the same 12-hour delay on both free plans. The pipeline's
freshness filter is 14 days, so this does not bite; it does mean neither free
plan can ever surface breaking news.

**Not built.** No key exists, so no call can be made, and docs/81 and docs/82
both settled this: an unexercisable code path is the thing those documents were
about. When a key exists, the client should be written against `/1/latest`,
batch five countries per request, and record `X-API-Limit-Remaining` on each
call.

### The one thing the owner has to do

Create a free NewsData.io key and set it on Fly, **or** create the GNews key
that was always missing. Either unblocks keyword search. Neither is urgent:
section 4 is what was actually starving the pipeline.

---

## 3. Rejected alternatives, and why

### Google News RSS — rejected on a measurement, not a preference

It looked ideal: **65–100 items per query in ~450 ms**, no key, no quota, and a
per-country edition for roughly every market via `hl` / `gl` / `ceid`.
Probed 2026-10-18 for `US`, `GB`, `CA`, `KE` — all 200, all populated.

Then the link was followed. Every `<link>` is
`https://news.google.com/rss/articles/CBMi…?oc=5`. Fetching one returns
**584 KB of JavaScript interstitial** on `news.google.com`, HTTP 200, with
`og:url` = `https://news.google.com` and a canonical pointing back at itself.
The `CBMi…` token base64-decodes to an opaque `AU_yqL…` blob with no URL in
it; resolving it requires Google's undocumented `batchexecute` RPC.

That is disqualifying here for three independent reasons:

1. Step 3b of the pipeline fetches the article body from the stored URL. It
   would classify 584 KB of Google's JavaScript instead of the article.
2. Deduplication is by URL, and these URLs do not match the publisher URLs the
   RSS feeds yield, so the same story would enter twice.
3. The `<description>` is an `<a href>` to the same token — there is no summary
   either.

### GDELT 2.0 DOC API — rejected from the production machine

On paper the best fit of all: no key, real publisher URLs, a `sourcecountry:`
operator covering essentially every country, 65 languages, and a `socialimage`.
A single probe confirmed the quality — `sourcecountry:IN` returned 25 articles,
all 25 from India, 22 with images.

It fails on throughput. GDELT documents "one request every 5 seconds" and
enforces it with a **plain-text** 429 body (so `res.json()` throws — the same
shape docs/84 recorded for Africa's Talking). Measured **from the Fly machine**,
spacing requests 6 s apart on top of 10–15 s response times:

```
US 429 10867ms    GB 429 10381ms    KE fetch failed 10495ms
IN 429 10145ms    NG 200 15505ms (0 articles)
```

**Three of five requests rate-limited, one failed outright, one returned
nothing** — with real gaps of 16–21 s, far beyond the documented limit. The
limiter is evidently per-IP and Fly's egress is shared. A source that answers
one request in five, at 12 s each, cannot serve 23 category queries inside a
300 s cron budget. It also returns **no summary field** at all.

### Not pursued

- **NewsAPI.org** — its free Developer plan forbids production use. Nothing
  else about it matters.
- **Mediastack** — free tier is per *month*, not per day, and serves plain HTTP
  on the free plan.
- **Currents, TheNewsAPI, Webz.io** — all plausible, all behind a signup, and
  none offering anything NewsData.io does not. Secondary sources disagreed
  wildly on their free tiers (one guide claimed NewsData.io's free plan is
  limited to 5 countries; its own specification says otherwise), which is
  exactly why nothing here is asserted from a blog post.

---

## 4. The finding that mattered more: 48 of 125 RSS feeds were dead

While establishing what coverage we already had, every configured feed was
fetched. The result, **from the production machine**, 2026-10-18:

> **72 live · 5 answering 200 with zero items · 48 dead** — of 125.

Nothing had ever checked. `fetchRssFeed` returns `[]` on any failure and
`fetchAllRssFeeds` settles and silently drops rejections, so a feed that has
404'd for years is **indistinguishable by return value** from a feed with
nothing new. In `fetch-rss` mode this list is the pipeline's entire reach.

The worst of it:

- **Both wire services gone.** `feeds.reuters.com` does not resolve
  (`NXDOMAIN`); `feeds.apnews.com` has no A record (`ENODATA`). Confirmed by
  DNS from the Fly machine. The pipeline had no wire service at all.
- **All five first-responder feeds dead** — ODMP, USFA's companion feeds,
  Police1, FireRescue1, EMS1, Firehouse — in a category the platform runs
  campaigns for. Lexipol retired the RSS endpoints; every path tried 404s.
- **Both military/veterans feeds dead** (Stars and Stripes, VA Press).
- **Eight of thirteen humanitarian feeds dead**, including UNICEF, ICRC, the
  IRC, UNHCR and ReliefWeb.
- **Africa was the thinnest region** — four of ten dead plus one empty, leaving
  five — which is the region no keyword API covers either.

### Measure the path the actual calls take

The same probe run from the development sandbox reported **49 live, 72 dead**.
The difference is not the feeds. BBC, The Guardian, the New York Times and the
LA Times answer **403 to the sandbox's egress proxy and 200 to Fly**. A feed
list "verified" from a laptop would have deleted nine working feeds.

This is the second time this exact mistake has been available to make — docs/66
records advising an IP allow-list from a `curl` measurement when the real calls
egressed from a different address. Only the production result is used here.

### A negative result worth keeping

Every 403 was retried with a full browser `User-Agent`, `Accept:
application/rss+xml, …` and `Accept-Language`. **Identical outcome in every
case** (the only two changes were 403 → 404, both still dead). The blocking is
at the IP/ASN level, not the header. There is nothing to gain by disguising the
crawler — and we would not.

### What changed

Replacements and additions, each verified returning items **from production**:

| Was | Now | Items |
|---|---|---|
| `feeds.apnews.com`, `feeds.reuters.com` | removed — no public endpoint exists | — |
| `www.upi.com/rss/TopNews/` (403) | `rss.upi.com/news/top_news.rss` | 24 |
| `www.va.gov/rss/rss_PressRel.asp` (404) | `news.va.gov/feed/` | 30 |
| `www.odmp.org/rss/all` (200, empty) | `www.odmp.org/feed` | 20 |
| `feeds.cbsnews.com/CBSNewsMain` (failed) | `www.cbsnews.com/latest/rss/main` | 30 |
| `www.cbc.ca/cmlink/rss-topstories` (timeout) | `www.cbc.ca/webfeed/rss/rss-topstories` | 20 |
| `www.dw.com/rss/en/top-stories/…` (200, empty) | `rss.dw.com/rdf/rss-en-all` | 136 |
| `www.dw.com/rss/en/eu/…` (404) | `rss.dw.com/rdf/rss-en-eu` | 20 |
| `www.who.int/feeds/…` (404) | `www.who.int/rss-feeds/news-english.xml` | 193 |
| `en.vietnamplus.vn/rss/news.rss` (404) | `en.vietnamplus.vn/rss/home.rss` | 50 |
| `www.nation.africa/rss.xml` (404) | `nation.africa/kenya/rss.xml` | 25 |
| `www.iol.co.za/cmlink/1.640` (403) | `www.iol.co.za/rss` | 30 |
| `www.news24.com/news24/rss` (403) | `feeds.capi24.com/v1/Search/articles/news24/TopStories/rss` | 20 |
| `www.ndtv.com/rss/top-stories` (403) | `feeds.feedburner.com/ndtvnews-top-stories` | 20 |
| `www.bostonglobe.com/arc/…` (404) | `www.bostonglobe.com/rss/bigpicture` | 50 |

Added: Army Times (25), Navy Times (25), Task & Purpose (30), Firefighter Close
Calls (15), National Fallen Firefighters Foundation (10), The Standard Kenya
(30), Vanguard Nigeria (20), The Citizen Tanzania (40), Rappler Philippines
(10).

Dropped with no replacement found: Police1, FireRescue1, EMS1, Firehouse,
Stars and Stripes, USA Today, Arizona Republic, Detroit News,
Chicago Tribune, Denver Post, Houston Chronicle, Dallas Morning News, Atlanta
Journal-Constitution, SF Chronicle, Seattle Times, Guardian Nigeria, Chronicle
Zimbabwe, Manila Bulletin, Korea Herald, NZ Herald, CTV News, SWI swissinfo,
Gulf News, Al Arabiya, UNICEF, ICRC, IRC, UNHCR, ReliefWeb, Devex, Global
Citizen.

**Feeds deliberately kept despite failing.** A hard, repeatable failure (404,
403, 402, 406, or 200 with no items) is treated as dead. A timeout, 429, 502 or
503 is treated as transient and kept — Miami Herald, Kansas City Star, Trinidad
Express, NHK World, CBC World and the Washington Post (502) among them. The
health reporting below is what catches a "transient" failure that is really
permanent.

### Measured after the change

The same probe, same machine, against the new list:

> **94 live · 0 empty · 7 failing** — of 101.

**58 % → 93 %.** All seven remaining failures are the transient kind the rule
above deliberately keeps: five timeouts (NHK World, CBC News, CBC World,
Kansas City Star, Miami Herald), one `fetch failed` (RNZ, which was live two
hours earlier) and the Washington Post's 502. None is a 404.

And in the pipeline itself, `fetch-news` run against production immediately
after the deploy:

| | before | after |
|---|---|---|
| articles fetched | 1,461 | **1,899** |
| classified | 9 | **40** |
| AI errors | 32 identical | **0** |

The two errors in the new run are both `low extraction confidence` skips, which
are the pipeline working as designed, not a model failing.

---

## 5. Making the next one visible

Three changes, so this cannot repeat silently:

1. **`fetchRssFeedWithOutcome`** returns `{ items, outcome }` where `outcome`
   is `ok` / `empty` / `http-error` / `transport-error` with the status.
   `fetchRssFeed` keeps its old signature and delegates.
2. **`fetchAllRssFeedsWithHealth`** rolls the outcomes up. When more than
   **25 %** of feeds are failing, the pipeline writes one
   `pipeline.feed_health` audit row at `warning` naming up to 30 of them. A
   proportion, not a count, so it tracks the list as it grows.
3. **A missing `GNEWS_API_KEY` is no longer a source failure.**
   `isGNewsConfigured()` is checked first and the source is skipped. An unset
   optional key is a configuration choice; filing 48 warnings a day about it is
   how a real failure gets missed.

### A defect found on the way out

`fetchGNewsArticles` caught every per-keyword error, logged it, and returned
whatever it had — `[]` for a total outage. The pipeline's
`pipeline.all_sources_failed` detector keys on that function **rejecting**, and
the only thing that ever threw was the missing-key check at the top. So
**blackout detection for GNews was dead code**: with a key set, no GNews outage
could ever have triggered it. It now counts attempts against failures and
throws when every request failed.

Three pipeline tests encoded the old conflation — they deleted the key and
called the resulting throw a GNews failure. They were the thing that had
drifted, not the code, and they now set a key and kill the network instead.

---

## 6. Status of the AI ladder this pipeline depends on

Recorded here because the news pipeline is its only heavy caller; the detail is
in the comment on `src/lib/ai/openrouter.ts`.

docs/89 left the two free rungs **slug-verified but not output-verified** —
they answered 429 rather than 404, which proves only that the slug resolves.
On a key with quota they were put to the real `classify-news` prompt and both
failed: `nvidia/nemotron-3.5-lightning:free` returns **empty content** with
every token spent on reasoning, and `xingchen-agi/xing4.0-29b-a4b:free` returns
chain-of-thought prose and no JSON. At the caller's real `max_tokens` of 4096
neither answers inside 90 s, and the production client's timeout is 60 s — so
neither could ever have succeeded, and a primary failure spent the whole
120 s `AI_CALL_DEADLINE_MS` on them before reaching `openrouter/free`.

All 16 of OpenRouter's free models list `reasoning` as a supported parameter,
so "pick one that is not a reasoning model" was not available. Each candidate
was sent the real prompt, called exactly as `call-ai.ts` calls it, and the
reply put through `call-ai.ts`'s own fence-stripping before `JSON.parse`:

| model | result |
|---|---|
| `qwen/qwen3-coder` (primary, paid) | 1.1 s, parsed |
| `nvidia/nemotron-3-super-120b-a12b:free` | 3.8 s, parsed → **new fallback** |
| `nvidia/nemotron-3.5-super-vl:free` | 3.9 s, parsed → **new tertiary** |
| `dots-studio/dots-3-note-preview:free` | 12.1 s, parsed (next candidate) |
| `google/gemma-4-26b-a4b-it:free`, `google/gemma-4-31b-it:free` | 429 upstream |
| `liquid/lfm-2.5-2.6b:free` | 400, reasoning cannot be disabled |

The primary is live again on the key supplied 2026-10-18 and costs
**$0.00020774** for a 257p/84c classification. An earlier draft of this
document extrapolated that to "about $0.30 per `fetch-news` run"; the real run
was then measured at **$0.0146**, because `MAX_NEW_ARTICLES_PER_RUN` caps the
run at roughly 400 of the articles fetched rather than classifying all 1,899.
The extrapolation was wrong by 20×, in the safe direction, and is recorded here
rather than quietly deleted. The account still reports `total_credits: 0`;
the key carries a $100 spend cap of its own and 50 free-model requests a day.

**Do not rotate that OpenRouter key** without setting the replacement on Fly —
it is production configuration now, not a sandbox credential.

---

## Trade-offs accepted

- **No wire service.** AP and Reuters have no public RSS and the only route to
  AP is Google News RSS, rejected above. Coverage leans on NPR, PBS, ABC, NBC,
  CBS, BBC, The Guardian, the NYT, France 24 and Al Jazeera instead.
- **Thirty-one feeds removed outright.** Each was a hard repeatable failure, so
  the loss is nominal — but the list is now 101, not 125, and a future reader
  should not mistake the smaller number for shrinking ambition. It carries 94
  working feeds against the old list's 72.
- **A 25 % failure threshold is a judgement, not a measurement.** At the
  current 101 feeds it fires at 26 failures, against the 7 seen today. It was chosen to sit well above
  normal publisher flakiness and well below the 38 % that went unnoticed for
  years. Revisit it once a few weeks of `pipeline.feed_health` rows exist.
- **NewsData.io is recommended on its own documentation, not on a live call.**
  Every number above is from the vendor's own specification or its rendered
  pricing page, dated. None of it has been exercised, and docs/84 is the
  standing warning about what vendor documentation omits — a failed send that
  answers HTTP 201. Treat section 2 as a plan, not a verified integration.
