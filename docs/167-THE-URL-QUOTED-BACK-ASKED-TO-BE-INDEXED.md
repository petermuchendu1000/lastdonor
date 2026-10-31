# 167 — The URL quoted back, and it asked to be indexed

Started by the owner sending a screenshot of this, from production:

> ⚠ category "garbage-not-real" is not one we recognize, so it was not
> applied. The list below is not filtered by category.

and asking what it means, and **what the effect of such words is on a site
like this one**.

The words are not ours. `garbage-not-real` is the literal value from
`/campaigns?category=garbage-not-real` — my own probe from `docs/165`. The
sentence is `docs/45`'s rule working as designed: a value we cannot apply is
reported rather than dropped, because dropping it in silence shows the whole
listing under a header reading as though every row matched.

The question was the right one to ask, and answering it found two defects.

---

## 1. What is NOT wrong, verified first

The obvious reaction to *"the page prints whatever is in my URL"* is script
injection. It isn't, and that was established before anything else, because it
decides whether this is an incident or a defect.

| claim | method | result |
|---|---|---|
| No script runs | real browser, dialog + `pageerror` listeners | **0 dialogs, 0 page errors** |
| The markup does not become an element | `img[onerror]` count after load | **0** |
| It renders as text | rendered DOM | `category “<img src=x onerror=alert(1)>”` as literal text |

React escapes a text child, and the value is only ever a text child. ⛔ So no
HTML stripping was added — that would imply the renderer needs it, and the one
property that must stay true is the one that already holds.

**And it does not reach anything a crawler quotes or a chat app previews.**
Enumerated, rather than grepped for: the string appears **7 times** in the
whole document — the canonical ×2 (once in the RSC payload), the router state
×3, the rendered notice ×2. `<title>`, `description`, `og:title`,
`og:description` and `og:url` are all fixed strings.

⚠️ **One of my own probes was wrong here and the contradiction caught it.** A
first pass sliced the document at `</head>` and reported **0 occurrences in
the head**, which reads like containment — while a separate probe had just
shown the canonical carrying the value. `docs/142`'s finding in person: React
19 streams metadata, and `</head>` is at byte **7,536** while the canonical is
at **27,422**. The enumeration above is over the whole document for that
reason.

## 2. The first defect: the value is uncapped, and a cap is not the fix

[VERIFIED live on production v171, at 390px, with a 500-character value:]

| surface | cap | horizontal overflow |
|---|---|---|
| `/campaigns` | **none** | **4,520px** |
| `/completed-campaigns` | 60 (`docs/165`) | **239px** |
| `/blog` | 40 (`docs/164`) | **36px** |
| `/campaigns`, short value | — | **0px** ← control |
| `/campaigns`, no param | — | **0px** ← control |

⛔ **So the two caps I wrote in the last two days were half-fixes.** They
reduced the number and did not reach zero: a 60-character unbroken run still
pushes a phone sideways. A flex item defaults to `min-width: auto`, so one
unbroken word sets the row's minimum however short it is.

**Both halves are needed.** `reportedValue` (one cap, 40, in
`src/lib/reported-value.ts`) *and* `wrap-anywhere` + `min-w-0` where it is
rendered.

⚠️ `wrap-anywhere` (`overflow-wrap: anywhere`), **not** `break-words`
(`overflow-wrap: break-word`): only the former contributes to min-content
sizing, which is what a flex parent reads.

⚠️ The cap is **40 because it must exceed the longest value any surface could
recognise** — `first-responders`, 16 characters — or a visitor who typed
something nearly right is shown their own near-miss truncated and cannot see
what they got wrong. The test derives that floor from the live category list
rather than restating it.

## 3. The second defect: any string minted an indexable URL

[VERIFIED live on v171, with `/settings` reading `noindex, nofollow` as the
control proving the extractor can see a noindex:]

```
/campaigns?category=garbage-not-real
  200   robots: index, follow
        canonical: https://lastdonor.org/campaigns?category=garbage-not-real
        content:   the UNFILTERED listing — byte-identical to /campaigns
```

A canonical is a claim about identity. A parameter that changed nothing cannot
make the document a different one — so this page was declaring itself a
separate document from `/campaigns` while being the same one. **Anyone can
therefore mint an unlimited number of indexable URLs on this domain, each
rendering a string of their choosing inside our own warning panel, on a site
whose public pages are appeals naming real people.** Not a hack; a link.

