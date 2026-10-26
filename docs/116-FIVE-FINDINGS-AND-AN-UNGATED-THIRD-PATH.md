# 116 — The five reported findings, and a third ungated campaign path

**Date:** 2026-10-26
**Status:** implemented on `claude/adoring-bell-7aka3l`, **not deployed**
(owner instruction, `docs/96`).

This closes the five findings `docs/115` §7 reported but did not fix. Taking
the inventory for one of them turned up a sixth, which is the most serious
thing in this document, so it is §4 rather than an appendix.

Every claim below is marked **[VERIFIED]** (with the receipt), **[INFERRED]**
or **[UNKNOWN]**.

> ⚠️ **Production was unreachable for this whole session.** Both Supabase
> pooler ports (5432 and 6543) time out from the sandbox, so nothing here is
> measured against live data. Where production state matters it is marked
> **[UNKNOWN]** and the local-fixture evidence is given instead.

---

## 0. Summary

| § | Finding | Outcome |
|---|---|---|
| 1 | `fund-pool/allocate` did not check that source and target share a currency | **fixed** + 4 integration tests |
| 2 | Donor segment money thresholds compared a currency-blind figure | **fixed** + 9 integration tests |
| 3 | Nothing in the codebase could set a campaign's currency | **fixed** + 14 tests; ⛔ still unreachable from the UI |
| 4 | **A third campaign-creation path published without review** | **fixed** + the gate test rewritten to discover its own inputs |
| 5 | 13 sites quoted a processing rate nobody has ever been charged | **fixed** + a sweep guard; ⛔ 3 areas reported, not changed |
| 6 | Five money settings stored, validated, rendered and read by nothing | **removed** + 6 integration tests |

**Gate 8 did not apply to any of it.** Nothing here moves, credits or voids
money, and no production row is deleted or mutated — see §6.3 for why removing
five settings deletes nothing.

---

## 1. A fund-pool allocation could cross a currency boundary

### Current behaviour, cited

`POST /api/v1/admin/fund-pool/allocate` validated the allocation ids, that
each was `pending`, and that the target campaign is not simulated. It never
compared currencies — and **[VERIFIED from the schema]**
`fund_pool_allocations` has no currency column of its own, so an allocation's
`amount` is denominated by the campaign the money came *from*.

Moving a KES 5,000 allocation onto a USD campaign therefore re-reads the
figure as US$50 on the next screen that renders it: the same ~130x shape as
the `/transparency` defect in `docs/114` §1.

### Severity, traced before claiming it

**[VERIFIED]** Allocations are inserted only behind `campaign.simulationFlag`
(`payment-service.ts:335`), and `fund-pool/disburse` flips a status and writes
an audit row **without crediting any campaign**. So this was a *reporting*
defect, not a money-movement one. The guard goes in before disbursement ever
credits a balance, which is the moment it would stop being one.

### The fix

The target select gained `currency`; the allocations select gained
`sourceCurrency` through an `innerJoin` on the source campaign; a check before
the transaction refuses the **whole batch** with a 400 naming both currencies.
The audit row records the currency.

⚠️ The defect was a **missing join**, which is why the test runs the real
handler against a real database. A unit test over a pure predicate would have
passed against the broken route, because the broken route never had the source
currency to compare.

`cross-currency.integration.test.ts`: 4 tests, including the positive case —
a check that refuses everything is as useless as one that never fires.

---

## 2. A donor-segment money threshold was compared across currencies

### Current behaviour, cited

`GET /api/v1/admin/donors/segments` classified a major donor with raw SQL:

```sql
"totalDonated" >= 50000
```

That is US$500 written as an integer, and **the column it compares carries no
currency**:

- **[VERIFIED]** for a registered donor it is `users.total_donated`, one
  `integer` that `payment-service.ts:307` increments by every donation's raw
  `amount` whatever rail it came over;
- **[VERIFIED]** for a guest it is `SUM(d.amount)` grouped by `donor_email`
  alone, in the route's own CTE.

`minDonated`/`maxDonated` were worse: they multiplied the caller's figure by a
hardcoded `100`, right for a two-decimal currency and **100x wrong** for a
zero-decimal one (`docs/103`).

⚠️ KES and USD share exponent 2, so every **digit** came out right and only
the **meaning** was wrong. That is why six thousand unit tests and nine
ratchets never saw it — the same reason `docs/115` gives for the admin sweep.

### The fix

There is no exchange rate in this codebase and `docs/102` forbids one deciding
anything but display, so these filters **cannot be made currency-agnostic —
only currency-explicit**. A money filter without a supported currency is a
**400**, not a default, because defaulting is precisely what the defect was.

