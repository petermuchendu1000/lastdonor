# 154 — One pixel of hidden text, and a "View" button on the wrong page

**Date:** 2026-10-30
**Status:** both findings fixed, guarded, verified in a browser
**Journey:** the ORGANISER'S DASHBOARD on a phone — 390px, `Africa/Nairobi`

---

## 1. How this was walked, and why this journey

`docs/151` walked the donor at 390px and `docs/153` the create wizard. The 22
`/dashboard/*` screens an organiser lands on **after** submitting had only ever
been walked at desktop (`docs/117`, `docs/119`, `docs/121`).

The second reason was a specific open question: `docs/128` §5 left four admin
tables overflowing at 390px with the root cause **[UNKNOWN]** and both of its
hypotheses refuted. The dashboard is a different shell with its own tables, so
measuring it would either reproduce the defect in different markup or produce
the discriminating negative that doc lacked. It produced the negative.

Walked against a **local production build on a throwaway Postgres with the E2E
fixture**, never production. 22 routes, both findings reproduced before being
touched.

---

## 2. The walk itself: a clean surface, measured

Four of the 22 are redirects (`donations` → `finances`, `fund-releases` and
`withdrawals` → `finances/payouts`, `profile` → `settings`), so there are 18
distinct screens. All 18: **HTTP 200, 0px horizontal overflow, no error
boundary, no soft 404, no WCAG 2.2 2.5.8 failure**, with a fabricated route
answering 404 as the control.

⚠️ **"0px on all 22" is what a blind probe reports**, so it is worth nothing
without a control that can produce the other answer. In the same run, the same
probe, same viewport and same emulation mode, against the four pages `docs/128`
§5 measured:

| page | docs/128 said | this probe |
|---|---|---|
| `/admin/governance` | +90 | **+89** |
| `/admin/donations` | +73 | **+73** |
| `/admin/users` | +46 | **+46** |
| `/admin/campaigns` (its control) | 0 | **0** |

⚠️ `/admin/blog/topics` was +124 and read **0** here. Not investigated beyond
noting it: that table's width depends on its rows and the fixture seeds none.

⛔ `isMobile: false` deliberately. `docs/128` §5: with `isMobile: true`
Chromium widens the layout viewport instead of scrolling and the overflow is
**hidden**.

---

## 3. ⛔ FINDING A — docs/128 §5's root cause, closed

### 3.1 What it is

Tailwind's `.sr-only` is `position: absolute`, 1×1px. Every admin table renders
one as its last `<th>` — the **"Actions" column header**. The table's scroll
wrapper was `position: static`, so that span's **containing block was the
initial containing block (`<html>`), not the wrapper**. Therefore:

1. the wrapper does **not clip it** — an absolutely positioned box whose
   containing block lies outside a scroll container is not clipped by that
   container; and
2. it contributes to the scrollable overflow of **its own containing block**,
   which is `html` — never `body`.

Its static position is wherever the wide table puts it, i.e. off screen.

### 3.2 [VERIFIED] three ways, each able to give the other answer

| page | `html.scrollWidth` | the escaped span's `right` | hide that span alone | CONTROL: hide a different 1×1 box | wrapper `position:relative` |
|---|---|---|---|---|---|
| `/admin/donations` | 463 | **463** | **0** | 73, unchanged | **0** |
| `/admin/users` | 436 | **436** | **0** | 46, unchanged | **0** |
| `/admin/governance` | 479 | **479** | **0** | 89, unchanged | **0** |
| `/admin/campaigns` | 390 | **358 — on screen** | n/a | 0 | 0 |

The span's right edge **equals `html.scrollWidth`** on every overflowing page.

### 3.3 It explains every observation docs/128 could not reconcile

- *"`body.scrollWidth` 390 while `documentElement.scrollWidth` 514"* — the box's
  containing block is `html`, so only `html`'s scroll area grows.
- *"a scan for elements past the viewport not inside a clipping ancestor finds
  **zero**"* — the span is **1×1**, and that scan skipped sub-2px boxes.
  ⚠️ **My own first probe had the identical skip** (`if (r.width < 2 ||
  r.height < 2) continue`), which is why this took a second pass.
