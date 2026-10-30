# 153 — The create wizard refused, 863px off screen

**Date:** 2026-10-30
**Status:** fixed, guarded, verified in a browser
**Journey:** the ORGANISER on a phone — 390px, `Africa/Nairobi`, the other
half of the pair `docs/151` started with the donor

---

## 1. How this was walked

`docs/151` walked the donor at 390px. The organiser's create wizard had only
ever been benchmarked at **desktop** (`docs/75` screen 1, `docs/76` screen 2,
`docs/77` screens 3–6), and `docs/118` §10 had since added a **currency
selector** to it that nobody had looked at on a phone.

⛔ Creating a campaign writes a row, so this was walked against a **local
production build on a throwaway Postgres with the E2E fixture**, never
production. The CI workflow's literal throwaway secrets were reused rather
than invented.

---

## 2. Four suspicions, all REFUTED

Recorded so nobody re-investigates them.

### 2.1 Goal bounds — refuted, and I had the wrong end

The wizard validates against `MIN_GOAL_MAJOR = 1` / `MAX_GOAL_MAJOR =
1_000_000_000` (`ShareYourStoryForm.tsx:172-173`), currency-independent, while
`CURRENCIES` carries **per-currency** `minGoalMinor`/`maxGoalMinor`. Executing
both ends showed a wide divergence — USD $1–$999 accepted by the wizard and
refused by the schema, and so on.

⚠️ **That measurement was of the wrong schema and the finding is withdrawn.**
The per-currency bounds live in `createCampaignSchema`, which is the **admin**
create route. The wizard POSTs to `/api/v1/user-campaigns`, which parses
**`createUserCampaignSchema`** — and that has its own flat minor-unit range,
`MIN_WIZARD_GOAL_MINOR = 100` / `MAX_WIZARD_GOAL_MINOR = 100_000_000_000`,
with a comment stating the choice is deliberate and recorded in `docs/116`
§3.3. For a 2-decimal currency those are **exactly** the wizard's major-unit
bounds. Re-run against the right schema, with controls at both ends, the two
agree in both currencies.

**What I should have checked first:** which schema the route the form posts to
actually parses. I compared the wizard against a schema it never reaches.

⚠️ One latent note, not a defect: `majorToMinor(1, code)` is 1 minor unit for
a **zero-decimal** currency, which `MIN_WIZARD_GOAL_MINOR = 100` would refuse.
Both collectable currencies are 2-decimal, and `docs/103` already makes adding
a third a deliberate edit.

### 2.2 Two `<h1>` per screen — refuted

Every screen reports `h1Count: 2`. The second has `w=0,h=0`,
`offsetParent === null`, same text, inside an `lg:`-gated parent — the
standard responsive duplicate, removed from the accessibility tree at phone
width.

### 2.3 Sub-24px tap targets — refuted, by its own control

Measured undersized targets on every screen, including five `Edit` buttons at
26×20 on the review screen. **Every one passes WCAG 2.2 2.5.8's *spacing*
exception** (nearest other target centre ≥ 24px away), so size alone was never
the finding. ⚠️ The control is what settled it: `/donate` reports the same
kind of list, and `docs/151` records that page as clean — because `docs/151`
measured the **form**, where my probe measured the whole page including the
footer. Different scopes, not a contradiction.

### 2.4 The FAQ on all six screens — refuted, already measured

A 536px FAQ block renders identically on every one of the six screens (26–39%
of each page, starting at y=844 — exactly one viewport down). It is a recorded
decision: `share-your-story/page.tsx:82-97` says *"All four answers used to
render expanded, which put 170 words and roughly 500px of reference text under
an unfinished form, on every one of the six wizard screens"*, and collapsing
them is the fix already applied. My 536px is the optimised state.

⚠️ Drift, not a defect: that comment says "all four answers"; there are now
**five**.

---

## 3. ⛔ THE FINDING: the gate refuses and says nothing you can see

### 3.1 What the code does

Both navigation gates are a bare return:

```ts
function goNext()              { if (!validateStep(step)) return; … }  // :517
function handlePreviewLaunch() { if (!validateStep(5))    return; … }  // :536
```

