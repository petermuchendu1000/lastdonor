# 156 — Twenty-three was nineteen, and four of them were already named

Closes `docs/155` §6.4. Every select and menu trigger in `src/` now has an
accessible name, and the rule is a build gate with **no allowlist**.

The useful part is not the labels. It is that the precondition `docs/155` §6.4
set for itself — *"before it becomes a build gate it needs a false-positive
check on the 23"* — **changed the answer**, and the guard it stopped me
shipping would have made four pages worse.

---

## 1. The correction: it is 19, not 23

`docs/155` §6.4 enumerated **23** unnamed admin controls: 4 native `<select>`s
and 19 triggers. The false-positive pass found that **all four `<select>`s were
already named.**

| site | named by | evidence |
|---|---|---|
| `CampaignVouches.tsx` `institutionId` | a directly wrapping `<label>` with `<span>Which organisation?</span>` | [VERIFIED in a browser] `combobox "Which organisation?"` |
| `PayoutAccountsPanel.tsx` currency | a local `<Field label="Currency">` that wraps `{children}` in a `<label>` | [VERIFIED] `combobox "Currency"` |
| `PayoutAccountsPanel.tsx` rail | the same `Field` | [VERIFIED] `combobox "Rail"` |
| `TrustedInstitutions.tsx` kind | a local `<Field label="Kind">`, the same shape | [INFERRED] — source only, see §7 GAP 1 |

⛔ **This is not a miscount to shrug at.** Satisfying a rule that flagged those
four would have meant putting an `aria-label` on a control that already shows a
visible label — and `aria-label` **overrides** visible text, which is a WCAG
2.5.3 Label-in-Name failure. The guard would have degraded four screens in the
name of accessibility, and every test would have been green.

`docs/155` §6.4 withheld the gate *because* 23 offenders would have forced
either a failing build or an exception each (`docs/152`: an allowlist entry is a
hole). That instinct was right for a reason it did not know: one of those
"offenders" was not an offender at all.

### 1.1 Two defects in my own detector, and one wrong rule

- **Line numbers.** `strip_comments` replaced each comment with a single space,
  which collapses a multi-line comment onto one line, so **every line number it
  reported after the first comment was wrong**. The TypeScript ratchet in
  `docs/155` blanked comments while preserving newlines; the Python scanner did
  not. ⚠️ **`docs/155` §6.4's list of 23 sites carries line numbers produced by
  that output and they are not trustworthy** — the file names are.
- **It knew three naming mechanisms and there are four.** A `<label>` that
  *wraps* the control names it, including across a component boundary
  (`<Field label="Currency">`). That is the mechanism all four false positives
  used.
- **The role distinction was applied to neither trigger.** It accepted text
  content for both `DropdownMenuTrigger` and `SelectTrigger`. Text content names
  the first (role=button) and **not** the second: Radix gives `SelectTrigger`
  `role="combobox"`, for which name-from-content is *prohibited*. That is
  `docs/155` §6's own central finding — `/admin/audit-log` rendered the visible
  words "All events" and was nameless anyway — and the detector written in the
  same turn did not encode it. It changed no verdict today (no `SelectTrigger`
  was being accepted by text), so it was a latent hole, not a live error.

---

## 2. Three methods, with controls in both directions

| method | result |
|---|---|
| static detector over `src/` (4 mechanisms) | **19** sites unnamed |
| Playwright's own accessible-name computation (`ariaSnapshot`) | **15** nameless `combobox`/`button` nodes, across 11 of 14 flagged routes |
| axe `button-name` / `select-name` / `aria-input-field-name` | **15** violations, the same nodes |

axe showed them as `<button type="button" role="combobox" aria-expanded=…>`
with no name, and three as `aria-haspopup` row menus on `/admin/users`.

The site count (19) and the node count (15) are different units and both are
right: a per-row control is one site and N nodes, while four sites were on code
paths the fixture does not render (§7).

**Controls that make the absence mean something** — `docs/135` §5, *a probe
that cannot see its subject reports the same thing as an absent subject*:

- the three reachable CONTROL routes report **0** nameless and **0** axe
  violations while naming `Currency`, `Rail` and `Which organisation?`, so
  neither probe simply flags everything;
- **44–62 named** interactive nodes on every flagged route, so neither probe has
  merely failed to resolve names;
- `/admin/donors` reported `combobox "Currency": USD`, which is
  `DonorSegmentation`'s `id="segment-currency"` + `<Label htmlFor>` — that
  browser-verifies the id-pairing mechanism on a `SelectTrigger`, which is the
  mechanism five of the fixes rely on.

---

## 3. The fix: the mechanism is NOT uniform

