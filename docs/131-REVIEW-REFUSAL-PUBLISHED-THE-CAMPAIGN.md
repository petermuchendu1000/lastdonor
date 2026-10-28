# 131 — Refusing a campaign published it

**Admin sub-journey 1 of 10: review and publication.**
Status: ⛔ **fixed on the branch, NOT DEPLOYED.** Production is still exposed
until the owner deploys. Nine `under_review` campaigns are one admin button
away.

---

## 1. The finding

`POST /api/v1/admin/campaigns/[campaignId]/suspend` is the refusal path. It is
the one `docs/93` designated — owner decision, 2026-10-25 — as *the* way an
admin says **no, this may not be published**, because refusal is the status
change that must carry a reason the organiser is emailed.

It writes `status: 'suspended'`. `suspended` is in
`PUBLICLY_VIEWABLE_STATUSES`. So refusing a campaign **gave it a public page.**

[VERIFIED by execution against a production build, §2 method 4] a `suspended`
campaign with `published_at IS NULL` answered **HTTP 200**, rendered the whole
appeal about its named subject, and printed `suspendedReason` — the admin's own
typed words — on the page. Twice (`page.tsx:538`, `page.tsx:766`), under the
heading *"This campaign is under review"*.

And `campaignRefusedEmail:933` tells the organiser, verbatim:

> **"Your campaign is not public. Nobody can see it or give to it."**

Neither half was true.

### 1.1 Four doors, not one

The refusal path is the worst of them because it is wired to a button an admin
is told to press. It is not the only one. Every route below moves a campaign
**nobody read** into a status the page served:

| from | to | route |
|---|---|---|
| `under_review` | `suspended` | `POST .../[campaignId]/suspend` (`SUSPENDABLE:18`) |
| `under_review` | `archived` | `DELETE /api/v1/user-campaigns/[id]:245` |
| `draft` | `archived` | `PATCH .../[campaignId]` (`ALLOWED_TRANSITIONS.draft`) |
| `draft` | `archived` | `DELETE /api/v1/campaigns/[slug]:217` |

⚠️ **`docs/120` §5 had already made this exact argument, and acted on it for
one door.** It removed `under_review` from `CANCELLABLE` because cancelling
"would give a never-reviewed appeal about a named real person a permanent
public page". It did not sweep the sibling route it designated as the refusal
path in the same breath. That is the shape of this whole family of findings:
`docs/118` swept the UI then notifications, `docs/120` §11.3 swept admin,
`docs/128` swept breadcrumbs — each time the sweep stopped one surface short.

### 1.2 What it is NOT — the bounds, measured

Severity has a ceiling, and it is worth stating because it is the difference
between this and `docs/116` §8.

- **Not indexed.** `isIndexable` and both sitemap lists are the narrower
  `active|last_donor_zone|completed` (`docs/118`), so an exposed page is
  served `noindex` and is absent from the sitemap.
- **Not listed.** No public listing surfaces `suspended` or `archived`.
  Checked: `/campaigns` filters `ACTIVE_STATUSES`; `/completed-campaigns` is
  `status = 'completed'` alone; `browse-params.ts:41`'s
  `COMPLETED_STATUSES = ['completed','archived']` feeds only `FilterNotice`
  copy (grep: its one consumer is `filter-notice.tsx`), **not** the query — I
  checked that specifically, because it reads like a widening.
- **No money.** `isDonatable` is `active || last_donor_zone`.
- **One surface only.** Every other public campaign surface filters to the
  three indexable statuses: `/campaigns/[slug]/donate:41`,
  `GET /api/v1/campaigns/[slug]:26`, and the OG card at
  `/api/v1/og/campaign/[slug]:93`. So the leak was `/campaigns/[slug]` and
  nothing else.

So: a shareable, direct-URL page carrying a real person's crisis and an
admin's private assessment of it. Not a search result.

### 1.3 Production state

[VERIFIED live, Supabase Management API, re-run twice]

```
status=active       n=14  unpublished=0
status=archived     n=1   unpublished=0
status=under_review n=9   unpublished=9
```

**It has not fired.** No campaign is in an exposed state today. Nine are one
`suspend` or one `DELETE` away.

