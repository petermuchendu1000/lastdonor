# 117 — Accepting an invitation led nowhere

**Date:** 2026-10-27
**Status:** implemented on `main`, **not deployed** (owner runs deploys, `docs/96`).

`docs/111` built campaign collaborators and recorded, in §5a, that *"a
collaborator cannot yet REACH a screen to use their capabilities — the API
admits them, the dashboard pages are still creator-gated."* This is what that
actually looked like to a person, and the fix.

Every claim below is **[VERIFIED]** (with the receipt), **[INFERRED]** or
**[UNKNOWN]**.

---

## 1. What was walked, and how

A real Chromium against a **production build** (`next build && next start` —
`docs/63`: the CSP blocks `unsafe-eval` in `next dev`, so nothing hydrates),
a local throwaway Postgres, and four seeded invitations: one for an address
with an account, one for an address without, one expired, one bogus.

**The half that already worked, verified:**

| Step | Result |
|---|---|
| Invite link while signed out | → `/login?callbackUrl=…`, **token preserved** |
| "Create one" link | `/register?callbackUrl=…`, **token preserved** |
| Register → terminal screen | "Go to sign-in" carries the token |
| Sign in | returns to the accept page, token intact |
| Accept | 201; row `accepted_at` set, `revoked_at` null |
| `POST …/updates` as the helper | **201**, row in `campaign_updates` |
| `POST …/collaborators` | **403** — a helper cannot invite |
| `POST …/withdraw` | **403 "You do not own this campaign"** |
| Expired / bogus / absent token | one uniform refusal, no enumeration oracle |

⚠️ **The withdrawal probe was non-discriminating at first** and is recorded
because it is the easy mistake: with a non-UUID `idempotencyKey` it returned
**400 on validation**, before any ownership check. That proves nothing — a
check that cannot fail. Re-run with a valid body it returns 403, and the
**creator** gets a *different* error ("Complete Stripe Connect setup"), which
is the control proving the 403 is an ownership refusal rather than an early
bail.

---

## 2. ⛔ The defect: the grant was real and entirely invisible

After accepting, the helper landed on `/dashboard/campaigns?joined=1` and read:

> **You haven't created any campaigns yet. Start one now**

**[VERIFIED] three independent ways at the same moment:**

1. **Code** — `dashboard/campaigns/page.tsx:43` was
   `.where(eq(campaigns.creatorId, session.user.id))`. A collaborator is not
   the creator.
2. **Database** — the `campaign_collaborators` row read `user_id` set,
   `accepted_at` set, `revoked_at` null.
3. **API** — `GET /api/v1/user-campaigns/<id>` answered **200** for that same
   browser session, and `POST …/updates` answered **201**.

**Falsification (Gate 3)** — *"what would most likely show this conclusion is
wrong?"* A sweep of **all twelve** signed-in dashboard routes, looking for the
campaign by name. **It appeared on none.** The conclusion survived.

Three more findings from the same walk:

- **`?joined=1` was read by nothing.** `grep` over `src/` returned exactly one
  occurrence: the redirect that sets it. There was no confirmation of any kind.
  (`?submitted=1` has `SubmittedForReviewNotice`; this had no sibling.)
- **All three capability screens bounced them** — `[id]/page.tsx:60`,
  `updates/page.tsx:36`, `edit/page.tsx:43` all
  `redirect('/dashboard/campaigns')` for a non-creator, i.e. into the empty
  list they had just come from.
- **The accept screen named no campaign.** "You were asked to help run a
  campaign." Somebody holding two invitations could not tell which they were
  accepting, and the token resolves to the campaign server-side, so it could
  always have been named.

Nothing threw. Every part worked and nothing joined them up — the `docs/83`
shape, and the reason the check for it has to be a **walk** rather than
another unit test.

---

## 3. The fix

### 3.1 `listMyCampaigns` — one query, `exists` not `leftJoin`

`src/lib/dashboard/my-campaigns.server.ts` returns campaigns the user created
**or helps with**, each tagged `creator` or `collaborator`.

⚠️ Still **one** query: this route is inside the three-concurrent-query
ceiling (`docs/87`, pool `max: 5`) and a second read would have been a change
to that budget rather than to this screen.

⛔ `exists`, not a `leftJoin`, and that is not style. The partial unique index
is on `(campaign_id, invited_email)` while live, so one person who accepted
invitations sent to **two different addresses of theirs** holds two live rows
on one campaign — a join lists it twice. Proven by mutation: swapped to a
`leftJoin`, the duplicate test returns 2 rows.

⚠️ No `sql` template anywhere in the module, deliberately. `docs/101`:
interpolating a Column renders it **unqualified**, and inside a correlated
subquery both sides then resolve to the inner table and the predicate is
silently never true. Typed builders carry their qualification — and the test
runs against real Postgres, because that is the only thing that catches it.

### 3.2 ⛔ Why it is NOT in `src/lib/collaborators/`

It was, and `collaborator-boundary.test.ts` rejected it:

```
my-campaigns.server.ts refers to `raisedAmount`
```

That directory is **sealed** — it may name no money, payout or verification
column, so nothing in the capability layer can grow into ownership
(`docs/111` §1). This module must select `raisedAmount`, `goalAmount` and
`verificationStatus` to render a dashboard row.

**The allowlist was not widened.** That is exactly what `docs/108` and
`docs/111` forbid. A read-only query for a screen is not a capability, so it
moved to `src/lib/dashboard/` and the seal stayed absolute.

### 3.3 The screens, and what a helper may NOT see

