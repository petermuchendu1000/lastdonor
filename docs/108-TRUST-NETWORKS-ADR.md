# 108 — Trust Networks: institutional vouchers

**Date:** 2026-10-25
**Status:** ⚠️ **AMENDED 2026-10-28 — "NOT DEPLOYED" was the wrong word, the
same conflation `docs/106` carried.** The code IS deployed: all seven
institution/vouch routes appear in the build's own route table and ship in
every image (`/admin/institutions`, `.../[institutionId]/payout-accounts`,
`/api/v1/admin/institutions`, `.../[institutionId]`,
`.../[institutionId]/payout-accounts`, `/api/v1/admin/campaigns/[campaignId]/vouch`,
`/api/v1/admin/vouches/[vouchId]`). What is true is that the feature is
**UNUSED**: [VERIFIED in production 2026-10-28, v119] `trusted_institutions`
0 rows, `institution_vouches` 0 rows, campaigns with
`verification_source='institution_vouch'` 0. Nothing can happen until an admin
creates an institution — which remains the trust root this doc describes.
⚠️ Note an external probe CANNOT settle this: the middleware is default-deny,
so `/api/v1/admin/fabricated-not-real` also answers 401 and
`/admin/fabricated-not-real` also answers 307. See `docs/136` §3.1.
**Read before:** touching `src/lib/trust-network/`, `campaigns.verification_source`,
the pre-verification raise cap (`docs/101`), or anything that writes
`campaigns.verification_status`.

---

## 1. What was asked for, and what was built

The request: *verified community entities — registered 501(c)(3) charities,
local churches, hospitals, university administrations — act as "Trusted
Vouchers". If an entity with an already-verified institutional account vouches
for a family's crisis, the campaign bypasses the standard verification queue
entirely.*

Built, and it does bypass that queue. One thing is narrower than the words
could be read, and it is the whole safety argument, so it is first:

> ⛔ **A vouch grants `identity_verified` and nothing else.** It lifts the
> pre-verification raise cap (`docs/101`). It does **not** release money, it
> does **not** make a payout possible without an administrator's own decision,
> and it does **not** publish a campaign.

### 1.1 There are two queues, and the request names one of them

This is not a hedge; it is a fact about the product that has to be stated
before anything else makes sense.

| Queue | Screen | What it gates | Decided by |
|---|---|---|---|
| **Verification** | `/admin/verification` | the raise cap, and eligibility for payout | documents + an admin |
| **Publication review** | `/admin/campaigns` | whether the campaign is public at all | an admin (`docs/78`, `docs/79`) |

"The verification queue" is the first one, and that is the one a vouch
bypasses. The second is untouched, deliberately: `docs/78` and `docs/79` made
"every campaign is reviewed by a person before it goes live" **true**, and that
sentence appears in roughly 44 lines across 23 files, including the site title
and the `/compare` table against GoFundMe. Bypassing it would falsify all of
them, which is a product and policy decision, not an implementation one.

So a vouched campaign still waits for a person to publish it — and
`under_review` is a **vouchable** state precisely so the reviewer reads the
hospital's statement while it waits. That is the speed-up, and it is real: the
organiser does not have to photograph an ID and a bill and wait for a second
queue behind the first.

### 1.2 Why not `fully_verified`

Because `fully_verified` moves money. `admin/campaigns/[campaignId]/verification/route.ts`
writes `total_released_amount` in the **same transaction** that sets it:

```ts
if (action === 'approve_t2') {
  updateFields.totalReleasedAmount = sql`LEAST((
    SELECT COALESCE(SUM(${donations.amount}), 0)::int FROM ${donations}
    WHERE ... AND source = 'real' AND refunded = false
  ), ${campaigns.raisedAmount})`;
}
```

If a vouch could write that status, an email from a third party would release
funds. `identity_verified` writes no amount column at all.

**The consequence that remains, stated plainly:** a vouched campaign becomes
*eligible* for an admin to approve for payout without any document ever
existing. That is a person's decision, and the admin screen is built so they
cannot miss the fact — see §5.

---

## 2. The trust root is a person, and it is us

There is **no self-serve path** to becoming a trusted institution. A row in
`trusted_institutions` exists because a LastDonor admin checked the
organisation and recorded how, in a `verification_notes` field the validator
requires to be at least 20 characters.