`majorDonorMinor` joins `CURRENCIES`:

- **USD 50,000** — byte-for-byte the threshold the route already used, so a
  dollar-only platform sees no change at all. Asserted against the constant.
- **KES 5,000,000** — a **policy number** on the ×100 scale the owner already
  chose for `unverifiedCapMinor` in `docs/101` (US$500 ↔ KES 50,000). Not a
  conversion. One line to change, and it decides nothing but which rows an
  admin list shows.

`minDonated`/`maxDonated` now take **minor units** directly, which removes the
exponent question rather than answering it.

### 2.3 The trap, found by probing the fix

The first version of the filter was:

```sql
EXISTS (SELECT 1 FROM donations d WHERE … AND d.currency = $1
        HAVING COALESCE(SUM(d.amount), 0) <= $2)
```

**[VERIFIED by running it against Postgres 16]** A `HAVING` with **no
`GROUP BY` is one group even over zero rows**, so `COALESCE(SUM, 0)` is `0`
and `0 <= anything` is TRUE. `?currency=KES&maxDonated=1` returned a **USD-only
donor who has never given a shilling**:

```
--- HAVING without GROUP BY, KES <= 1 ---
 email
-------
 b@x        <- gave only USD 50,000
```

Adding `GROUP BY d.currency` makes an empty match produce no group, so EXISTS
is false and **both** comparisons require at least one donation in that
currency. The same probe with the `GROUP BY` returns `(0 rows)`.

That `GROUP BY` is load-bearing and the test that pins it says so, because it
is exactly the line somebody removes as redundant.

### 2.4 What is NOT closed

- ⚠️ **The filter and the displayed total attribute differently.** The filter
  matches `d.user_id = unified_donors.id OR d.donor_email =
  unified_donors.email`, which is what the CTE itself does. `donorTotalsForUsers`
  matches `user_id` alone and falls back to email. A registered donor with
  guest donations under the same address can therefore be *selected* by a
  figure the table does not *show*. Pre-existing, unchanged, recorded.
- ⚠️ **`ORDER BY "totalDonated" DESC` still reads the blind figure.** It is an
  ordering, not a threshold, and a mixed-currency list has no honest single
  sort key. Reported, not changed.

### Checks

`currency-thresholds.integration.test.ts`: 9 tests, real handler, real
database. Three donors seeded so the **old** rule called all three major
(blended 5,000,000 / 50,000 / 2,525,000, all ≥ 50,000) and the new rule admits
exactly one per currency. **Five mutations, all killed:** remove the
`GROUP BY`; drop the currency predicate; revert `major_donors` to the literal;
default the currency instead of refusing; restore the `× 100`.

---

## 3. Nothing in this codebase could set a campaign's currency

### Current behaviour, cited

**[VERIFIED]** All four `insert(campaigns)` sites — `user-campaigns/route.ts:154`,
`campaigns/route.ts:145`, `campaign-publisher.ts:369`, `news-pipeline.ts:688` —
**omitted the column**, so every campaign this codebase has ever created took
the `'USD'` default.

On a platform where Stripe cannot take a payment at all (`docs/72`) and every
donation ever collected came over M-Pesa in shillings (`docs/92`).

**[UNKNOWN]** How the KES campaigns in production came to exist. `docs/92` and
`docs/114` record them, no code path creates one, and production is unreachable
from here. Presumably set by hand or by migration — worth the owner's
confirmation.

Both create validators also hardcoded dollars:

| Schema | Bounds | Message |
|---|---|---|
| `createCampaignSchema` (admin) | 100,000 – 10,000,000 | "Minimum goal is $1,000" |
| `createUserCampaignSchema` (wizard) | 100 – 100,000,000,000 | "Minimum goal is $1" |

Accidentally true while USD was the only reachable currency, and the
`docs/101` defect the moment it was not.

### The fix

`currency` on both create schemas, restricted to `SUPPORTED_CURRENCY_CODES`
and defaulting to `DEFAULT_CURRENCY`, persisted at both insert sites.

⚠️ **Collectable, not merely known** (`docs/103`): `donations` carries a
composite FK onto `campaigns (id, currency)`, so a campaign in a currency no
gateway settles would be unfundable *and* unmovable — the FK freezes it the
moment a donation lands.

Goal bounds moved into a `superRefine`, because a field validator cannot see a
sibling field:

- **Admin route** — `minGoalMinor`/`maxGoalMinor` on `CurrencyDefinition`.
  USD is byte-for-byte today's pair. KES is **10,000,000 / 1,000,000,000**
  (KES 100,000 – 10,000,000), a **policy number** on the `docs/101` ×100
  scale, flagged for the owner. Note the KES floor is 2× the pre-verification
  cap, so a KES campaign cannot reach its own minimum goal before somebody has
  checked the organiser's ID — the intended order of events, not an accident.