Using `aria-label` for all 19 would have been wrong for five of them.

### Shape A (5) — a visible `<Label>` already exists and is not associated

Fixed with `htmlFor` + `id`, so the label a sighted user can already read
*becomes* the accessible name. An `aria-label` here invents a second name that
can drift from the visible one.

⛔ **`BlogEditor.tsx` is the sharp case: `<Label htmlFor="category">Category</Label>`
already existed and dangled on an id nothing carried.** The page looked
labelled and was nameless — worse than no label, because nothing about it
reads as missing. `CampaignEditor.tsx:217` next door does it correctly
(`<SelectTrigger id="category">`), which is what shows this was an omission
rather than a decision.

| component | id |
|---|---|
| `BlogEditor` category | `category` (the `<Label htmlFor>` already pointed there) |
| `DonorProfileEditor` donor type | `donor-type` |
| `DonorSegmentation` donor type | `segment-donor-type` |
| `InteractionTimeline` type | `interaction-type` |
| `RelationshipsList` relationship type | `relationship-type` |

### Shape B (11) — a filter with no visible label

`aria-label`. There is no visible text to conflict with, and **the sibling
search input in the same filter row already carries one**
(`aria-label="Search donations"`, `"Search refund batches"`,
`"Search verification queue"`, …). So this is the house convention and its
absence on the select beside it was an oversight — `docs/151`'s reasoning
exactly, where the attribute's presence on an adjacent field is what showed the
gap was not a decision.

`BlogPostsList`, `BulkEmailDashboard`, `DonationsList` ×2, `GovernancePanel`,
`InfoRequestsDashboard`, `NewsFeedMonitor` ×2, `RefundBatchDashboard`,
`TopicQueueList`, `VerificationQueue`.

### Shape C (3) — per-row controls, named per row

Because N identically-named buttons barely beat N nameless ones (`docs/155` §6).

- `UsersList` row menu → `` `Actions for ${u.name ?? u.email}` ``
- `InfoRequestsDashboard` row menu → `` `Actions for ${req.campaignTitle}` ``
- `PipelineMonitor` category override → `` `Override category for ${item.title}` ``

### 3.1 The one offender outside admin, and why it changed the rule's scope

A sweep of all of `src/` found **exactly one** control outside
`src/components/admin/`: `/notifications`' page-size select, on a signed-in
**user-facing** page. Its visible text is `Show [20] entries` — a label split
around the control — so it is named `"Show entries per page"`, which contains
both visible words and keeps WCAG 2.5.3.

That single number is what let the ratchet cover **all of `src/`** rather than
just the admin directory. Had it been 23, the rule would have needed a scope
boundary that was really an allowlist in disguise.

---

## 4. The ratchet

`src/components/ui/control-names.ratchet.test.ts`, 13 tests, **no exceptions**.
46 of 46 controls in `src/` are named.

It accepts all four mechanisms, because a rule that knows fewer fires on
correct code — which is precisely what the first version did. Beyond the main
sweep it carries:

- **rule 3, the role distinction**, as four synthetic assertions: text content
  names a `DropdownMenuTrigger` and does **not** name a `SelectTrigger`, a
  `SelectValue placeholder` is not a name, and a native `<select>` is not named
  by its options. This is the most "simplifiable" line in the file and the one
  whose removal would silently un-gate the original defect.
- **rule 4's two conditions**, each with its own failing counter-example: a
  component that renders its label *beside* `{children}` does not name them,
  and a wrapper used without a `label` prop supplies no text. Without these the
  mechanism would accept "is called `Field`", i.e. it would be a hole rather
  than a mechanism.
- **anti-vacuity**: ≥40 controls found, and ≥1 named by *each* of four
  mechanisms — so a mechanism falling out of use is visible rather than silent.
- **two controls on the tool itself**: the brace/quote-aware tag scanner, and
  that `stripComments` preserves line numbers.

### 4.1 Mutation proof

15 injection rows, **all 15 behaved**, restore verified independently
(`git diff --stat` byte-identical before and after). Notable rows:

- row 1, **the real production state** (the campaign status filter loses its
  name) → fires.
- row 2, `BlogEditor` loses `id="category"`, restoring the dangling
  `htmlFor` → fires.
- row 4, the `/notifications` select → fires, which is what proves the sweep is
  **not admin-only**.
- row 6, text content is allowed to name a `SelectTrigger` again → fires, so
  rule 3 is load-bearing.
- rows 7–9, each of mechanism 4's conditions → fire.
- rows 10–12, the scanner and the glob → fire.
- row 14 **must pass**: a comment quoting the forbidden shape (comment
  stripping, `docs/116` §4).