That is the security model, not an omission. Anyone who can create an
institution can lift the raise cap on any campaign that institution vouches
for. A public registration endpoint would hand that to the internet.

### 2.1 `representative_*` is attribution, not authentication

⚠️ v1 records a vouch **through an admin**. The institution's representative
writes in or calls; an admin records what they said, naming them, their role
and their email. Nothing in the platform has proven who that person is, and
**no screen may imply it has** — the admin copy says *"St Mary Hospital said
this came from Grace Wanjiku, Medical Social Worker. We have not checked who
they are."*

### Rejected (for now): an institutional login

An institutional portal is the version that deserves the word
"decentralized", and it was not built, for the reason this repository keeps
re-learning:

- `docs/76`: an "Automated goal setting" toggle, default ON, labelled
  "Recommended" — `autoGoal` was never POSTed, no column stored it, no job
  acted on it.
- `docs/77`: "reviewed before publication", claimed in ~30 places, with the
  insert saying `status: 'active'` and a comment reading "instant-live, no
  review needed".
- `docs/81`: Didit **v1** was taken over v2 because v2 needs a console
  `workflow_id` nobody has, and an unexercisable code path is exactly what
  those two were about.

No real institution has ever used this product. An authentication flow,
invite email, session model and permission scope built against zero users
would be four more unexercised paths. The **columns** a portal needs are in
the table, so adding one later is a route and a session, not a migration.

---

## 3. What a vouch may touch, proven structurally

`src/lib/trust-network/vouch-boundary.test.ts` reads the directory's source
and asserts, mechanically:

| Claim | How it is checked |
|---|---|
| No module assigns `fully_verified` | every occurrence of the string must be the right-hand side of an equality |
| Writes exactly four tables | the argument of every `.update()` / `.insert()` / `.delete()` is in an allowlist of `campaigns`, `institutionVouches`, `trustedInstitutions`, `auditLogs` |
| Never names a money column | `totalReleasedAmount`, `totalWithdrawnAmount`, `raisedAmount`, `goalAmount`, `donorCount` appear nowhere |
| Updates `campaigns` in exactly 2 places | and each `.set({})` body's keys are within `{verificationStatus, verificationSource, verificationReviewedAt, updatedAt}` |
| Cannot publish anything | no `.insert(campaigns)` and no `publishedAt:` assignment |
| The granted status comes from a named constant | the literal `'identity_verified'` appears only in `decide.ts` |

Proven by injection — three separate violations, each caught by the right
test and nothing else:

```
inject VOUCH_GRANTS_STATUS = 'fully_verified'
  × mentions fully_verified only to COMPARE against it, never to assign it
  × ⛔ never lowers fully_verified, because money has been released against it
  × ⛔ a vouch grants identity_verified and nothing more

inject totalReleasedAmount: 1 into the campaigns update
  × ⛔ never names a money or payout column at all
  × ⛔ updates campaigns in exactly two places, writing only verification columns

inject tx.insert(verificationDocuments)
  × ⛔ writes to exactly four tables, and they are the expected four
```

### 3.1 ⚠️ A repo-wide version of this test was WRONG and was removed

The first draft also tried to enumerate every writer of `fully_verified` in
the repository. It named two files and **missed a third**:
`verification/didit/webhook/route.ts:137` does

```ts
await db.update(campaigns).set(update).where(eq(campaigns.id, campaign.id));
```

where `update` is an object assembled earlier, so no text search for
`verificationStatus: 'fully_verified'` can see it. That is the `docs/101`
lesson again — **a grep over code proves the text, not the semantics** — and
the honest response was to delete the over-claiming test rather than patch its
regex. What survives is a narrow claim about one small directory where every
write is direct.

---

## 4. Containment

A vouch is a money-adjacent control granted on a third party's word, so the
question is not only "can it be abused" but "how much, and can it be undone".

**Budget.** `monthly_vouch_limit` (default 10) caps vouches per institution
per rolling 30 days.

⚠️ **The window counts REVOKED vouches**, and that is the point. If revoking
your own vouch returned budget, an institution with a limit of 2 could vouch,
revoke, vouch, revoke, forever — no limit at all. It is a rate of
**assertions**. Asserted against a real database, not reasoned about:

```
✓ ⚠️ counts REVOKED vouches against the rolling budget
✓ forgets a vouch older than the window
```

