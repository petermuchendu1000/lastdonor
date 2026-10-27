# 120 — The review journey, and the door that published

**Date:** 2026-10-27
**Scope:** the journey from "an organiser presses Submit" to "a person has said
yes or no", walked end to end.
**Status:** fixed and tested; four findings reported and not changed (§12).

---

## 1. Why this journey was next, and what production said

The previous two passes covered the donor journey (`docs/118`) and the
organiser's own (`docs/119`). The review journey gates both: since `docs/78`
and `docs/79` **every** campaign is inserted `under_review` with
`published_at: null` and is invisible to the public until an admin approves it,
so if this journey has a gap nothing on the platform goes live at all.

Production, read 2026-10-27 over the Supabase management API:

| | |
|---|---|
| campaigns | 23 — 14 `active`, **8 `under_review`**, 1 `archived` |
| of those 23, with an organiser | **3** (`creator_id` is nullable; `docs/119` §3.3) |
| admins | **1** |
| last `campaign.published` audit row | **2026-10-19 — eight days earlier** |
| `campaign.submitted` rows | 3 (2026-10-20, -21, -25) |
| `campaign.auto_drafted` rows | 7 (2026-10-18 … -27) |
| verification documents, withdrawals, Didit sessions | **0, 0, 0** |

So the queue was accumulating and nothing was coming out of it. One organiser's
appeal had been waiting seven days. No promise was broken — `docs/78`
deliberately quotes no turnaround time — but something was clearly not working,
and the question was whether it was a product gap or simply nobody having
looked.

### 1.1 ⚠️ The anomaly that pointed at the defect

One of the three organiser submissions was **not** in the queue.
`help-john-recover-after-a-car-accident`, submitted 2026-10-25 02:27:17 by
`cosialm@gmail.com`, is `active` with `published_at = 02:28:52` — **95 seconds
later** — and its complete audit trail is:

```
2026-10-25 02:27:17  campaign.submitted      actor=donor
2026-10-27 02:18:53  collaborator.invited
2026-10-27 02:19:10  collaborator.invited
2026-10-27 02:21:06  collaborator.accepted
```

**No `campaign.published` row. No `campaign.status_changed` row.** Nothing at
all records the decision.

A falsification query over every public campaign makes the pattern plain —
`published_at` set against the audit rows that should accompany it:

| slug | `campaign.published` | `auto_published` | `auto_drafted` | organiser |
|---|---|---|---|---|
| david-nwosu … tuan-nguyen (8 rows) | 1 | 1 | 0 | none |
| **brent-ledbetter** | 0 | 0 | 1 | none |
| **nicholas-cabo** | 0 | 0 | 1 | none |
| **samuel-pierre-jr** | 0 | 0 | 1 | none |
| **maj-sorffly-davius** | 0 | 0 | 1 | none |
| **david-l-jones** | 0 | 0 | 1 | none |
| zz-payments-test-mpesa-gateway | 0 | 0 | 0 | none |
| **help-john-recover-after-a-car-accident** | **0** | **0** | **0** | **set** |

The five in the middle are `docs/116` §8's unreviewed publications, still live
exactly as that doc records. The last row is a different shape: an
organiser-submitted campaign, 95 seconds from submission to public, with no
record of who approved it.

**[VERIFIED]** `campaign.published` is written in exactly one place,
`src/app/api/v1/admin/campaigns/[campaignId]/route.ts:151`, by an
unconditional `await db.insert(auditLogs)` — nothing swallows it. So that route
was not used, and something else published the campaign.

---

## 2. ⛔ The finding: the dashboard's own "Review" link published the campaign
on save

Three mistakes, each harmless alone, composing into a publication path that
recorded nothing.

### 2.1 The chain, cited

1. **`src/components/admin/AdminDashboard.tsx:158-163`** — the `/admin`
   pending-review table's only row action was
   `Review → /admin/campaigns/<id>/edit`. The `[Admin] Review needed` email's
   CTA (`src/lib/email-templates.ts:241`) and the in-app notification row
   (`src/lib/notifications.ts:518`) pointed at the same place. **All three
   push signals led to the editor.**

2. **`src/app/admin/campaigns/[id]/edit/page.tsx:50`** —

   ```ts
   status: campaign.status === 'draft' ? 'draft' : 'active',
   ```

   Anything that is not `draft` was handed to `CampaignEditor` as `'active'`.
   So an `under_review` campaign arrived at a select labelled **"Initial
   Status"**, pre-set to **Active**, offering only Draft and Active — a
   campaign that was not active, not public, and not approved, described to
   the admin as live.

