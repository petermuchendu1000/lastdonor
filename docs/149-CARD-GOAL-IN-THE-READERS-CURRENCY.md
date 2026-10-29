# 149 — The card goal, in the reader's own currency

Owner decision 2026-10-29, option (2) of the FX discussion in `docs/148`'s
successor conversation: wire the **existing** display-FX layer into the
surfaces a visitor actually browses. No schema change, no money path, no rate
anywhere near an amount column.

---

## 1. The gap, and why it was invisible

`docs/102` built the whole display-FX layer — `convertMinor`, `ApproxMoney`,
`LocalAmount`, a daily `refresh-fx-rates` cron, a 48-hour staleness refusal,
provider attribution as a licence term, and an import allowlist that fails the
build if a money-writing module can see a rate. `docs/103` added browser-side
country detection; `docs/104` fixed the reader bug that made it 98.7% inert and
verified the fix in a real browser at `Africa/Kampala`.

⛔ **And then it was wired to exactly one figure**: the goal on
`campaigns/[slug]/page.tsx:639`.

[VERIFIED by inventory] every card a visitor browses — the homepage grid,
`/campaigns`, the category pages, similar campaigns, completed campaigns —
carried **no local equivalent at all**. So a Kenyan reading a dollar appeal had
no way to size it, on a platform whose only working rail is M-Pesa
(`docs/147`).

⚠️ **A comment in that file said the task was impossible.** `page.tsx:617-624`
read:

> *"the reverse would mean guessing which currency a reader of a USD campaign
> thinks in, and **this codebase has no viewer-locale detection**. When one
> exists, this is where it goes."*

Viewer-locale detection had existed since `docs/103`, and the sentence sat
directly above `<LocalAmount>` — the component whose entire purpose is to do
it. A reader taking the comment at face value would have concluded this work
could not be done.

## 2. What was done

One `<LocalAmount>` per card, on the **goal**, rendered after the
funded/unfunded branch so it appears in both shapes.

**The goal and not the raised figure, deliberately.** The goal is the number
that tells a reader how big an appeal is, and [VERIFIED from production
2026-10-29] every live campaign has `raised_amount = 0` — so converting both
would double the approximate figures on a twelve-card grid to say the same
nothing twice.

Pages that now read the snapshot: `(home)`, `campaigns/(index)`,
`campaigns/category/[category]`, `completed-campaigns`.
`campaigns/[slug]` already read it and now passes it to its similar-campaign
cards.

### 2.1 ⛔ A PROP, not a server-rendered node

The obvious shape is to render the converted figure on the server and pass it
into the card as a `ReactNode` slot, which would keep the card FX-blind.

**It would have been a half-fix.** `CampaignGrid` builds cards **in the
browser** after a "Load more" fetch (`docs/145`), and nothing constructed on
the server can reach those — so page 1 would convert and page 2 would
silently not. That is the exact shape `docs/115` already found on this
component once, when appended cards rendered every amount in dollars because
the listing API never selected `currency`.

So the snapshot is a prop, `CampaignGrid` forwards it, and §5.3 proves in a
browser that appended cards convert.

### 2.2 The homepage reads it INSIDE its cache; the others do not

`getHomepageData` is wrapped in `unstable_cache` at 300s, and the homepage is
the busiest public route. Reading the snapshot inside that function costs one
query per five minutes instead of one per visitor.

⚠️ `docs/144` warns that this cache **serializes** what it returns — which is
why the category *cards* cannot go through it, since a `ShowcaseCategory`
carries an icon component. An `FxSnapshot` is plain JSON ([VERIFIED] **2,769
bytes**, 151 rates, in `site_settings` under `fx:usd-rates:v1`), so it holds
perfectly well. The distinction is the lesson: that doc forbids caching a
*function*, not a *document*.

`/campaigns` reads `searchParams` and is therefore dynamic (`docs/104` §4), so
there the read is per-request and unavoidable.

### 2.3 Sequential, never in the batch — and this is PROVEN, not read

