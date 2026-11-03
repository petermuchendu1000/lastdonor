# 169 — Discovery was never the blocker, and IndexNow is for the engines Google is not

**Status: BUILT, NOT DEPLOYED.** Branch `claude/adoring-bell-7aka3l`. The
owner deploys (`docs/96`); the gate was run here and is reported in §7.

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

## 5. ⛔ Item 3 was NOT done, and it reopens an owner decision

The third thing I proposed was dropping the 17 empty category pages from the
sitemap. I proposed it without reading the doc that records the owner's
instruction against it. `src/lib/homepage-categories.test.ts:216-228`,
rule 7:

> *"The owner's instruction was explicit: make the grid data-driven AND keep
> the 23 in the sitemap. The obvious tidy-up after this change is to drop the
> empty ones, and that is a different decision — a category page with nothing
> in it today is a real page that fills later, and `generateStaticParams`
> builds all 23."*

So the change is (a) against a recorded explicit instruction, (b) pinned by
a test that would fail, and (c) described verbatim as the tidy-up not to do.

⚠️ And the obvious alternative is **worse**: serving those pages `noindex`
while leaving them in the sitemap is the contradiction
`src/lib/campaign-visibility.ts` already names — *a URL both submitted in a
sitemap and served `noindex` is a contradiction Google reports*. Every
technical variant of item 3 is either a reversal of an owner decision or a
known contradiction. **It is an owner call, and it is left untouched.**

## 6. Verification record

| | |
|---|---|
| IndexNow endpoint | probed with a **fabricated-path control**; `/submit-bulk` refuted |
| IndexNow POST shape | confirmed by the server distinguishing 403 (key) from 400 (`urlList` required) |
| key file served | **200 `text/plain`**, body exactly the key; a fabricated key file **404s** (control) |
| robots.txt | does not disallow the key file |
| `X-Robots-Tag` by Host | real execution, 8 hostnames, see below |
| unit | **8350 passed / 0 failed / 16 skipped**, 302 files (+34 tests, +2 files vs baseline — exactly the two new files) |
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

⚠️ **Row 5 fired when I had predicted green, and MY EXPECTATION was wrong.**
`^.*origin\.lastdonor\.org$` genuinely matches `xorigin.lastdonor.org`, so
the near-miss assertion was right to fail — [VERIFIED by reading which
assertion broke: *"expected [ 'noindex, nofollow' ] to deeply equal []"*].
`docs/163` §5.2 is the same shape.

## 7. ⛔ What was NOT checked

- **Nothing is deployed.** `docs/96`: the owner deploys. Every measurement
  above is local or against the live site's *current* (unchanged) state.
- **The header measurement is from `next dev`, not a production build.** The
  `headers()` function is the same in both and the matcher is Next's own,
  but a production build was not run. [INFERRED] it behaves identically;
  the cheap confirmation after deploy is one `curl -I` per hostname.
- **No real IndexNow submission has been made.** Every probe used a foreign
  host (`example.com`) with a bogus key, so nothing of ours was submitted
  and the 200 path has never executed against the real API. The first
  production publication is what exercises it — and the audit row is what
  will say whether it worked.
- **The key file is not yet live**, so IndexNow cannot verify ownership
  until this deploys. Until then a submission would answer 403.
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