3. **`src/app/api/v1/campaigns/[slug]/route.ts:146-151`** —

   ```ts
   if (data.status !== undefined) {
     updateValues.status = data.status;
     if (data.status === 'active') { updateValues.publishedAt = new Date(); }
   }
   ```

   `CampaignEditor.onSubmit` (`:158-170`) PUTs the **whole form object**,
   status included. This route had **no transition check, no audit insert and
   no notification import at all**, and it stamped `publishedAt`
   **unconditionally** rather than only when null.

**So: an admin who followed the review link, fixed a typo, and pressed Save
published the campaign** — with no `campaign.published` row, no "Your Campaign
Is Live!" email to the organiser, `ALLOWED_TRANSITIONS` bypassed, and
`published_at` re-dated on every subsequent save of an already-live campaign.

Two clicks from the dashboard, and the row it produces is **indistinguishable
in `audit_logs` from one nobody ever read** — which is the evidence
`docs/116` §8's forensics rest on, and the only evidence that *"every campaign
is reviewed by a person before it goes live"* (asserted in ~44 lines across 23
files, including the site title and the `/compare` table) is true of any
particular campaign.

### 2.2 ✅ The organiser's path is NOT affected, and that is worth recording

`PUT /api/v1/campaigns/[slug]` admits `editor`, `admin` **or the campaign's
owner** (`:104-108`). An owner is then restricted to an explicit field list —
`title`, `heroImageUrl`, `photoCredit`, `subjectName`, `subjectHometown`,
`storyHtml`, `impactTiers` (`:112-119`) — and `status` is not in it, so an
organiser sending one gets `FORBIDDEN: Campaign owners cannot update: status`.

**[VERIFIED by reading `:112-119`] the review gate is not bypassable by the
person submitting the campaign.** This was the first thing checked and it is
the difference between a serious defect and a catastrophic one.

### 2.3 Why nothing caught it

- `approve.test.ts` and `refuse.test.ts` exercise the PATCH route and the
  suspend route. Neither knows this path exists.
