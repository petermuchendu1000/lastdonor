# 100 — Hand-rolled radio groups: making the role true

**Date:** 2026-10-22
**Status:** Done. All seven `role="radiogroup"` instances in the codebase now
implement the pattern they claim. Verified in Chromium against a production
build; see §5 for the measurements.

**Read before** adding a `role="radio"` anywhere, or changing
`src/lib/radio-group-keys.ts`, `DonationForm`'s amount tiles, or
`ShareYourStoryForm`'s choice chips.

---

## 1. What was wrong

Seven groups across two components were built as `<div role="radiogroup">`
holding `<button role="radio">`. Not one of them had a key handler, and not
one managed `tabIndex`.

**An ARIA role is a promise about behaviour, not a label.** A radio group is
ONE tab stop: Tab enters it, arrow keys move between options, Home and End
jump to the ends, Tab leaves. That is what a screen reader tells its user to
expect the moment it announces "radio button, 2 of 23". These groups
announced exactly that and did none of it:

- **Arrow keys did nothing at all** — the one interaction a screen-reader
  user is instructed to use.
- Every option was a plain `<button>` with the default `tabindex="0"`, so the
  groups were **23, 7, 6, 3 and 2 tab stops** instead of one each. A keyboard
  donor had to press Tab nine times to cross the donation amounts; someone
  creating a campaign had to press it twenty-three times to pass the category
  chips.

Found by `e2e/e2e-12-keyboard-a11y.spec.ts` asserting the documented pattern
against `DonationForm` and getting `Expected: focused, Received: inactive` on
both the desktop and mobile legs (`docs/99` §8.2). The groups had never been
exercised by a keyboard in a test, because the E2E suite had never run
(`docs/50`).

**Note for anyone auditing with axe:** axe did **not** flag any of this. It
checks that `role="radio"` has `aria-checked` and sits in a `radiogroup` —
all true here. Keyboard *behaviour* is not something it can see. Three of
these groups sat on pages that pass a full WCAG 2.1 AA axe run.

---

## 2. What was decided

`src/lib/radio-group-keys.ts` exports two functions, applied to all seven
groups:

- **`onRadioGroupKeyDown`** goes on the group container. It works off the
  DOM — `querySelectorAll('[role="radio"]')` — so it needs no refs and no
  per-option wiring, which is what made it cheap to apply to seven groups of
  different shapes. It handles **both axes** (`ArrowRight`/`ArrowDown` and
  `ArrowLeft`/`ArrowUp`), wraps at both ends, supports Home/End, skips
  `disabled` and `aria-disabled` options, and enters at the start when focus
  is on the container rather than an option.
- **`rovingTabIndex`** returns the `tabIndex` for one option, which is the
  half that makes the group a single tab stop.

Selection goes through **the option's own `onClick`**, by calling
`element.click()`. That is deliberate: each option already owns its state
update, and calling it keeps arrow-selection and click-selection from being
two implementations that can disagree.

### 2.1 The first-option fallback is load-bearing

`rovingTabIndex` gives the tab stop to the selected option — but when
**nothing** is selected it gives it to the FIRST option instead. Without that
fallback every option would be `-1` and the group would be **unreachable by
keyboard entirely**, which is worse than the defect being fixed.

This is not hypothetical. `form.fundraisingFor`, `form.category` and
`form.beneficiaryRelation` all initialise to `''`, and `DonationForm`'s
`selectedPreset` initialises to `null` — deliberately, so no amount is
pre-chosen. **Four of the seven groups render with no selection**, so the
fallback is the normal case, not the edge case.

---

## 3. The decision that took the most thought: two groups must NOT select on move

APG says an arrow key in a radio group moves focus **and** selects. That is
the default here, and it is right for five of the seven groups.

It is wrong for two of them, and applying it blindly would have been a
**regression**. `ShareYourStoryForm`'s review screen has a category editor
and a relationship editor, and both call `setEditField(null)` in the same
`onClick` that sets the value — **choosing an option unmounts the group**. So
with selection on move:

> The first ArrowRight commits a value and closes the panel. Of 23
> categories, a keyboard user can only ever reach the one adjacent to the
> current selection.

Those chips were previously 23 separate tab stops, so a keyboard user **could**
reach any of them. "Fixing" the group that way would have reduced keyboard
reach while looking like an improvement — and nothing would have caught it,
because the group would still have announced itself correctly and still had
one tab stop.

So `onRadioGroupKeyDown` takes `{ selectOnMove: false }` for those two:
arrows move focus only, and Space or Enter chooses. No extra key handling was
needed for the commit, because the options are real `<button>`s, which
activate on both and fire the same `onClick` — **still exactly one code path
that selects.**

