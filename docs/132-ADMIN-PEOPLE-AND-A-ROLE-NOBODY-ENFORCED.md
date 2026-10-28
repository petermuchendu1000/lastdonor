# 132 — The admin people journey, and a role nobody enforced

**Admin sub-journey 4 of 10: people.** Journeys 1 (review, `docs/131`),
2 (verification, `docs/130`) and 3 (money, `docs/129`) are closed.

Status: ✅ fixed on the branch. The people pages themselves were sound; what
the walk found was one layer out.

---

## 1. What the journey is, and what was already right

Three pages (`/admin/users`, `/admin/users/[id]`, `/admin/donors`) and five
routes. The write surfaces are `PUT` (role change), `PATCH` (donor profile),
`DELETE` (erasure) on `users/[id]`, plus `interactions` and `relationships`.

[VERIFIED] several things are correct and are recorded so nobody re-audits
them:

- **All three people pages gate properly** — `users/page.tsx:17`,
  `donors/page.tsx:13`, `donations/page.tsx:17` each redirect a non-admin.
- **Zero-admin is unreachable.** `PUT` refuses self-demotion
  (`users/[id]/route.ts:189`) and `DELETE` refuses any `role === 'admin'`
  (`:422`, "demote to donor or editor first"). With two admins, A can demote B
  then delete B, and A can never demote A — so the last admin cannot be
  removed by either path.
- **Erasure is `docs/124`-compliant**: one path, `anonymiseAccount`, with the
  donation count kept only for the audit row.
- **Every write route in the journey requires `['admin']`.**

⚠️ And one thing that is NOT a defect but reads like one: the live `users`
table has **33 columns and no ban, suspend, status or disabled column of any
kind**. The only lock-like state is `failed_login_count` /
`failed_login_window_start`, the automatic `docs/126` lockout. An admin cannot
suspend a person, and [VERIFIED] no screen offers to.

---

## 2. ⛔ The finding: `editor` is admitted by the layout and enforced by almost
nothing

`src/app/admin/layout.tsx:30` admits **`editor` as well as `admin`**. Only
**one** of the 35 admin pages calls `requireRole` of its own; the rest rely on
the layout, or on a hand-written
`if (session?.user?.role !== 'admin') redirect('/admin')` that nothing
cross-checks against the navigation.

`editor` is a real role, not a dead one — [VERIFIED] 17 `requireRole` sites
admit it: blog CRUD, news feed, campaign updates, message moderation, upload.
It is a **content** role.

The sidebar states the intended policy per group via `adminOnly`. Nothing
enforced it, and the two sides drifted **in both directions at once**:

### 2.1 Offered and refused — three dead links

The `Finance & Users` group carried no `adminOnly`, so an editor was shown
**Donations, Donors and Users** — and all three pages redirect them back to
`/admin`. `docs/119`'s rule ("a tile is gated by whether its target will serve
the viewer"), never swept over the admin side.

### 2.2 Declared admin-only and not enforced — five served URLs

`Trust & Verification` and `Operations` **are** `adminOnly`, so the links are
hidden from an editor — and the pages had no gate, so the URLs were served
anyway. **Hiding a link is not access control.**

`/admin/screening` is the one that matters: 332 lines containing **no `role`,
no `isAdmin`, no `session` anywhere**, joining `document_screenings` to
`verification_documents`. `docs/106`'s entire safety argument is about who may
see identity documents.

### 2.3 ⛔ And the dashboard handed an editor donor names against gift amounts

`/admin` is an editor's landing screen — Overview is not `adminOnly` and the
page has no gate, both deliberate. `(index)/page.tsx:186-190` computes
`isAdmin` and passes it; `AdminDashboard.tsx:58` declares `isAdmin: boolean`
and **`:61` destructures only `{ stats }`** — one occurrence of the name in
the whole file, the type declaration.

So an editor saw `Fixture Donor One — $1,000.00`, the platform's money totals,
and every campaign's raised/goal. The `docs/119` `_hasCampaigns` shape: a flag
computed, passed, and thrown away.

