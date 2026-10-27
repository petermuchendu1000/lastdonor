# 124 — Nobody could delete their account, by either route

**Date:** 2026-10-27
**Journey:** 7 of the end-to-end walk (after `docs/123` content)
**Status:** fixed; two owner decisions taken and recorded
**Read before touching** `src/lib/account-erasure.ts`, either delete route, or
adding a column to `users`.

---

## 1. The finding

There are two account-deletion paths and **neither one worked.**

| Path | How it failed | Who it affected |
|---|---|---|
| `DELETE /api/v1/users/me` (self-service) | `tx.delete(users)` → foreign-key violation → `500 "Please try again"` | **3 of 9 production users**, each blocked by a *different* column |
| `DELETE /api/v1/admin/users/[id]`, donations branch | `badges: null, preferences: null` into two `NOT NULL` columns → UPDATE throws, transaction rolls back | **every user with a donation**; had never once worked |
| `DELETE /api/v1/admin/users/[id]`, no-donations branch | same foreign-key hole as self-service | anyone holding any reference |

So there was **no working path to remove a person's data from this
platform**, against a commitment published at `/privacy:151`: *"If you delete
your account, personal identifiers are removed within 30 days."*

The self-service path is reachable from `AccountPageClient.tsx:503`
("Delete my account") → `:469`.

---

## 2. Evidence

### 2.1 The foreign-key hole — four independent methods

**Method 1 — the live schema.** 36 foreign keys reference `users.id`: five
`CASCADE`, **31 `NO ACTION`**. The transaction nulled or deleted rows in
**six** of them. Thirteen of the 31 columns are `NOT NULL`, so for those
"null the reference" is not even available.

**Method 2 — reading the route.** The `catch` returned
`500 "Failed to delete account. Please try again or contact support."`
Trying again can never work.

**Method 3 — executable reproduction, with a control.** Against a real
Postgres on the project's own migrated schema; the two users differ by one
row and nothing else:

```
CONTROL: user B (no share link)  → deleted,  0 rows remaining
SUBJECT: user A (one share link) → ERROR: update or delete on table "users"
                                   violates foreign key constraint
                                   "campaign_share_links_user_id_users_id_fk"
                                   1 row remaining
```

**Method 4 — production.** The Gate-3 falsification was *"does anyone
actually hold a blocking row?"* It **did not falsify it**:

| user | role | blocked by |
|---|---|---|
| `7c8b75be…` | donor | 1 `campaign_share_links.user_id` (`docs/57`) |
| `676ad0be…` | admin | 6 `site_settings.updated_by` |
| `bbaafd95…` | donor | 2 `campaign_collaborators.invited_by` (`docs/111`) |

Three users, three *different* columns. That is the real tell: the handled
set of six was arbitrary, not reasoned.

### 2.2 The `NOT NULL` scrub — three methods

`schema.ts:389-390` declares `badges` and `preferences` `.notNull()` with
defaults `'[]'` and `'{}'`. The admin route wrote `null` into both.

Executing exactly that statement against a real Postgres:

```
ERROR:  null value in column "badges" of relation "users"
        violates not-null constraint
=== did the row change? ===
         email         | badges | preferences
-----------------------+--------+-------------
 scrub@example.invalid | []     | {}
```

The row comes back **completely unchanged**. Confirmed a third time through
drizzle in `src/lib/account-erasure.integration.test.ts`.

⚠️ **Why no test caught it.** `route.delete-erasure.test.ts` mocks drizzle at
the table-identity level — and **a mock cannot raise a foreign-key violation
or a `NOT NULL` violation.** It asserted `delete` on `users` and passed
throughout. The `docs/101` and `docs/107` lesson a third time: a statement is
checked by running it.

### 2.3 Two routes, two meanings of erasure

The admin path left the real address in **three** stores that mail is sent
from — `donations.donor_email`, `donor_campaign_subscriptions.donor_email`,
`newsletter_subscribers.email` — while the self-service path scrubbed all
three and documented why. And `bulk-email-recipients.ts:110` justifies its own
guard with *"Account deletion scrubs `donations.donor_email` …
(`users/me/route.ts`)"* — true of one route, false of the other.

---

## 3. The decision (owner, 2026-10-27)

**Anonymise in place, always.** The `users` row survives carrying an opaque
id; every personal identifier on it is scrubbed, and the address is scrubbed
out of every store mail is sent from. Because the row survives, **no foreign
key can ever be violated**, so erasure cannot fail for a reason the person
can do nothing about.

**Rejected — full hard delete**, cascading through all 31 references. It
destroys `campaign_withdrawals`, `refund_batches`, `institution_vouches` and
`verification_documents`: financial and audit records `/privacy` commits to
keeping seven years, and the evidence `docs/108` and `docs/120` rest on.

**Rejected — erase what is possible, refuse the rest.** Honest, but thirteen
of the thirty-one columns are `NOT NULL`, so it would leave people
permanently unable to delete their account, including two of the three
blocked today.

⚠️ **This is erasure of the person, not of the record.** A withdrawal still
says who requested it; it just no longer says who that was.

**Second decision: an administrator may not erase themselves here.** The
admin route has always refused self-deletion; `users/me` did not, and the
account page reaches it. Until now a foreign-key violation stopped it **by
accident** — the one admin holds six `site_settings.updated_by` rows — and
removing that accident is exactly what makes the refusal have to be
deliberate. Scrubbing an admin takes the attribution on settings changes,
institution vouches and verification reviews with it, and there is currently
one admin.

