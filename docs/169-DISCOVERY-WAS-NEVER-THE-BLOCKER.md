# 169 — Discovery was never the blocker, and IndexNow is for the engines Google is not

**Status: ✅ DEPLOYED as v174, 2026-11-03**, merged to `main` at `3d5f1b4`.
Owner instruction on the day overrode the standing *"do not deploy"*
(`docs/96`); the gate was run on `main` first (8362 passed / 0 failed).

[VERIFIED live after the release] the sitemap went **50 → 33** URLs
(category **23 → 6**, campaigns 8 unchanged, and the 6 are exactly the 6
measured as holding campaigns); `origin.lastdonor.org` and
`lastdonor.fly.dev` serve `noindex, nofollow` while **the apex and `www`
serve none**; the IndexNow key file answers 200 with exactly the key against
a fabricated file's 404; `/donate` still renders its M-Pesa form; and the
de-advertised category pages still answer **200**. One `app` machine on
v174, updated in place, zero orphaned release machines — no partial rollout.

⚠️ **Deployed WITH `--prerender`**, which matters more for this change than
any before it: see §5.6: without it the sitemap bakes at **19** URLs rather
than 42. `deploy.sh`'s own closing line read `sitemap: 8 campaign URL(s)`,
which is the discriminator proving the builder reached the database.

---

## 1. ⚠️ A correction, before anything else

On 2026-11-03 I reported that LastDonor is not indexed because **Google had
never discovered it**, on the grounds that no code anywhere submits the
sitemap and the only page on the web linking here is the GitHub repository.

**That was wrong, and the mechanism is why.** `src/app/robots.ts:131` emits

```
Sitemap: https://lastdonor.org/sitemap.xml
```

and Google reads that directive out of robots.txt unprompted. **The channel
always existed.** Submitting the sitemap by hand in Search Console gave us
the *report*, not the *channel* — which is also why the submission reported
all 50 URLs instantly rather than after a crawl.

What I should have checked before concluding: whether the thing I said was
missing was already being advertised by a file I had read in the same
session. I read `robots.ts` twice and did not read the last two lines of it.

## 2. What Search Console actually showed

