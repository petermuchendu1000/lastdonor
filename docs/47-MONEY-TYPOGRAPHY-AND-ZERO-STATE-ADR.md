# 47 — Money typography, the unfunded campaign state, and share parity

Decided 2026-10-15. Implements the UI/UX half of the GoFundMe benchmark in
`docs/30`, which covered strategy and features but never compared the two
products as rendered surfaces.

**Method.** Both sites were driven headless at 1440×900 and 390×844, and the
numbers below are computed styles and layout metrics read out of the live DOM,
not estimates. GoFundMe pages measured: `/`, `/discover`,
`/f/2026-wildfire-relief-fund`. LastDonor pages measured: `/`, `/campaigns`,
`/campaigns/alicia-reeves`. All GoFundMe figures are **VERIFIED, retrieved
2026-10-15**, and are a snapshot of a site that ships continuously.

---

## 0. The finding that reframed the work

**Our Core Web Vitals already beat theirs.** Measured the same way, same run:

| Page | CLS | LCP |
|---|---|---|
| LastDonor campaign (desktop) | **0.0001** | **720 ms** |
| GoFundMe campaign (desktop) | 0.0482 | 1000 ms |
| LastDonor campaign (mobile) | **0** | **656 ms** |
| GoFundMe campaign (mobile) | **0.75** | 1300 ms |

GoFundMe's mobile campaign page scores a 0.75 CLS, which is three times the
0.25 "poor" threshold. We are not losing on performance and should stop
treating it as the gap. **The gap is presentation and information
architecture.** That is what this ADR addresses.

---

## 1. Money is set in the body sans, never the mono face

### What was decided

All donor-facing currency renders through one primitive,
`src/components/ui/Money.tsx`: body sans, `tabular-nums` always on, and a
`precision` prop that defaults to whole dollars.

### Why

The codebase rendered the *same card's* two amounts in two different
typefaces. Measured on `/campaigns/alicia-reeves`:

| Element | Font before | Font after |
|---|---|---|
| Amount raised (`$0`) | **DM Mono** 30px | DM Sans 30px |
| Goal (`$25,000`) | DM Sans 16px | DM Sans 16px |
| Impact tiers (`$25.00`) | **DM Mono** 18px | DM Sans 18px |
| Donor feed amount | **DM Mono** 14px | DM Sans 14px |

GoFundMe renders **every** figure on its campaign page in its body sans
(`GoFundMe Sans`) — `$312,067`, `$1M`, `$1,000`, `$500`, `$350`, `$100`, `$50`
all measured at `font-family: GoFundMe Sans`. There is no mono face anywhere on
their donor-facing surface.

The argument is not "match the competitor". It is that a monospace face is a
convention for *code and machine output*. Setting a gift in it makes the gift
read as a database value. Mono's one genuine advantage, column alignment, is
available from `font-variant-numeric: tabular-nums` without the connotation,
and the primitive turns it on unconditionally.

**Mono is retained throughout `src/components/admin/`.** There it is correct:
those really are identifiers, cron expressions and masked config values.

### Rejected

- **Keep mono, it looks technical and precise.** Rejected: "technical" is the
  wrong register for a page asking a stranger for money, and the inconsistency
  above means we were not even applying it as a convention.
- **Fix the class names at each call site, no primitive.** Rejected: that is
  what produced a card with one amount in each face. Five call sites, one rule.

### Trade-off accepted

`Money` is a component where a string helper would do, so inline currency
inside a sentence cannot use it without splitting the text node across
elements, which breaks `getByText` and degrades screen-reader phrasing.
Resolved by convention, applied in this change: **`Money` for standalone
figures; `centsToDollarsWhole()` plus `tabular-nums` on the parent for currency
inside a sentence.**

---

## 2. Presets lead with the largest amount, and drop the cents

### What was decided

`PRESET_AMOUNTS` in `DonationForm.tsx` goes from ascending
`[25, 50, 100, 250, 500, 1000]` to descending `[1000, 500, 250, 100, 50, 25]`,
and preset chips render whole dollars (`$25`, not `$25.00`).

### Why

GoFundMe's live donate form offers **$1,000 / $500 / $350 / $100 / $50,
descending, no cents** (VERIFIED 2026-10-15). We led with $25. Trailing `.00`
on a preset is noise: the figure is a choice, not yet a charge.

### Honesty about the evidence

The cents removal is a straightforward legibility fix. **The reordering is a
hypothesis, not a measured result.** The support is (a) anchoring, and (b)
revealed preference from a market leader that A/B tests this form at a volume
we cannot match. We have not run the experiment. **This is the single
highest-value A/B test available to this codebase** and the reorder should be
treated as the challenger arm until it is run.

### Deliberately not changed

`ImpactTiers` in the sidebar stays **ascending**. Those carry escalating
semantic labels ("Covers immediate expenses" → "Life-changing impact"), so they
are a narrative ladder, not a choice set, and reversing them would make the
prose read backwards. The submit button keeps **exact** precision
(`Donate $25.00`), because at that point the figure has stopped being a choice
and become the amount that will be charged.