- row 15 **must pass**: the `aria-label` *wording* changes. The rule checks the
  property — that a name exists — not today's copy, so it can never become a
  pin on wording.

### 4.2 ⚠️ My own control assertion was wrong

The scanner control asserted that the naive regex `/<select[^>]*>/` **would not
match** a tag with an arrow function in it. It does match — it matches a
*truncated* tag ending at the arrow's own `>`, and truncation is the whole
trap. (`docs/155`'s equivalent returned false only because its sample required
`role="dialog"` *after* the arrow, so the truncated span failed the match. Same
defect, different observable.) The assertion now checks that the naive match
**excludes the `aria-label` and includes the `=>`** — the thing that actually
goes wrong. A control that asserts the wrong symptom passes for the wrong
reason.

---

## 5. After the fix

[VERIFIED in a browser, 15 routes] **0 nameless** `combobox`/`button` nodes and
**0** axe name violations, with the names themselves read back as positive
evidence — because "zero nameless" is also what a page that failed to render
reports:

```
combobox "Category": News                      <- the formerly dangling htmlFor
combobox "Donor Type": All Types
combobox "Filter donations by campaign": All campaigns
combobox "Filter by event type": All events    <- docs/155 §6, still named
button   "Actions for E2E Fixture Organiser"   <- per row
button   "Actions for General Fund"
combobox "Show entries per page": "20"         <- the one outside admin
```

The row menu named `"Actions for E2E Fixture Organiser"` opens with 3 items, so
the named control is the working one.

**Nothing moved.** The Shape-C edits reflowed a `<Button>` across several lines,
which is the kind of edit that can change a row, so layout was measured too:
**0px horizontal overflow** on all five routes at **1440px and 390px**
(`scrollWidth − clientWidth`, `isMobile: false` per `docs/128` §5). `docs/154`'s
containment fix still holds on the same pages.

Gate: lint clean (one pre-existing unrelated warning), typecheck clean, unit
**8178 passed / 0 failed / 16 skipped**, 290 files.

⚠️ Measured against HEAD rather than inferred: HEAD is **8165 / 289 files**, so
this change is **+13 tests, +1 file** — exactly the new ratchet.
⚠️ CLAUDE.md quoted **8066 / 280**, stale by 99 tests and 9 files from
`docs/154` and `docs/155`. That file's own instruction is *"measure before
quoting it"*, and the stale number is the reason it says so.

---

## 6. ⚠️ A probe that reported itself

While restarting the lab I ran `pkill -f "next start"`, which matched **its own
shell's command line** — `docs/139` §11's trap, which I had recorded and then
walked into. Worse, the diagnosis that followed was also self-inflicted:
`pgrep -f next-server` kept returning *changing* pids, which read exactly like
a process respawning in a loop. They were my own successive shells, each
carrying the literal string `next-server` in its command line.

I was two commands from killing the harness's process group over it. The tell
that settled it was the one measurement that could not be self-referential:
**the port was free**. `pgrep -f 'next-serv[e]r'` returns nothing.

⚠️ Process inspection in this session prints **pids and `/proc/*/comm` only,
never command lines** — a command line here can carry the production database
password, which is how one leaked into a transcript earlier in this session.

---

## 7. What was NOT checked

- **GAP 1** — `TrustedInstitutions`' `kind` select is accepted on **source
  alone**. Its create form sits behind a disclosure no button name I tried
  matched. Its sibling through the *same* `Field` component shape
  (`PayoutAccountsPanel`) IS browser-verified, so this is [INFERRED], not
  [VERIFIED].
- **GAP 2** — 5 of the 19 fixed sites were never rendered in a browser, before
  or after: `PipelineMonitor:557` and `TopicQueueList:375` (I seeded a
  `news_items` row and a `blog_topic_queue` row and **neither surfaced the
  control**, so the data requirement is something else), and
  `DonorProfileEditor` / `InteractionTimeline` / `RelationshipsList`, which sit
  behind edit/add disclosures on `/admin/users/[id]`. Their evidence is the
  static sweep plus `tsc` — which does confirm `item.title`,
  `req.campaignTitle` and `u.name` are in scope, so the labels cannot be
  referencing nothing.
- **GAP 3** — **no screen reader was run.** Every claim here is about the
  *computed accessible name*, which is what a screen reader reads from, not
  proof of what one announced.
- The 23 remaining unnamed controls `docs/155` §6.4 promised are now 0, but
  this rule governs `<select>`, `SelectTrigger` and `DropdownMenuTrigger` only.
  Other interactive roles (`switch`, `tab`, icon-only `<button>`s outside a
  trigger) are **not** swept, and that is a separate pass — not a hole in this
  one, but not covered by it either.