**Suspension** stops new vouches at once and leaves existing ones standing.
Deliberately the conservative direction: a suspension is often precautionary
("their email was compromised, hold on"), and cascading it would un-verify
every campaign they had ever vouched for — putting live appeals back under the
cap, mid-appeal, on a suspicion. Revoking is per campaign, with a reason, each
with its own audit row.

**Revocation** is where the three cases live, and the obvious rule is wrong in
two of them:

1. Another institution still vouches → the campaign keeps its status.
2. `verification_source` is `documents`, **or NULL** → leave it alone.
   ⛔ NULL means *unknown*, never "this vouch's doing": a campaign verified
   before the column existed has NULL, and treating that as ours would strip a
   status this code never granted. Same confusion `docs/106` records about a
   missing trusted name, where "cannot judge" had to stay distinct from "no
   problem found".
3. Only this vouch verified it → back to `unverified`, and back under the cap.

And nothing ever lowers `fully_verified`: money has been released by then, and
a revoked vouch is not a reason to rewrite a payout's precondition after the
fact — it is a reason for an admin to look.

**Audit.** `institution.created`, `institution.updated`, `institution.suspended`,
`institution.vouch_recorded`, `institution.vouch_revoked`, all at `severity:
'warning'`, each naming the institution, the representative, the status before
and after, and the budget position.

---

## 5. Why `verification_source` is a column and not a derivation

It would be cheaper to infer "this campaign was vouch-verified" from the
existence of a live vouch row. That inference cannot answer the revocation
question: a campaign with both a live vouch *and* an approved document review
would have to guess which one to fall back from. A guess about someone's
verification state is the wrong kind of guess, so the source is recorded.

It is also in `publicCampaignSelect` — the security-reviewed public allowlist
(`src/db/public-select.ts`), with the key pinned in
`test/security/indistinguishability.test.ts`. Its three values are
`documents`, `institution_vouch` and null; none is personal or operational.
Exposing it does two jobs: the campaign page decides whether to render the
disclosure banner, and it avoids a database query for every campaign that was
**not** vouched for (`/campaigns/[slug]` has three sequential reads and a spent
query budget — `docs/87`).

---

## 6. What the donor is told

Before a vouch, `/campaigns/[slug]` shows an amber banner: *"We have not
checked this organiser's ID yet. This campaign can raise up to $500 until we
do, and no money can be paid out to them before then."*

A vouch removes the cap, so that banner stops rendering. **Saying nothing in
its place would not be a false claim, but it would let a donor assume the usual
check happened.** It did not: a hospital's word did. CLAUDE.md's rule is that
trust copy is a factual assertion, so the replacement is the fact:

> **Confirmed by St Mary Hospital** — They told us this need is real. We have
> not seen the organiser's ID ourselves.

⛔ `src/components/campaigns/VouchedByBadge.test.tsx` asserts that this copy
contains none of *verified*, *verification*, *document* or *we checked*, and
that exactly one of the two banners ever renders — never both, never neither.
One edit from "Confirmed by" to "Verified" turns an honest statement into a
claim the platform cannot substantiate, and nothing else in the codebase would
notice.

The registration number has the same treatment on the admin screen: it renders
as *"Not checked — as stated by them"* until somebody actually checks it, because
an EIN printed without qualification reads as verified to every reader.

---

## 7. The admin surface, and the one sentence it exists to show

`/admin/institutions` holds the organisations. `/admin/campaigns/[id]` holds
the vouch panel — on **every** campaign, in **every** state.

That last point is `docs/83`'s lesson applied before it bites again: the Didit
verification flow worked and was unreachable for days because its only link
sat behind `status === 'active' && donorCount > 0`, a condition that became
unsatisfiable as a side effect of work in other files. A panel that only
appeared for campaigns in some particular state would repeat it exactly.

The load-bearing line on that panel:

> This campaign is **ID verified on an organisation's word**. Nobody has
> uploaded any documents, and no one at LastDonor has seen the organiser's ID.

It is rendered in the same block as the vouch, because an administrator
deciding on a payout reads that block and nothing else. Showing
`identity_verified` without it would let a vouch read as a document review
that happened.

---

## 8. Known limits, recorded rather than hidden

1. ⛔ **A second institution cannot corroborate a vouched campaign.** The
   first vouch sets `identity_verified`, and `canCampaignBeVouched` refuses an
   already-verified campaign — correctly, for a first vouch, and wrongly for
   corroboration. The database permits several live vouches (the unique index
   is per institution per campaign, partial on `revoked_at is null`); the
   decision layer does not. A second organisation's vouch has to be recorded
   before the first or not at all. There is a test asserting this behaviour as
   it stands, so changing it is a deliberate edit, not a surprise.