- *"`table-layout: fixed` takes it to 0"* — it narrows the columns, so the
  escaped span lands on screen. It never addressed the cause.
- *"a minimal reproduction produces 0px, so the browser is not at fault"* — the
  reproduction had no `.sr-only` in it. The browser never was at fault.
- *"a blank right gutter"* — literally correct. One pixel of visually hidden
  text is the only thing out there.

⛔ **`docs/128`'s control was never structurally different.** `/admin/campaigns`
has the same span with the same containing block; its table is merely narrow
enough that it lands **32px** inside the viewport. `/admin/blog`'s margin is
**1px**. The four "affected" pages are not a class — they are the ones that
crossed zero.

### 3.4 The fix, and the four rejected alternatives

`relative` on every horizontal scroll wrapper in `src/` — **40 wrappers across
31 files** — so the scroller is a containing block for its absolutely
positioned descendants.

- **Changes no geometry.** `position: relative` with `z-index: auto` creates no
  stacking context and does not move the box.
- **Proven safe before it was applied.** Across 33 walked pages there are **7**
  abs/fixed boxes inside a horizontal scroller and **0 are anything but
  `.sr-only`** — so no popover's positioning or clipping can change. (A
  hand-rolled popover inside a table would have been the real risk, and there
  is none.)

⚠️ **`src/components/ui/table.tsx` already wrote `relative w-full
overflow-auto`.** The library's own container was right the whole time; the 40
hand-rolled wrappers were not. It is now the rule's premise tripwire.

Rejected:

- `table-layout: fixed` — `docs/128` already rejected it: redistributes every
  column on four tables to fix a symptom.
- `contain: paint` — measures 0, and also clips ink overflow, so it would clip
  a focus ring. Heavier than the problem.
- `aria-label` on an empty `<th>` instead of an `.sr-only` child — removes one
  instance, not the cause (any abs descendant of a static scroller escapes),
  and screen-reader support for a named empty cell could not be tested here.
- `relative` on each of the eight `<th>`s — a hand-maintained per-site list,
  the shape this project has been burned by in `docs/119`, `/124`, `/144`,
  `/146`, `/147`.

### 3.5 What the open [UNKNOWN] was already costing

`ImpactUpdateQueue.tsx:37` records that `docs/139` built **cards instead of a
table** partly because *"a new table would be a fifth instance of a defect
nobody has explained"*. An unexplained defect was shaping product decisions.

### 3.6 [VERIFIED after the fix]

All four pages **0px**, `html.scrollWidth` 463/436/479 → **390**, and
`window.scrollTo(9999, 0)` no longer reaches a non-zero `scrollX`.

---

## 4. ⛔ FINDING B — three dashboard surfaces handed out a 404

### 4.1 [VERIFIED by execution]

| surface | visible anchors to a campaign with no public page | what they say |
|---|---|---|
| `/dashboard` | 1 | **"View"** |
| `/dashboard/supported` | 2 | the title, and **"Donate Again"** |
| `/dashboard/subscriptions` | 2 | the thumbnail, and the title |

All five target an `under_review` campaign with `published_at` NULL, which
answers **404**; `/campaigns/<an active slug>/donate` → 200 is the control.
`/dashboard/campaigns` and `/dashboard/campaigns/[id]` are **correctly gated**
and omit it — same component family, same button label.

⛔ **"Donate Again" is worse than a 404**: it invites a donation to a campaign
that cannot take one.

⚠️ `/dashboard/supported` and `/dashboard/subscriptions` were only measurable
because the fixture was made faithful first (`docs/129`): the organiser was
given a donation and a subscription to the unpublished campaign in the
throwaway database. Before that both read 0 anchors, which looks exactly like
clean.

### 4.2 Why no rule caught it, which is the useful part