`docs/87` caps an entry point at **three concurrent** queries against a pool of
five. Every new read is `await readFxSnapshot()` on its own line, after the
page's existing `Promise.all`.

⚠️ The existing campaign page states this constraint in a comment at
`:355-362`. A comment is not evidence. **Injection 7b moved the homepage's read
into its `Promise.all` and `src/db/pool-fanout.ratchet.test.ts` FAILED** — so
"sequential is legal, a fourth concurrent is not" is now verified by execution.

## 3. What was deliberately left out, and why

⛔ **The charge amounts in both donation forms.** `MpesaDonationForm` and
`DonationForm` render the sum about to leave someone's phone or card. An
approximate figure beside an exact charge, at the moment of payment, is a
trust hazard — `docs/42` is about rendering a receipt only from a
gateway-verified state, and this is the same family. It needs its own
decision, not a side effect of this one.

⛔ **`DonorFeed`.** A gift is a fact about what somebody gave, not an input to
the reader's decision, and converting each one adds twelve approximations to a
feed.

⛔ **`/transparency`.** It publishes per-currency totals that CLAUDE.md
forbids summing. Adding converted equivalents invites exactly that sum.

⛔ **`SidebarDonationSummary` and `StickyMobileDonateBar`.** The campaign page
already converts its goal in the body, so that page is served; the sticky
bar's mobile height is budgeted by `docs/60`/`docs/62`, which makes adding a
line there a layout decision rather than a wiring one.

✅ **`ProgressBar` needed nothing** — [VERIFIED] it renders a percentage and a
bar and no money at all.

## 4. The FX allowlist grew by six, on purpose

`fx-display-only.ratchet.test.ts`'s header says *"Adding one is not forbidden;
doing it without noticing is."* Six entries were added with a reason each.

⚠️ **They are listed because `importsFx` matches the module path as raw text**
(`:80`), so even `import type { FxSnapshot }` trips it. None of the six calls
`convertMinor`; none appears in `MONEY_WRITE_SIGNALS`, which is the rule that
actually matters and is untouched.

## 5. The checks

`src/components/campaign/card-local-currency.test.ts`, 7 tests. It
**discovers** every file rendering `<CampaignCard>` or `<CampaignGrid>` from
disk, so a new surface fails until it wires the converter.

**Rule 3 is the one that earns its place.** The defect this codebase keeps
repeating is a prop that is declared and never read: `docs/119`'s
`hasCampaigns`, destructured as `_hasCampaigns` and thrown away after costing
a query, and `docs/132`'s `isAdmin`, declared on `AdminDashboard` and
destructured away so an editor saw donor names against gift amounts. A card
that accepted `fxSnapshot` and rendered nothing with it would satisfy rules 1
and 2 completely.

### 5.1 ⚠️ My own rule matched both the fixed and the broken version

Injection row 1 renamed `<LocalAmount` to `<LocalAmountXX` — the production
state, in effect — and **DID NOT FIRE**. Rule 3 asserted `/<LocalAmount/`, and
the broken text still *contains* that pattern as a substring.

That is Gate 4's named trap word for word: *a grep whose pattern would match
both the fixed and the broken version.* The rule is now `/<LocalAmount\b/`,
and the harness carries both the faithful injection (delete the whole block)
and the substring trap as separate rows.

### 5.2 All 11 injections fire

sha256-verified clean restore after each (`docs/120` §11.1). Rows: the block
deleted (the real production state); the component renamed (the substring
trap); the card declaring the prop and discarding it; a render site dropping
`fxSnapshot`; a page no longer reading the snapshot; the grid not forwarding
to appended cards; a USD appeal falling back to converting USD into USD; the
read moved into the `Promise.all` (against both my text tripwire **and** the
real fanout ratchet); the discovery emptied, so anti-vacuity fires; and the
card removed from the FX allowlist.

### 5.3 Verified in a real browser, PAIRED

`docs/104`'s lesson is that this class is invisible without one — a missing
rate renders as nothing by design.