- **Wizard** — the **same integers as before** (100 and 100,000,000,000),
  deliberately. See §3.3.
- Messages render through `formatMoney` in the chosen currency.

### 3.3 One improvement recorded and NOT taken

The obvious change is a wizard floor of `minDonationMinor`, since a goal below
one donation cannot be reached by one. That would **reject a US$1–4.99 goal
that is accepted today**, and changing what an organiser may ask for is a
product call, not a currency fix. Left at 100.

### 3.4 ⛔ STILL OPEN: no human can choose a currency

`ShareYourStoryForm` does not send `currency`, and neither does
`CampaignEditor`, so the API accepts KES and no screen offers it. **This is the
`docs/83` / `docs/111` §5a shape and it is recorded rather than half-fixed**:
a currency picker needs decisions this document cannot make — whether a US
organiser is shown KES at all, what the goal input's units are per currency,
and what the screen says about which rail will collect.

### Checks

- `campaign-currency.integration.test.ts` — 6 tests, real handler, real
  database, including that a KES campaign can then take a KES donation **and
  that a USD donation onto it is refused by the database**, which is what
  makes one-currency-per-campaign a guarantee rather than a convention.
  3 mutations killed.
- `campaign-currency-immutable.test.ts` — 8 tests. ⚠️ `updateCampaignSchema`
  is `createCampaignBase.partial()`, so adding the field to create **widened
  update with it**. What stops a write is that `PUT /api/v1/campaigns/[slug]`
  builds `updateValues` field by field and `currency` is not in the list —
  one line of *absence* holding a money invariant, which is the kind of thing
  that gets tidied into a spread. Pinned at the route **and** swept across
  every `.update(campaigns).set({…})` in `src/`. 4 mutations killed.

---

## 4. ⛔ A THIRD campaign-creation path published without review

Found while taking the §3 inventory of campaign inserts. This is the most
serious item here.

### What was wrong

**[VERIFIED]** `src/lib/news/news-pipeline.ts:688` inserted:

```ts
status: 'active',
…
publishedAt: new Date(),
```

A machine-generated campaign about a **named real person**, public with nobody
having read it — the exact defect `docs/78` and `docs/79` were written to
close, on a third creation path neither of them knew about.

**[VERIFIED] it is not dead code.** `CRON_SCHEDULE` contains both
`ingest-news` and `fetch-news`; each route calls `runNewsPipeline`, whose body
this is. There is no feature flag between the cron entry point and the insert —
`simulation.enabled` is never read in that file.

**[UNKNOWN]** whether it has ever actually fired in production. It is gated by
dedup, a daily limit and `simulation.max_concurrent` (default 10), and
production is unreachable from here. **Worth checking `audit_logs` and
`campaigns WHERE source='automated' AND status='active'` on the live database
before deploying anything else.**

### Why nothing caught it

`publisher-review-gate.test.ts` **named two files** by literal path and
searched each for the literal string `.insert(campaigns)`.

1. It never opened `news-pipeline.ts`.
2. That site spells the call `.insert(schema.campaigns)`.

So every assertion in it passed while the claim it exists to protect — *"Every
campaign is reviewed by a person before it goes live"*, asserted in ~44 lines
across 23 files — was false.

This is the `docs/108` lesson on a different surface: **a check that
enumerates its own inputs by hand proves something about those inputs and
nothing about the property.**

### A second defect in the same file

It sliced a **fixed 2,600 characters** after the insert and searched that.
Adding one comment inside the user route's `.values({…})` pushed
`status: 'under_review'` past the window, and the assertion failed with the
gate fully intact. **A window that silently stops looking is the same class of
defect pointed the other way.**

### The fix

`news-pipeline.ts` now inserts `status: 'under_review'` with
`publishedAt: null`.

`publisher-review-gate.test.ts` was rewritten to **discover** its inputs:
walk `src/`, match **both spellings**, brace-match the `.values({…})` object.
16 tests, `it.each` over whatever it finds.

⛔ The admin route `/api/v1/campaigns` is deliberately exempt and the exemption
is itself asserted: `status` comes from the request body, the route is
`editor`/`admin` only, and **an admin choosing 'active' is the human review**.

⚠️ **The discovery had to strip comments first, and the first version did
not.** It found **six** inserts in four files — two of them prose, because the
comment explaining why that insert is no longer `status: 'active'` quotes both
spellings of the call — and then asserted that a paragraph of prose inserts
`under_review`. The original file had the mirror-image problem and documented
it (a raw-source match reports the *fix* as the defect). Both directions are
one hazard; stripping first covers both.