---

## 4. What changed

- **`src/lib/account-erasure.ts`** — one `anonymiseAccount(tx, {userId, email})`
  that both routes call, inside the caller's transaction, with the caller
  writing its own audit row.
- **`users/me` DELETE** — refuses an admin with 403; otherwise anonymises.
- **`admin/users/[id]` DELETE** — one path instead of two. The donation count
  is still recorded on the audit row but is no longer a discriminator: a user
  with no donations can still hold a share link, an invitation or a
  verification document.
- **`campaigns.creator_id` is now LEFT INTACT.** That null existed only to get
  past the foreign key. Nothing needs it now, and `docs/119` found 13 of 14
  live campaigns already have no organiser — one that cannot be traced,
  reminded or paid. The row it points at holds no personal data.
- **The scrub list grew.** The old one predated `phone_e164`,
  `phone_verified_at`, `sms_consent_at` (`docs/82`, `docs/85`) and
  `stripe_connect_account_id`, and had silently kept leaving each new column
  behind. `image`, `security_question` and `security_answer_hash` were also
  missing. ⚠️ The security answer is **not** a login credential — it is an
  admin step-up check at `/api/v1/admin/settings/verify-security` — so this is
  a completeness gap, not a security exposure. Checking that is what kept the
  severity honest.
- **Both UIs now say what happens.** `UsersList` removed the row from the
  table and toasted "User deleted"; the row survives, so it reappeared as
  "Deleted User" on the next load — the `docs/122` §2 class, an admin UI
  asserting an outcome the route did not report. The dialog also promised
  "This action cannot be undone" on a branch that did nothing at all. The
  self-service copy and the confirmation email were rewritten the same way.

---

## 5. The tests, and the probe that lied

`src/lib/account-erasure.integration.test.ts` — **9 tests against a real
Postgres**, because both defects are invisible to anything that does not run
SQL. It covers the reported symptom (a share link), the `NOT NULL` columns,
the mail-safety invariant (the address appears in **none** of four stores),
the duplicate case (two people who followed the same campaign — the unique
index is why those rows are deleted rather than scrubbed to a shared
placeholder), idempotency, and a control (a user with no references at all,
without which "erasure succeeds" would be true of an implementation that did
nothing).

**The scrub list is checked against the table it scrubs.** The test reads
`users`' live column list and requires every column to be either scrubbed or
in a written "kept on purpose" set. Adding a personal column to `users` now
fails the build until somebody decides which. A hand-written list is only as
good as whoever remembered to extend it — `docs/119`.

All six rules proven by injection, every restore verified clean.

### ⚠️ 5.1 My injection probe was itself a check that could not fail

The first injection — putting `tx.delete(users)` back — reported **zero
failures**, and I nearly recorded that as "the test does not bite". It was
the probe. My edit truncated the file past the closing brace, so Vitest failed
to **collect**, and a collection error emits no `×` line for a
`grep -c '×'` to count. Re-run with a syntactically whole edit and a probe
reading the `Tests` line, the same injection fails **6 of 9**.

Gate 4 says a verification that passes on the first try should be suspected
before it is believed; this one did not even pass, it reported nothing, which
is worse and looks the same.

---

## 6. Also found on this journey, reported not changed

- **`/notifications` states two totals at once above 200 rows.** The page
  queries a true `count(*)` and prints "N total" (`page.tsx:56`) while
  `.limit(200)` caps the rows and the pager prints
  `Showing x–y of {filtered.length}` over the loaded set. The `totalCount`
  prop is destructured as `_totalCount` and **discarded**
  (`NotificationsClient.tsx:120`) — the `docs/119` `_hasCampaigns` shape. This
  is `docs/88` F16 on a user-facing page, where F16's `ListCount` fix went to
  admin only. ⚠️ **Latent**: the largest notification count in production is
  **4**, so nobody has seen it. Nothing prunes the table, so it is reachable.
- **`/profile` is a dead route.** An unconditional
  `redirect('/dashboard/settings')` that **nothing links to** (grep over
  `src/`). Harmless — it carries `robots: index: false` and is in the
  middleware matcher — but it is one more surface to keep correct for no
  reader.
- **There is no way to report a campaign or a message.** No route, no button,
  no table column a visitor can set. The only moderation surface is
  `admin/campaigns/[campaignId]/messages/[messageId]/moderate`, which an
  admin must find unaided. For a platform publishing appeals about named real
  people this is a product gap, not a defect — building it is an owner call.

---

## 7. What was NOT checked

- **The fix has not been exercised against production.** It is verified
  against a real Postgres on the same migrated schema, and nothing is
  deployed (the owner deploys). The three blocked users are still blocked
  until it ships.
- **No end-to-end browser walk of deletion.** Deleting an account is
  irreversible and the only accounts available are real ones, so this was
  proven at the database and the route, not by pressing the button in
  production.
- **`DELETE /api/v1/admin/users/[id]` has no unit test**, before or after.
  The shared function it now calls is covered by the integration suite; the
  route's own guards (role check, UUID check, self-delete refusal) are not.
- **Whether any of the 31 references matter to a person.** I checked which
  tables block the delete, not whether, say, keeping `campaign_share_links`
  attributed to an anonymised row is what a regulator would call erasure.
  That is a legal reading, not a code one.
- **The remaining account-journey surfaces** — register, sign-in, password
  reset, avatar upload, notification preferences — were inventoried but not
  walked. `docs/39` and `docs/74` cover parts of the first three.
