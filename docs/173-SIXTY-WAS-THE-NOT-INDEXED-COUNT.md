# 173 — Sixty was the not-indexed count

**2026-11-05.** Started by the owner asking *"just check what has indexed and
not? understand why"*. The answer overturned a number this project had been
reasoning from for two days, and found one live defect on the way.

---

## 1. The correction, first

`docs/169` §2 recorded, and `docs/170`, `docs/171`, `docs/144`, `CLAUDE.md`,
`sitemap.ts`, `homepage-categories.test.ts` and `brand-images.ts` all
repeated:

> Google knows **60 URLs** on this domain and has indexed **zero**.

**That is false.** [VERIFIED from the owner's Search Console screenshots,
2026-11-05] The Page Indexing screen shows two tiles side by side:

| Tile | Value |
|---|---|
| Not indexed | **60** — "7 reasons" |
| **Indexed** | **26** |

**60 is the not-indexed count.** Known = 26 + 60 = **86**.

### 1.1 Why it was misread, and why that is the instructive part

The seven-reason table beneath the tiles breaks down **only the 60**, and it
sums to exactly 60 — so the breakdown corroborated the headline number and
made it look like a total. A table that adds up is not evidence that it
covers everything. The missing check was reading the *other* tile.

⚠️ The screenshot reads **"Last update: 23/10/2026"**, which predates the
2026-11-03 reading. So the 26 was on screen then too: this was a misreading
of the same data, not a change in it. [INFERRED — a report cannot have held
newer data on an earlier date; the chain is the stated update date.]

### 1.2 What it overturns

`docs/169` §5 **reversed a recorded owner decision** (`docs/46`, re-affirmed
`docs/144`) to stop advertising empty category pages, citing *"60 URLs known
and zero indexed"* as the measurement that outweighed it. Half that premise
is false.

⛔ **The decision is left standing, not quietly reversed.** Its other half —
17 of 23 category pages holding nothing — was verified independently across
all 23 live pages and is unaffected. But it was argued from a number that was
not real, and every surface that cited it now says so.

Nine locations were corrected. None was deleted; each carries what it used to
say, because a silently repaired number is indistinguishable from one that
was always right.

---

## 2. What is actually indexed, and why

**26 indexed. 60 not indexed, of which 56 are correct by design or correctly
dead.** The only genuine declination is **4 pages** in *"Crawled – currently
not indexed"*.

| Reason | Pages | Verified |
|---|---|---|
| Not found (404) | 20 | ✅ `nicholas-cabo`, `brent-ledbetter` answer 404, are linked from **no** live page and are absent from the sitemap. GSC still lists them under internal links — that data is stale. |
| Excluded by `noindex` | 18 | ✅ by design; 8 static routes confirmed live |
| Blocked by robots.txt | 8 | ✅ `/admin`, `/api`, `/dashboard`, `/profile` |
| Alternative page w/ canonical | 6 | ✅ canonical working — see §2.1 |
| Page with redirect | 2 | ✅ `http→https`, `/search` 307 |
| Blocked, other 4xx | 2 | ❓ **[UNKNOWN]** |
| **Crawled – currently not indexed** | **4** | ⛔ the verdict |

### 2.1 The duplicate host

[VERIFIED] `https://www.lastdonor.org/completed-campaigns` answers **200 with
no redirect**, so both hosts are crawlable — `docs/169` §4 left `www`
indexable deliberately. Google's Links report lists `www` URLs among internal
links, which looked like we were emitting absolute `www` hrefs.

**Refuted:** the homepage, `/campaigns` and `/completed-campaigns` emit **0**
absolute `www` URLs, and `src/` and `public/` contain none. [INFERRED] those
are links Google found *while crawling `www` itself*. The canonical is doing
its job; this is the 6, and GSC counts it as correct.

### 2.2 The binding constraint

**External links: Total 0.** Google's own number, and the one input no code
change reaches. Internal links total 145.

Crawling is emphatically **not** the problem and should stop being
investigated as one: **1.88k crawl requests in 90 days**, robots.txt "All
files are valid", sitemap read **Success**. Google is visiting freely and
indexing most of what it finds.

The rest is youth and thinness: property added **19 October 2026**, `/blog`
has 0 posts ever and renders 186 words, and 10 of 36 advertised pages are
under 400 words *including* nav and footer chrome.

### 2.3 The report is 13 days stale

"Last update: 23/10/2026" against a reading on 2026-11-05. So the 26/60
predate v174 (IndexNow, sitemap 50→33), v175, and both campaign approvals.
The sitemap was last read **3 Nov** showing **50** discovered pages; it
serves **36** today. ⛔ Do not read these figures as a verdict on anything
shipped since 23 October.

---

## 3. ⛔ The defect: `/newsletter` was never advertised

`/newsletter` shipped 2026-10-29. [VERIFIED live] it answers **200**,
`index, follow`, self-referencing canonical, 318 words, and `Footer.tsx:33`
links it from **every page** — Google's Links report counts **36 internal
links to it, tied with the homepage as the most-linked URL on the site**.