---

## 3. Severity, traced rather than asserted

**It is information disclosure and broken UX — NOT privilege escalation.**
That distinction was the falsification attempt, and it held: I expected to
find an editor able to act, and did not. [VERIFIED by reading every one]
`PATCH /api/v1/admin/campaigns/[campaignId]:53,287` and the `suspend`,
`resume`, `pause` and `cancel` routes all `requireRole(['admin'])`, as do all
five people routes. An editor shown "Approve and publish" gets a 403 if they
press it.

[VERIFIED in production] **0 editors exist** — 1 admin, 8 donors. Nothing has
happened. The role is assignable today via `PUT /api/v1/admin/users/[id]`.

⚠️ **Two of my own claims were wrong and the measurements corrected them:**

- I listed `/admin/fund-releases` as editor-reachable from a static grep. It
  is not: it redirects to `/admin/payouts`, which IS gated, so the editor
  bounces. Right about the file, wrong about reachability.
- My disclosure signal counted `$` figures, and screening, institutions and
  payout-queue showed `$0` — **because the fixture seeds no rows**, not
  because anything was hidden. A non-discriminating probe. Converted by
  reading the page instead: it has no role branch at all, so it cannot
  distinguish roles whatever the data.

---

## 4. The fix: make the pages obey the policy the sidebar already states

⛔ The codebase already declared the intent, per group. What was missing was
anything that made it true. So the rule is derived from the sidebar itself:

> A page in an `adminOnly` group must refuse a non-admin.
> A page in an open group must serve an editor.