| Surface | Collaborator | Why |
|---|---|---|
| `/dashboard/campaigns` row | ✅ listed, badged **Helping** | the defect |
| `[id]` campaign screen | ✅ | membership |
| `[id]/updates` | ✅ `post_update` | `DELEGATABLE` |
| `[id]/edit` | ✅ `edit_content` | `DELEGATABLE` |
| `CampaignTeamPanel` | ⛔ hidden | `invite_collaborator` |
| Verification link | ⛔ hidden | `upload_identity` |
| "Where the money goes" | ⛔ hidden | `change_payout_account` |
| `JourneyChecklist` / next step | ⛔ hidden | the path to being **paid** |
| Donors list and link | ⛔ hidden | donor PII is not in `DELEGATABLE` |

⛔ **The hiding is the load-bearing half.** Admitting a helper to the campaign
screen without it would have shown them an invite panel, a verification link
and a payout destination — every one of which answers 403. A control that can
only fail is worse than no control.

⚠️ **The detail page asks for MEMBERSHIP, not a capability.** It calls
`resolveCampaignRole`, not `canCollaborate`. Viewing is not a delegated power,
and asking `canCollaborate(…, 'post_update')` as a stand-in for "are you on
the team" would read as though it were — and would put a view-only page in the
`DELEGATING` map, every entry of which *performs* the capability it names.

### 3.4 The two seal tests both fired, and both were extended deliberately

- `collaborator-boundary.test.ts` caught the module (§3.2) → the module moved.
- `collaborator-call-sites.test.ts` caught the two screens consulting
  `canCollaborate` → they were **added to `DELEGATING` by name**, not exempted.

⚠️ One assertion in it had to change shape: `every delegatable capability has
a declared surface` was `expect(Object.values(DELEGATING)).toEqual(DELEGATABLE)`
— a **bijection**, which held only while each capability had exactly one
surface. It is now a set comparison **both ways** (every capability reachable;
no surface naming one outside `DELEGATABLE`), which is what its own name says.

### 3.5 Copy

- `JoinedTeamNotice` for `?joined=1`, modelled on `SubmittedForReviewNotice`.
  It says the money is not included — a third time, at the moment the access
  actually begins.
- The accept screen now names the campaign and the inviter, via
  `describeInvite` — **read only**, because a GET must not mutate (mail
  clients and link scanners fetch emailed URLs first), and `null` for every
  unusable token so it adds no way to probe which tokens exist.

---

## 4. Checks, and what each is for

| Check | Count | Proves |
|---|---|---|
| `my-campaigns.integration.test.ts` | 13 | the query, against real Postgres |
| `collaborators.integration.test.ts` | 34 (6 new) | `describeInvite`'s four null cases |
| `collaborator-screens.test.ts` | 13 | the sealed sections stay gated |
| `CampaignsListClient.test.tsx` | 12 (5 new) | the row renders by role |
| `e2e-19-collaborator-journey.spec.ts` | 13 | **the journey end to end** |

### 4.1 Mutations, all killed

Resolver: creator-only revert (3 fail) · drop `acceptedAt` · drop `revokedAt`
· role always creator · `exists` → `leftJoin` (duplicate row).
Screens: team panel escapes the gate · payout link escapes the gate · updates
page drops its check.
`describeInvite`: stop hiding an accepted invite · an expired one · a revoked
one.

⚠️ **One mutation SURVIVED first time and the test was wrong, not the code.**
Dropping `isNotNull(acceptedAt)` broke nothing: my "a pending invitation lists
nothing" case left `user_id` null, so the `userId` predicate excluded the row
on its own and the test passed **for the wrong reason**. The state that
predicate actually guards — a row with `user_id` set but not yet accepted, the
case `can-collaborate.ts` names in its own comment — was added, and the
mutation then died.

### 4.2 The E2E fixture now has a sign-in

`docs/99` §8 records ten specs skipped for want of one. `seed-data.ts` seeds a
helper with a real peppered hash (via the project's own `hashPassword`, so it
cannot drift from the pepper or the rounds) plus a live and an expired
invitation.

⚠️ **An invitation is single use, and the suite is `fullyParallel`.** The first
run failed two tests because a sibling had already accepted the one seeded
token — the product was right and the spec was sharing state. Every test that
accepts now mints its own through `createE2EInvite`.

⚠️ **Wait for the URL to leave `/login`, not for `networkidle`.** Idle resolved
while the credentials POST was still in flight, and every later assertion then
measured the login page — a whole walk that read as a product failure and was
a harness one.

---

## 5. Results

```
npm run lint              0 errors (1 pre-existing warning, review-gate.test.ts)
npm run typecheck         0 errors
npm run test:unit         7541 passed | 16 skipped (251 files)
npm run test:integration  250 passed (26 files)
e2e-19 (Desktop Chrome)   13 passed
```

## 6. ⛔ What was NOT checked

- **Nothing against production.** This is all local. The feature is
  `docs/111` BUILT, NOT DEPLOYED, so production has no collaborator rows to
  observe — **[VERIFIED]** by the walk being possible only on a seeded fixture.
- **The E2E spec was not mutation-proven against the old code.** The resolver
  mutation that reproduces the original defect was started and the worker
  restarted mid-rebuild; the resolver was restored and re-verified (13/13),
  but *"the E2E spec fails against the pre-fix code"* is **[UNKNOWN]**. The
  equivalent mutation at the integration layer **was** run and killed three
  tests, and `collaborator-screens.test.ts` was mutation-proven three ways.
- **Mobile Chrome leg not run** for the new spec; Desktop Chrome only.
- **The invited-address-with-no-account arm stops at "Check your email".**
  Whether the registration email's own link carries the invitation token is
  **[UNKNOWN]** — not traced. The *on-screen* path does carry it.
- **No accessibility (axe) pass** on the new notice or the badged row.
- **The mobile leg and axe.** No accessibility pass on the new notice or the
  badged row, and the new spec was not run on Mobile Chrome.