| arm | `/campaigns` | `/` |
|---|---|---|
| **A: `Africa/Nairobi` + `en-KE`** | 12 cards → **12 "about Ksh"** | 6 cards → **6 "about Ksh"** |
| **B: `America/New_York` + `en-US`** (control) | 12 cards → **0** | 6 cards → **0** |
| dangling `"Goal is"` with no figure | **0** | **0** |

Arm B is the control: without it, arm A cannot tell *"conversion works"* from
*"something prints Ksh unconditionally"*. It reads 0 because
`LocalAmount.tsx:80-91` already refuses a same-currency conversion once
detection resolves — [VERIFIED by reading, then by this measurement].

Zero dangling labels confirms the `docs/107` §8.2 class is absent: `label` is
a **prop inside** the component, so it disappears with the figure.

**And appended cards convert.** Clicking "Load more" at Nairobi: cards
**12 → 14**, conversions **12 → 14**. Two appended, two converted — §2.1's
hazard measured rather than argued.

## 5.4 The mobile cost, measured — and one open design question

Measured at 390px as a PAIR from the same build, which is what makes the
difference attributable: Nairobi renders the line, New York does not.

```
with conversion (Nairobi)    page=5011px  firstCard=184px  horizOverflow=0px
without          (New York)  page=4387px  firstCard=132px  horizOverflow=0px

per-card cost: 52px    page cost: 624px over 12 cards    (12 x 52 = 624 ✓)
```

⚠️ Overflow was measured with `scrollWidth - clientWidth` and
`isMobile: false`, because `docs/128` §5 established that Playwright's
`isMobile: true` **hides** horizontal overflow — Chromium widens the layout
viewport instead of scrolling. **0px in both arms.**

**The 52px decomposes exactly**: 16px figure + 32px wrapped attribution + 4px
margin.

⚠️ **A defect I nearly reported and did not have.** `innerText` reads
`"about Ksh 649,162at the 2026-10-29 rate · Exchange rates by
ExchangeRate-API"` — the figure and the attribution apparently run together.
They do not: the attribution is an inline `<a>` whose box sits **16px below**
the figure's (`figTop=490`, `attrTop=506`, `sameLine: false`), so that is a
line-wrap artifact of `innerText`, not something a reader sees.

⛔ **OPEN, and deliberately not decided here: 32 of those 52px are the
attribution, repeated on every card.** `ApproxMoney` has a `hideAttribution`
prop and [VERIFIED] **no call site uses it** — there is no precedent. The
ratchet pins that the component *contains* the attribution markup
(`:154-157`), not that every render shows it, so hiding it on cards would pass
the build.