`validateStep` ends `setErrors(errs); return …` (`:505`). React renders each
message beside its own field. **Nothing moves the person to them**, and the
action bar is pinned to the bottom of the viewport — so the person is *always*
at the end of the page when they press it.

### 3.2 [VERIFIED] three independent ways

**Method 1 — source.** The two gates above; `setErrors` with no scroll, no
focus, no toast. The `heroImageUrl` message (`:1730`) had no `id` and no
`role` at all.

**Method 2 — execution, 390px.** On the review screen (page **2,093px**,
viewport **844px**), scrolled to the button as a person must be, pressing
**Preview & submit** with no cover photo:

```
scrollY 1213 -> 1249   (visible band 1249..2093)
errors: [{ "text": "A campaign photo is required", "absY": 386, "inViewport": false }]
toasts: []            modal opened? 0
```

The message was **863px above the top of the screen**.

**Method 3 — the screenshot.** The frame taken immediately after the press is
indistinguishable from the one before: the button, unchanged, and the FAQ
below it. Nothing on screen says anything happened.

⚠️ **The control proves the probe could see the other answer**: the same press
on screen 1 (1,380px) put its message at y=197, `inViewport: true`.

### 3.2a The class is not one screen, and that is measured too

The review screen is the worst case, not the only one. Screen 5 (*Title and
story*), driven the same way with the title left empty:

```
page=1562px  viewport=844px   scrolled to the button: scrollY 718 (band 718..1562)
"Title must be at least 20 characters (0/20)"  at y=401   -> 317px ABOVE the band
```

So the blast radius is measured on two screens rather than one plus an
inference. Screens 1–3 are short enough (1,380px, button at ~792px) that their
messages land in view on their own, which is exactly why this was easy to
miss: the defect only appears once a screen grows past roughly two viewports.

### 3.3 And the wizard INVITES the state

Screen 3 offers **"Skip for now"** (`:2349-2355`), which calls `goNext`, and
`validateStep(2)`'s own comment reads *"Add Media - no required fields; photo
is validated at Review"*. So the product tells the organiser to skip the
photo, then three screens later silently refuses because they did.

⚠️ This is not a contrived path. It is the path the UI offers.

---

## 4. The fix

Smallest change at the root cause. `validateStep` is the one function **both**
gates pass through, so the reveal is wired there — putting it in the callers
would have been two chances to forget, and one of them being forgotten is what
this document is about.

- `FieldError` renders every message with a stable `id`, a `data-field-error`
  marker and **`role="alert"`**. Each site keeps its own `className`, so no
  pixel moves. 17 sites converted.
- `revealFirstError()` finds the marked message with the smallest viewport
  `top`, scrolls it to centre, and focuses the control it names where one
  exists (several fields are a radiogroup or an upload area, so a missing id
  is normal and the scroll is the fallback).
- Called after **two** `requestAnimationFrame`s: React has not rendered the
  messages when `setErrors` returns, and one frame lands before the commit
  paints on mobile Chromium.

⚠️ `role="alert"` is not decoration. These messages appear *after* the press,
so without a live region a screen-reader user is told nothing either — the
same silence by a different route.

**[VERIFIED by execution, same probe, after the fix]**

| | before | after |
|---|---|---|
| `scrollY` on press | 1213 → 1249 | 1213 → **0** |
| error `inViewport` | **false** | **true** |

The screenshot now shows the highlighted photo area with *"A campaign photo is
required"* directly beneath it.

---

## 5. The guard, and the four wrong versions it took

`src/app/share-your-story/validation-is-visible.test.ts`, 6 rules, checking
the **mechanism** rather than the symptom: that every message is findable by
the reveal, and that the reveal is wired to the one function both gates share.
Asserting "pressing submit scrolls" would need the whole wizard rendered with
a session — which is how this went untested in the first place.

**8 injections, all behaving** (7 fire, including the real production state;
one comment-only row must pass), sha256-verified restore after each, and every
row asserts its own anchor applied before being scored.

