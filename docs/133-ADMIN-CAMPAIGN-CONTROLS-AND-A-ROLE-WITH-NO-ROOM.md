# 133 — The admin campaign screens, and a role with nowhere to stand

**Date:** 2026-10-28
**Status:** implemented, not deployed (owner deploys — `docs/96`)
**Sub-journey:** admin journey, part 5 of 10 (campaign CONTROLS; `docs/128`
walked all 35 pages and pressed nothing, `docs/131` walked the review decision,
`docs/132` walked the people pages and found the role boundary one layer out)

---

## 1. What this started as, and what it turned out to be

`docs/132` closed the admin role boundary at the level of the 35 admin **pages**:
pages in an `adminOnly` nav group now gate themselves, and a group whose pages
all refuse a non-admin now says `adminOnly`. It left one item explicitly open
and reported it:

> `CampaignDetail` still renders "Approve and publish" and "Suspend" with no
> role prop while the routes behind them require `admin`. That is the
> `docs/119` violation still standing, on the most consequential control in
> the product.

That is the finding this doc closes. It is `docs/119`'s rule — *a step may
offer an action only if its target will accept it* — and `docs/117`'s sharper
form of it: **a control that can only fail is worse than no control.**

### 1.1 The first conclusion was wrong, and the third method is what caught it

My first reading of the evidence was that **campaigns are admin territory
throughout**, and that the fix was to gate all five `/admin/campaigns*` pages
and move them into an `adminOnly` nav group. The evidence for it looked
complete:

[VERIFIED by reading six route files] every status write behind these screens
is `requireRole(['admin'])` —
`admin/campaigns/[campaignId]/route.ts:53,287` (the one status writer,
`docs/120`), `pause:31`, `resume:28`, `suspend:31`, `cancel:58`, and
`campaigns/[slug]/route.ts:199` (PUT and DELETE).

The third method refuted it. A sweep of the **whole** admin API for routes
admitting `editor` — rather than of the routes those particular buttons call —
returns eight files, and two of them are campaign routes:

| Route | Roles |
|---|---|
| `admin/campaigns/[campaignId]/updates/route.ts` | `['editor','admin']` |
| `admin/campaigns/[campaignId]/messages/[messageId]/moderate/route.ts` | `['editor','admin']` |
| `admin/blog/route.ts`, `admin/blog/[id]` GET+PATCH, `admin/blog/topics/*` | `['editor','admin']` |
| `GET /api/v1/admin/news-feed` | `['editor','admin']` |
| `api/v1/upload` | `['editor','admin']` |

Both campaign entries are **per-campaign** capabilities, and the only door to
a specific campaign in the whole admin UI is `/admin/campaigns` →
`/admin/campaigns/[id]`; the "Add Update" link that reaches the form is
`CampaignDetail.tsx:534`. So `Campaigns` sitting in the sidebar's **open**
`Content` group is deliberate and load-bearing, not an oversight — and gating
the page would have made an `['editor','admin']` route unexercisable, which is
exactly what `docs/76`, `docs/77` and `docs/81` are about.

⚠️ The transferable part: *"every route this button calls requires admin"* and
*"every route in this area requires admin"* are different claims, and the first
does not imply the second. I had checked six route files chosen by the buttons
in front of me. The question that mattered was the one asked of the directory.

---

## 2. The defect, stated precisely

[VERIFIED] `src/app/admin/layout.tsx:30` admits `editor` as well as `admin`.
[VERIFIED by inventory of all 35 admin pages] none of the five
`/admin/campaigns*` pages carried any role gate. So an editor —
legitimately on these screens, to post a campaign update — was offered:

| Surface | Controls shown | Route | Role |
|---|---|---|---|
| `/admin/campaigns/[id]` | Approve and publish | `PATCH .../[campaignId]` | `admin` |
| | Pause, Resume, Suspend, Cancel | the four dedicated routes | `admin` |
| | Archive, Restore to Draft | `DELETE`/`PATCH` | `admin` |
| | Edit | `PUT /api/v1/campaigns/[slug]` | `admin` |
| | Record a vouch, Revoke | `.../vouch`, `admin/vouches/[vouchId]` | `admin` |
| `/admin/campaigns` | Edit, Change Status, Delete | as above | `admin` |
| `/admin/campaigns/new` | the whole form | `POST /api/v1/campaigns` | `admin` |
| `/admin/campaigns/[id]/edit` | the whole form | `PUT` | `admin` |

**Twelve controls across four screens, every one of which answers 403.** Among
them "Approve and publish" and "Suspend" — the two halves of the publication
decision `docs/120` and `docs/131` spent two days making correct — and
"Delete".

