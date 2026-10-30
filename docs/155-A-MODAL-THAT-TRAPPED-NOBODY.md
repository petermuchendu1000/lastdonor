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

## 6. Reported, NOT fixed — the next pass

axe (WCAG 2.1 AA) on the admin screens with keyboard-activated rows found
**seven critical "control with no accessible name" violations**:

| page | violation | nodes | what they are |
|---|---|---|---|
| `/admin/campaigns` | `button-name` | **5** | the per-row action menu triggers (`aria-haspopup="menu"`) |
| `/admin/campaigns` | `select-name` | **1** | a filter `<select>` |
| `/admin/audit-log` | `button-name` | **1** | a Radix Select trigger (`role="combobox"`) |

A screen-reader user hears "button" five times on `/admin/campaigns` with no
indication of what any of them opens. This is `docs/134`'s class — icon-only
admin controls named by `aria-label` — with the label **missing**. Verified by
axe only so far, not yet three ways, and not fixed: it is a coherent finding
set of its own and half-doing it alongside this would be worse than naming it.

`color-contrast` also reports 4 nodes on `/admin/payouts` and 4 on
`/admin/campaigns`; not this journey's subject and not investigated.

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
- The media-picker dialog was fixed by the same hook but measured only
  indirectly: the browser walk exercised the **edit** dialog. Its unit
  coverage is the hook's.
- Focus **visibility** (is there a visible ring?) was not measured — only
  focus location.
- `/admin` was reached as an admin; an editor's keyboard path was not walked.
- 1280px for the dialog work; `docs/154` covers 390px for the dashboard.