`src/lib/campaign-links.ratchet.test.ts` exists, and its own header states
`docs/118`'s rule as *"before rendering **ANY** link to `/campaigns/<slug>`,
call `hasPublicPage`"*. Its rule 1 matches only `` link:`/campaigns/${ `` — the
**notification-property** spelling. A JSX `` href={`/campaigns/${ `` is
invisible to it. The rule was right; the matcher saw one of two spellings.
Same shape as `docs/116` §4, `docs/146` §6.1, `docs/147` and `docs/121` §3.

⚠️ **And the near-miss is written down in the repo.**
`dashboard/campaigns/[id]/page.tsx` carries:

> ⛔ Gated. This was the THIRD ungated link to `/campaigns/<slug>` (`docs/109`
> found the wizard redirect and **the dashboard "View" button**).

`docs/109` fixed the "View" button in `CampaignsListClient` — the one on
`/dashboard/campaigns`. `/dashboard` has **its own** "View" button, same label,
same template literal, never gated. The fix went to the page that was being
looked at.

Every newly submitted campaign is `under_review` (`docs/78`, `docs/79`), so
this was live for the whole time an organiser is waiting.

### 4.3 The fix: there is no hand-written campaign link in the dashboard

Every dashboard campaign link is now built by **`publicCampaignPath`**, which
returns `string | null`:

- 10 sites converted across 11 files, including the four that were already
  gated with `hasPublicPage` — so the pattern is uniform.
- The two client components (`subscriptions/client.tsx`, `FinancesClient.tsx`)
  and `ImpactLinkRow` take **`campaignHref: string | null`** from the server,
  since they cannot ask the database.
- `share-impact.ts` resolves it once for both of its row types, so there is one
  decider for the whole impact screen.
- `published_at` was added to the **four selects that lacked it** — never a new
  query (`docs/87`, `docs/131`).

Where a link is withheld the title renders as plain text and the status badge
already says why; the "Donate Again" button is withheld entirely, because a
control that can only fail is worse than none (`docs/119`).

### 4.4 [VERIFIED after the fix]

`/dashboard` 4 anchors → **3** — it dropped exactly the dead one, with
`controlLiveLink=1` proving the live ones stayed. `/dashboard/supported` 2 → 0.
`/dashboard/subscriptions` 2 → 0. `/dashboard/campaigns` still 4, unchanged.

---

## 5. ⚠️ Admin is deliberately out of scope, and that is recorded

`docs/120` §12 already reports `AdminDashboard`, `UserDetail` and
`admin/screening` as unfixed, because their row shapes carry no status so
guarding them means changing three queries on screens not walked in this pass.
Rule 3's scope is **derived** — `src/app/dashboard/**` and
`src/components/dashboard/**` — on a principle rather than a list: a signed-in
surface lists campaigns by ownership or relationship so it can hold any status,
while a public surface reached its campaign through a filter that already
required visibility (`docs/147`). Naming the three admin files as exemptions
would have been an allowlist, and `docs/152` is about what falls through one.

(Finding A's one-class change does cover admin: it is orthogonal.)

---

## 6. The guards, and the two rules that were DEFEATED first

`src/components/ui/scroll-containment.ratchet.test.ts` (4 rules) and rule 3 in
`src/lib/campaign-links.ratchet.test.ts`. **15 injections, all behaving** (13
fire, 2 comment-only rows must pass), sha256-verified clean restore after each,
and every row asserts its anchor applied before being scored (`docs/152` §4b).

⚠️ **The first two versions of rule 3 were defeated by injection, and that is
the transferable part.**

- **v1, "the file mentions a guard":** satisfied by a **leftover import** once
  the call is deleted. `docs/146` §6.1 and `docs/147` had each already met
  exactly that, and I wrote it anyway.
- **v2, "guard uses ≥ hrefs, imports excluded, following the resolved local":**
  survived the import hole. **Four injections still did not fire** — removing
  the gate from one of *two* links in `supported`, and turning
  `{x.campaignHref ? (` into `{true ? (` in three files where the prop's *name*
  still appears in a type declaration. **A line count cannot see which href is
  guarded.**
- **v3, what shipped:** the hand-written form is forbidden **outright**.
  `publicCampaignPath` returns `string | null`, so the type system carries the
  obligation and `href={publicHref}` cannot be accidentally ungated — there is
  nothing to gate. This is `docs/147`'s conclusion reached a second time:
  *"Rule 1 is now ABSOLUTE."*

v2's four dead rows are why the code was converted rather than the rule
weakened. A rule I know an injection defeats is not a guard.

One Finding-A rule deserves naming: the `relative` match is
`(?<![\w:-])relative(?![\w-])`, because **`md:relative` would satisfy
`includes('relative')` while applying at no phone width at all** — the only
width where this defect shows. An injection row proves it.

### 6.1 Two existing tests were amended, not satisfied

`campaign-visibility.test.ts` asserted the **old** shape: that
`CampaignsListClient` contained `hasPublicPage({ status: c.status, … })` and
exactly **one** hand-written href sitting *later in the file* than that call.
Both are now false and the code moved in the stronger direction. They now
assert the property (the builder is called; no hand-written href exists) plus a
control that the file being read really is the campaign list. ⚠️ The positional
assertion was the weaker claim anyway: an href appearing later in a file than a
guard call is not the same as being governed by it — which is what v2's four
dead injections demonstrated.

---

## 7. ⚠️ Three of my own measurements were wrong, and the controls caught all three

1. **The dangling-label detector reported 13 false positives, in two different
   ways.** It matched `` /(Raised|Goal is|…)\s*\n/ `` — which a **healthy
   label-above-value block** also produces. Rewritten to ask the label's own
   element what renders after it, it then reported the campaign detail page's
   "Raised" card as dangling — because "Raised" is a `CardTitle` inside
   `CardHeader` and the figure lives in a **sibling** `CardContent`, so the
   parent's text really is just the label. Asking the enclosing *card* returns
   `Raised / $1,500.00 / of $5,000.00 goal`. **Zero dangling labels on the
   dashboard.** `docs/107` §8.2's class is real; this was not an instance.
2. **A login timeout that looked like a broken app.** I guessed the `auth`
   rate-limit tier (10/60s per IP, `docs/127`) and a probe said **302, not
   429** — so the guess was wrong. Made the probe say what the *screen* says
   instead, and it answered immediately: **"Enter a valid email"**. A
   controlled React input filled before hydration silently loses what was
   typed, and a correct credential then presents as a validation error. Fixed
   by filling and then **verifying the value stuck**.
3. **A background scan was killed at its time limit** after writing its full
   output; both of its answers were already read, so nothing was lost — but
   piping it through `tail` the first time meant the output file stayed empty
   for 12 minutes and looked like a hang.

---

## 8. Reported, NOT fixed

- ⛔ The three admin link sites of `docs/120` §12, for the reason in §5.
- ⚠️ `subscriptions/client.tsx` holds an **eighth** status-label map
  (`docs/110` §4's class) missing `draft`, `under_review` and `archived`, so
  those fall back to the raw enum. My change makes that badge load-bearing (it
  is now the only explanation for a missing link). Not fixed because the map's
  `suspended → "Under Review"` is deliberate donor-facing copy, so adding keys
  means choosing donor-facing words for the missing statuses and deciding
  whether two statuses may share a label — a copy decision, not a sweep.
- ⚠️ `/admin/blog`'s escaped span now sits inside the viewport by **1px** with
  the fix in place it can no longer escape at all, but the *underlying*
  closeness means any admin table is one wider column from needing a
  horizontal scroll a phone user must discover. Not a defect; a note.

## 9. What was NOT checked

- No screen reader was run. The `.sr-only` headers are asserted present, not
  announced.
- 390px only; no tablet width.
- `/dashboard/updates`, `/dashboard/impact` and `/dashboard/finances` are gated
  **by inspection and by rule 3**, not by a reproduced 404: even with the
  faithful fixture they render no campaign anchor, because the unpublished
  campaign has no updates, no share-link attributions, and the finances query
  keys on the user id rather than the donor email.
- The 40th wrapper (`AuditLogViewer`'s `<pre>`) is a vertical JSON scroller; it
  got `relative` for uniformity and was not separately measured.
- No admin page's data query is executed by any test (`docs/107` §7 is still
  open); this pass executed them in a browser, not in CI.