⚠️ **The rule was wrong four times, each caught by an injection refusing to
fire.** This is the useful part of the document.

1. `slice(i, i + 700)` from `function FieldError` **ran past the end of the
   function into `revealFirstError`**, whose selector string contains
   `[data-field-error]` — so deleting the marker left the rule green,
   satisfied by the *next function*. (`docs/123`'s "stop at the end of the
   block", in another costume.) Replaced with a body bounded by the next
   top-level `function`.
2. The control counted **occurrences** of two strings and asserted
   `marked < reds`. That can never fail: the marker appears ~3 times however
   many elements wear it, against ~20 reds.
3. Rewritten to match opening tags, it then flagged **`FieldError`'s own
   `<p>`** — which is the one place the marker belongs — and failed against
   correct code.
4. Scoped outside that body, the tag regex `<([A-Za-z]+)\b[^>]*data-field-error[^>]*>`
   still missed an injected marker, because **`[^>]*` stops at the first `>`,
   and JSX tags routinely contain one inside `onClick={() => …}`**.

The rule that survives is a **count**: `data-field-error` may appear exactly
twice — on `FieldError`'s `<p>` and in the reveal's selector. A third
occurrence means somebody hand-marked an element the reveal could scroll to.
Counting cannot be defeated by any of the four failures above.

---

## 6. Probe failures that each read as a result

- ⚠️ **The first error probe could not see its subject.** It selected
  `[role="alert"], .text-destructive, [id$="-error"]`; the messages render as
  `<p className="text-sm text-red-500">` and the `heroImageUrl` one has
  neither an id nor a role. It reported `errors: []` for the subject **and the
  control**, which is the tell — `docs/135` §5 for the second time in one day.
- ⚠️ **`pkill -f "next start"` killed its own shell** (exit 144), `docs/139`
  §11's trap. The stale server then kept port 3100, the new `next start` died
  with `EADDRINUSE`, and the old process served the **old build's HTML against
  a rebuilt `.next`** — a `ChunkLoadError` and an error boundary that looked
  exactly like my change having broken the wizard. `docs/144` §5.2: *a server
  you did not actually stop answers exactly like a change that did nothing.*
  Resolved by killing by pid found in `/proc` (printing only the pid) and
  re-checking the port.
- ⚠️ Two schema probes reported every row as refused because the fixture was
  missing required fields (`slug`, `storyHtml`, then `beneficiaryRelation`) —
  zod's `superRefine` does not run when the base parse fails, so the bound
  under test was never reached. Both caught by the control row.

---

## 7. Reported, NOT fixed

- ⛔ **The currency selector defaults to USD for an organiser in Nairobi.**
  The wizard reads `DEFAULT_CURRENCY`, and this platform already has
  browser-side country detection (`docs/103` `detectLocale`) wired into
  `LocalAmount` by `docs/149`. Defaulting the selector from it would mean a
  Kenyan organiser no longer creates, by default, a campaign on the rail that
  cannot collect (`docs/125`). **Not done:** a campaign's currency is
  immutable once any donation exists (`docs/92`), so what it defaults to is a
  product decision, and `docs/118` §10.6 already records the adjacent question
  as owner-only.
- ⚠️ `ytError` (`:1460`) and the literal YouTube message (`:2078`) are
  user-facing errors outside the `errors` object; they do not gate navigation
  and were left alone to keep the change minimal.

## 8. What was NOT checked

- No screen reader was run. `role="alert"` is asserted as present, not as
  announced.
- The wizard was never driven to a **successful** submission, so the created
  campaign, its redirect (`docs/109`) and the submission email were not
  exercised on this pass. The reason is concrete rather than an omission:
  `handleSubmit` POSTs the photo to `/api/v1/campaign-photos` first
  (`:641-653`), which reaches Supabase storage, and this sandbox has no
  storage credentials — the same wall `docs/130` met. Supplying production's
  would mean writing a test photo into production storage, which is a
  production write and not an audit's to make.
- Screens were measured at 390px only; no tablet width.
- The five hand-rolled `role="radiogroup"`s `docs/99` reports in this file
  were not re-tested for arrow-key behaviour here.