---

## 2. How it was verified — and two VOID measurements first

Four independent methods, each challenging the last.

**1. Source composition.** `SUSPENDABLE` (`suspend/route.ts:18`) includes
`under_review`; `PUBLICLY_VIEWABLE_STATUSES`
(`campaign-visibility.ts:44`) includes `suspended`; and
`campaign-visibility.test.ts` already asserted that list equals the page's own
`or(...)`, parsed from source. So the composition was provable without running
anything.

**2. The page's own filter.** `page.tsx:113-131` keys on status alone.
`published_at` appears nowhere in it.

**3. Gate 3 — the falsifier, which FAILED to falsify.** The falsifier was
*"the page must have some other guard; a never-reviewed campaign surely
cannot render"*. It does not: the lookup is the only gate, `publicCampaignSelect`
imposes nothing, and there is no `published_at` check anywhere beneath it.

**4. Execution.** Local production build, real Postgres. Apply the refusal
write exactly as `suspend/route.ts:77-82` does, then read the page.

```
CONTROL A  under_review                     404  (STALE -> HIT)
CONTROL B  an active campaign               200  (STALE -> HIT)   [discriminates]
APPLY      suspended, published_at NULL     200  storyBody=YES  adminReason=LEAKED
RESTORE    under_review                     404  storyBody=no    adminReason=no
```

The restore is a fifth control: the leak appears and disappears with the one
column, in both directions.

### 2.1 ⚠️ Gate 5: the first two probes were VOID, for two different reasons

Both were ISR, and both would have been reported as results by a less
suspicious harness. `/campaigns/[slug]` is `revalidate = 60` (`page.tsx:40`),
and a `psql` write does not call `revalidatePath()` the way the real routes do.

- **Probe 1** read immediately after each write. `stale-while-revalidate`
  serves the previous copy and only *schedules* the refresh, so the answers
  came out **inverted**: `under_review` read 200 and the refused row read 404.
  Had I stopped there I would have reported the opposite of the truth.
- **Probe 2** "settled" on three reads 2 seconds apart. All three were the
  same unexpired cache entry. **A cache that has not expired cannot disagree
  with itself**, so the agreement proved nothing — a check that could not
  fail, inside a measurement.

Probe 3 waits out the full 60s window, then reads A (expect `STALE`, discard),
B (the regenerated copy) and C (confirm B), and voids the row if B ≠ C. That
is `docs/119` §2's two-request rule, extended by one, and the harness is kept
at
`scratchpad/refusal-probe3.sh`.

⚠️ A sixth marker was also wrong at first: grepping the body for the slug
matched the **404 page**, whose canonical URL carries the slug. The marker is
now the subject name, which only the campaign body renders.

---

## 3. The fix: ask the column, not the status

`src/app/campaigns/[slug]/page.tsx` now requires
**`isNotNull(campaigns.publishedAt)`** in `getCampaign`, and
`hasPublicPage` / `publicCampaignPath` take `publishedAt` as a **required**
input.

### 3.1 Why not a fifth guard on a fourth door

Because the door set is not the invariant. Four doors were open, and the only
reason there were four is that nobody had asked the question once. **A status
allowlist answers the wrong question**: it says *"would this page render a
campaign in a state like this one"*, never *"did a person approve this"*.

`published_at` is the record of that approval, and `docs/120` pinned it to
exactly two UPDATE writers with
`src/db/campaign-publication-writers.ratchet.test.ts`. So asking the column
closes the class, and the fifth door somebody opens next week is closed before
it is written.

### 3.2 ⚠️ It needs no new status, and that is the point

`docs/93` records the real difficulty: *"one status, two situations"*.
Suspending a **live** campaign is an investigation — it has donors, and
`notifyCampaignSuspended` tells them their money is safe, so the page must
render that notice. Suspending an `under_review` campaign is a **refusal** —
it was never public and has no donors.

The enum offers no non-public terminal status to move a refusal to (`draft`
and `under_review` are not terminal; `archived`, `cancelled` and `suspended`
are all served). So "give refusal its own status" is a schema change and an
owner decision.