2. **No email is sent** to anyone when a vouch is recorded or revoked. The
   organiser is not told that an organisation vouched for them, and the
   institution gets no receipt. Both are worth having; neither is built, and
   nothing in the product implies they exist.
3. **The institution is not notified** that it has been recorded, so an
   organisation cannot discover a vouch falsely attributed to it. The
   mitigation today is that only an admin can record one, and every one is
   audit-logged and revocable.
4. **Nothing verifies a registration number.** Not the EIN, not an NGO-Board
   number, not a charity number. The column records a claim and the UI says so.
5. **There is no institution in any environment**, so no part of this has run
   against a real organisation. The paths themselves are exercised: 21 unit
   tests on the decisions, 7 structural boundary tests, 7 on the donor-facing
   copy, and **17 integration tests against a real Postgres 16**.

---

## 9. What was verified, and how

### Integration, against a real Postgres (17/17)

The things no unit test can settle:

- A vouch verifies the campaign and the raise cap lifts — asserted through
  `checkRaiseCap`, **the function the money-in routes actually call**, not by
  reading a status and assuming.
- Revoking puts the cap back.
- Revoking does **not** un-verify a campaign whose source is `documents`.
- `total_released_amount` and `total_withdrawn_amount` stay `0`, and the
  status never reaches `fully_verified`.
- `campaigns.status` stays `under_review` and `published_at` stays NULL.
- The **partial** unique index permits a second vouch after a revocation and
  refuses a second live one — and the database refuses it independently of the
  application check, because a guard that lives only in TypeScript is a guard
  one new code path can walk around.
- The `revocation_complete` CHECK rejects `revoked_at` with no `revoked_by`.
- The duplicate-organisation index is case-insensitive per country, and the
  same name in a different country is a different organisation.
- The ISO country CHECK rejects `Kenya` and `ke`.

### `db.$count` was probed, not trusted

The institutions list uses `db.$count(...)` as a correlated subquery for the
live and in-window counts. `docs/101` is about a `sql` expression that was
valid, silent and wrong, so this was run against a real database with the two
counts deliberately **different** (one vouch revoked, so live=1 and window=2)
— equal numbers would have hidden a subquery that was wrong in both the same
way:

```
[{"name":"Never Vouched","liveVouches":0,"vouchesInWindow":0},
 {"name":"Probe Hospital","liveVouches":1,"vouchesInWindow":2}]
EXPECT: Never Vouched live=0 window=0 ; Probe Hospital live=1 window=2
```

### Gate

`npm run lint` clean (one pre-existing warning, unrelated), `npm run typecheck`
clean, **6,892 unit tests pass + 16 skipped across 218 files**, and the whole
integration suite is **136/136 across 15 files**. `pool-fanout`,
`admin-caching`, `revalidate-honesty`, `middleware.public-routes`,
`test/security/indistinguishability` and `sql-template-dates` all pass.

---

## 10. Schema

`src/db/migrations-v2/0009_chief_darkstar.sql`. Three enums
(`institution_kind`, `institution_status`, `verification_source`), two tables,
one column on `campaigns`.

The parts that are load-bearing rather than routine:

- `trusted_institutions.verified_by` is **NOT NULL**. An institution with no
  author is an institution nobody checked.
- `UNIQUE (lower(name), country)`. Two rows for one organisation is not a
  cosmetic duplicate — each carries its own vouch budget, so a duplicate
  silently doubles it.
- `UNIQUE (institution_id, campaign_id) WHERE revoked_at IS NULL`. **Partial**,
  so a revoked vouch stays on the record and the same institution can vouch
  again, without a second live row inflating the appearance of independent
  support.
- `CHECK ((revoked_at is null) = (revoked_by is null))`. A revocation with
  nobody's name on it is not a revocation.
- `CHECK (country ~ '^[A-Z]{2}$')` as a floor; the validator checks the code
  against the generated ISO 3166-1 table (`docs/103`), because `XX` passes a
  regex and names no country.

Nothing is ever deleted: a revoked vouch keeps its row, its reason and its
revoker, because the fact that an organisation once asserted something — and
that it was withdrawn — is exactly the history an abuse investigation needs.