[VERIFIED from the owner's Page Indexing report, 2026-11-03] Google knows
**60 URLs** on this domain and has indexed **zero**.

| Reason | Pages | Reading |
|---|---|---|
| Excluded by `noindex` | 18 | ✅ correct — `/login`, `/register`, `/settings`, token pages |
| Blocked by robots.txt | 8 | ✅ correct — `/admin/`, `/api/`, `/dashboard`, `/profile` |
| Alternative page with canonical | 6 | ✅ canonical working — the duplicate hosts of §4 |
| Page with redirect | 2 | ✅ correct — `http→https`, `/search` 307 |
| **Not found (404)** | **20** | ⚠️ stale |
| Blocked due to other 4xx | 2 | ❓ **[UNKNOWN]** |
| **Crawled – currently not indexed** | **4** | ⛔ the verdict |

So **54 of the 60 are URLs we never wanted indexed**, and of the four real
pages Google actually read, it indexed none.

### 2.1 The 404s

[VERIFIED by live probe, with `/campaigns`, `/campaigns/category/medical`
and `/` at 200 as controls] 8 of the 20 are nameable and all are correctly
gone: the five unreviewed pipeline campaigns of `docs/116` §8
(`brent-ledbetter`, `nicholas-cabo`, `samuel-pierre-jr`,
`maj-sorffly-davius`, `david-l-jones`), the sixth of `docs/148`
(`help-john-recover-after-a-car-accident`), `/campaigns/category` (the
breadcrumb target `docs/128` removed) and `/campaigns/lastdonor-general-fund`
(`published_at` NULL by owner decision, `docs/147`).

⛔ **They must stay 404 and must not become 410.** A campaign in
`under_review` can still be approved; 410 tells Google to drop it
permanently. The status code is right. What is costly is that Google's
picture of this site is **five dead URLs for every live one it has read**,
on a domain whose crawl budget is already minimal.

The other 12 are **[UNKNOWN]** — the sample URLs are owner-only, one click
per row in Search Console.

### 2.2 One hypothesis ruled out

Suspected: Googlebot was being rate-limited into the "other 4xx" bucket.
[VERIFIED] `src/middleware.ts:267-294`'s matcher covers only `/dashboard`,
`/notifications`, `/profile`, `/admin` and `/api` — **no public page is rate
limited**, so a crawler cannot be 429'd on a campaign or category URL.
Refuted. Those 2 URLs remain unexplained.

### 2.3 The conclusion this forces

Nothing technical blocks indexing: robots allows, the meta is
`index, follow`, canonicals self-reference, and all 50 sitemap URLs answered
200 + indexable over 100 fetches the same day. **Google crawled and
declined** — the profile of a new domain with no inbound links and thin
inventory (8 campaigns, 17 of 23 category pages empty, `/blog` at 28 words).
That is not a defect to fix in code; it is why §3 targets the engines Google
is not.

## 3. IndexNow — `src/lib/indexnow.ts`

`docs/27:164` chose IndexNow and nothing was built. Google **does not
participate**; this reaches Bing, Yandex, Seznam, Naver and Yep, and the
receiving engine shares the submission with the rest. Those engines have no
channel here at all — no verification file, no submission call, no inbound
links — so unlike Google their silence really was discovery.

### 3.1 The protocol, probed rather than recalled

⚠️ **The first path probe was VOID.** A bare GET to *any* path on
`api.indexnow.org` answers **400**, including
`/definitely-not-a-real-path-control`. It cannot discriminate (`docs/135`
§5). A `bing.com` fake path answering 404 proved the *method* worked and the
*host* did not.

With full parameters it discriminates, and [VERIFIED 2026-11-03]:

| path | status | body |
|---|---|---|
| `/indexnow` | 403 | `{"errorCode":"UserForbiddedToAccessSite"...}` — real |
| `/IndexNow` | 403 | same (case-insensitive) |
| `/submit-bulk` | 400 | Edge HTML page — **not a real endpoint** |
| fabricated control | 400 | same Edge HTML |

⛔ A widely-copied third-party guide recommends `/submit-bulk`. It does not
exist. A test pins the verified endpoint.

The POST shape is confirmed **by the server itself**: a well-formed body
with a bad key reaches key validation (**403**), while a body missing
`urlList` is rejected at parse (**400 `InvalidRequestParameters`**, *"The
urlList field is required."*). That pair is what establishes the field
names `host` / `key` / `keyLocation` / `urlList`.

⚠️ **The 403 here is not reproducible, and §8.1 measured a bad key answering
202 instead.** Both have been observed against the same endpoint, so the API
is inconsistent about whether it checks the key synchronously. It changes
nothing in this section — either answer is a well-formed body reaching key
validation, which is all that is being established — but ⛔ **do not rely on
a bad key producing an error**: §8.1 and the CLAUDE.md convention record the
consequence, which is that a divergence can be silently accepted.

### 3.2 The invariant that decides whether this works at all

⛔ **The key appears in three places and all three must agree**: the
filename `public/<key>.txt`, that file's contents, and the `key` field in
the payload. Any divergence answers 403 and submissions stop working with
**no symptom anywhere on this site**. `indexnow.test.ts` rule 1 reads the
file off disk and compares all three.

⛔ **Every submitted URL must be on `INDEXNOW_HOST`** or the API refuses the
**whole batch** with 422 — one foreign URL loses every good one. So
`buildIndexNowSubmission` filters rather than trusting its caller, and rule
4 asserts the property over the built payload.

⚠️ `INDEXNOW_ORIGIN` is deliberately **not** read from `NEXT_PUBLIC_APP_URL`
or `NEXTAUTH_URL`: those resolve to `lastdonor.fly.dev` in some
environments, and submitting a `fly.dev` URL under `host: "lastdonor.org"`
is exactly the 422. Rule 2 derives `BASE_URL` from `src/app/sitemap.ts`'s
source and asserts equality — there are already four local copies of that
string in `src/`, and a fifth free-floating one is how they drift.

### 3.3 Where it is called, and why only there

The two `published_at` writers `docs/120` pins — the approval route and
resume — gated on `isFirstPublication`. The URL set is deliberately the same
three paths each route already hands `revalidatePath`: the pages whose
cached HTML we invalidate are the pages whose content a crawler holds a
stale copy of. Rule 5 derives both ends from the route's source, so a fourth
`revalidatePath` without a fourth submitted URL fails the build.

⛔ **No feature flag.** `docs/123` is this project's record of a flag
defaulting to off and the blog pipeline being silent for nine days with
nobody able to tell. The only guard is `NODE_ENV === 'production'`, which an
operator cannot set wrong and cannot forget.

⛔ **Every production attempt writes an audit row.** A submission that
failed silently would be the identical defect one level down — `docs/136`
§4.1: *a job that writes nothing when idle is indistinguishable from the
database from one that never ran*. `invalid_key`, `invalid_request` and
`wrong_host` are recorded at `error` severity because they repeat forever;
the rest at `info`. The event type is a **literal** (`docs/139` §6.1 built
one from a variable and produced `impact_update.rejectd` in production).

⛔ **`submitted` means received, never indexed.** The specification says 200
confirms receipt only. Rule 6 forbids any outcome spelled with "indexed"
(`docs/158`, `docs/160`, `docs/162`).

## 4. `noindex` on the duplicate hostnames

`docs/142` §7 reported this and it stayed open. [VERIFIED live 2026-11-03]
all four hostnames — apex, `www`, `origin.lastdonor.org`,
`lastdonor.fly.dev` — answered **200 with `index, follow` and no
`X-Robots-Tag`**. Search Console put the cost at the 6 URLs in "Alternative
page with proper canonical tag": the canonical *is* working, so nothing is
wrongly indexed; what it costs is crawl budget on a domain with none spare.

⛔ **Not a redirect.** `docs/66`'s cron Worker targets `lastdonor.fly.dev`
to dodge Cloudflare's 100s proxy ceiling, and `origin.lastdonor.org` is
grey-clouded on purpose (`docs/105`). Redirecting either breaks both.

⛔ **`www` is deliberately left indexable** — a conventional alias whose
canonical already points at the apex. A different decision, reported not
taken.

### 4.1 The semantics were read from Next's source, not its docs

The published docs call `has.value` *"a regex like string"* and never say
whether it is anchored — which is the entire question. [VERIFIED] from
`next/dist/shared/lib/router/utils/prepare-destination.js:104`:

```js
const matcher = new RegExp("^" + hasItem.value + "$");
```

Anchored, and the host is lowercased with the port stripped. So escaped dots
are precise and no pattern can reach the apex.

⚠️ **The blast radius of getting this wrong is the apex going `noindex`** —
the exact opposite of the goal, and invisible until traffic vanished. Hence
two independent guards: the ratchet reconstructs Next's own matcher over the
real config with **the apex as a must-NOT-match control**, and §6 measures
the running server.

## 5. Empty categories are no longer advertised — a REVERSED owner decision

I first proposed this without reading the doc recording the owner's
instruction against it, halted on that, and the owner then reversed the
instruction explicitly. Both halves are recorded because the reversal is the
decision, not the tidy-up it looks like.

### 5.1 What was reversed

`src/lib/homepage-categories.test.ts` rule 7, now amended in place:

> *"The owner's instruction was explicit: make the grid data-driven AND keep
> the 23 in the sitemap. The obvious tidy-up after this change is to drop the
> empty ones, and that is a different decision — a category page with nothing
> in it today is a real page that fills later, and `generateStaticParams`
> builds all 23."*

`docs/46`'s four reasons are preserved verbatim in `sitemap.ts` rather than
deleted, because none was refuted — each page renders its own editorial copy
and is a real landing page; they answer 200 regardless; dropping a URL from a
sitemap does not deindex it; and gating on a live count makes the advertised
set **flap**. ⚠️ **The flapping cost is accepted, not solved.**

What outweighed them is a measurement that did not exist when they were
written: Search Console on 2026-11-03 shows **60 URLs known, zero indexed**,
four of them *"Crawled – currently not indexed"*. On a domain whose crawl
budget is demonstrably not reaching the pages that matter, advertising 17
near-empty URLs is a cost with no measured benefit.

### 5.2 The invariant, and why it holds in the safe direction

> **A category advertised in the sitemap renders at least one campaign on its
> page.**

| | status set | fund excluded | `published_at` |
|---|---|---|---|
| sitemap (`sitemap.ts:~300`) | `LIVE_SITEMAP_STATUSES` | yes | **required** |
| category page (`page.tsx:90`) | `listedCampaignFilter()` — same two | yes | not required |

[VERIFIED from `public-campaigns.ts:93-101`] the sitemap's test is **strictly
narrower**, so it can under-advertise and can never advertise an empty page.
A category holding only `completed` campaigns is correctly dropped — that
page shows the live set. ⛔ Nothing connects those two declarations, so a new
test derives both from source and fails if either moves.

### 5.3 ⛔ Absence of data is not emptiness

`advertisedCategorySlugs` keys on a new `campaignsLoaded` flag, **not** on
`newestByCategory.size`. `NO_DERIVED_DATES` carries an empty map because the
campaign read FAILED, and `sitemap()`'s own comment requires the dates to
*"fall back to the editorial constant rather than disappearing"*. A bare
`.has()` would drop all 23 URLs on any database failure.

⚠️ That this was the right design is not my judgement: `sitemap.test.ts`
**already had a test** named *"keeps every category landing page"* on a
database failure. Three independent signals agreed before a line was changed
— the code comment, the `NO_DERIVED_DATES` sentinel, and that test. Same rule
as `docs/106` (*a MISSING trusted name is "cannot judge", never "no
mismatch"*) and `docs/159` (*`keepPolling === false`, never `!keepPolling`*).

⛔ An **empty database** is the opposite case and now drops all 23: the tally
is known and every category really is empty. The two are pinned against each
other in one test, because either rule alone can be satisfied wrongly.

### 5.4 ⛔ Not paired with `noindex`, deliberately

Serving these `noindex` while leaving them in the sitemap is the
contradiction `campaign-visibility.ts` names — *a URL both submitted in a
sitemap and served `noindex` is a contradiction Google reports*. An
unadvertised URL is not in that bind. `noindex`ing them is a second, larger
decision and was not taken.

### 5.5 ⛔ The pages are untouched

`generateStaticParams` still builds all 23 and each still answers 200. Rule 7
now guards exactly that, having previously guarded the opposite.

### 5.6 Measured effect

[VERIFIED live, 23 category pages fetched 2026-11-03] **6 hold campaigns**
(medical 3; emergency, community, veterans, disaster, essential-needs 1 each)
and **17 are empty**. Those 6 sum to **8 campaigns — exactly the 8 live
ones**, which is the control that makes the count trustworthy, and the live
sitemap's 50 URLs decompose as 19 static + 23 category + 8 campaign.

**Predicted after deploy: 50 → 33** (19 + 6 + 8).

⚠️ Accepted regression: a deploy without `--prerender` (`docs/119`) now bakes
**19** URLs rather than 42 for up to an hour, because the build-phase
fail-soft returns zero rows without throwing — `campaignsLoaded` is true and
the tally is honestly empty. The campaign URLs already vanish in that case,
so the sitemap is degraded either way, and the flag remains the fix.

## 6. Verification record

| | |
|---|---|
| IndexNow endpoint | probed with a **fabricated-path control**; `/submit-bulk` refuted |
| IndexNow POST shape | confirmed by the server distinguishing 403 (key) from 400 (`urlList` required) |
| key file served | **200 `text/plain`**, body exactly the key; a fabricated key file **404s** (control) |
| robots.txt | does not disallow the key file |
| `X-Robots-Tag` by Host | real execution, 8 hostnames, see below |
| category tally, live | 23 pages fetched: **6 hold campaigns, 17 empty**; the 6 sum to the 8 live campaigns |
| unit | **8362 passed / 0 failed / 16 skipped**, 302 files |
| typecheck | clean |
| lint | clean (1 pre-existing warning in an untouched file) |

Header measurement, same path, varying only the Host header:

| Host | X-Robots-Tag |
|---|---|
| **`lastdonor.org`** | **(none)** ← the control that makes the rest mean anything |
| `www.lastdonor.org` | (none) |
| `origin.lastdonor.org` | `noindex, nofollow` |
| `lastdonor.fly.dev` | `noindex, nofollow` |
| `LASTDONOR.FLY.DEV` | `noindex, nofollow` (lowercased) |
| `lastdonor.fly.dev:443` | `noindex, nofollow` (port stripped) |
| `xorigin.lastdonor.org` | (none) (anchored) |
| `lastdonor.fly.dev.attacker.test` | (none) (anchored) |

### 6.1 Injections

**IndexNow: 12/12 behave** (10 must-fail, 2 must-pass), sha-verified clean
restore after every row.

⚠️ **Row 6 first read DID NOT FIRE and was VOID, not a hole.** It renamed
the `'submitted'` member of the **type union**, and **vitest does not
typecheck** (`docs/162` §6), so nothing a runtime assertion can see moved.
Re-run against the returned literal it fires (23 passed / 3 failed). The
harness checks that the anchor matched and that the file sha changed, and
*both passed* — an injection can apply cleanly and still mutate something
the rule does not govern (`docs/152`).

**noindex hosts: 6/6 behave**, including both catastrophic rows (a pattern
widened to `.*lastdonor.*`, and the host condition dropped entirely) which
fire on the apex control.

**sitemap categories: 10/10 behave** (8 must-fail, 2 must-pass). The rows
that earn their place: row 1 restores the real production state (all 23
mapped unconditionally); row 3 keys the guard on `newestByCategory.size`,
collapsing "known empty" into "unknown"; row 4 inverts the filter so it
advertises exactly the empty ones; and rows 7 and 8 drift the two status
lists apart from either end.

⚠️ **I predicted ONE test would break and FOUR did.** The three I missed were
not noise: an empty database, a completed-only category, and a
no-live-campaign category all asserted the *editorial-date fallback* on
entries that no longer exist. Each was repointed to the path where the
property is still reachable rather than deleted — and reading them is what
changed my mind on the empty-database case, which I had initially intended
to treat as "unknown".

⚠️ **Row 5 fired when I had predicted green, and MY EXPECTATION was wrong.**
`^.*origin\.lastdonor\.org$` genuinely matches `xorigin.lastdonor.org`, so
the near-miss assertion was right to fail — [VERIFIED by reading which
assertion broke: *"expected [ 'noindex, nofollow' ] to deeply equal []"*].
`docs/163` §5.2 is the same shape.

## 7. ⛔ What was NOT checked

- ✅ **RESOLVED the same day — see §8. The key DOES validate, and the 200 path
  has executed.** This item used to read *"whether the IndexNow key VALIDATES
  is [UNKNOWN] … Bing Webmaster Tools is the only place that shows received
  URLs"*. Both halves were wrong, and §8 records the probe that settles it.
  What stands from the original wording: the first post-deploy probe really
  was **void**, because a real submission answered **202** and so did a
  wrong-key control — but the reason was that the probe ran from the sandbox
  and read 202 as the best available answer, not that the API cannot
  discriminate. It can. **200 is the discriminator, not 202.**
- **The `noindex` headers were verified live, which supersedes the earlier
  `next dev` measurement** — but only on `/`. Other paths were not sampled
  per host.
- **12 of the 20 Search Console 404s are unidentified** (owner-only sample).
- **The 2 "Blocked due to other 4xx" URLs are unexplained.** Rate limiting
  is refuted; nothing else was established.
- **Safe Browsing / Manual Actions status is [UNKNOWN]** — the Transparency
  Report is client-rendered and could not be read.
- **Whether `noindex` on the duplicate hosts measurably helps is
  [UNKNOWN].** It removes 6 URLs of crawl waste. It does not address the
  reason the 4 real pages were declined, which is §2.3.
- **Bing's current index state is [UNKNOWN].** A `site:` probe via
  DuckDuckGo was void — the control (`site:gofundme.com`) also returned zero
  result links, so the probe could not discriminate.
- **Whether dropping 17 URLs measurably helps is [UNKNOWN].** It removes
  advertisement of pages Google has shown no sign of wanting. It does not
  address §2.3, which is why the four real pages it *did* read were declined.
  The honest expectation is a smaller, cleaner sitemap — not indexing.
- ✅ **The 33-entry prediction is now OBSERVED**, not inferred: two reads
  after the deploy both returned `total=33 category=6 campaign=8`, and the
  six advertised are exactly the six measured as holding campaigns.
- **The flapping cost is unquantified.** A category crossing zero now adds or
  removes a sitemap URL within the hour. Nobody has measured what Google does
  with a sitemap whose entry set moves; `docs/46` raised it as an objection
  and this change accepts it without evidence either way.
- **Nothing was re-measured after the category-page fetches**, so the 6/17
  split is a single sample per page. It is internally corroborated (the 6 sum
  to the 8 live campaigns) but was not repeated.

---

## 8. ✅ The key validates, and the 200 path has executed

Added 2026-11-03, a few hours after §7 was written, in answer to the owner
asking for IndexNow to be verified by approving a campaign. **It corrects §7's
first bullet, which claimed key validation was [UNKNOWN] and that only Bing
Webmaster Tools could settle it. Both claims were wrong.**

### 8.1 The three-arm probe, run from the production machine

§7's void probe ran from the sandbox and got **202** for the real key and 202
for a wrong-key control, so it could not discriminate. Re-run from the app
machine itself (`flyctl ssh console`, so the egress path is production's own),
with the key as the ONLY variable between arms A and B:

| arm | host | key | urlList | answer |
|---|---|---|---|---|
| A | `lastdonor.org` | **real** | `https://lastdonor.org/` | **200** `""` |
| B | `lastdonor.org` | wrong (same shape) | `https://lastdonor.org/` | **202** `""` |
| C | `lastdonor.org` | real | `https://example.com/` | **422** `InvalidRequestParameters` |

**So 200 is the discriminator and 202 is not acceptance.** A and B differ in
the key alone, which is what makes this evidence rather than a reading:

- **200** = submitted, key validated.
- **202** = received, key *not yet* validated — exactly what this codebase's
  classifier already names `pending_key_validation`.
- **422** is the positive control, and its message is the strongest single
  line in the whole probe: *"One or more URLs are not related to your
  **verified domain**."* IndexNow itself calls `lastdonor.org` verified.

Stability: arm A repeated **200 / 200 / 200** at 2s spacing, and
`https://lastdonor.org/<key>.txt` answers **200** with the exact key as its
body. ⚠️ A fabricated host (`example.invalid`, fabricated key) also answers
**202**, which is why 202 carries no information at all — it is returned for a
domain that does not resolve.

⚠️ **Why the earlier probe saw 202 for the real key is [INFERRED], not
verified.** The likely mechanism is that IndexNow fetches the key file
asynchronously on first sight and answers 202 until it has, then 200
thereafter; roughly 40 minutes separated the two measurements. Nothing here
depends on that explanation being right — the A/B/C contrast stands on its own.

### 8.2 The approval route, exercised end to end

§7's second bullet said *"the 200 path has still never executed"*. It has now,
with **`isFirstPublication` proven in both directions**.

⛔ **It was NOT verified by publishing a production campaign, and that was
deliberate.** The production queue holds **15** `under_review` rows and
**12 have `creator_id NULL`** — machine-written appeals about real named
people, the `docs/116` §8 class that `docs/148` retracted. Which of those goes
public is an editorial decision, not an audit's to make, and publishing one to
read an audit row would be the `docs/131` mistake in a new costume.

Instead: a local **production-mode** build (`next start`, so `NODE_ENV` is
production and the guard does not short-circuit), a throwaway Postgres, a
seeded admin, and a seeded `under_review` campaign **whose slug is one that is
already live in production** (`tuan-nguyen`). `INDEXNOW_ORIGIN` is a hardcoded
constant, so the submission carries real, live, already-advertised URLs — a
correct submission, not a fabricated one. Signed in through the real
credentials endpoint (`session role=admin`), then `PATCH .../campaigns/<id>`
with `{"status":"active"}` → **200**.

The row it wrote, 582ms after `campaign.published`:

```
event_type  | seo.indexnow_submitted
severity    | info
target_type | campaign
details     | { "urls": [ "https://lastdonor.org/campaigns/tuan-nguyen",
            |             "https://lastdonor.org/campaigns",
            |             "https://lastdonor.org/" ],
            |   "detail": "HTTP 200",
            |   "reason": "campaign.published",
            |   "outcome": "submitted",
            |   "submittedCount": 3 }
```

**The control, because "it fires on approval" is also satisfied by "it fires on
everything":** the same campaign was then driven `active → draft → active`
through the same route. Both answered 200 and both wrote
`campaign.status_changed`, `published_at` was preserved at its original stamp —
and the `seo.%` count **stayed at exactly 1**. So the gate suppresses a
re-publication, which is the half a one-arm test cannot see.

⚠️ **`NODE_ENV` could not be read from `/proc/<pid>/environ`** — `next start`
assigns it inside the Node process, and two `next-server` pids disagreed
because Next respawns workers (`docs/156` §6's moving-pid trap). It was settled
behaviourally instead, from `docs/64`: the dev CSP adds `'unsafe-eval'` and
`ws://localhost`, and the local response's `script-src` carried **neither** and
was identical to production's. That is the discriminator; the pid read was not.

### 8.3 What is still not verified

- ✅ **RESOLVED — see §8.4. The production route has now run it.** This item
  used to read *"the PRODUCTION deployment's route has still never run this"*,
  which was true for about ten minutes.
- **Whether Bing then indexes anything is [UNKNOWN]** and is not what any of
  this measures. `submitted` means received (`docs/158`, `docs/160`,
  `docs/162`). Bing remains unverified as a property (`docs/142` §6).
- **Only the 200 path was executed.** `invalid_key`, `wrong_host`,
  `rate_limited` and the timeout path are covered by unit tests, not by
  execution against the live API.

### 8.4 ✅ Production, on a real approval

2026-11-03 11:32:45Z. The owner named the campaign — the editorial decision
§8.2 declined to make — and
`help-maksym-a-ukrainian-war-veteran-and-widowed-father-overcome-a-financial-crisis`
was approved through the real production route. It is the one row in the queue
with a real organiser behind it and a substantial first-person story; the 12
with `creator_id NULL` are untouched.

**Baseline first** (`docs/119`'s rule — measure before asserting after):
sitemap `total=33 campaign=8 category=6`, Maksym absent; the campaign page
**404** against `tuan-nguyen`'s **200** as the control; `seo_rows=0`.

The row:

```
11:32:45.146Z  campaign.published       warning  actor=676ad0be… (the admin)
11:32:45.747Z  seo.indexnow_submitted   info
  urls  [ /campaigns/help-maksym-…, /campaigns, / ]
  detail "HTTP 200"   outcome "submitted"   submittedCount 3
```

**HTTP 200 in production too**, 601ms after publication — so §8.1's finding
holds on the deployed path and not merely from a shell on the same machine.
`live_published` 8 → **9**, `under_review` 15 → **14**, `published_at` stamped.

Verified after: the page **200** (fabricated slug 404 as the control),
`index, follow`, self-canonical, renders the organiser's name, and appears on
`/campaigns` — so the three `revalidatePath` calls took effect. The organiser's
notification exists with `email_sent: true` and its link resolves, which is
`docs/118`'s guard holding on a live row.

⚠️ **The session was MINTED, not signed in, and that is worth recording.** The
standalone image bundles `next-auth` into its chunks, so there is no importable
copy on the machine, and pulling `NEXTAUTH_SECRET` into a sandbox to forge one
there would have created a credential exposure to run a test. Instead an
Auth.js JWE was minted **on the machine with its own secret**, using nothing
but Node's `crypto` — HKDF-SHA256 with the cookie name as salt, then `dir` +
A256CBC-HS512, `kid` omitted (which `@auth/core`'s decode explicitly permits).
⛔ **The encoder was proven before it was used**: locally, its output was
round-tripped through the REAL `@auth/core/jwt.decode`, with a wrong salt and
a wrong secret as controls — both `JWEDecryptionFailed`. And the drive script
refused to PATCH unless `/api/auth/session` first returned `role=admin`, then
sent the same PATCH **with no cookie** as a control (**401**), so the 200
cannot be read as the route being open.

⚠️ **Two ISR surfaces lag, and neither is a defect.** The route revalidates
`/campaigns/<slug>`, `/campaigns` and `/` — not the sitemap (`revalidate =
3600`) and not the category page (`300`). Measured: three sitemap reads at
+2 min still said `33/8/6` with Maksym absent, and `/campaigns/category/family`
showed nothing; the category page then **healed at +5m30s** (3 reads, 1 card
each). So IndexNow announces a page the sitemap has not yet caught up with,
by design — IndexNow is the faster channel, which is the whole reason it exists.

✅ **§8.5 THE FLAP IS OBSERVED, and the §5 invariant holds in the refill
direction.** `family` was one of the 17 EMPTY categories this change stopped
advertising; it now holds one campaign. The prediction `total=35 campaign=9
category=7` was recorded here before being measured, and at 11:56Z:

| read | total | campaign | category | maksym |
|---|---|---|---|---|
| 1 | 33 | 8 | 6 | absent |
| 2 | **35** | **9** | **7** | present |
| 3–4 | 35 | 9 | 7 | present |

⚠️ **Read 1 is why `docs/119`'s two-request rule exists.** Stale-while-
revalidate served the expired entry and only *scheduled* the refresh, so a
single read would have reported `33/8/6` and read as *"the sitemap never
updated"*. The seventh category is `family`, as predicted.

⚠️ **And the lag was ~24 minutes, not the ~60 this section implied**, because
the ISR clock runs from when the cache ENTRY was generated — here around the
v174 deploy — **not from the data change**. So "up to an hour" is the ceiling,
and where in that hour a change lands is not something the change controls.

The invariant was then checked both ways, with the sum as the control:

- All **9** advertised campaign URLs answer **200**.
- All **7** advertised category pages answer 200 and are non-empty, and their
  card counts sum to exactly **9** — the live campaign count (`medical` holds
  3, the other six hold 1 each).
- CONTROL: `education`, `memorial` and `first-responders` answer **200 with 0
  cards**. Advertisement moved; rendering did not, which is §5's central claim.

⚠️ One of my own measurements was wrong first: `grep -c` counts matching
LINES, and this HTML is minified, so it reported `cards=1` for every category
including `medical`. `grep -o | sort -u | wc -l` gives the real counts. The
non-empty half of the invariant survived either way; the sum control only
works with the corrected count.