It was absent from `/sitemap.xml`, and `sitemap.ts` did not mention it
anywhere, so this was an oversight rather than a decision.

### 3.1 Root cause

`staticPages` (`sitemap.ts:198`) is a **hand-written list**, and nothing
compared it to the pages that exist. Identical in shape to `docs/119` (a
hand-kept nav list), `docs/124` (a hand-kept scrub list), `docs/144` (a
hand-curated category grid) and `docs/146`. Four prior instances make it a
class, not an oversight — so the fix is a rule, not just an entry.

### 3.2 The guard

`src/app/sitemap-advertises-public-pages.test.ts`. A route must be advertised
unless one of two things is true, both read from the code that already
decides them:

1. it sits under a prefix `robots.ts`'s `PRIVATE_PATHS` disallows; or
2. its `page.tsx`, **or any ancestor `layout.tsx`**, declares
   `robots: { index: false }`.

⛔ **The ancestor walk is load-bearing.** `/login`, `/login/reset-password`
and `/register` inherit `noindex` from a layout; a page-file-only check
reports correct code as broken.

⛔ **It EXECUTES the route** rather than regex-matching the array literal.
With an empty fake database `advertisedCategorySlugs` returns nothing, so
`sitemap()` yields exactly the static section. A text rule would pass against
a `staticPages` the route no longer returns (`docs/162` §5.1, `docs/164`).

**No hand-written exclusion list**, which is what would have reintroduced the
root cause.

### 3.3 The predicate was validated against production before it became a test

All 76 static routes were fetched from the live site. The 8 served with a
`noindex` robots meta are **precisely** the 8 this detector flags among
200-answering routes — **zero false positives**. The other 48 redirect behind
auth; 42 also declare `noindex`, and the 6 that do not are all under
`/admin` or `/dashboard`, which rule 1 removes. A guard that models a
property incompletely enforces the opposite of what it is for (`docs/156`).

### 3.4 Mutations

| # | Mutation | Result |
|---|---|---|
| A | remove `/about` from `staticPages` | 1 failed, names `/about` ✅ |
| B | blind the `noindex` detector | 3 failed ✅ |
| C | detector calls every page `noindex` | 4 failed; anti-vacuity caught the empty candidate set ✅ |
| D | drop the ancestor-layout walk | 1 failed — the inherited-layout control ✅ |

The **production state is itself the mutant**: the guard failed naming
`/newsletter` before the fix and passed after.

⚠️ **D fires only the dedicated control**, not rule 1 — `/login*` is excluded
by prefix anyway, so without that control a page-file-only check would pass.

⚠️ **Two mutation rows were initially void and neither looked it.** C was an
**anchor miss** (shell quoting), and D printed **`Tests no tests`** — a
collect failure, which `docs/124` §5.1 and `docs/138` §6.1 both record as
reading like zero failures. The harness now refuses to score a row whose file
sha did not change, and treats "no tests" as void. `docs/152`'s rule met in
person: *an injection that does not apply reports exactly like a rule with a
hole in it.*

---

## 4. Five void probes, and what made them visible

The authoritative index is readable only from Search Console, which is
DNS-verified and owner-only. Every attempt to measure it from the sandbox
failed, and **four of the five would have read as "nothing is indexed"**:

| Probe | Returned | Why void |
|---|---|---|
| WebSearch `site:` | pages about organ donors | engine states `site:` unsupported |
| Bing HTML | "7,880 results" on Windows power settings | uncorrelated with the query |
| Bing RSS | estate-law pages | `site:gofundme.com` → ArtStation |
| Bing via WebFetch | Spotify pages | different egress, same garbage |
| DuckDuckGo HTML | HTTP 202 anomaly page | bot-blocked, all 3 queries |

⛔ **Only the fabricated-domain control exposed it.** `site:ld-probe-not-a-real-domain-xyz.org`
returned ten word-game sites. A positive control (`site:gofundme.com`) was
necessary and **not sufficient** — a garbage engine returns plausible-looking
results for it too. The negative control is what proves the probe is not
reading the query at all.

⚠️ A probe bug of my own: `while read` drops a final line with no trailing
newline, and the dropped line was one of the two Supabase images — the exact
row that mattered.

---

## 5. Unchecked

- **Which 26 are indexed is [UNKNOWN].** It is one click in Search Console
  ("View data about indexed pages") and was not available when this was
  written.
- The 2 "Blocked due to other 4xx" remain **[UNKNOWN]**, as in `docs/169`.
- Whether **Bing, Yandex, Seznam, Naver or Yep** indexed anything from
  IndexNow is **[UNKNOWN]** — `submitted` means received, and their webmaster
  tools are owner-only.
- Whether the figures moved since 23 October is **[UNKNOWN]**; the report has
  not updated.
- **Inbound links were not independently measured** — that needs a working
  index. `External links: Total 0` is Google's figure, taken as given.