### Mutations, all killed

Revert the third path to `active`; re-stamp its `publishedAt`; revert the
publisher; revert the user route; **narrow the discovery regex to one spelling**;
**exempt the news pipeline the way the admin route is exempt**. The last two
are mutations of the *test*, which is the only way to show the discovery is
doing the work.

> ⚠️ **A process note worth keeping.** Restoring one of those mutations with
> `git checkout <test>` discarded the entire rewrite, because the file was
> tracked and the rewrite uncommitted. It was rewritten from scratch. Back up
> to a scratch copy, not to the index.

---

## 5. A processing rate nobody has ever been charged

### Current behaviour, cited

**13 sites in 10 files** said "Stripe charges 2.9% plus 30 cents", and several
then did the arithmetic: *"On a $50 donation that is $1.75, so the campaign
receives $48.25."*

Every part of that was wrong, and each part is independently checkable:

1. **[VERIFIED `docs/72`]** Stripe cannot take a payment here.
   `STRIPE_SECRET_KEY` on Fly is the `sk_test_…0000` placeholder, so
   `create-checkout` 500s for every campaign. **[VERIFIED `docs/92`]** Every
   donation ever collected came over M-Pesa.
2. **[VERIFIED `docs/92`]** That rate has never been charged to anybody here.
   The only fees ever incurred were PayHero's, and they are a **flat KES 8.9**
   against a published table that says KES 6 — which is also why a vendor's
   rate card is not evidence of what gets charged.
3. **[VERIFIED by reading all three writers] Nothing deducts a processing fee
   from a payout at all:**
   - `create-checkout` sets `unit_amount: data.amount`, no `application_fee`,
     no fee line item (already pinned by `src/app/fee-claims.test.ts`);
   - `payment-service.ts:236` credits `raisedAmount + amount` — the **full**
     donation;
   - `withdraw/route.ts:341` computes
     `availableBalance = totalReleased − totalWithdrawn − pending`.

So the copy named a processor that could not process, quoted a fee nobody had
paid, and described a deduction no code performs — on a platform holding real
money. Per CLAUDE.md an unsubstantiated claim is a factual problem, not
microcopy.

### 5.1 The replacement invents no number

`docs/110` §10 left this open because the correct figure needs an owner
decision, and `docs/92` shows the live gateway's own published table
understating by 48%. **No substitute rate was introduced.** What remains is
only what is traceable: *we take 0%, and nothing is deducted from a donation.*

The homepage ledger (`WhereYourMoneyGoes`, `docs/59`) keeps its four rows and
its arithmetic is corrected — `$50.00 in, −$0.00, −$0.00, $50.00 reaches the
campaign` — with both zeros **computed, not typed**, so the total cannot drift
from the rows. The section is not redesigned.

Also corrected:

- **"Secured by Stripe"** in the footer of every page, and **"Stripe secured"**
  beside the donate button → they now name the **property**, not a vendor.
  Traced: the card rail uses `ui_mode: 'embedded'` Checkout
  (`create-checkout/route.ts:239`), whose fields sit in the processor's own
  iframe, and the M-Pesa rail takes a phone number with the PIN entered on the
  handset. Neither puts a card number on our servers.
- **The campaign meta description** said "standard Stripe processing fees
  apply" — a **search engines republish this** surface.
- **`/transparency`'s fee row had the single word "Stripe" as its value**, where
  the row's question is how much comes out of the gift. Now `0%`.
- **"This is handled securely by Stripe"** on the verification screen →
  **[VERIFIED]** that button calls `/api/v1/verification/identity/session`,
  which creates a **Didit** session (`docs/81` replaced Stripe Identity
  precisely because it could never run on the same dead key). The one screen
  where an organiser hands over their ID named the wrong company. It now names
  no company, because the provider has already changed once and a vendor name
  there goes stale silently. Same in two emails.

### 5.2 A stale test was holding the claim in place

`DonationForm.ledger.test.tsx` asserted `/2\.9% \+ \$0\.30/` and *"comes out
of the payout, not your card"* — the `docs/109` shape again. Replaced with the
property its own file header asks for (a fee line that cannot silently stop
saying $0.00) plus the absence of any rate. 2 mutations killed.

### 5.3 ⛔ Reported, NOT changed — three areas

1. **Who bears the processing fee, as policy.** The code says the platform
   does, on both rails. Whether that is the standing commitment is the owner's
   to state.
