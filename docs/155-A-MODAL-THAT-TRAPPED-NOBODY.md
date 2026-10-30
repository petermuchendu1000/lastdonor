# 155 — A modal that trapped nobody, and a trap that never ran

**Date:** 2026-10-30
**Status:** fixed, guarded, verified in a browser
**Journey:** the KEYBOARD user — the first execution pass over this product's
keyboard behaviour

---

## 1. Why this journey, and what it set out to settle

`docs/100` retrofitted `onRadioGroupKeyDown` + `rovingTabIndex` onto all seven
hand-rolled `role="radiogroup"`s and proved it with unit tests and injection.
`docs/153` §8 recorded that arrow keys had **never been re-tested in a
browser**, and `docs/100` itself warns that **axe cannot see any of this** —
it checks `aria-checked` and the parent role, both of which were already
right.

So this pass pressed the keys.

---

## 2. ✅ The radiogroups: `docs/100`'s fix verified by execution, 7 of 7

An ARIA radiogroup promises three things. Each was measured separately, after
driving the wizard to the screen that holds each group.

| group | where | one tab stop | ArrowRight moves focus | `aria-checked` | mounted after |
|---|---|---|---|---|---|
| Donation frequency | `/campaigns/…/donate` | ok | 0→1 | 0→1 | yes |
| Donation amount | `/campaigns/…/donate` | ok | 0→1 | −1→1 | yes |
| Who are you fundraising for? | wizard 1 | ok | 0→1 | −1→1 | yes |
| Relationship to beneficiary | wizard 1 | ok | 0→1 | −1→1 | yes |
| Campaign category | wizard 4 | ok | 0→1 | −1→1 | yes |
| **Campaign category (review editor)** | review | ok | **0→1** | **0→0, no select** | **yes** |
| **Relationship (review editor)** | review | ok | **1→2** | **1→1, no select** | **yes** |

⚠️ **The last two rows are the control that makes the first five mean
anything.** `docs/100` §3 says those two editors pass
`{ selectOnMove: false }` because selecting there calls `setEditField(null)`
and **unmounts the group**. They read *differently* from the other five —
focus moves, selection does not, and the group survives — so the probe is
demonstrably measuring the key handler and not an artifact.

Two further controls ran first, because a probe that cannot press a key
reports the same thing as a group that ignores it (`docs/135` §5):

- **C1′ probe self-test.** The native control `docs/100` points at (the payout
  accounts list) renders only when a Connect account exists, and there are
  none — in the fixture *or in production* (`docs/121`). So a native radio
  group was **injected** into the page: focus 0→1 on ArrowDown. The probe can
  press arrow keys.
- **C2′ negative.** A plain button outside any group keeps focus on
  ArrowRight. Arrows are not global.

**No defect.** This section is a negative result, and it is the one `docs/153`
§8 asked for.

---

## 3. ⛔ THE FINDING: two modal dialogs kept none of their three promises

### 3.1 What the code did

`ShareYourStoryForm.tsx` rendered two dialogs by hand — the media picker
(`:1452`) and the seven inline "Edit" editors on the review screen (`:2052`):

```tsx
<div className="fixed inset-0 …" onClick={close} onKeyDown={trapFocus}
     role="dialog" aria-modal="true" aria-label={…}>
```

No focus management, no Escape handler anywhere in the file, no scroll lock.

### 3.2 [VERIFIED] three ways, each able to give the other answer

**Method 1 — source.** A grep for `Escape` in `ShareYourStoryForm.tsx`
returns **nothing**. `trapFocus` (`:340`) is a **React** `onKeyDown` on the
overlay, so it fires only for keydowns bubbling up from inside the dialog.

**Method 2 — execution**, with a Radix sheet in the same product as the
control:

| | focus moves in | Tab trapped | Escape closes |
|---|---|---|---|
| Radix sheet (`/campaigns` Filters) | **yes** | — | **yes** |
| wizard Edit-category dialog | **no** | **no** (27 presses) | **no** |

**Method 3 — hit test.** With the modal open, the focused element was the
"Edit" button, and `elementFromPoint` at that button's own centre returned
**the overlay**. The keyboard user's focus ring was on a control *painted
underneath the modal*. Tab then walked them through the page behind a dimmed
backdrop.

### 3.3 ⛔ The trap was DEAD CODE, not broken code

This is the transferable part. The focus trap existed and was written
correctly. It never ran once — because an overlay-level React `onKeyDown`
cannot fire while focus is outside the dialog, and **nothing moved focus
inside**. One missing line disabled the mechanism written to contain it.