`published_at` makes it unnecessary: **the live one has the column set and
keeps its page and its notice; the refused one never had either.** It is
precisely the discriminator `docs/93` said the status could not carry, and it
takes nothing away from `docs/118` §9's decision to serve closed campaigns.

### 3.3 Blast radius on live data: zero, and measured

Every currently-served production row has `published_at` set (§1.3: active
14/14, archived 1/1). So this predicate 404s nothing that answers 200 today.
It is not a behaviour change for any existing campaign; it is a change for
campaigns that should never have been reachable.

### 3.4 ⛔ Required, not optional

`publishedAt` is a required parameter on both guards, so `tsc` enumerated every
call site — **49 errors across 21 files**, nothing silently compiling. That is
the `docs/115` trick and `docs/118`'s own reasoning (*"an optional one would
have let every existing 404 compile"*) **inverted**: an optional one here would
let every call site keep promising a page the lookup has started refusing,
which is the `docs/118` defect arriving from the other direction.

⚠️ `Date | string`, because the same row is read on both sides of the
serialization boundary: a server component holds a `Date`, a client component
handed it through props holds an ISO string. A string-rejecting guard would
have hidden the "View" link on every live campaign in the organiser dashboard.

### 3.5 ⚠️ No new queries

Fifteen call sites needed the value plumbed. In every case the column was added
to a `select` that already ran — **not one new round trip**, which `docs/87`'s
three-concurrent-query cap makes a hard constraint rather than a preference.

Two call sites needed care because they notify *after* writing:

- `resume/route.ts` and `PATCH .../[campaignId]` both stamp `published_at`
  conditionally. The row read beforehand still holds the old `null`, so a
  notification built from it would have refused a link to a campaign that had
  just gone live. The stamp is **hoisted** into a `publishedStamp` local, and
  the same value is both written and passed — not a second `new Date()`.