⚠️ It also closed an alias duplicate nobody had noticed:
`?category=disaster-relief` and `?category=disaster` are one document
(`CATEGORY_ALIASES`) and both used to canonicalise to themselves.

### 3.1 The fix is a second function, not a flag

`campaignsCanonicalHref(resolved, page)` takes **resolved** params. ⛔ That is
the whole safety property and it is structural: there is no argument through
which an unapplied value could reach it.

⛔ **`campaignsPageHref` keeps carrying the raw value, deliberately** — its own
comment says why, and it is right: if pagination dropped an unapplied value,
the notice would vanish on page 2 and the visitor would silently be shown a
different result set than page 1. The two functions must disagree. That
disagreement is injection row 9, the **vacuity attack**: dropping the raw value
everywhere satisfies "the canonical drops it" and deletes the notice.

⚠️ `status` is omitted from the canonical **always** — it is a no-op on this
page in every case. `sort` is omitted when it equals `DEFAULT_SORT`, since
that URL is the same document as the bare one.

⚠️ `robots` was left alone. A canonical pointing elsewhere is the correct
signal for a duplicate and is better than `noindex`, which discards rather than
consolidates. `docs/166`'s `paginationRobots` still handles beyond-the-end.

## 4. Verified by execution

Local production build, 390px, `isMobile: false` (`docs/128` §5):

| | overflow | value | truncated | canonical |
|---|---|---|---|---|
| `/campaigns` 500-char | **0px** | 40 | yes | `/campaigns` |
| `/completed-campaigns` 500-char | **0px** | 40 | yes | `/completed-campaigns` |
| `/blog` 500-char | **0px** | 40 | yes | `/blog` |
| `/campaigns` long `sort` + `status` | **0px** | 40 | yes | `/campaigns` |
| `/campaigns` short value | 0px | — | no | `/campaigns` |
| `/campaigns` no param | 0px | — | no | `/campaigns` |

⛔ **PROBE CONTROL, on that very page:** appending an unbroken 500-character
`<div>` with no wrap class takes the same page from **0px → 4,922px**. So the
zeros are observations, not a blind measurement (`docs/135` §5).

⛔ **And the notice still does its job**: the short value is quoted **whole**
(`category “garbage-not-real”`), the capped one shows `…`, and a URL with no
param renders **no notice at all** — so the fix did not buy zero overflow by
deleting the disclosure.

## 5. The sibling defect, found while verifying the fix

`q` and `location` are free text, so there is no such thing as an
unrecognised value and nothing is reported — which is why neither appears
above. They are still echoed into an **active-filter chip**, and `freeText`
caps them at **100**, which is not short.

[VERIFIED at 390px, `isMobile: false`:]

| | chip width | page overflow |
|---|---|---|
| `?q=` 100 unbroken | **898px** at a 390px viewport | **524px** |
| `?location=` 100 unbroken | — | **532px** |
| both | — | **532px** |
| `?q=cancer` | 99px | **0px** ← control |
| no param | — | **0px** ← control |

⛔ **A chip TRUNCATES, it does not wrap** — a five-line pill is not a chip, and
the clear `×` has to stay reachable. `max-w-full` on the button, `min-w-0
truncate` on a span around the value, `shrink-0` on the icons, and `title`
carrying the whole string. Four chips across two files.

After: the chip is **358px** at 390px with the `×` present, `title` holds all
100 characters, the search input still holds all 100, **0px** overflow — and
at 1280px it renders at its natural 898px, so it truncates only when it must.

## 6. Gate 4 — 18 injections, and the hole was in my own rule