⚠️ And `aria-modal="true"` is a statement to assistive technology that
everything outside the dialog is inert. Saying that while the focus ring is
outside is worse than saying nothing.

### 3.4 One file away, the same product did it correctly

`FundraiserPreviewModal.tsx:42-85` — *"Trap focus and handle Escape"* — had a
document-level listener, a Tab trap, initial focus, focus restore and a scroll
lock. Three hand-rolled dialogs: **one correct, two with none of it.**

### 3.5 The fix

`src/hooks/useModalKeyboard.ts` — the implementation `FundraiserPreviewModal`
already had, lifted so there is **one decider** instead of one correct copy and
two absent ones. All three dialogs call it; `trapFocus` is deleted.

`canClose` exists for exactly one reason: that modal passes `!launching`, so
Escape cannot dismiss it mid-submit.

⛔ **Rejected: converting to the Radix `Dialog` primitive.**
`src/components/ui/dialog.tsx` exists and the Filters sheet proved Radix gets
all of this right, so that is the better end state and is recorded as such. Not
taken here because it is a markup rewrite of two dialogs inside a 2,450-line
form that `docs/153` had changed the previous day.

---

## 4. ⛔ The second-order defect, which only the browser found

After the initial-focus fix, D1 and D3 passed and **D2 still failed** — focus
escaped to "Go back", behind the overlay.

`MODAL_FOCUSABLE` contains `button:not([disabled])`, which matches a
`<button role="radio" tabindex="-1">`. Every hand-rolled radiogroup here uses
**roving tabIndex** (`docs/100`), so 22 of the 23 category options were in the
"focusable" list and **not in the tab order**. The wrap condition is
`activeElement === last`, and `last` was an option Tab can never land on — so
the trap could not fire.

**The selector says what might take focus; `tabIndex >= 0` says what the
browser will Tab to.** A modal trap needs the second, so the hook exports
`tabbablesIn()` and the Tab branch uses it.

⚠️ And a second hole beside it: comparing only `first`/`last` is not enough.
Focus can sit on an element **inside** the dialog and absent from the tab order
— an arrow-reached roving option is exactly that — and from there neither
boundary test is true, so the browser moves focus out. The trap now takes
`indexOf(active)` and pulls focus back when it is −1.

⚠️ This defect was inherited **verbatim** from the modal that "worked". It
never showed there because that dialog contains no roving radiogroup. A unit
test without one passes against it, which is why the suite has a dedicated
roving case.

### 4.1 [VERIFIED after the fix]

| | before | after |
|---|---|---|
| focus moves into the dialog | **false** (on a control behind the overlay) | **true** ("Close") |
| Tab stayed inside, 27 presses | **false** → "Go back" | **true** → "Medical", hit test "itself" |
| Escape closes | **false** | **true** |
| focus returns to the opener | — | **true** ("Edit") |

The Radix control still passes in the same run, so the probe is still sound.

---

## 5. The guards

- `src/hooks/useModalKeyboard.test.tsx` — **10 tests**, executing the contract:
  focus in, Escape, focus restore, `canClose:false`, Tab and Shift+Tab wrap,
  **the roving-radio case**, `tabbablesIn` excluding a focusable-but-not-tabbable
  option, nothing bound while closed, and a control proving an unrelated key is
  ignored (without it, a handler that called `onClose` on every keydown would
  pass the Escape test).
- `src/hooks/modal-keyboard.ratchet.test.ts` — **8 rules**: every file with a
  literal `role="dialog"` calls the hook; no element carries both
  `role="dialog"` and its own `onKeyDown`; the Tab path goes through
  `tabbablesIn`; focus outside the tab order is handled; plus anti-vacuity, a
  call-count control, and a **premise tripwire** that the Radix wrappers still
  set no literal role — which is what makes "a literal `role="dialog"` means
  hand-rolled" a boundary rather than an allowlist.

**12 injections, all behaving** (11 fire, including the real production state;
1 comment-only row must pass).

### 5.1 ⚠️ My own rule had `docs/153` §5's trap, one day later

Rule 2 matched `<[A-Za-z][^<>]*role="dialog"[^<>]*>`. The injection that
re-adds an overlay `onKeyDown={(e) => e.stopPropagation()}` **did not fire** —
because `[^<>]*` stops at the first `>`, and JSX has one inside every arrow
function. `docs/153` §5 recorded exactly that failure and it still caught me.
Replaced with `openingTagAround()`, a brace- and quote-aware scanner, plus a
test asserting the naive regex fails on the same sample so the reason stays
visible.