⚠️ **Not privilege escalation.** The falsifier held: each of those routes calls
`requireRole(['admin'])` at the top of its handler, so an editor who presses
one gets a 403 and nothing moves. This is a usability and disclosure defect,
and the disclosure half is the worse one.

### 2.1 And the screen handed an editor donor names against gift amounts

[VERIFIED] `src/app/admin/campaigns/[id]/page.tsx` selected `donorName`,
`donorEmail` and `donorLocation` and passed all three into `CampaignDetail`,
which renders the name and the email beside the amount.

That is the same exposure `docs/132` §4.1 removed from `/admin`, in a place
that sweep did not look: `/admin/donations` and `/admin/donors` both gate on
`role !== 'admin'`, so a name against a gift amount is data an editor is
refused **everywhere else in the product** — and this page gave it to them one
campaign at a time.

⛔ And hiding the cell would not have been enough. `CampaignDetail` is
`'use client'`, so anything the page passes is serialized into the RSC payload
whether or not a cell renders it. The page **removes** the three fields for a
non-admin.

---

## 3. What changed

One principle, applied four times: **the predicate that decides whether a
control renders answers one question — will the route behind it accept this
viewer in this state? — so the role belongs in that predicate, not beside it.**

### 3.1 `CampaignDetail` (`isAdmin`, required)

Each `can*` constant gained `isAdmin &&`; the Edit link, which has no
predicate of its own, is wrapped. `Add Update` is **untouched** — it is the one
action an editor may take here, and a test asserts it stays ungated.

The donor cell renders `Admins only` in italics for a non-admin rather than an
empty cell: an empty name reads as *Anonymous*, which is a different and false
claim about that donation.

### 3.2 `CampaignsList` (`isAdmin`, required)

`Edit`, `Change Status` and `Delete` gated. `View Details` **not** — it is how
an editor reaches the campaign whose update they may post.

### 3.3 The page reads the role once and narrows what it sends

`/admin/campaigns/[id]` and `/admin/campaigns` each `await auth()` once. The
detail page withholds the three donor fields, and does not render the vouch
panel **or run its three queries** for a non-admin: both vouch controls are
`admin`-only, the panel has no read-only purpose for an editor, and the
institutions and vouch history it lists are Trust & Verification data that
`/admin/verification` and `/admin/institutions` already refuse them.

⚠️ Skipping the queries is not an optimisation, it is the containment: a query
whose rows are passed to a client component is in the payload.

### 3.4 The two screens that are nothing but an admin-only write

`/admin/campaigns/new` and `/admin/campaigns/[id]/edit` gate themselves with
the `docs/132` pattern. There is no partial version of these screens: the form
*is* the control, and its submit is `admin`-only.

### 3.5 Per-ITEM nav policy, because the group flag could not say this

`New Campaign` must be hidden from an editor while `Campaigns`, three lines
above it in the same group, must not be. `NavGroup.adminOnly` cannot express
that, so `NavItem` gained its own optional `adminOnly`.

⚠️ **The `docs/132` ratchet is what forced this, and it was right.** Gating
`/admin/campaigns/new` while leaving it in an open group made that test fail
with *"offered to an editor and bounces them back to /admin"* — its own rule,
applied to a change I had just made. The parser now reads per-item flags
(matching whole item objects, not `href:` alone — an href-only match would read
`New Campaign` as open and pass).

### 3.6 And `gatesOutEditor` was imprecise

That helper returned `true` for any file containing `role !== 'admin'`. But
`/admin/blog/[id]/edit` reads `role !== 'admin' && role !== 'editor'`, which
**admits** an editor. The helper was right on every file it was pointed at and
wrong in general — the shape that makes a rule agree with whatever it is shown.
It now requires that the refusal does not also name `editor`.

### 3.7 Two `docs/120` assertions pinned text, not the property

Putting the role into the predicates turned two assertions in
`campaign-publication-writers.ratchet.test.ts` red:

```
expect(detail).toMatch(/const canApprove = campaign\.status === 'under_review'/);
expect(canCancel).toMatch(/^const canCancel = !\[/);
```

Both asserted the **spelling** of a line, so `isAdmin && ` broke them while
the properties they exist to protect — *the approval control exists and is
keyed on the queued status*, and *`under_review` sits inside the NEGATED list*
— were untouched. Stale tests, not regressions (CLAUDE.md: *work out which one
drifted before changing either*), and `docs/109`'s trap in miniature: pin
today's text and an unrelated correct change has to edit the test to land.

⚠️ **Loosening an assertion is a chance to make it vacuous**, so both were
re-proven: deleting `canApprove`, re-keying it to `'draft'`, and making
`under_review` cancellable each still fail exactly one test.