---

## 3. An unfunded campaign gets its own state

### The constraint, stated plainly

Every one of the 12 live campaigns has `raised_amount = 0` and
`donor_count = 0` (verified against production, 2026-10-15). That is **correct
and intended**: seeded donations are gated off by `SEED_DONATIONS_OPT_IN`
(docs/33, docs/41). It is not a bug to be designed around with fake numbers.

### Why copying GoFundMe here would have made the page worse

Their campaign sidebar is built on the assumption that money is already
moving: a 32% progress ring, `$312,067 raised`, `1.1K donations`, and four
named donors with amounts and timestamps. Rendered against our data every one
of those is a zero or an empty list. A faithful port would have produced a
**more** prominent display of emptiness than we had.

This is the general lesson for the rest of the benchmark work: GoFundMe's
design is tuned for the median *funded* campaign. Their weakest surface is a
campaign on day one, which every campaign is at some point, and that surface is
unoccupied ground.

### What was decided

When `raisedAmount === 0`, the sidebar and the card stop leading with a
quantity and lead with the ask:

| | Before | After |
|---|---|---|
| Sidebar headline | `$0` + "raised" | "Be the first to donate" |
| Sidebar secondary | "of $25,000 goal" | "$25,000 goal" |
| Sidebar count | "0 donors" | *(suppressed)* |
| Card figure | `$0 raised` / `of $5,000` | "Be the first to donate" / `$5,000 goal` |

The goal is still shown in full, and the progress bar still renders at 0%.
Nothing is concealed; only the hierarchy changes. Once `raisedAmount > 0` the
funded layout returns, now with an explicit funded percentage, which the
sidebar previously never showed at all.

### Rejected

- **Turn on seeded donations so the pages look alive.** Rejected on the merits
  and already settled: docs/30 §3 records that displaying simulated activity to
  real donors is disqualifying for a platform positioned on trust, and docs/41
  made the gate fail-closed. This ADR does not reopen it.
- **Hide the zero.** Rejected: a donor comparing campaigns is entitled to know
  one has raised nothing. Honest hierarchy, not omission.
- **"$0 raised so far" softened with copy.** Rejected: still leads with the
  absence.

### Trade-off accepted

Two visual states per surface instead of one, so every change to the funded
layout now needs checking against the unfunded branch. Accepted because the
unfunded branch is currently **100%** of live campaigns.

---

## 4. Share is a co-equal primary action

### What was decided

`SidebarShareButton` is added directly beneath "Donate now" in the campaign
sidebar, at the same width and weight, outline against the donate button's
fill.

### Why

GoFundMe's sidebar stacks **"Donate now" then "Share"** as two full-width
buttons of equal prominence (VERIFIED 2026-10-15). Ours had no share control in
the sidebar at all — only a row of 36px icon links far below the story, after
the full campaign text, the updates and the message wall.

`docs/30` §1 already identified the attributed share loop as "their growth
engine, not a feature". The sidebar placement is the cheap half of that, and it
was missing.

The button prefers `navigator.share()`, which on a phone opens the OS share
sheet — the user's whole contact list, one tap, no social account needed — and
falls back to clipboard. The capability is probed **inside the click handler**,
not at render, so server and client markup stay identical and no hydration
mismatch is introduced. `AbortError` (the user dismissing the sheet) is treated
as a normal outcome and reported as nothing.

### Not done here

This is **not** the attributed share loop of `docs/30` §1.1. There is no
per-donor share token and no attribution of a donation back to the link that
produced it. That needs a schema change and is deliberately out of scope; this
change is the placement and the affordance only. **Do not read this ADR as
closing `docs/30` §1.1.**

---

## 5. Accessible names on the preset chips

Found while updating tests, fixed here. Each preset chip built its accessible
name by concatenating two child spans, yielding `"$50Week of groceries"` — one
run-on token to a screen reader, with no pause between the amount and its
meaning. Each chip now carries an explicit
`aria-label={"$50, Week of groceries"}`.

---

## 6. Tests changed, and why that is not test-fitting

Ten tests failed. `CLAUDE.md` requires establishing which side drifted.

- **Nine** asserted `$25.00` / `$50.00` on preset chips, or selected a radio by
  the name `/\$25\.00/`. These encode the presentation decided against in §2.
  The code is the newer decision; the assertions were updated to `$25` and to
  name regexes anchored with `/^\$50\D/` so they cannot also match `$500`.
- **One** was a genuine regression I introduced. `CampaignCard` asserted
  `getByText(/of \$5,000/)`, and wrapping the goal in `<Money>` split that
  string across two elements. **The code was reverted**, not the test: the
  sentence case now uses `centsToDollarsWhole()` with `tabular-nums` on the
  parent, which is what produced the convention recorded in §1.

Full suite after the change: **5181 passed, 0 failed.**

**Correction to `CLAUDE.md`:** its Commands section states `npm run test:unit`
runs 3977 tests. The real count is **5181** as of this commit.
