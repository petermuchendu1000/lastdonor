# 142 — robots.txt forbade the share card, and the brand was appended twice

**Date:** 2026-10-29 · **Deployed:** v125 (audit), v126 (these fixes)
**Scope:** phases 0–2, 5, 6, 8.1, 8.2 and 10 of the SEO/AIEO audit. Phase 0 and
Phase 1 are in the session record; this doc carries the defects and the fixes.

---

## 1. The headline the question got wrong

The brief was *"why has no page ever been indexed"*. **Nothing is blocking
indexing.** Every candidate was tested and none fires:

| Candidate | Result | Evidence |
|---|---|---|
| robots.txt disallow | not blocking (`User-Agent: *` / `Allow: /`) | `GET /robots.txt` 200, 4,497 B, 12 UA groups |
| WAF / bot challenge | not blocking — **17/17** agent classes get 200 | `curl -A` matrix: Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Applebot, … |
| `X-Robots-Tag` | absent on all 17 | same matrix |
| `noindex` meta | `index, follow` | raw HTML byte 83,322 |
| canonical | self-referencing | `/` → `https://lastdonor.org`; `/about` → `/about` |
| sitemap validity | **56/56** are 200 + `index, follow` | every `<loc>` fetched; a `noindex` control fired on 7 other routes |
| client-only content | none — no template has a positive render delta | 24-template raw-vs-DOM diff |
| Search Console | **DNS-verified** | TXT `google-site-verification=vzfr9OWQ5…` |

⚠️ **Two of my own first readings were wrong.** I read the homepage as having
no `<title>` — it is at byte **81,834**, after `</head>` at 8,082 (React 19
streams metadata into the body), not cloaking. And I nearly reported "Search
Console was never set up" from the absent meta tag before checking DNS TXT.

So the cause is age, discovery and inventory, [VERIFIED from production]:

- First campaign **published 2026-10-18** — indexable content is 11 days old.
- Domain registered **2026-03-20** (.org registry RDAP), 7 months.
- **Zero** external identity: all 7 social profiles are `href: null`
  (`social-links.ts:67-77`), rendered "coming soon", and `sameAs` is absent.
- **Bing Webmaster is not verified at all** — no meta, no TXT,
  `/BingSiteAuth.xml` 404.
- **15 of 23** sitemap-advertised category URLs hold zero campaigns.

⚠️ Two WebSearch queries (`site:` and an exact-phrase search for the homepage
H1) returned nothing from the domain. I cannot query Google's index directly;
**GSC Page Indexing / Crawl Stats is the blocker** and is named in §6.

---

## 2. ⛔ robots.txt forbade the fetch the rest of the stack is built on

`src/app/robots.ts:3` set `PRIVATE_PATHS = ['/admin/', '/api/', …]`, applied as
`disallow` in **all 12** user-agent groups. Every `og:image` on this site is
`/api/v1/og/page?…` or `/api/v1/og/campaign/<slug>`.

Meanwhile `src/middleware.ts:205,210` declares both routes public, with the
reason written in the file:

> *"Open Graph image generation for share cards; **fetched by social crawlers
> that hold no session**."*

One file exists so social crawlers can fetch it; another told them not to.

**Verified three independent ways:**

1. **Source.** `robots.ts:3` vs `middleware.ts:205,210`; **26** source files
   emit an og:image under that path; **0** `opengraph-image` convention routes
   exist anywhere.
2. **Live.** The served robots.txt carries `Disallow: /api/` in all 12 groups;
   the homepage and `/campaigns/tuan-nguyen` both emit absolute
   `https://lastdonor.org/api/v1/og/…`; the route itself answers **200
   image/jpeg, 148,095 bytes**.
3. **RFC 9309 evaluation** of the served file against the served URL →
   **DISALLOWED** for Googlebot, Twitterbot, facebookexternalhit, GPTBot and
   OAI-SearchBot, with **5 controls** that discriminate (3 allowed, 2
   disallowed), so the evaluator can say yes.

**Falsifiers, both run and both failed to falsify:** there is no alternative
robots-allowed image path (0 convention routes), and no og:image sits outside
`/api/`. `src/lib/facebook-rescrape.ts` exists *solely* to ask Facebook to
fetch these URLs again after `docs/112` §7-§9 rebuilt the card.

⚠️ **What is NOT claimed.** Whether each platform honours this for a preview
fetch is **[UNKNOWN]**. Meta's own crawler documentation says
`facebookexternalhit` *"might bypass robots.txt when performing security or
integrity checks"*, does not state what blocking does to previews, and
recommends allow-listing the agent. So the **self-contradiction is verified**;
the per-platform consequence is not, and I did not assert it.

### 2.1 The fix