---

## 4. Verification

### 4.1 The ratchet, written to derive both ends

`src/components/admin/campaign-controls-role.ratchet.test.ts`, 6 rules:

1. **The partition, read from the routes themselves.** Every
   `route.ts` under `src/app/api/v1/admin/campaigns/` is discovered from disk,
   its `requireRole` lists parsed, and the editor-admitting set asserted
   exactly. Widen one and this fails, which sends the next reader here rather
   than leaving a stale guard on a route that would now serve them.
2. `CampaignDetail`: all seven `can*` predicates require `isAdmin`; the Edit
   link is guarded; **and `Add Update` is not** — without that control,
   deleting every button on the screen would satisfy the rule.
3. `CampaignsList`: Edit / Change Status / Delete guarded; **View Details not**.
4. `isAdmin` is a **required** prop on both components (`docs/118`: an optional
   flag defaulting to `true` would restore every defect above in silence).
5. The two admin-only pages read the session and redirect a non-admin.
6. The page narrows all three donor fields and neither renders nor queries the
   vouch panel for a non-admin.

### 4.2 All eleven injections fire

Run with a verified clean restore after every row (`docs/120` §11.1):

| # | Injection | Result |
|---|---|---|
| 1 | `canSuspend` loses `isAdmin` | FIRED |
| 2 | the Edit-link guard removed | FIRED |
| 3 | **CONTROL** `Add Update` gated on `isAdmin` | FIRED |
| 4 | the Delete row-action guard removed | FIRED |
| 5 | **CONTROL** `View Details` gated on `isAdmin` | FIRED |
| 6 | `isAdmin` made optional | FIRED |
| 7 | the `/admin/campaigns/new` gate removed | FIRED |
| 8 | `donorEmail` sent to a non-admin | FIRED |
| 9 | the vouch queries run for a non-admin | FIRED |
| 10 | `suspend/route.ts` widened to admit an editor | FIRED |
| 11 | **VACUITY** every header control deleted | FIRED |

The nav parser changes were injected separately and both directions fire: the
per-item flag removed (1 failed), and a group-level flag removed (1 failed).

### 4.3 In a real browser, paired against an admin

Production build, throwaway Postgres, the E2E fixture seeded, the helper
account promoted to `editor` for the run and restored after. Every editor
assertion is paired with the same measurement taken as an admin, so the
measurement can tell *gated* from *deleted*.

⚠️ **The first production build was DISCARDED before it was measured.** It
overlapped the injection runs in §4.2, which mutate `CampaignDetail.tsx` on
disk, so the artefact could have contained injected source. A build that
*might* have been polluted is not evidence — Gate 5 — so the walk ran against
a clean rebuild on a settled tree.

The harness is `scratchpad/walk133.js`: 21 checks, of which **nine are the same
measurement taken as an admin**. That pairing is the point — if a button is
absent for an editor, the probe must find it PRESENT for an admin, or it cannot
tell *gated* from *deleted*. The donor-identity assertions read
`page.content()`, which includes the RSC flight payload, not just the rendered
text.

**21/21.**

| | editor | admin (control) |
|---|---|---|
| sidebar | `Campaigns` ✓, `New Campaign` **absent** | both present |
| row action menu | `View Details` only | `View Details`, `Edit`, `Change Status` |
| `/admin/campaigns/[id]` (active, 1 donation) | `Add Update` only | `Add Update`, `Pause`, `Suspend`, `Cancel`, `Edit` |
| `/admin/campaigns/[id]` (under_review) | `Add Update` only | `Add Update`, **`Approve and publish`**, `Suspend`, `Edit` |
| donor name / email in the payload | **absent / absent** | present / present |
| donor cell | "Admins only" | the name and the email |
| vouch panel | absent | present |
| `/admin/campaigns/new` | lands `/admin/campaigns` | lands `/admin/campaigns/new` |
| `/admin/campaigns/[id]/edit` | lands `/admin/campaigns` | lands `…/edit` |
| `…/updates/new` | **serves it** | serves it |

⚠️ One reading needs stating so it is not mistaken for a miss: the
`under_review` campaign reports no "Admins only" label for either role,
because the E2E fixture gives it **zero donations**, so the donations table is
empty and that cell never renders. The label is observed on the `active`
campaign, which has one. A single screen could not have shown both.

The helper account was promoted to `editor` for the run and restored to
`donor` afterwards; both statements are echoed in the harness output.

---

### 4.4 Suites