2. **The Stripe Connect payout copy** (`PayoutSettingsClient`,
   `/fund-release-policy`, `/campaign-verification-policy`,
   `/donor-faq`'s payout answer). That out-rail is implemented, and
   **[VERIFIED `docs/113`]** has never moved money: 0 withdrawals, 0 Connect
   accounts. Rewriting it is bound up with the open question of whether Stripe
   Connect is the out-rail at all.
3. **The privacy policy, terms and refund policy.** Naming a sub-processor
   there is a **compliance disclosure**; removing it would *reduce* disclosure.
   Deliberately untouched.

All three are in the guard's allowlist, and the allowlist is documented at the
call site rather than left as a bare list.

### Checks

`src/app/fee-claims.test.ts` grew from 8 to 14 tests:

- no percent-plus-fixed rate, no "30 cents"/"30c", no "<processor> charges"
  anywhere in `src/` (comments stripped);
- **a positive assertion** that the 0% disclosure still exists, so the rules
  cannot be satisfied by deleting the fee section;
- no processor name outside the allowlist, **plus a check that the allowlist
  does not swallow the public pages** — if it ever covered everything the rule
  would be vacuous.

5 mutations killed: restore the footer badge, restore the FAQ rate, make the
ledger's processing row non-zero, restore the meta description, re-add Stripe
to the verification screen.

---

## 6. Five money settings that nothing read

### Current behaviour, cited

`donation.min_amount`, `donation.max_amount`, `donation.preset_amounts`,
`campaign.min_goal` and `campaign.max_goal` were stored, rendered with an
editable input, and **cross-validated against each other** in the settings
route.

**[VERIFIED by enumerating every `getSetting()` call — all of which pass
literal keys — and every `getAllSettings()` consumer]** no money path read any
of them. They were also the only `inputType: 'cents'` settings, and being
currency-less they rendered with a dollar sign they had no claim to.

The real bounds are per currency in `CURRENCIES`, which is where they must be:
one platform-wide integer cannot express a floor for both USD and KES, since
500 minor units is US$5.00 *or* KES 5.00.

### 6.3 Why removal deletes nothing

⛔ **No production row was deleted, and none needs to be.** `getAllSettings()`
keeps `if (row.key in SETTING_DEFAULTS)` (`settings.server.ts:54`), so a row
stored under a removed key is **ignored** rather than crashing a read or
leaking into the map — and `updateSettings` filters the same way, so it cannot
be written again.

That is the half worth testing against a real database: a type-level check
cannot see a row that is already there.

### Checks

`settings.removed-money-keys.integration.test.ts`: 6 tests, including
inserting rows for all five removed keys and asserting `getAllSettings()`
neither surfaces them nor throws, and that a kept setting still round-trips.
The `inputType: 'cents'` union member is asserted **unused** rather than
deleted, so whoever adds the next money setting meets the rule instead of a
compile error.

---

## 7. Results, as they are

```
npm run lint              clean (1 pre-existing warning in review-gate.test.ts,
                          an unused `table` arg; not touched here)
npm run typecheck         0 errors
npm run test:unit         7508 passed | 16 skipped  (250 files)
npm run test:integration  237 passed (25 files)
```

Integration run against a throwaway Postgres 16 on `127.0.0.1:54329`,
database `ldfix`, freshly migrated. **[VERIFIED]** never production — `docs/98`.

⚠️ **`npm run test:unit | tail` exits 0 even when a test fails**, because the
pipeline's status is `tail`'s. The first full run here reported `exit code 0`
with one failure in it. Redirect to a file and read `$?`.

### What was NOT checked

- **Nothing against production.** Both Supabase pooler ports time out from the
  sandbox. The §4 question — whether the ungated path ever fired — is open and
  answerable only from the live database.
- **No browser.** `docs/115` verified its currency sweep in a real browser;
  this pass did not re-run it. The visual surfaces changed here are copy and
  the homepage ledger's two zeros. The `DonorSegmentation` currency selector
  is **unverified in a browser** — tsc and lint only.
- **No E2E run.** None of the touched specs are in `e2e/`, but
  `/campaigns/[slug]`, `/donate`, `/compare`, `/how-it-works` and the footer
  all changed copy, and an E2E assertion on any removed sentence would fail.
- **`npm run build` was not run.** Typecheck passed; a build was not attempted.
- **The admin `CampaignEditor`** was not given a currency field (§3.4), so the
  admin create route's new `currency` parameter is API-only too.
- **The news pipeline's goal computation** is still USD-shaped
  (`goalAmountCents`, `computeStartingGoal`). It now inserts
  `currency: DEFAULT_CURRENCY` explicitly rather than by omission, which makes
  the assumption visible; it does not make that path multi-currency.