`src/components/admin/admin-nav-role.ratchet.test.ts` derives **both** ends
from source — the groups and their `adminOnly` flags from `AdminSidebar.tsx`,
each target page's gate from `src/app/admin/**/page.tsx` — and requires them
to agree (`docs/109`'s shape). It was written FIRST and failed on five
entries before any fix existed.

⚠️ It found one I had not: **`/admin/notifications`**, the only admin page
that calls `requireRole`, which explicitly admits `['admin', 'editor']` while
its group hides it. Two deliberate statements contradicting each other.
Resolved **in the page's favour costing the editor nothing**: that screen
reads `notifications WHERE user_id = <caller>` — the caller's own inbox — and
[VERIFIED] `/notifications` serves the same `NotificationsClient` to any
signed-in user (`notifications/page.tsx:17-19`). So it is now `['admin']` and
an editor reads their notifications where everyone else does.

Changes:

| | |
|---|---|
| `screening`, `institutions`, `payout-queue`, `monitoring` | gate added |
| `institutions/[id]/payout-accounts` | gate added — **not in the nav**, so the ratchet cannot require it; written deliberately because it holds payout destinations |
| `notifications` | `['admin', 'editor']` → `['admin']` |
| `AdminSidebar` `Finance & Users` | `adminOnly: true` |
| `(index)/page.tsx` + `AdminDashboard` | the `isAdmin` fix, §4.1 |

⚠️ **`auth()` costs a query and `docs/87` caps an entry point at three.** Five
pages gained one; `src/db/pool-fanout.ratchet.test.ts` passes (4 tests).

### 4.1 ⛔ Hiding the section is only HALF the fix

`AdminDashboard.tsx:1` is `'use client'`. Anything in `stats` is serialized
into the RSC payload **whether or not it is rendered**, so a JSX guard alone
would have left donor names readable in the browser. The page narrows the
object before passing it; the component then also hides the section, so an
editor does not see an empty table implying "no donations".

Campaign rows are deliberately **kept**: `raisedAmount` is already public on
the campaign page, and the review queue sits next to the editor's own work.

---

## 5. Verified by execution, with the admin as the control

Measured in Chromium against a production build, one server, an editor
promoted in the throwaway database and restored afterwards.

| page | editor BEFORE | editor AFTER | admin (control) |
|---|---|---|---|
| `/admin` | served, **2 donor names**, 13 money figures | served, **0 donor names**, 9 | served, 2 names, 13 |
| `/admin/screening` | **served** | **→ /admin** | served |
| `/admin/institutions` | **served** | **→ /admin** | served |
| `/admin/payout-queue` | **served** | **→ /admin** | served |
| `/admin/monitoring` | **served** | **→ /admin** | served |
| blog, blog/new, blog/topics, news-feed, campaign updates/new | served | **still served** | served |

⚠️ The control is the half that proves I did not simply lock the editor out:
every page their role legitimately needs still serves them, and the admin
still reaches all five gated pages.

The arithmetic confirms the narrowing is exactly what was intended: admin 13 =
9 campaign figures + 2 tile details + 2 donation amounts; editor 9 = the
campaign figures alone.

### 5.1 Gate 4 — and one of my own controls was broken

| # | injection | result |
|---|---|---|
| 1 | `Finance & Users` loses `adminOnly` | FIRED |
| 2 | `/admin/screening` loses its gate | FIRED |
| 3 | `/admin/notifications` re-admits `editor` | FIRED |
| 4 | `AdminDashboard` goes back to ignoring `isAdmin` | FIRED |
| 5 | the page stops withholding donor rows (hiding-only) | FIRED |
| 6 | `NAV_GROUPS` → `NAV_GROUPS_RENAMED` | **SILENT — a bad probe** |
| 6a | renamed to `SIDEBAR_SECTIONS` | FIRED (the file errors) |
| 6b | `NAV_GROUPS` emptied | FIRED (the vacuity control) |

⚠️ **Injection 6 was silent because the injection was wrong, not the check.**
The test does `indexOf('const NAV_GROUPS')`, and `NAV_GROUPS_RENAMED` *starts
with* `NAV_GROUPS`, so the parse never broke and nothing was injected. Redone
two ways: 6a is a real symbol rename, and 6b empties the array — which is the
one that matters, because it proves the rules are not vacuously true on an
empty input (`docs/123`'s lesson).

⚠️ 6a "fires" by making the file **error** rather than fail an assertion, so
it emits no failure count (`docs/124` §5.1). It does not go green, but it is
not the same signal as the others and is recorded as such.

---

## 6. Reported, not fixed

**6.1** `PATCH /api/v1/admin/users/[id]` writes `users.phone` — the free-text
column `docs/82` describes as "never validated or verified and read by
NOTHING". The verified number lives in `phone_e164`. Not a new defect, and the
admin screen does not claim the number is usable, but an admin typing one
there is writing to a dead column.

**6.2** `DELETE /api/v1/admin/users/[id]`'s JSDoc (`:375-378`) still says
*"Users with no donations are hard-deleted"* — the exact behaviour `docs/124`
removed, contradicted by the body's own comment 30 lines below it.

**6.3** `notifyAccountDeletion` is called **before** the transaction, on the
stated grounds that otherwise "there is nowhere to send it". That reason does
not hold: `user.email` is already captured in a local `const` from the select
above, so mailing after the transaction would work — and today a transaction
that throws leaves a person told their account was erased when it was not.

All three are small and none is a security issue; they are listed so the next
pass does not have to re-find them.

---

## 7. Not checked

- I did not FIRE an editor's POST at the admin routes. I read all ten gates;
  I did not watch one return 403.
- The remaining ungated pages in OPEN groups (`campaigns`, `campaigns/new`,
  `campaigns/[id]`, `campaigns/[id]/edit`) are deliberately left serving an
  editor, but their **controls** are not yet role-gated: `CampaignDetail.tsx`
  renders "Approve and publish" and "Suspend" with no role prop at all
  (`:308`, `:338`), and the routes behind them require `admin`. That is the
  `docs/119` violation still standing, on the most consequential control in
  the product. It needs a prop threaded through and is its own change.
- `users/[id]/interactions` and `users/[id]/relationships` (POST/DELETE) were
  not exercised.
- The disclosure of `screening`, `institutions` and `payout-queue` was never
  measured with real rows in them — only established that the pages cannot
  distinguish roles.