- `npm run lint` — clean (one pre-existing unused-arg warning, untouched)
- `npm run typecheck` — clean
- `npm run test:unit` — **7739 passed / 16 skipped / 0 failed**, 264 files.
  The run taken *before* the two stale docs/120 assertions (§3.7) were
  corrected was 2 failed / 7737 passed, and both of those failures are those
  assertions; `campaign-publication-writers.ratchet.test.ts` is now **17/17**
  and still able to fail three ways.
- `npm run test:integration` — **301 passed**, 31 files, on a throwaway Postgres
- `src/db/pool-fanout.ratchet.test.ts` — passes with `auth()` added to two
  pages (the detail page's queries are all sequential, so its concurrency is
  unchanged at 1)

---

## 5. Reported, not fixed

- ⛔ **`.../messages/[messageId]/moderate` admits an editor and has NO UI
  anywhere.** `grep moderate src/components/admin/*.tsx` returns nothing. So
  one of the two campaign capabilities the editor role grants has no door at
  all — the `docs/83` shape. Building a message-moderation screen is a product
  decision, not a defect fix.
- ⛔ **An editor may POST a campaign update and may not delete one.**
  `DELETE .../updates/[updateId]` is `['admin']`, and also has no UI. So an
  editor cannot remove an update they wrote. That is a role question for the
  owner; rule 1 pins today's answer so a change is deliberate.
- ⛔ **`donorLocation` is selected, serialized and rendered by nothing.** It is
  in the payload and in no cell. Narrowed here with the other two; removing it
  from the select belongs with whoever next touches that query.
- ⚠️ **The `users.phone` claim in `docs/132` §6 is REFUTED, and the column is
  live.** It was reported as a dead column the PATCH handler writes. It is not:
  `DonorProfileEditor.tsx:53` PATCHes this exact route with `phone`,
  `UserDetail.tsx:241` renders it on `/admin/users/[id]`, `schema.ts:368`
  documents it deliberately as the human-typed note kept beside the sendable
  `phoneE164` (`docs/82`), `updateDonorProfileSchema` validates its format, and
  `account-erasure.ts:98` scrubs it as PII (`docs/124`). Removing the write
  would have broken a live admin editor. **No change made.**
- ⚠️ **A self-service account deletion notifies nobody.**
  `DELETE /api/v1/users/me` does not call `notifyAccountDeletion` at all, while
  the admin path does. Arguably correct — the person just pressed the button
  themselves — but it is an asymmetry nobody decided.

---

## 6. Two small truths in `admin/users/[id]/route.ts`

Fixed here because they were found here and are one line each.

### 6.1 The DELETE docstring described a design `docs/124` deleted

It said *"users with donations are anonymized (soft-delete); users with no
donations are hard-deleted"*. `docs/124` replaced both branches with one
`anonymiseAccount` call — and neither branch had ever worked (one wrote `null`
into two `NOT NULL` columns, the other raised a foreign-key violation for
almost anybody). A comment describing a removed design is worse than none: it
is what a reader reaches for before they read the code.

### 6.2 `notifyAccountDeletion` fired BEFORE the transaction

It sat above `db.transaction` under the comment *"Mail them BEFORE the address
is scrubbed, or there is nowhere to send it"*. [VERIFIED] that premise is
false: `user` is a local read at the top of the handler
(`route.ts:409-413`), so `user.email` survives the scrub by construction. What
the ordering actually did was tell somebody their account had been removed and
*then* try to remove it — so any failure inside the transaction left a person
holding an email about an erasure that had been rolled back.

It now runs after the commit, and that costs nothing: [VERIFIED]
`sendEmailOnly` (`notifications.ts:182-195`) catches everything, so a delivery
failure cannot turn a completed erasure into a 500. An unsent email is a
delivery failure; a sent one about work that did not happen is a false
statement.

---

## 7. What was NOT checked

- The write paths themselves. No campaign was approved, suspended or deleted
  in this walk; `docs/131` exercised the approval and refusal routes and
  `docs/130` the verification release.
- The editor's own capability end to end: the walk confirms an editor reaches
  `/admin/campaigns/[id]/updates/new`, and does **not** post an update through
  it.
- `/admin/news-feed` and `/admin/blog` carry the same class of defect in the
  other direction — three controls on pages that legitimately serve an editor
  (`Create campaign` and `Review` on the news feed, `Delete` on the blog list)
  whose routes require `admin`. Reported, not fixed: that is its own change,
  on pages this sub-journey did not walk.
- Whether any editor exists. [VERIFIED in production] zero. Like `docs/132`,
  the severity here is latent-but-armed: the role is implemented, admitted by
  the admin layout, and one `UPDATE users SET role='editor'` away.
