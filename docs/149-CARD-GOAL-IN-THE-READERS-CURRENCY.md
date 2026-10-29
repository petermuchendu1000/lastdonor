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

## 6. What is NOT verified

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