### 5.2 ⚠️ And my injection harness did not restore cleanly

Row 1 edits **two places in one file**. The backup loop copied the file and
recorded its sha *per edit*, so the second iteration copied the
already-modified file over the pristine backup and recorded **that** sha — the
restore assert then compared the polluted state with itself and passed. Eleven
later rows were measured against a tree carrying a renamed import, and the
clean-tree re-check reported 0 because no text rule notices a broken import.

Found by reading the file afterwards, not by the harness. Fixed by backing up
each **distinct** file once before any edit, and the re-run was validated by an
independent check the assert cannot give: `git diff --stat` byte-identical
before and after the whole run. This is `docs/120` §11.1 reproduced in my own
tool, which is why that doc says the tell is what the tree looks like at the
end.

---

## 6. ✅ Seven nameless admin controls — found, verified three ways, fixed

Running axe (WCAG 2.1 AA) over the admin screens with keyboard-activated rows
turned up **seven critical "control with no accessible name" violations**.
This is `docs/134`'s class — icon-only admin controls named by `aria-label` —
with the label **missing**.

| page | violation | nodes | what they are |
|---|---|---|---|
| `/admin/campaigns` | `button-name` | **5** | the per-row action menu triggers |
| `/admin/campaigns` | `select-name` | **1** | the category filter `<select>` |
| `/admin/audit-log` | `button-name` | **1** | the event-filter Select trigger |

### 6.1 [VERIFIED] three ways

1. **axe**: the counts above.
2. **Source**: `CampaignsList.tsx:380` is a `DropdownMenuTrigger` wrapping a
   `<Button>` whose only child is `<EllipsisVerticalIcon>`, and `docs/70`
   makes icons `aria-hidden` — so there was no name to compute. `:303`'s
   `<select>` had no `aria-label`. `AuditLogViewer.tsx:127`'s trigger had only
   a `<SelectValue>`.
3. **Playwright's own accessible-name computation** (`ariaSnapshot`),
   independent of axe: **6 nameless** interactive nodes on `/admin/campaigns`
   and **1** on `/admin/audit-log` — against **55** and **44** *named* nodes
   on the same pages, which is the control proving names were being resolved.

### 6.2 ⚠️ The audit-log one is the instructive case

That trigger renders the visible text "All events" and was still **nameless**.
For `role="combobox"` the contents are the VALUE, not the label, and the
`placeholder` only shows while empty. A control can read perfectly on screen
and be anonymous to a screen reader.

### 6.3 The fix, and why the labels say what they say

Three `aria-label`s. The row menus are named **per row**
(`Actions for ${c.title}`) rather than "Actions" — five identically named
buttons would be only marginally better than five nameless ones, since the one
thing the user needs is which row they are on.

**[VERIFIED after]** axe: `button-name` and `select-name` gone,
`/admin/audit-log` at **0 violations**. Playwright: **0 nameless** on both
pages, named counts 55→57 and 44→45.

### 6.4 ⛔ AND A SWEEP, enumerated and NOT done

The same detection run across all of `src/components/admin/` finds **23 more
unnamed controls** — 4 `<select>`s and 19 `DropdownMenuTrigger`/`SelectTrigger`s
— on pages this pass never loaded:

```
selects   CampaignVouches:289  PayoutAccountsPanel:141,156  TrustedInstitutions:373
triggers  BlogEditor:139  BlogPostsList:113  BulkEmailDashboard:441
          DonationsList:121,134  DonorProfileEditor:123  DonorSegmentation:247
          GovernancePanel:275  InfoRequestsDashboard:169,248
          InteractionTimeline:144  NewsFeedMonitor:142,155  PipelineMonitor:557
          RefundBatchDashboard:195  RelationshipsList:145  TopicQueueList:130
          UsersList:364  VerificationQueue:122
```

A name can legitimately come from three places — `aria-label`/`aria-labelledby`,
an `id` paired with a `<Label htmlFor>`, or real text content — and the
detector accepts all three (10 triggers and 6 selects pass it today).

⛔ **No ratchet was added, deliberately.** With 23 offenders a general rule
either fails the build or needs 23 exceptions, and an allowlist of 23 is the
hole `docs/152` is about. The honest move is the sweep: name all 23, then the
rule lands with nothing to except. Each label needs a decision about what that
control actually filters, which is why it is a pass of its own rather than a
bolt-on.