**It was not used.** The attribution is a LICENCE term of the open endpoint
(`docs/102`, citing exchangerate-api.com's terms as read 2026-10-24), and
suppressing it on the highest-traffic surfaces in the product is exactly the
erosion that pin exists to prevent. A version that hides it per card while
rendering it once per page would likely satisfy the licence and recover
~576px on a 12-card phone view — but that is a licence judgement plus a
`docs/60`/`docs/62` height-budget decision, and it belongs to the owner, not
to the wiring change that happened to measure it.

## 6. What is NOT verified

> ⚠️ **EVERY BULLET BELOW IS SUPERSEDED BY §7**, written the same day after
> this change was merged and deployed as **v141**. They are kept verbatim
> because what was unchecked at the time of a change is part of its record,
> and because two of them turned out to be checkable in ways that changed
> what is known rather than merely confirming it.

- **Nothing is deployed.** This is on `claude/adoring-bell-7aka3l` only; the
  owner deploys (`docs/96`). Production still shows no conversion on any card.
- **The real rate was not used in the browser run.** The local snapshot was
  written by hand with KES at **129.832372**, copied from production, and four
  other rates invented. The conversion arithmetic is `convertMinor`'s and is
  covered by `fx-convert.test.ts`; this run tested the WIRING.
- **Staleness and the missing-snapshot path were not exercised in the
  browser.** Both render nothing by design and are covered by unit tests, but
  "renders nothing" is what a broken wiring also looks like — the Nairobi arm
  is what distinguishes them, and it only ran with a fresh snapshot.
- **The integration and E2E suites were not run** for this change; it adds no
  query shape and no route.
- **The `/campaigns` latency cost was not measured.** That page is dynamic
  (`docs/104` §4), so its snapshot read is one extra sequential round trip per
  request. Legal under `docs/87` (the cap is on concurrent queries, proven by
  injection) but not timed.

---

## 7. AMENDMENT 2026-10-29: merged, deployed as v141, and §6 closed

§6 above listed five things this change had not verified. All five were then
checked, and **two of them turned out to be checkable in ways that changed
what is known** rather than merely confirming it. Deployed state: image
`lastdonor:deployment-01M6476PPEM6F0Z17S7RDDW78J`, machine version **141**,
`arn`, 1/1 checks passing, deploy took 411s on the first attempt (no
`no capacity available`, unlike `docs/146` §9.1a).

### 7.1 The real rate — RESOLVED, and the arithmetic checked per campaign

§6 said the browser run used a hand-written snapshot with KES copied from
production and four other rates invented, so it tested the WIRING and not the
arithmetic. Redone against **production's own snapshot**, read from
`site_settings`: provider `open.er-api.com`, `asOf` `2026-10-29T00:02:31Z`,
`fetchedAt` `2026-10-29T02:00:05.687Z`, **151 rates**, KES `129.832372`.

Each card's own dollar figure was read out of the rendered page, converted
independently, and compared with what the page printed:

```
  keisha-wallace       $  5000  printed Ksh    649162  expected    649162  delta 0
  danielle-sutton      $ 35000  printed Ksh   4544133  expected   4544133  delta 0
  antonio-rivera       $ 25000  printed Ksh   3245809  expected   3245809  delta 0
  david-nwosu          $150000  printed Ksh  19474856  expected  19474856  delta 0
  marcus-delgado       $ 20000  printed Ksh   2596647  expected   2596647  delta 0
  mila-ostrowski       $ 35000  printed Ksh   4544133  expected   4544133  delta 0
  harold-jennings      $ 15000  printed Ksh   1947486  expected   1947486  delta 0
  tuan-nguyen          $ 15000  printed Ksh   1947486  expected   1947486  delta 0
  matched=8  mismatched=0  missing=0
```

Six distinct goals spanning 30x, so a wrong exponent or a scaled rate would
have shown as a proportional miss on all eight rather than nothing at all.

And the deploy itself is a PAIRED measurement on one host, which is what makes
the change attributable rather than merely coincident with it:

| | `/campaigns` Nairobi | `/` Nairobi | `/campaigns` New York | `/` New York |
|---|---|---|---|---|
| **before** the deploy | 8 cards, **0** | 6 cards, **0** | 8 cards, **0** | 6 cards, **0** |
| **after** | 8 cards, **8** | 6 cards, **6** | 8 cards, **0** | 6 cards, **0** |

The New York column is the control throughout: `LocalAmount:80-91` refuses a
same-currency conversion, so a figure appearing there would mean something
prints Ksh unconditionally.

### 7.2 ⛔ Staleness and absence — RESOLVED, and they are TWO refusals, not one

§6 treated this as one gap. Reading the code first showed it is two, in two
different places, and a single test could not have covered both:

- **absent** — `readFxSnapshot` returns `null` on the **server**, and
  `ApproxMoney` stops at `if (!snapshot) return null`.
- **stale** — the row parses fine and is handed to the browser;
  `convertMinor` refuses there on `snapshot.asOf`, and the component stops at
  `if (converted === null) return null`.

Exercised in one local production build, one process, with production's real
151-rate table and only the timestamp changing between arms:

| arm | snapshot state | cards | dollar goals | "about Ksh" |
|---|---|---|---|---|
| 1 | fresh (`asOf` = now) | 12 | 12 | **12** |
| 2 | **stale**, `asOf` = now − 49h | 12 | 12 | **0** |
| 3 | **edge**, `asOf` = now − 47h | 12 | 12 | **12** |
| 4 | **absent**, row deleted | 12 | 12 | **0** |
| 5 | fresh, restored | 12 | 12 | **12** |

⚠️ **This is what answers §6's actual objection** — *"renders nothing is what
broken wiring also looks like"*. `cards=12` and `dollars=12` in **every** arm,
so in the negative arms the page is intact and only the converted line is
gone. Three further properties the arm order buys:

- **arm 3 pins the boundary at 48h.** Without it, "stale renders nothing"
  would be satisfied by a component that refuses any `asOf` more than a few
  hours old, or by one that never renders at all.
- **arm 5 is why arms 2 and 4 mean anything.** A zero from a dead server, a
  truncated fixture or a cache still serving an older result is
  indistinguishable from a working refusal (`docs/144` §5.2, `docs/146`
  §4.0b). A positive arm after every negative one is the cheapest way to rule
  all three out.
- **a fresh browser context per arm**, plus a cache-busting query string, so
  detection is re-run and nothing is carried over.

### 7.3 Latency — the page-timing A/B was VOID, and the cost was measured directly

§6 said the extra sequential round trip was untimed. The obvious experiment —
build with the read, build without it, compare page TTFB — **was run and is
discarded**, because it measured the read as making the page FASTER:

```
  WITH    the per-request read   p50 13.96ms
  WITHOUT it (memoised per process, byte-identical HTML)  p50 18.46ms
                                  -> marginal cost -4.50ms
```

A negative marginal cost is not a weak result, it is an impossible one: two
builds in two processes are not comparable at this resolution, and the noise
floor (±4.5ms) is larger than the effect. Reported rather than rounded to
zero, because "we measured it and got noise" and "we measured it and it is
free" are different claims.

So the added thing was measured instead of inferred from the page:

| what | n | min | p50 | p90 |
|---|---|---|---|---|
| `readFxSnapshot()`, loopback Postgres | 300 | 0.318 ms | **0.864 ms** | 1.566 ms |
| the `SELECT` alone, same pool | 300 | 0.275 ms | 1.006 ms | 1.581 ms |
| `parseFxSnapshot()` over the real 151-rate blob | 30 000 | 0.008 ms | **0.011 ms** | 0.013 ms |
| **production** pool round trip (`SELECT 1`, `/api/v1/health`) | 20 | 4 ms | **5 ms** | 7 ms |

The parse is free at **11 microseconds**, so the whole cost is one round trip:
**~5 ms median in production**. Put in proportion against production itself,
25 interleaved samples per route on one reused connection:

| route | n | min | p50 | p90 |
|---|---|---|---|---|
| `/campaigns` (3 concurrent queries **+ this read**) | 25 | 169.1 ms | **176.1 ms** | 231.9 ms |
| `/privacy` (cached, no database) | 25 | 148.1 ms | **157.8 ms** | 173.2 ms |

The ~155 ms floor is RTT to Stockholm. **All** the dynamic work on
`/campaigns` — auth, the rows query, the count, the category tally, this read,
and rendering 117 KB against 70 KB — fits inside **18–21 ms**, so the read is
about 3% of what a visitor waits.

⚠️ **The first production sample was void and is worth recording**: measured
with a fresh connection per request, `tcp+tls` swung from 0.12 s to 2.61 s on
the same host, which is sandbox-path noise, not the server. Interleaving the
two routes on one reused connection is what made the difference attributable.
And a sample-size assertion is load-bearing: a run with a single
`-o /dev/null` across many URLs sends only the FIRST body to the file and the
rest to **stdout**, so the parser was measuring HTML and reported a confident
`p50=165.5ms` from it.

### 7.3a ⚠️ A CORRECTION to §2.3: one of those five surfaces is not per-request

§2.3 and §6 both describe the new read as "one extra sequential round trip per
request" across the listing surfaces. Read from the build's own route table,
that is true of three of them and not of the other two:

| surface | render mode | when the read runs |
|---|---|---|
| `/campaigns` | Dynamic | **per request** |
| `/completed-campaigns` | Dynamic | **per request** |
| `/` (homepage) | Dynamic | once per 300 s — the read is INSIDE `unstable_cache` (§2.2) |
| `/campaigns/category/[category]` | **SSG** | once per revalidation, not per visitor |
| `/campaigns/[slug]` (similar campaigns) | **SSG** | once per revalidation |

So the per-request cost lands on two routes, not five. Verified live on the
SSG surface after the deploy, from both locales:

```
  Africa/Nairobi    /campaigns/category/medical   cards=3  "about Ksh"=3
  America/New_York  /campaigns/category/medical   cards=3  "about Ksh"=0   <- control
```

### 7.4 The suites — run, and ⛔ E2E FOUND A REGRESSION (see §8)

Run in full, on throwaway databases created and migrated for the purpose
(`docs/140` §8.1: a cluster whose schema predates recent work gives void
failures, and `docs/98`: never point these at production).

```
lint         0 errors, 3 pre-existing warnings
typecheck    0 errors
unit         280 files passed | 3 skipped (283)   8066 passed | 16 skipped (8082)
integration   33 files passed (33)                 315 passed (315)       107.70s
e2e          160 passed |  4 FAILED | 24 skipped           <- see §8
```

⛔ **And this is where §6's reasoning for skipping them fails.** It said the
suites were unnecessary because the change *"adds no query shape and no
route"*, which is true and beside the point: what it added was MARKUP, inside
another component's anchor, and the only check in this repo that looks at the
rendered DOM is the one that was skipped. The integration suite was indeed
unaffected (315/315 with and without). E2E was not.

### 7.5 The two heals the hermetic build cost, both observed

The deploy could not pass `--prerender` — this session's production access is
the Supabase **Management API**, which exposes no connection string — so the
seven baked routes of `docs/119` §2 shipped rendered against zero rows. Both
ends of that were watched rather than assumed:

- **`/donate` blanked and healed in 5 m 13 s.** Deploy completed 16:22:32Z; at
  16:26:14Z it served *"not accepting donations"* with no M-Pesa field; at
  16:27:45Z the field was back. `revalidate` on that page is 300, so the
  observed window matches the prediction to the second. ⛔ Worth stating
  plainly: that is the page which now collects real money (`docs/147` §11),
  and a hermetic deploy takes it out for five minutes.
- **The sitemap** dropped to 0 campaign URLs, as `scripts/deploy.sh`'s own
  end-of-deploy report said — the line `docs/119` added for exactly this.

⚠️ **And the pre-deploy baseline was itself void on the first read**, in the
way `docs/119` warns about: the first request returned **56 `<loc>` / 14
campaign URLs** and every subsequent one **50 / 8**. The first read was the
stale-while-revalidate copy from before the `docs/148` retraction and its own
request scheduled the refresh. One request after a data change proves nothing;
the corrected baseline is 50 `<loc>`, 8 campaign URLs, 23 category URLs. That
8 also independently confirms `docs/148`: 8 published campaigns, 8 advertised,
and none of the six retracted slugs in the file.

### 7.6 ✅ `docs/144` held under a real distribution change, with no intervention

Not planned, and the best evidence `docs/144` could have asked for. The
`docs/148` retraction moved five `military` campaigns and three `memorial`
ones into the review queue, so production's category distribution is now:

```
  medical 3    disaster 1   veterans 1   community 1   essential-needs 1   emergency 1
  military 0 (5 in queue)   memorial 0 (3 in queue)   first-responders 0   charity 0   family 0
```

`docs/143` recorded `military` as holding 3 and *"tied for the most on the
platform"*; that is now stale. The homepage grid followed the data by itself —
it promotes exactly the **6** categories holding a published campaign, and
`military` and `memorial` are absent. Under the hand-curated `TOP_CATEGORIES`
that `docs/144` deleted, the grid would now be sending visitors to two empty
pages and hiding six populated ones.

---

## 8. ⛔ AND RUNNING E2E FOUND A REGRESSION THIS CHANGE SHIPPED

§6 listed "the integration and E2E suites were not run" with the reasoning
*"it adds no query shape and no route"*. That reasoning was wrong, and running
the suite is what showed it: **four E2E tests failed, in
`e2e/local-currency-e2e.spec.ts`, because of this change** — and they were
failing against the version already deployed as v141.

```
  160 passed  4 failed  24 skipped        (CLAUDE.md records 164 / 0 / 24)

  [Desktop Chrome] + [Mobile Chrome]
    › a visitor in Kampala on an en-US browser sees Ugandan shillings
    › the figure carries the required provider attribution
```

### 8.1 Not stale locators — an anchor inside an anchor

The failures were strict-mode violations, which is exactly how this class of
defect announces itself:

```
  getByText(/at the \d{4}-\d{2}-\d{2} rate/)          resolved to 2 elements
  getByRole('link', { name: /ExchangeRate-API/i })     resolved to 3 elements
```

and the second element in both lists was the thing that mattered:

```
  <a class="flex flex-1 flex-row sm:flex-col" href="/campaigns/e2e-fixture-newly-published">…</a>
```

`CampaignCard` wraps its whole body in one `<Link>` (`:89`-`:249`), and
`ApproxMoney` renders the provider credit as an `<a>`. Putting `LocalAmount`
inside that Link therefore put an **anchor inside an anchor**: invalid HTML,
and `nested-interactive` under ARIA.

Measured on the live site before fixing it, paired so it is attributable:

| at `/campaigns` | Nairobi | New York (control) |
|---|---|---|
| nested `<a>` inside `<a>` | **8** (one per card) | **0** |
| provider credits inside another anchor | **8** | 0 |
| card link's accessible name | **211 chars** | 127 chars |
| card still navigates on click | yes | yes |

The card's link name ended `"…Goal is about Ksh 649,162at the 2026-10-29 rate ·
Exchange rates by ExchangeRate-API"`, so a screen-reader user heard the
provider credit as part of every card.

⚠️ **Why nothing short of E2E could see it.** The server renders nothing for a
USD card (`fallbackCurrency={null}`), so the HTML this build ships is innocent;
React inserts the credit AFTER detection resolves, which means the HTML parser
never gets the chance to normalise the nesting and the DOM really is nested.
Clicking still worked. Lint, typecheck, 8066 unit tests, the paired browser run
in §5.3 and the arithmetic check in §7.1 all passed over it — the browser run
counted conversions and never asked what element they were inside.

### 8.2 The fix keeps the licence obligation, in one place per page

⛔ Dropping the credit was not an option: `fx-providers.ts` §TERMS records that
the free endpoint "requires attribution", and
`fx-display-only.ratchet.test.ts` asserts `ApproxMoney` renders it.

- `LocalAmount` gained `hideAttribution` and forwards it to `ApproxMoney`,
  which already had it.
- `CampaignCard` passes it — a card may not render an interactive credit
  inside its own link.
- New `FxAttribution` renders the credit **once per surface, outside every
  anchor**: in `CampaignGrid` for `/campaigns` and `/completed-campaigns`
  (which also covers the cards it appends in the browser), and on the homepage
  and category page directly. `campaigns/[slug]` keeps its own, because that
  figure is the campaign's goal and is not inside an anchor.

### 8.3 ⚠️ MY FIRST VERSION OF THE FIX WAS WRONG, in the direction that matters

`FxAttribution` initially took only the snapshot and rendered whenever one
existed. That is a **false claim about our own conduct on a page that exists to
be trusted**: a reader in the United States looking at dollar campaigns sees no
converted figure at all, because `LocalAmount` refuses to convert a currency
into itself — so the page would have carried a credit for a rate it never used.
Caught by writing the rule for it, not by the browser.

It now asks the same question the figures ask, through the same `convertMinor`
and the same detection, and renders only if one of the page's source currencies
would convert into the reader's. Making that possible meant extracting
`useDetectedLocale` from `LocalAmount`'s effect — ⚠️ the alternative was to copy
the effect into a second component, which is the `docs/99` §8 defect where two
dark-mode toggles each held their own copy of one global.

### 8.4 The checks, and three holes injection found in my own rules

Four new rules in `card-local-currency.test.ts` (6, 7, 7a, 7b, 7c). Rule 7 is
the load-bearing one: rule 6 alone would be satisfied by a build that shows
converted figures and credits nobody, which is a breach and a silent one.

**11 of 11 injections fire**, with a sha256-verified clean restore after each
(`docs/120` §11.1), and row 1 is the production state itself. Three rows found
holes in the rules rather than in the code:

1. ⚠️ **Rule 7b's caller scan matched `CampaignCard.tsx`** — because the comment
   I had just written in it explaining the fix quotes `<FxAttribution>`. This is
   `docs/116` §4 word for word: *"the comment explaining why an insert is no
   longer `active` necessarily quotes `status: 'active'`, so a raw-source match
   reports the fix as the defect"*. The scans now read comment-stripped source,
   and row 9 is a permanent anti-regression on that hole.
2. ⚠️ **Row 6 did not fire** against a guard commented out with `/* */`,
   because the rules read `.src`. Pointed at `.code`.
3. ⚠️ **Row 6 STILL did not fire** against a guard commented out with `//`,
   because the strip handled block comments only. This is §5.1's trap for the
   third time in one change: a rule that matches both the fixed and the broken
   version. `(?<![:/])` keeps `https://` intact, which is the only reason `//`
   was skipped in the first place.

### 8.5 The E2E tests were SCOPED, not loosened

The tempting repair was `.first()`. `docs/99` §8 records that as precisely how
these tests came to pass for the wrong reason — *"`getByText('about')` also
matches the hidden mobile About nav link"* is a note in this same spec file.
So instead:

- the campaign's own goal figure carries `data-fx-figure="campaign-goal"` and
  both assertions are scoped to it;
- the attribution test asserts **`toHaveCount(1)`**, which is what catches a
  card reintroducing its own credit, and additionally that
  `a a[href*="exchangerate-api.com"]` has count **0**;
- a third test asserts `a a` has count **0** on the page, so the regression is
  checked directly rather than as a side effect of a strict-mode violation.

### 8.6 ✅ Verified live, paired across the two deploys

Fix deployed as **v142** (459s, first attempt, 1/1 checks passing). The same
probe run against v141 and then v142, from both locales:

| at `/campaigns` and `/` | **v141** Nairobi | **v142** Nairobi | New York (control, both) |
|---|---|---|---|
| cards | 8 / 6 | 8 / 6 | 8 / 6 |
| converted figures | 8 / 6 | **8 / 6** unchanged | 0 |
| nested `<a>` inside `<a>` | **8 / 6** | **0 / 0** | 0 |
| provider credits on the page | 8 / 6 | **1 / 1** | **0** |
| card link accessible name | 211 chars | **174** | 127 |

Three things to read off it:

- **The conversions are unchanged** (8 and 6), so the fix removed the defect
  and not the feature.
- **Exactly one credit per page**, where there were eight.
- ⚠️ **Zero credits from New York**, which is the §8.3 correction verified
  rather than argued: a reader who sees no converted figure is not shown a
  credit for a rate that was never used. The first version of `FxAttribution`
  would have printed one here.

The card's accessible name is 174 rather than back to 127, and that is
deliberate: what remains is `"Goal is about Ksh 649,162 at the 2026-10-29
rate"`, which is information about that card. `docs/102` is explicit that a
money figure a reader cannot date is worse than none, so the date stays with
the figure.

⚠️ **One thing this deploy cost, stated rather than glossed:** at 17:17Z the
PREVIOUS deploy's sitemap was still serving 0 campaign URLs — 55 minutes into
a 3600s window, consistent with the prediction but not yet healed — and
deploying again restarted that clock. The heal mechanism itself is observed in
§7.5 on `/donate` (5m13s against `revalidate = 300`), which is the same
mechanism with a shorter window. Two hermetic deploys in one hour is the real
cost of not having a production `DATABASE_URL` in this session.