`PUBLIC_API_PATHS = ['/api/v1/og/']`, added to the `allow` of all 11
allow-bearing groups. Under RFC 9309 the longest match wins, so
`/api/v1/og/` (11 chars) beats `/api/` (5) and **nothing else under `/api/`
becomes crawlable**. CCBot keeps its deliberate whole-site block — rendered
output confirms 11 of 12 groups carry the allowance and CCBot's group is still
`Disallow: /` alone.

Cost is bounded and measured: the campaign card is `s-maxage=86400` with one DB
select, the text card `max-age=604800, immutable` with none — at most one
render per campaign per 24 h across 14 URLs.

**Guardrail:** `src/app/robots-og-crawlable.test.ts` (17 tests). It
**discovers** og paths from the files that emit them — never a hand-written
list (`docs/116` §4, `docs/123` §4) — and implements RFC 9309 group selection
and longest-match precedence, because a substring check cannot answer this.
`robots.ts` is excluded from discovery so the config cannot satisfy its own
rule.

---

## 3. ⛔ `public/llms.txt` quoted a fee this project bans and nothing charges

The one file written specifically to hand facts to AI assistants said:

> `- Payment processing: Standard Stripe fees only (~2.9% + 30 cents)`

`docs/116` §5 removed that exact claim from 13 sites and guards it with
`src/app/fee-claims.test.ts`, whose rules assert the pattern *"is absent from
**src/**"*. `public/llms.txt` sits one directory outside the sweep. Applying
the test's own `RATE_PATTERNS` to the file:

```
percent-plus-fixed    MATCH -> "2.9% + 3"
30 cents              MATCH -> "30 cents"
```

Stripe cannot take a payment here (`docs/125`: live `create-checkout` answers
503 `PAYMENTS_UNAVAILABLE`), the live rail is PayHero, and **nothing deducts a
processing fee at all** (`docs/116` §5). Removed, with no substitute number.

Also removed: *"Transparency: Donors receive impact updates with receipts and
photos"* — [VERIFIED] `impact_updates` holds **0 rows**, so no donor has ever
received one. Replaced with what the product can do: *"an organiser can publish
an impact update showing how the money was used."*

**Guardrail:** `fee-claims.test.ts` now also sweeps `public/*.{txt,md}`
(14 → 18 tests), with an anti-vacuity rule asserting `llms.txt` is actually
found. **Extending the scope is the fix** — the list was the defect, exactly
`docs/123` §4's `EMAIL_SOURCE_FILES` lesson.

### 3.1 Left for the owner, deliberately not changed

- ⛔ *"Review: All campaigns are reviewed before publishing"* is **false for 6
  of 15** published campaigns [VERIFIED: 5 news-pipeline rows from 2026-10-18
  with the `published_at − created_at` = **−0.003 s** signature of `docs/116`
  §8, plus `help-john-recover-after-a-car-accident` published **95 s** after
  creation via `docs/120` §2's editor-PUT door; 8 rows do have a
  `campaign.published` audit row]. The claim appears in ~44 lines across 23
  files and `docs/116` §8.5 already records this as an owner decision with
  three options. Changing one of 44 instances would create inconsistency and
  reopen a recorded decision.
- ⚠️ `foundingDate: '2024-01-01'` (`layout.tsx:28`) and `- Founded: 2024` in
  llms.txt, on a domain registered 2026-03-20, stated in **two
  machine-readable surfaces and no human-visible copy**. Whether the
  organisation was founded in 2024 is **[UNKNOWN]** — a fact only the owner
  holds. Not deleted.

⚠️ I first reported *"15 of 15 published campaigns have no review row"*. That
was **wrong** — an artifact of guessing the JSON key `details->>'campaignId'`
when the linking column is `target_id`. Corrected to 7 (6 live + 1 archived
test) before any conclusion rested on it.

---

## 4. The brand was appended twice, worst on the money pages

`src/app/layout.tsx:171` sets `title: { template: '%s | LastDonor' }`, and
templates that already ended their own title with the brand rendered it twice.
Measured verbatim from production:

```
Browse Reviewed Medical & Emergency Crowdfunding Campaigns | LastDonor | LastDonor   (82)
Completed Campaigns | LastDonor.org | LastDonor                                      (47)
Removed Campaigns | LastDonor.org | LastDonor                                        (45)
Campaign Stories & Impact Updates | LastDonor | LastDonor                            (57)
Help Tuan Nguyen Rebuild After Fire Destroys San Jose Home | LastDonor.org | LastDonor  (86)
Donate to Help Tuan Nguyen … San Jose Home | LastDonor.org | LastDonor                  (96)
```

The last two are the campaign page and its donate page. Eight title strings in
seven files now hand the template a bare title.

⚠️ **A brand mention inside the sentence is not the defect.** "About
LastDonor.org", "How LastDonor Works" are editorial and were left alone; only a
trailing brand suffix duplicates the template.
`campaigns/category/[category]:30` is the counter-example done right — it
passes a bare `seoTitle` and keeps `| LastDonor.org` in `openGraph`, which Next
never templates.

**Guardrail:** `src/app/title-template-once.test.ts` (6 tests) reads the brand
**out of the layout template**, brace-strips `openGraph`/`twitter` blocks, and
fails on a trailing brand. ⚠️ **It immediately found a seventh offender my
25-route sample had missed** — `collaborate/accept` (`noindex`, so absent from
the measured set). That is the derived sweep earning its place over sampling.

⚠️ And my first edit attempt **refused to run**, correctly: the 2-space anchor
`"  title: 'Completed Campaigns | LastDonor.org',"` is a *substring* of the
4-space `openGraph` line, so it matched twice and the script declined rather
than editing the wrong one. Anchoring on the newline fixed it.

---

## 5. Also measured, and clean

Stated positively because absence is a claim (`docs/141` §1):

- **No cannibalisation**: zero duplicate titles and zero duplicate descriptions
  across 25 templates.
- Every one of the 25 has a canonical **and** a description in the raw HTML.
- **No template injects substantive content client-side** (24-template raw-vs-DOM
  diff; every delta negative).
- gzip works (15,756 B for 76,012 B — my HEAD-based first reading was wrong);
  HTTP/2; HSTS preload.
- `sitemap.ts:26` uses a deterministic `lastmod` constant by design.
- Trailing slash and `http://` both redirect; `/About` 404s; `?utm_source`
  canonicalises clean.
- One `h1` on 24 of 25 templates (`/share-your-story` has 2, §7).

---

## 6. Blockers — the exact access required

1. **Google Search Console** for the DNS-verified `lastdonor.org` property —
   Page Indexing and Crawl Stats. Without it I cannot separate *never
   discovered* from *crawled and declined*, the most decision-relevant fact.
2. **HTTP access logs.** `flyctl logs` carries **no** access log: I ran the
   control (a request with a unique UA, then a 70 s capture → 0 lines, probe UA
   absent), so "0 crawler hits" is a **VOID** measurement and is not reported
   as evidence.
3. **Bing Webmaster Tools** — unverified, so no crawl data exists to read.
4. **Backlink data** — no tool; no backlink count is stated anywhere here.
5. **Field CWV** — no CrUX access. Lab TTFB only (§7), no LCP/INP/CLS.

---

## 7. Reported, not fixed

- ⚠️ **`www.`, `origin.` and `lastdonor.fly.dev` all serve 200** with a
  canonical to the apex and **no 301 and no `X-Robots-Tag`**. A 301 on `www` is
  safe; `lastdonor.fly.dev` must **not** be redirected or blocked — `docs/66`'s
  cron Worker targets it to dodge the 100 s proxy ceiling, so the correct
  control there is `noindex`, not a redirect. Needs the owner's call on `www`.
- ⚠️ **docs/105 §7 claims the Cloudflare proxy is ON; it is not.** [VERIFIED 4
  ways] the apex A record is `66.241.124.43`, a Fly address in **no** published
  Cloudflare range (`cloudflare-ips.ts`); responses carry no `cf-ray` and
  `server: Fly`; two independent DoH resolvers agree; NS is Cloudflare but the
  record is grey-clouded. docs/105's reasoning stands — `getClientIp` is
  correct either way — but its status line is stale.
- ⚠️ **`/` is `force-dynamic`**, so `cache-control: private, no-cache,
  no-store` and TTFB **0.80 s** against 0.15–0.25 s for every other template,
  on a single machine in **`arn`** behind an `iad` edge.
- ⚠️ `/share-your-story` renders **two** `<h1>` with identical text (a
  responsive pair).
- ⚠️ `knowsAbout` on the Organization node holds **46** near-duplicate keyword
  variants; `og:site_name` is absent sitewide; `twitter:site: '@lastdonororg'`
  (`layout.tsx:194`) contradicts `social-links.ts:67` `{ name: 'X', href: null }`
  and that file's own written rule against naming a handle we do not own.
- ⚠️ `/blog/sitemap.xml` is not declared in robots.txt (and carries 0 entries).
- ⚠️ The admin titles use `- Admin - LastDonor.org` and therefore render the
  brand twice too. Not fixed: they are `noindex`, and the §4 sweep deliberately
  skips `admin/` and `dashboard/`.
- ⚠️ CLAUDE.md calls the middleware constant `PUBLIC_API_PREFIXES`; it is
  **`PUBLIC_API_ROUTES`**.

---

## 8. Not checked

Phase 3 lab CWV beyond TTFB; Phase 4 internal link graph; Phase 5 for the 36
admin and 22 dashboard templates; Phase 6 against an external validator (I
parsed JSON-LD myself and have not run Google's Rich Results Test); Phase 8.3
chunk-level rewrites; **Phase 8.8 prompt panel — not run, and no panel result
is invented anywhere in this doc**; Phase 9 international; Phase 11/12 for the
items in §7. `/blog/[slug]` remains unrenderable (0 posts) and stays BLOCKED.