⚠️ The detector is validated only in the negative direction so far (it accepts
16 named controls and flagged exactly the 7 that two other methods confirmed).
Before it becomes a build gate it needs a false-positive check on the 23.

`color-contrast` also reports 4 nodes on `/admin/payouts` and 4 on
`/admin/campaigns` — not this journey's subject and not investigated.

---

## 8. ⛔ `scripts/deploy.sh` reported a FAILED deploy as finished

Found by this work's own deploy failing.

**[VERIFIED]** v159 aborted with
`408: failed to launch VM` creating the `release_command` machine, leaving
production on v158. `scripts/deploy.sh` then printed:

```
deploy finished in 380s
sitemap: 8 campaign URL(s) at https://lastdonor.org/sitemap.xml
```

and **exited 0**. Four lines above sat
`Error: release command failed - aborting deployment`, but the last two lines
of the run read exactly like a success, and the exit status agreed with them.
Only `flyctl releases` showed the truth.

⚠️ `set -euo pipefail` is at `deploy.sh:31`, so the script should have aborted
at the failing command. It did not, which means flyctl exited **0** in that
invocation — while a direct `flyctl deploy --image` on the same failure
returned **1**. That inconsistency is **[INFERRED]** from the control flow
rather than observed directly, and it is precisely why the fix does **not**
rely on the exit code.

### 8.1 The fix

`deploy.sh` now captures flyctl's status *and* asks Fly what the latest
release's STATUS is, and refuses to report success unless it is `complete` —
printing the flyctl code, the release, the live machine version, and the
retry-the-pushed-image recipe. CLAUDE.md's own rule (*"'the deploy ran'
requires reading the deploy result AND the live version"*) applied to the
script that does the reporting.

Proven able to give both answers: the parser reads `v161 complete` from the
live app and `v160 failed` from the real failed output, and the branch refuses
on the second.

⚠️ The failure PATH itself is exercised only through that parser, not by
re-triggering a 408 — a capacity error is not something I can summon.

### 8.2 ⚠️ A CLAIM IN CLAUDE.md IS NARROWED

It says *"**every single failure** left a machine in
`fly_app_release_command` stuck in state `created`"*. Across the three
failures here (v159, v160, and the first `--image` retry)
`flyctl machine list` reported **0** such machines each time. So that
"every" is too strong: orphans accumulate **sometimes**. Causation was
already marked [UNKNOWN] there; the frequency now is too. The retry loop
clears them when present, which costs nothing either way.

### 8.3 What made the retry work is not known

Attempt 1 of the orphan-clearing loop succeeded immediately, with **0**
orphans to clear — so the clearing cannot be what helped, and the difference
between that attempt and the two failures before it is **[UNKNOWN]**.
Capacity, most likely, which nothing here can verify.

---

## 7. What was NOT checked

- **No screen reader was run.** Every claim here is about focus, keys and the
  accessibility tree as the DOM reports them, not about what is announced.
- ⛔ **The `<tr role="button">` question is UNMEASURED, not refuted.**
  `PayoutsDashboard.tsx:264` and `AuditLogViewer.tsx:168` put `role="button"`
  on a table row, which **replaces** the row semantics — the class `docs/99`
  §8 found with `role="tab"` inside `<li>`. [VERIFIED] both rows carry
  `tabIndex={0}` and an `onKeyDown` handling Enter and Space, so they are
  keyboard-operable; what is unknown is the table-semantics cost. The axe run
  reported **`tr[role]=0` on all three pages**, because the fixture has no
  withdrawals and no audit rows, so those rows never rendered. A faithful
  fixture would settle it.
- ✅ **The media-picker dialog is now verified ON PRODUCTION** (v158), which
  is the stronger half: the wizard is reachable without signing in, so the
  dialog was opened, focus landed inside on "Upload a photo", Escape closed
  it, and focus returned to the opener — with the Radix sheet passing in the
  same run as the control.
- ⛔ **The §6 accessible-name fix is NOT verified on production.** Those are
  admin pages; `/admin/campaigns` answers **307** without a session, and the
  labels are in code-split admin chunks that the homepage does not load (a
  scan of its 27 chunks found none of the three strings). It is verified on a
  local production build by two independent methods, before and after, and
  that is all. Reaching production's admin screens needs the owner's
  credentials.
- Focus **visibility** (is there a visible ring?) was not measured — only
  focus location.
- `/admin` was reached as an admin; an editor's keyboard path was not walked.
- 1280px for the dialog work; `docs/154` covers 390px for the dashboard.