⛔ **No call site passes a literal.** The hardcoded-`status: 'active'`
notification sites were the temptation: the campaign is live by construction,
so `publishedAt: new Date()` would have compiled and passed every test. That is
exactly the `docs/125` Gate-4 trap (*"injecting `currency: 'USD'` at the call
site passed all 41 tests"*), so each one carries the real column.

---

## 4. The checks, and that they can fail

`src/lib/campaign-publication-gate.test.ts` (11 tests) asserts:

- the page's `getCampaign` requires `isNotNull(campaigns.publishedAt)`, read
  from source, with a control that the function was found and has a `where`;
- every served status is refused with a null date — **and the control that
  each is allowed with one**, without which a guard returning `null` for
  everything would pass;
- the refusal email still promises the campaign is not public, tied to the
  behaviour that makes the promise true (the shape of
  `organiser-promises.test.ts` / `account-promises.test.ts`);
- **the doors are still open**, read from source. This is the control that
  makes the rule mean something: if every door were closed the predicate would
  be belt-and-braces and the suite vacuously green forever. If somebody closes
  one, this fails and names the decision to re-read.

⚠️ Its first version sliced the refusal template at the first `\n}` — which
closes the **parameter object**, not the function — so it captured the
signature and no copy, and the `toContain` failed for a reason that had nothing
to do with the template. Sliced to the next `export` now, with a control
asserting the slice is non-trivial.

### 4.1 Gate 4 — injection results

(filled in below by `scratchpad/inject/run.py`, which restores from a content
snapshot and **re-verifies the restore byte-for-byte after every row** —
`docs/120` §11.1 recorded a run where one injection persisted and seven later
rows were measured against a polluted tree while printing PASS)

Baseline across the three files: **39 passed, 0 failed.** All eight injections
fire; the restore afterwards is byte-identical and the suite returns to 39/0.

| # | injection | failed | result |
|---|---|---:|---|
| 1 | page lookup drops `isNotNull(campaigns.publishedAt)` | 1 | FIRED |
| 2 | `hasPublicPage` ignores `publishedAt` | 5 | FIRED |
| 3 | `publicCampaignPath` substitutes `new Date()` on the way through | 2 | FIRED |
| 4 | `hasPublicPage` answers false for everything (**the control**) | 7 | FIRED |
| 5 | the refusal email stops promising the campaign is not public | 1 | FIRED |
| 6 | `under_review` removed from `SUSPENDABLE` (door closed) | 1 | FIRED |
| 7 | `PATCH` stops allowing `draft -> archived` | 1 | FIRED |
| 8 | the email slice reverts to the `\n}` bug (**control on the control**) | 2 | FIRED |

Rows 4 and 8 are the ones worth reading. **4** proves the rule is not satisfied
by a guard that hides every link — seven tests fail, so refusing everything is
caught as loudly as allowing everything. **8** proves the control on the
refusal-promise test works: reintroducing the slice bug that captured the
signature instead of the copy fails two tests rather than passing quietly,
which is how that defect behaved the first time.

Rows 6 and 7 fire **by design**, and that is their job: if somebody closes a
door, the suite says so instead of leaving the predicate as unexplained
belt-and-braces.

### 4.2 The fix, in a browser

Production build, real Postgres, one server (pinned — two would void the
measurement), each row settled past the ISR window per §2.1.

| | state | HTTP | |
|---|---|---:|---|
| 01 | control: active, published | **200** | renders |
| 02 | **the fix**: suspended, `published_at` NULL | **404** | no story body, reason not rendered |
| 03 | control: suspended, `published_at` SET | **200** | donor notice shown |
| 04 | restore: `under_review` | **404** | |

**Row 03 is the row that matters.** It is `docs/93`'s live-suspension case and
it is untouched: a campaign that WAS live keeps its page, its hero, its story
and its "This campaign is under review / your money is safe" notice. The fix
removes exactly one case and nothing else.

⚠️ And row 03's screenshot is what the DEFECT looked like. The only difference
between that page and the one a refused organiser got is one column.

Screenshots: `scratchpad/review-shots/01..03-*.png`.

---

## 5. Reported, not fixed

**5.1 ⛔ `DELETE /api/v1/user-campaigns/[id]` archives a queued campaign
silently.** Its guard is `['archived','completed']`, so `draft` and
`under_review` fall through to `.set({ status: 'archived' })` with **no audit
row and no notification**. The public-page half is closed by §3; what remains
is that an organiser can retire a campaign out of the review queue and nothing
records it — which also means an admin reviewing the queue sees a row vanish
with no explanation. [VERIFIED] the route has no UI caller (grep for a
`DELETE` fetch against `user-campaigns` across `src/components` and `src/app`
returns nothing), so it is API-only and reachable by an authenticated owner.
Not fixed here because deciding what an organiser may withdraw, and what the
admin who was reviewing it is told, is a product call.

**5.2 The enum has no non-public terminal status for a refusal** (§3.2).
`published_at` makes this harmless, so it is debt rather than a defect. Worth
knowing before anyone proposes serving a status on `published_at`'s behalf.

**5.5 ⛔ THE E2E SUITE IS RED AT HEAD, and CLAUDE.md says it is green.**
Found running the gate for this change, and **it is not mine** — [VERIFIED by
control: `git stash`, rebuild, re-run, and the same two tests fail identically
at baseline with 0 modified files]. CLAUDE.md records *"138 pass / 0 fail / 24
declared skips"*; at HEAD it is **162 passed / 2 failed / 24 skipped**, so both
halves of that line are stale.

The two failures are `e2e-19-collaborator-journey.spec.ts:92` and `:98`, on
**Mobile Chrome only** — Desktop passes them, which is the control proving the
product renders the invitation page correctly. The cause is shared mutable
fixture state across the two Playwright projects, traced rather than guessed:

- `E2E_INVITE_TOKEN` is **one** seeded invitation, and an invitation is single
  use (`docs/111`).
- `:170 accepting twice is success` **consumes it**. It runs once per project,
  so the Desktop leg uses it up and the Mobile leg's view-only tests at `:92`
  and `:98` then render the *invalid invitation* state — hence `element(s) not
  found`.
- `:78` already mints its own with `createE2EInvite(CAMPAIGN_ID)`, which is
  the `docs/117` pattern. These three did not get it, presumably because two
  of them only *view* the invitation — true, but another project's accepting
  test consumes it anyway, and both projects share one database.
- `:61` and `:71` use the shared token and pass on both, because they test the
  signed-OUT redirect, which works whether or not the invitation is live.

⚠️ **And `:170` passes on the second project for the WRONG reason** — the
`docs/104` class. On Mobile the invitation is already used, so `button.count()`
is 0 on both iterations and the loop does nothing; the assertion
`toHaveCount(1)` succeeds only because the **Desktop** run left a membership
row for the same helper. It asserts nothing on that project.

⛔ **Not fixed here, and not because it is small.** Minting a fresh token in
`:92` and `:98` is not sufficient: `:98` asserts *"Still not a member"* via
`getByText('Helping')).toHaveCount(0)`, and `E2E_HELPER_EMAIL` already holds an
accepted membership from the other project by then. A correct fix needs
per-project fixture identity (or a per-campaign assertion instead of a global
one) and must also repair `:170`'s wrong-reason pass. That is a spec refactor
in another journey's file, and it does not belong in the same commit as a
review-gate fix.

**5.4 The sitemap was NOT given the same predicate, deliberately.**
`sitemap.ts` selects `active|last_donor_zone|completed`, and none of those can
hold a null `published_at` today: both writers of `active` stamp it when null,
and `src/db/campaign-publication-writers.ratchet.test.ts` pins that. So the
"sitemap advertises a URL the page 404s" contradiction is currently
unreachable, and a sitemap edit deserves its own before/after measurement
(`docs/119` §2) rather than riding along here. `generateStaticParams` was left
alone for the same reason, and because a hermetic build returns `[]` from it
anyway. Both are consistency hardening, not defects.

**5.3 `suspendedReason` is rendered publicly for a live suspension, by
design.** For a refusal that is now unreachable. But the field is admin-typed
free text shown to donors — [VERIFIED in the browser, §4.2 row 03: it appears
twice, in the sidebar panel and above the title] — and the suspend route takes
`internalNotes` separately, so the split exists and is being relied on.
Nothing checks that an admin knows which box is which, and the dialog does not
say that one of them is published.

---

## 6. Corrections to this session's own work

- **I reported the DELETE door first and the refusal door second.** The
  refusal door is the one that matters: `DELETE` has no UI caller, and the
  refusal path is a button in `CampaignDetail`. I found it only by enumerating
  every writer of a publicly-viewable status rather than stopping at the first
  one — which is what `docs/120` §5 did not do.
- **Two measurements were void before one was valid** (§2.1), and both void
  ones were self-consistent. Neither failed loudly.
- ⚠️ **I nearly reported an E2E run that never happened, and the mechanism is
  worth knowing.** The command was
  `npm run e2e:build > build.log && npm run test:e2e > run.log`. The seed
  failed (`ECONNREFUSED 127.0.0.1:5433` — that Postgres was from an earlier
  session and was gone), so the `&&` short-circuited: `test:e2e` never ran,
  **and its redirect never truncated `run.log`**, which still held a previous
  run's "138 passed". A tail of that file reads exactly like a green run.
  The tell was a non-zero `$?` beside a passing-looking log, and the build log
  saying `FAILED` on its last line. **A redirect that never executes leaves
  the old file in place**, so an aborted step can hand you yesterday's
  success. Delete the target before the run, or write to a fresh path.

- **My first attempt at the `donations/[id]` edit landed on the wrong
  `select`** — the `docs/122` manual-refund branch, which does not link the
  campaign page — because I replaced the first textual match rather than the
  one at the flagged line. Caught by reading back, and the patch harness now
  asserts an anchor occurs exactly once before replacing it.

---

## 7. Not checked

- The `e2e/` suite WAS run: **162 passed / 2 failed / 24 skipped**, and the 2
  are pre-existing (§5.5, proven by a baseline control). Nothing in it
  regressed. The fixture is also consistent with this change by construction —
  every served fixture status carries a `publishedAt`, and the one
  `under_review` row is explicitly `publishedAt: null` with a comment saying it
  must stay that way.
- The four remaining doors are still open by design; only the page is closed.
- `/admin` surfaces that link a campaign by hand and were reported unfixed in
  `docs/120` §12 (`AdminDashboard`, `UserDetail`, `admin/screening`) are
  untouched: their row shapes carry neither status nor publication date.