- **No test in the repository had ever exercised an admin review decision at
  all.** There was no admin E2E fixture (`docs/99` §8 records ten specs
  skipped for the missing sign-in fixture; `docs/107` §7 records that no admin
  page's data query is run by any test), and `e2e-18` asserts
  `toHaveURL(/\/(admin|login)/)`, which passes whether a protected route is
  guarded or wide open.
- `publisher-review-gate.test.ts` (`docs/116` §4) discovers every campaign
  **INSERT** from disk. A publication by **UPDATE** is outside its subject.
- Typecheck cannot see it: the editor's payload is a valid
  `CreateCampaignInput` and the route's `updateValues` is
  `Record<string, unknown>`.

### 2.4 The fix: one writer

A campaign's status now has exactly one general writer and four named
special-purpose ones.

- **`PUT /api/v1/campaigns/[slug]` refuses a status outright** — an explicit
  400 naming `PATCH /api/v1/admin/campaigns/<id>`.
  ⚠️ **A 400, not a silent omission, and the distinction matters.**
  `docs/116` §3 could leave `currency` to the field-by-field `updateValues`
  quietly dropping it, because nothing should ever send one. `status` had a
  live caller — the "Restore to Draft" button posted `{ status: 'draft' }`
  here — so a silent drop would have left a button that looked like it worked
  and did nothing. That button now uses PATCH, where `archived -> draft` is
  already in `ALLOWED_TRANSITIONS`.
- **The edit page stops coercing** and passes `currentStatus` for display
  only. The editor renders the real status read-only, with a sentence saying
  where the controls are.
- ⛔ **Edit mode deletes `status` from the payload, and that deletion is the
  fix rather than a belt-and-braces extra.** `createCampaignSchema` declares
  `status: z.enum(['draft','active']).default('draft')` and this form's
  resolver **is** that schema, so zod fills the field whether or not anything
  renders it. Removing the control alone would have made every admin save post
  `status: 'draft'` and **unpublish** the campaign — the inverse defect, and
  worse. A test pins the `.default()` as the premise, so if it ever goes away
  somebody re-reads this paragraph instead of inheriting it.
- **All three push signals now point at `/admin/campaigns/<id>`**, the page
  that holds the real controls.

---

## 3. The allowlist, and a sweep that follows a variable

`campaigns.published_at` now has exactly **two** UPDATE writers, both of which
key the stamp on the column being null and both of which write an audit row:

| Writer | Why |
|---|---|
| `admin/campaigns/[campaignId]/route.ts` | the approval route |
| `admin/campaigns/[campaignId]/resume/route.ts` | resuming a campaign that was never public *is* a first publication (§6) |

`src/db/campaign-publication-writers.ratchet.test.ts` discovers every
`.update(campaigns)` / `.update(schema.campaigns)` in `src/` — 43 sites — and
fails the build on any other writer.

⚠️ **It has to resolve variables, and this is the part worth carrying
forward.** The approval route builds
`const updates: Record<string, unknown> = {...}`, then
`updates.publishedAt = new Date()`, then `.set(updates)`. A sweep that only
brace-matches the `.set({...})` literal sees **nothing** there — and six of the
43 sites pass a variable. My own first pass over this question reported
`publishedAt` as having a single writer for exactly that reason, and would have
allowlisted the wrong file. It is the `docs/108` lesson in a second place: a
grep proves text, not semantics.

The rule also carries its own controls: the two allowed writers must *still*
stamp the column (otherwise deleting both would satisfy it, and a live campaign
with a null `published_at` is undated in the homepage order, the `/campaigns`
"newest" sort and every sitemap `lastmod`), and the sweep must find more than
20 sites, because an empty sweep passes against anything.

---

## 4. ⛔ The campaign page could only say no

`src/components/admin/CampaignDetail.tsx` — the one screen an admin reads a
queued campaign on before deciding — rendered **Edit, Suspend and Cancel** and
**no approval control at all**. The only working approve affordance on the
platform was a third-level menu item labelled "Active" under
`/admin/campaigns` → row kebab → "Change Status".

So of the two paths an admin is most likely to take from the dashboard, one
could not approve and the other approved without logging or emailing anything.

Fixed: an **Approve and publish** button, shown only for `under_review`, going
through the PATCH route. This is `docs/119` from the other side — that one was
a door shown onto a room that refuses to open; this was a room with no door.

---

## 5. ⛔ Cancel: permitted at review, notifies nobody, terminal — and it had
never worked

`CANCELLABLE` listed `under_review`
(`admin/campaigns/[campaignId]/cancel/route.ts:26`) and `canCancel` was
`!['cancelled','completed','archived'].includes(status)`, so the red **Cancel**
button rendered on every queued campaign's page. Cancelling one:

- **notifies nobody.** There is no organiser-facing call in the route at all,
  and the donor/refund mails short-circuit — `_processBulkRefundInner` returns
  early when there are no un-refunded donations, which for a campaign that was
  never public is always.
- **is terminal.** `ALLOWED_TRANSITIONS.cancelled` is empty, `RESUMABLE` is
  `['paused','suspended']`, `SUSPENDABLE` excludes it, and the PUT route no
  longer takes a status. Nothing brings it back.
- **gives it a public page.** `cancelled` is in `PUBLICLY_VIEWABLE_STATUSES`,
  so a never-reviewed appeal about a named real person would acquire a
  permanent public page with a cancellation notice and `published_at = NULL`.

`docs/93` already settled that refusing a campaign at review has exactly one
path — suspend, with a reason of at least three characters, which emails the
organiser the admin's own words. So `under_review` is removed from
`CANCELLABLE` and from `canCancel`. That enforces an existing decision rather
than making a new one.

### 5.1 ⚠️ And the button had the `docs/93` defect, in the adjacent statement

```ts
if (governanceAction.action === 'suspend') body.reason = governanceReason || 'Under investigation';
if (governanceAction.action === 'cancel')  body.reason = governanceReason || 'policy_violation';
```

`cancelCampaignSchema.reason` is `z.enum(CANCELLATION_REASONS)`, and
`policy_violation` **is not in that enum**. The dialog's only input was a
free-text textarea placeholdered "Reason…". So the default 400'd, and so did
any sentence a human typed: **Cancel had never worked either.**

The comment immediately above those two lines is `docs/93`'s own record of
fixing exactly this class on the Suspend line. The fix did not sweep the
statement beneath it. The dialog now renders a native `<select>` built from
`CANCELLATION_REASONS` itself (`docs/118` §10: a plain list of labels is a
native control), the bogus default is gone, and the confirm button is disabled
until a reason is chosen.

---

## 6. ⛔ Two unguarded writes, and the only route to a live, undated campaign

**`POST /api/v1/admin/info-requests` with `pauseCampaign: true`** was the only
completely unguarded write to `campaigns.status` in the codebase: its single
check was `if (!campaign || !campaign.creatorId) → 404`, with no test of where
the campaign currently was. So `under_review -> paused` went through — and
`paused` is in `PUBLICLY_VIEWABLE_STATUSES`, so **asking a queued organiser for
more information published their unreviewed campaign.** Its audit row says only
`info_request.created`, so the status move is invisible in `/admin/audit-log`.

**And `POST .../resume` did not stamp `published_at`.** Its write is
`{ status: 'active', pausedAt: null, … }` with no first-publication check. So
the two compose into the only path to a live campaign with a NULL
`published_at`: pause a queued campaign through the info-request route, then
press **Resume** on the detail page. The homepage orders featured campaigns by
that column, `/api/v1/campaigns` sorts "newest" on it, and `src/app/sitemap.ts`
derives every listing `lastmod` from it and skips a null — the campaign would
have been live and undated everywhere.

Fixed: the info-request pause is guarded by the same `PAUSEABLE` set the
dedicated pause route uses, and resume stamps `published_at` keyed on the
column being null, exactly as the approval route does, so resuming a campaign
that *was* live does not re-date it.

---

## 7. ⛔ With one admin, a self-submission notified nobody

`src/lib/notifications.ts:512` was `if (p.creatorId && admin.id === p.creatorId) continue;`

`docs/93` added that so an admin who submits a campaign is not also sent
"[Admin] Review needed" about their own submission, on the stated premise:
*"Other admins still get it, so nothing stops being reviewed."*

**[VERIFIED] there is exactly one admin account on this platform**, so for that
admin the premise is false: the loop skipped the only recipient and the function
returned having sent zero emails and written zero notification rows. A campaign
would sit in a queue nobody had been told about.

The test covering the skip seeds **two** admins in `beforeEach`, so the
one-admin case had never been exercised.

The skip is kept — it is right whenever a second admin exists, and the three
original tests still pin that — and conditioned on someone being left to tell.
A new `describe` block covers the one-admin case, and it fails against the old
unconditional skip (proven by injection, §11).

---

## 8. The machine path pushes nothing, and the one surface that showed it said
the opposite

`src/lib/news/campaign-publisher.ts` and `src/lib/news/news-pipeline.ts` insert
`status: 'under_review'` and write a `campaign.auto_drafted` audit row.
**Neither imports `@/lib/notifications` at all**, and neither does the
`publish-campaigns` cron. So a machine-drafted campaign generates **no email
and no notification row** — nothing increments the avatar badge, nothing
chimes.

The last place it could have surfaced was `/admin/activity`, and two things
stopped it:

- `ALERT_EVENTS` (`src/app/admin/activity/page.tsx:15-18`) listed
  `campaign.submitted` and not `campaign.auto_drafted`, so the alert panel
  showed nothing. **Added.**
- `src/components/admin/ActivityCenter.tsx:99-101` shared one `case` between
  `campaign.auto_drafted` and `campaign.auto_published`, returning
  **"Campaign auto-published"**. Since `docs/79` the entire point of the first
  event is that the campaign is **not** published and needs a person — so the
  only in-app surface a machine draft appeared on told the admin it was
  finished work. **Given its own sentence.**

### 8.1 Confirmed against production, not only by reading imports

**[VERIFIED 2026-10-27T07:1xZ]** The two campaigns the news pipeline drafted
most recently — `sergeant-morgan-wong` (2026-10-25 05:31) and `nigel-max-edge`
(2026-10-27 02:32) — each produced **zero** `notifications` rows in the window
around their creation and **exactly one** `audit_logs` row
(`campaign.auto_drafted`).

The whole `notifications` table holds **7** rows ever: six
`campaign_submitted` (three organiser submissions × organiser + admin) and one
`campaign_donation_received`. Nothing in it came from the machine path.

So the reading of the imports and the production data agree: a campaign about a
named real person was drafted at 02:32 this morning and nobody was told. The
`/admin/activity` alert added above is the first signal it will produce — once
this is deployed.

⚠️ Also measured while there: `cron.verification_reminders` has run **twice**
and emailed **zero** both times, which is correct rather than broken — there is
no campaign with both a real organiser and a qualifying donation. But it does
mean the ladder `docs/110` §7 shipped has never actually sent anything, which
is the `docs/81` "unexercised path" concern by another name.

What remains true, and is correct: the `/admin` pending-review tile reads
`eq(campaigns.status, 'under_review')` and nothing else, renders
unconditionally including a zero state, attributes machine drafts as "News
pipeline", and uses `<Money minor currency>`. The `docs/88` F6 fix is intact on
both halves. It covers **both** creation paths — it is the only surface that
does — but it is **pull, not push**: the admin has to go and look.

Whether a cron should mail somebody every time it drafts a campaign is a
product call, left in §12.

---

## 9. The review email and notification printed a non-USD goal in dollars

`campaignSubmittedEmail` called `formatCents(p.goalAmount)` with no currency
(default `'USD'`, `email-templates.ts:56`), and the in-app row's message was a
literal `` `$${(p.goalAmount / 100).toFixed(2)}` ``. The payload carried no
currency field, although `data.currency` was at the call site and used in the
insert eleven lines earlier.

So a KES 50,000 appeal reached the reviewer as **"$500.00"** — a figure wrong
by the exchange rate, in the one email whose whole job is to describe the
campaign. And four of the known currencies are zero-decimal, where dividing by
100 understates by 100x (`docs/92`).

Latent until `docs/118` §10 made currency selectable in the wizard; making it
selectable is what armed it. These were the two sites the `docs/114` and
`docs/115` sweeps missed. `currency` is now a **required** parameter on both,
so `tsc` enumerated every call site (the `docs/115` trick).

---

## 10. Two menu items that always answered 400

`ALLOWED_TRANSITIONS` exists twice and the copies disagree. The divergence on
`under_review` is deliberate and correct — the client offers
`['active','suspended']` and routes `suspended` to the suspend endpoint rather
than to PATCH. But the client also offers `paused` as a target for `active` and
`last_donor_zone`, and the **server map has no `paused` target anywhere**, so
both menu items posted a transition PATCH rejects with 400. The `docs/93`
Suspend defect again, one class over.

Pausing has a dedicated route with the same reason shape as suspend
(`pauseCampaignSchema`: free text, min 3) and it notifies donors, so the fix
routes there rather than deleting a control that should work. The reason
textarea already in the dialog is reused, with copy that says donors are the
audience rather than the organiser.

The ratchet rule for this **derives both maps from source** and checks that
every client-offered transition is either rerouted to a dedicated endpoint or
present in the server map — so aligning them either way in future keeps it
true, rather than pinning today's answer.

---

## 11. Checks

- `npm run lint` — clean (one pre-existing unused-arg warning in
  `review-gate.test.ts`).
- `npm run typecheck` — clean.
- `npm run test:unit` — see §11.2.
- `src/db/campaign-publication-writers.ratchet.test.ts` — 17 tests.
- `src/lib/notifications.admin-self-submit.test.ts` — 4 → 8 tests.
- The browser walk — §11.3.

### 11.1 ⚠️ The injection run that was void, and why it is recorded

Twelve defects were re-injected one at a time to prove each ratchet rule fails
against the code it describes. **The first run was invalid and its PASS lines
meant nothing for seven of the twelve.** The backup set omitted
`admin/campaigns/[campaignId]/route.ts`, so injection 4's edit persisted into
every later run and rows 6-12 were measured against a polluted tree — their
"2 failures" included a leftover from a different rule. The tell was the
closing line reporting **1 failure after restore** when it should have been 0.

The harness now **restores and re-runs after every injection** and fails the
whole run if the restore is not clean. Re-run from a verified-green baseline,
each injection fails exactly its own assertion:

| Injected defect | Rule that fired |
|---|---|
| PUT route stamps `publishedAt` again | no other UPDATE writes it; the route writes neither column |
| edit page coerces status to `'active'` | the edit page passes the real status |
| editor stops deleting `status` | edit mode deletes `status` from the payload |
| approval route keys the stamp on the previous status | each writer keys it on null |
| resume stops stamping | both allowed writers are still there |
| dashboard "Review" points back at `/edit` | every review surface links to the campaign page |
| approve control removed | the campaign page offers approval |
| `under_review` cancellable again | `under_review` is not cancellable |
| cancel dialog back to free text + bogus default | the dialog offers the schema's reasons |
| pause menu item PATCHes again | the client never PATCHes a rejected transition |
| `auto_drafted` shares the published sentence | it has its own sentence |
| `auto_drafted` leaves `ALERT_EVENTS` | it reaches the alert channel |

Closing state: **0 failures.** And the one-admin notification test was proven
separately — reverting `recipients` to the unconditional skip fails that test
and only that test, with the four original tests still green, so `docs/93`'s
intent is demonstrably preserved.

### 11.2 Suite

**7,657 unit tests: 7,641 passing, 16 skipped, across 258 files.**
**256 integration tests across 26 files, on a throwaway Postgres.**

One pre-existing test failed on the way and was corrected rather than
satisfied. `refuse.test.ts` asserted the literal `` /suspend` `` in
`CampaignsList.tsx`; §10 made the path build from the target
(`.../${dedicatedRoute}`) so pausing could reach its own route, and the literal
went away. The behaviour it means did not, so the assertion now derives it —
`suspended` resolves to `'suspend'`, that resolution is what selects the
non-PATCH request, and a refusal cannot be sent without a reason. Proven by
injection: routing refusals back to PATCH fails that test and only that test.

### 11.3 The browser walk

The E2E fixture gained an **admin who can sign in**
(`e2e-fixture-admin@example.invalid`, `role: 'admin'`) and a campaign sitting
in the queue (`e2e-fixture-waiting-for-review`, `under_review`,
`published_at: null`). Both were missing, which is why no test had ever walked
this journey.

⛔ The queued fixture's `published_at` must stay null: it is what
`isFirstPublication` keys on, so a fixture that pre-dated it would make the
approval path silently skip both the stamp and the audit row — the test would
pass and prove nothing.

**21/21 assertions, Chromium at 1440x1000 against `next start`, zero failing
responses and zero console errors.** In order:

| | |
|---|---|
| `/admin` | names the pending-review queue; its "Review" link goes to the campaign page and **not** to `/edit` |
| `/admin/campaigns/<queued>` | offers **Approve and publish**; still offers Suspend; **does not** offer Cancel; names the status "Under Review"; renders **no** link to a public page that does not exist, and says so instead |
| `/admin/campaigns/<queued>/edit` | shows the real status read-only, has **no** status control, and says where the controls are |
| save the editor | the public page still answers **404** — the save did not publish |
| press Approve | admin page shows Active, the approve control is gone, and the public page answers **200** |
| the database | `published_at` stamped, and **`campaign.published`, `actor_role=admin`, `under_review -> active`** — the row that production's own approval was missing |
| Cancel on a live campaign | offered, and its dialog is a `<select>` of the schema's eight reasons |
| the organiser | sees the approved campaign in their dashboard list |

⚠️ **The walk earned its keep on a check I nearly waved away.** The first run
reported three unexplained console 404s. Visiting the same admin pages directly
produced none, so rather than guess I instrumented the walk to log every
failing response **by URL** and re-ran it from a re-seeded fixture. The answer
was one line:

```
404 GET http://localhost:3000/campaigns/e2e-fixture-waiting-for-review?_rsc=1gn7v
```

Next **prefetching** the `Public link:` on the admin campaign page — which was
rendered unconditionally, so for a queued campaign it pointed at a 404.
`docs/118`'s rule had been swept over the public UI and over notifications and
never over `src/components/admin/`, where **six** sites build that link by
hand. Three are fixed (`CampaignDetail`, `GovernancePanel`,
`VerificationQueue` — every campaign in the verification queue is
`under_review`, so that one was a 404 on every row); three carry no status in
their row shape and are reported in §12. A console 404 taken at face value
would have hidden all six.

### 11.4 ⚠️ And a second thing only a screenshot could show

The admin breadcrumb on that same screen read:

> Admin › Campaigns › **E2e00000 0000 4000 8000 000000000004**

`Breadcrumbs.toLabel` title-cases every path segment, so on any `[id]` route a
UUID has its hyphens turned into spaces and each group capitalised, and is then
presented as the page's name — and emitted as a `name` in the `BreadcrumbList`
JSON-LD beside it. It is on **every** admin and dashboard detail screen,
including the one an administrator reads before approving an appeal about a
real person.

No assertion was anywhere near it, and the component had **no test at all**. A
UUID segment now renders as "Details" — the component is a client component
holding nothing but the pathname, so it cannot know the campaign's title, and
"Details" is the honest label for a segment that carries no name.

⚠️ The test for it imports the component's own `toLabel` rather than
reproducing it. The first version sliced the source and evaluated it with
`new Function`, which choked on a TypeScript annotation — and a hand-written
copy would have been worse, passing happily while the component did something
else. Proven by injection: removing the rule fails four tests while the six
ordinary-segment controls stay green.

This is `docs/119` §9.1's lesson again. That one was found by looking at a
screenshot too.

---

## 12. Reported, not changed

1. ⛔ **`DELETE /api/v1/user-campaigns/[id]` archives a queued campaign
   silently.** Its guard is `['archived','completed']`, so `under_review` goes
   through; there is no audit row and no notification, and since `docs/118` §9
   `archived` is publicly viewable — so withdrawing a submission would give a
   never-reviewed appeal a public page.
   **[VERIFIED] it has no UI caller** (eleven `user-campaigns` fetch sites, none
   a DELETE), so the exposure is API-only today.
   The general fix is the interesting one and it is a change of its own: *a
   campaign with no `published_at` has no public page*, enforced in the detail
   page's lookup. That cannot land alone — `publicCampaignPath` decides from
   status, so the page would start 404ing links the guard calls safe, which is
   precisely the `docs/118` defect. It needs `publishedAt` threaded through
   `campaign-links.ts` the way `campaignStatus` was.
2. **No approval path is transactional.** In every status route the update, the
   audit insert and the notification are separate statements; only `cancel`
   wraps update+audit in `db.transaction`. A crash between them publishes a
   campaign with no audit row — the same signature as an unreviewed
   publication. Worth closing, but it is a change to five routes.
3. **An `editor` sees the queue and is never emailed.**
   `src/app/admin/layout.tsx:30-32` admits `editor` to the whole `/admin`
   subtree and the pending-review section is ungated, but the recipient query
   is `eq(users.role, 'admin')`. A role policy call.
4. **`campaign.queued_for_review` is written by nothing.** A repo-wide grep
   over ts/tsx/sql/md returns zero hits, yet production holds one such row. Its
   origin is [UNKNOWN] — code that no longer exists, or a write from outside the
   app. It is not a live signal and nothing reads it.
5. **A machine-drafted campaign still has no push signal** beyond the
   `/admin/activity` alert added in §8. Mailing somebody every time a cron
   drafts a campaign is a product decision about volume: `CRON_SCHEDULE` runs
   the news pipeline every 30 minutes.
6. **Three more admin surfaces build a public campaign link by hand**:
   `AdminDashboard.tsx:271` and `UserDetail.tsx:436` (a donation's campaign)
   and `admin/screening/page.tsx:163`. Unlike the three fixed in §11.3, their
   row shapes carry **no status**, so guarding them means widening the queries
   and the types first. The exposure is smaller — a campaign with a donation
   has been public — but it is the same class, and `active -> draft` is a
   permitted transition.
7. **`notifyWelcomeCampaigner` writes `type: 'campaign_submitted'`** for a
   notification titled *"Your campaign … is live!"*. The approval and the
   submission share one enum value, so muting one mutes the other. Adding
   `campaign_approved` is a schema change and a migration; recorded rather than
   bundled in here.
8. **The five `docs/116` §8 campaigns are still live**, unreviewed, naming real
   people. `docs/116` §8.5 holds the three options; this pass did not reopen it.

---

## 13. What this journey looks like now

1. An organiser submits. The insert is `under_review`, `published_at: null`
   (`docs/78`, `docs/79`), and the redirect goes to
   `/dashboard/campaigns?submitted=1` (`docs/109`).
2. The organiser gets a receipt (`docs/93`) that promises no decision email and
   quotes no turnaround.
3. Every admin who is not the submitter — or the submitter, if they are the only
   admin (§7) — gets `[Admin] Review needed` with the goal in the campaign's own
   currency (§9) and a CTA to **the campaign page** (§2.4), plus an in-app row
   that increments the avatar badge within 60s.
4. `/admin` shows a pending-review count with a zero state, covering both
   creation paths; `/admin/campaigns` shows a true `GROUP BY status` tile and
   sorts the newest first.
5. On the campaign page the admin can **Approve and publish** (§4), which
   stamps `published_at` only if null, writes `campaign.published`, and emails
   the organiser "Your Campaign Is Live!" with the `?launched=true` banner —
   the one moment those words are true (`docs/109`) — or **Suspend** with a
   reason the organiser is emailed verbatim (`docs/93`). Cancel is not offered
   (§5).
6. Saving the editor changes content only (§2.4).