### Trade-off accepted

Under manual activation the roving tab stop still follows **selection**, not
focus. So tabbing away and back returns to the selected chip rather than to
the one last arrowed to. Accepted because both groups are transient — they
close as soon as a choice is made — and it preserves the guarantee that
matters: exactly one tab stop per group, and never a trap. Making the tab
stop follow focus needs per-group state and buys nothing in a panel that is
about to close.

---

## 4. Rejected

**Removing the roles and letting them be plain buttons.** The simplest way to
stop the markup lying. Rejected: the roles carry real information that a row
of buttons cannot convey — these 23 chips are *one choice*, and one of them
is *currently chosen*. A screen-reader user would lose both. Better to make
the promise true than to delete it.

**Replacing them with native `<input type="radio">`.** Correct by
construction, and it would have deleted this whole file. Rejected because the
tiles are not stylable that way: `DonationForm`'s amounts carry two lines of
content plus a "suggested" badge and a 3-column grid layout, and the wizard's
cards carry an icon, a title and a description. The project already made that
trade; this ADR is about honouring it, not reopening it. **If a new group is
a plain list of labels, use a native radio** — the helper exists for the
cases where that is not possible.

**Doing all seven in one pass with the donate form.** Rejected at the time
(`docs/99` §8.2 records it with a ⛔): a 2,169-line wizard touched in the same
commit as the money path, with no test covering the wizard, is how a
regression ships. The money path went first and alone; this is the follow-up,
and the delay is what surfaced §3 — which would otherwise have been applied
blindly to all seven.

**Letting the helper infer `selectOnMove` from the DOM.** There is no honest
signal to infer it from. "Does selecting unmount this group" is knowledge the
call site has and the DOM does not.

---

## 5. Verified

Measured in Chromium against `next build && next start`, not reasoned about.
`scripts/` holds no probe for this; the probes were run ad hoc and their
assertions are reproduced here.

**Unit — `src/lib/radio-group-keys.test.ts`, 17 tests.** Both axes, wrapping
at both ends, Home/End, disabled options skipped, entering from the
container, unhandled keys left alone (and `preventDefault` NOT called on
them, so the page still scrolls), `selectOnMove: false` moving without
selecting, the default still selecting, and the never-more-than-one-tab-stop
property of `rovingTabIndex` across every selection state.

**Browser — the five wizard groups, walked end to end.**

| Group | Screen | Result |
|---|---|---|
| Who are you fundraising for? | step 0 | 2 options, 1 tab stop on the first while unselected; ArrowDown moves AND selects; tab stop follows the selection; wraps |
| Relationship to beneficiary | step 0 | 6 chips — `self` correctly filtered out, and the tab stop is on the first **rendered** chip, not the first of the unfiltered list; arrows select; Home/End reach both ends |
| Campaign category | step 3 | 23 chips, 1 tab stop, nothing selected initially; arrows select as they move; End reaches the 23rd |
| Campaign category | review editor | opens with the step-3 choice selected; **4 arrow presses and the editor is still open**; selection unchanged; focus moved; Space chose the focused chip and closed it |
| Relationship to beneficiary | review editor | 7 options (unfiltered — the review screen offers "Myself" too); same manual-activation result |

**Browser — `DonationForm`**, via `e2e/e2e-12-keyboard-a11y.spec.ts`: one tab
stop, ArrowRight moves and selects, Space keeps the selection. Green on both
Chromium legs in CI run 8.

### 5.1 A mistake worth recording

The first attempt at the two review-screen groups put the explanatory comment
**inside** the JSX conditional:

```jsx
{editField === 'category' && (
  {/* why selectOnMove is false … */}
  <div role="radiogroup" …>
```

A JSX expression container holds exactly one expression, so that is a parse
error — `')' expected` at a line 120 further down, and four more cascading
TypeScript errors pointing at the end of the file. Neither message names the
comment. `npm run typecheck` caught it in seconds; the lesson is only that
the error location is nowhere near the cause, so look for a `{/* … */}` as
the first child of a `&&` before reading the reported line.

---

## 6. Still open

**`tabIndex` does not follow focus under manual activation** — §3's accepted
trade-off. Revisit only if one of those editors stops closing on selection.

**No automated coverage for the five wizard groups.** The browser assertions
in §5 were run by hand. Covering them properly means driving the wizard
through five screens, which is a real E2E spec and a real fixture decision
(`docs/99` §5.1 — the suite has no sign-in fixture, though this flow does not
need one). The helper itself is unit-tested, and `DonationForm`'s use of it is
covered end to end, so what is uncovered is specifically the *wiring* of the
five wizard groups.