| row | injection | expect | result |
|---|---|---|---|
| 1 | **the real production state** — no cap on `/campaigns` | fire | FIRED |
| 2 | **the real production state** — canonical from RAW params | fire | FIRED |
| 3 | cap everything to nothing | fire | FIRED (8) |
| 4 | cap BELOW the longest recognisable category | fire | FIRED |
| 5 | `reportedValue` stops capping | fire | FIRED |
| 6 | wrap removed from the `/campaigns` notice | fire | FIRED |
| 7 | wrap removed from the blog notice | fire | FIRED |
| 8 | `min-w-0` removed | fire | FIRED |
| 9 | **the vacuity attack** — page links drop the raw value too | fire | FIRED (6) |
| 10 | `/completed-campaigns` keeps its own cap again | fire | FIRED |
| 11 | the blog notice stops capping | fire | FIRED |
| 12 | **over-correction** — an APPLIED filter dropped from the canonical | fire | FIRED |
| 13 | reword a comment | **pass** | PASSED |
| 14 | rename a local | **pass** | PASSED |
| 15 | the class stays, the COMMENT stops naming it | **pass** | PASSED |
| 16 | **the sibling production state** — the `q` chip is unbounded | fire | FIRED |
| 17 | the location chip loses `min-w-0` (truncate goes inert in flex) | fire | FIRED |
| 18 | `/completed-campaigns`' chips regress | fire | FIRED |

⛔ **Rows 6, 7 and 8 DID NOT FIRE on the first run.** My wrap rules searched
the whole file for `wrap-anywhere` and `min-w-0` — and the comments I had just
written explaining that those classes are load-bearing **quote them**, so three
injections that deleted the class from the markup passed.

`docs/116` §4 states this rule outright (*"the comment explaining the fix
necessarily quotes the forbidden string, so strip comments first"*) and
`docs/165` §3 the sibling one (*a mention is not a render*). **Both were read
before this file was written.** The rules strip comments now, row 15 proves the
rule does not depend on the comment, and the anti-vacuity row fails if the
stripper ever stops removing anything.

## 7. Gate

lint 1 pre-existing warning, typecheck clean, unit **8289 passed / 0 failed /
16 skipped** (299 files, +19 tests and +1 file), integration **329 passed / 0
failed** (35 files, unchanged).

## 8. ⚠️ Three probe failures, and two readings that were VOID

**`ss` is not installed in this sandbox.** Every
`ss -lntn | grep :PORT || echo none` run this session printed `none` — whether
or not anything was listening. The contradiction with `pg_isready` exposed it
and `curl` settled it, but it is `docs/164` §7 and `docs/135` §5 again: **a
probe that cannot see its subject reports exactly what an absent subject
reports.** Check a port with `curl`, a database with `pg_isready`.

⛔ **And that cost two void measurements.** `pkill` did not stop the server
(it exited 144, having matched its own shell — `docs/139` §11), `ss` reported
the port free, the next `next start` died with **`EADDRINUSE`** into a log file
nobody read, and the OLD server kept answering 200 — with `.next` rebuilt
underneath it, so its content-addressed chunks were gone and the client never
hydrated. The browser then reported **0 buttons and 0 inputs** on a listing
page, which read as *"the chip fix worked, 0px overflow"*.

⚠️ **The tell was the control**, as always: the chip was missing on the
100-character case AND on the short-value case, and the search input reported
**6** characters when the URL carried 100. Identical readings on subject and
control mean the probe, not the subject (`docs/135` §5). The input selector was
also wrong — it matched a hidden `source` field, which is where the 6 came
from. Every figure in §4, §5 and §6 was re-taken against a server confirmed to
be the new build.

## 9. What was NOT checked

- **Not deployed.** Every figure in §4 is a local production build on the E2E
  fixture. The §2 and §3 figures ARE production, on v171.
- **No crawler behaviour is claimed.** The verified statement is mechanical:
  the canonical now names `/campaigns` for a URL whose filter was not applied.
  What Google does with that is outside this measurement.
- **`/search` was not re-examined.** It forwards `BROWSE_PARAM_KEYS` and has
  no screen of its own (`docs/164`), so it cannot render a notice — but whether
  a forwarded junk value should survive the redirect was not revisited.
- **No screen reader was run.** The notice keeps `role="status"` and the chip
  keeps its `title`; whether a truncated value is announced usefully is
  unmeasured.
- **Other echoed params were not swept.** This looked at `category`, `sort`,
  `status`, `q` and `location` on three listings. Whether any other public
  page prints a URL value back was not inventoried — ⛔ `docs/45`'s rule has
  now produced the same defect on three surfaces and this is the second sweep
  over it (`docs/165` §3 was the first), so a third instance means the rule
  needs a sweep of its own rather than another per-surface fix.
- **The 1280px chip is 898px wide and does not truncate**, because it fits.
  Whether a chip should have a maximum width on desktop regardless is a design
  question, not measured here.
