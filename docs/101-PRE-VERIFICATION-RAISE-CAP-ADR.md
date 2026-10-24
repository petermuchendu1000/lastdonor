# 101 — The pre-verification fundraising cap

**Date:** 2026-10-24
**Status:** Implemented, not deployed (deployment is manual and the owner runs it).
**Supersedes nothing. Amends nothing. Does NOT change the review gate of docs/78–79.**

---

## 1. What was decided

An **unverified campaign may raise up to a per-currency cap**, and must be
verified to go past it. The cap is enforced on every money-in route before the
payment provider is asked for anything, and a donor-facing badge on the
campaign page states the ceiling and that no payout can happen yet.

| Currency | Cap (minor units) | Human |
|---|---|---|
| USD | `50_000` | US$500.00 |
| KES | `5_000_000` | KES 50,000.00 |

Exempt states are exactly `identity_verified` and `fully_verified` — the two an
admin approval can produce (`approve_t1` / `approve_t2`,
`src/components/admin/VerificationQueue.tsx:287-288`). **[VERIFIED]**

## 2. What this deliberately does NOT do

The owner's brief described a "freemium trust model" in which campaigns also go
**live instantly** instead of waiting for review. **That half was explicitly
declined by the owner on 2026-10-24: "keep the review gate, ship Part A only."**

The reason it was put to the owner rather than built: instant go-live would
falsify **44 non-test lines across 23 files** that assert pre-publication
review **[VERIFIED by grep, 2026-10-24]** — including the site title itself
(*"LastDonor – Reviewed Crowdfunding Platform"*, `src/app/layout.tsx:68,170`),
the Organization JSON-LD, the `/compare` table against GoFundMe
(`src/app/compare/page.tsx:155`), and the line shown at the point of payment
(`src/components/campaign/DonationForm.tsx:1168`). CLAUDE.md: *never add a
claim the platform cannot substantiate.* `docs/78` and `docs/79` made that
claim true; nothing here reopens it.

So campaign creation still inserts `status: 'under_review'` with
`publishedAt: null` (`src/app/api/v1/user-campaigns/route.ts:184,190`), both
insert paths remain gated, and the two gate ratchets are untouched.

## 3. The exposure this closes

Money **out** has always been gated on verification: the withdrawal handler
refuses anything but `fully_verified`, re-read under a row lock
(`src/app/api/v1/user-campaigns/[id]/withdraw/route.ts:272`), and
`createTransfer` has **exactly one caller**, that handler
**[VERIFIED — enumerated every export of `src/lib/stripe-connect.ts` and
searched for callers, 2026-10-24]**.

Money **in** was gated on campaign *status* only, never on verification:

- `create-checkout/route.ts:61` — `eq(campaigns.status,'active')`
- `create-intent/route.ts:45` — same
- `payhero/initiate/route.ts:112` — `active OR last_donor_zone`

So an unverified campaign could raise an unbounded amount and only discover at
payout that it could not be paid. Production on 2026-10-24 **[VERIFIED by
query]**: 20 campaigns, **every one `verification_status = 'unverified'`**, 13
of them `active`.

Severity was bounded by an unrelated outage rather than by design: all 13
active campaigns are USD, and `CURRENCIES.USD.gateway` is `'stripe'`
(`src/lib/money/currencies.ts:100`), which is the dead placeholder key of
`docs/72`. The KES/PayHero rail works. **[VERIFIED]**

## 4. The figure is measured over REAL donations, never `raised_amount`

`campaigns.raised_amount` is **blended**: the simulation engine increments it
for `source = 'seed'` rows that carry no money
(`src/lib/seed/simulation-engine.ts:282`). A cap read off that column would let
fabricated money consume a real campaign's headroom and lock out donors trying
to give actual money.

This is the mirror image of a bug the release path already had and fixed —
releasing the blended column once meant a campaign showing $40,000, of which
$38,000 was seeded, released $40,000 of real platform money
(`src/app/api/v1/admin/campaigns/[campaignId]/verification/route.ts:166-172`).

So the cap reads `SUM(donations.amount) WHERE source = 'real' AND refunded =
false`, in **one** expression (`src/db/real-raised.ts`) shared by all three
routes and by the test that proves it. It is a correlated scalar subquery
inside a SELECT each route already issues, so it costs no extra round trip and
adds nothing to the 3-concurrent-query budget of
`src/db/pool-fanout.ratchet.test.ts`.

## 5. ⚠ The trap: drizzle renders interpolated columns UNQUALIFIED

**[VERIFIED against Postgres 16.15, 2026-10-24.]** This is the most
transferable finding in this change.

The obvious way to write the subquery:

```ts
sql`... FROM ${donations} WHERE ${donations.campaignId} = ${campaigns.id}`
```

generates:

```sql
WHERE "campaign_id" = "id"
```

Inside the subquery only `donations` is in scope, so **both names resolve to
it** and the predicate becomes `donations.campaign_id = donations.id` — never
true. The query is valid SQL, raises no error, and returns **0 for every
campaign**, so the cap silently never fires and every campaign appears to have
full headroom.

`alias()` does not fix it: it renders `FROM "rd"` while still emitting
unqualified column names, so the subquery fails with
`relation "rd" does not exist`.

The fix is explicit qualification with identifiers **derived from the schema
objects** (`getTableName(table)`, `column.name`) rather than string literals,
so a rename cannot strand the file.

**How it was caught matters more than the fix.** Unit tests on the cap
arithmetic passed. The ratchet grepping the route files passed. Typecheck
passed. Only running the expression against a real database failed — 5 of 8
assertions, every one that expected a non-zero sum. A text ratchet over SQL
proves the text, not the semantics. `src/db/real-raised.integration.test.ts`
exists for exactly this and nothing else.

## 6. Enforced before collection — and the bound that leaves

The cap is decided **before** the provider is called, because that is the last
moment at which refusing costs the donor nothing. By the time
`payment-service.ts:236` settles, M-Pesa or Stripe has already taken the money;
refusing there would mean refunding, which moves money and burns the flat
KES 8.9 collection fee the platform absorbs (`docs/92`).

**The consequence is accepted, not solved:** `checkRaiseCap` is a pure function
of a figure read a moment earlier, so two donors in flight at once can both be
told yes. **The overshoot is bounded by (concurrent in-flight donations ×
`maxDonationMinor`) and is not zero.** Two tests in
`src/lib/campaign-raise-cap.test.ts` encode this on purpose, under the heading
*"the concurrency bound, stated rather than assumed"*, so that nobody later
reads the other tests as proof of atomicity.

Closing it would need either headroom reserved at initiate (a new row and a
new expiry path) or auto-refunding the overage. **Auto-refunding moves money,
so it is the owner's call and was not taken.**

## 7. Cap values are chosen per currency, not converted

There is **no FX conversion anywhere in this codebase** **[VERIFIED by search,
2026-10-24]**, and two existing comments say why that is deliberate: a
cross-currency figure rendered with the wrong symbol *"is not a formatting slip
— it is a wrong figure, off by the exchange rate"*
(`src/lib/services/payment-service.ts:521`, `src/lib/email-templates.ts:49`).

So the two caps are two independent policy numbers that happen to be the same
order of magnitude. **The KES figure is an assumption, not a derivation**: it
was chosen as a round harambee-scale amount, NOT as US$500 at any rate, because
baking a moving rate into a constant would be wrong the day after it is
written. It is one line to change.

Invariants checked, with the arithmetic:

- `cap > minDonationMinor` for every currency, or the campaign would be shut to
  donations from its first shilling. USD 50,000 > 500 ✓. KES 5,000,000 > 5,000 ✓.
  Asserted as a property test over all of `CURRENCIES`.
- `maxDonationMinor > cap` in both currencies — USD by **200×** — so a *single*
  donation can exceed the cap. The check therefore rejects a donation that
  would **cross** the cap, not merely one offered after it is full. A check
  written `realRaised < cap` would wave the 200× donation through; a mutation
  test covers exactly that.
- `cap < goal_amount` is normal and intended. While unverified a campaign
  cannot reach its goal, so the completion branch
  (`payment-service.ts:259`, `newRaised >= goalAmount`) never fires and no
  completion email is sent. That is the desired behaviour, recorded here
  because it is surprising.
- Headroom below `minDonationMinor` is reported as `CAP_REACHED`, not
  `CAP_EXCEEDED`. Telling a donor "you can still give KES 30" when the floor is
  KES 50 offers an amount the validator then rejects, which reads as the site
  contradicting itself.

## 8. Rejected alternatives

- **A database CHECK constraint on `raised_amount`.** Rejected: the constraint
  cannot see `verification_status` changing, cannot be per-currency without
  repeating the currency table in SQL, and `migrations-v2/0005` already removed
  a USD-literal money CHECK for precisely this reason (`docs/98`).
- **Capping inside `payment-service.ts`** (the single settlement writer).
  Rejected: the money is already taken by then, so the cap would be enforced by
  refunding. §6.
- **Measuring the cap on `campaigns.raised_amount`.** Rejected: blended with
  seed money. §4.
- **Adding `unverified` to `VERIFICATION_CONFIG`** so the existing
  `VerificationBadge` renders it. Rejected: that map's only callers are two
  admin screens, so it would have put a new badge on every row of two admin
  tables as a side effect of a donor-facing change. A separate
  `PendingVerificationBadge` also says something a status badge cannot — the
  *consequence*, which is what a donor needs.
- **Converting the USD cap into KES.** Rejected. §7.
- **Instant go-live.** Declined by the owner. §2.

## 9. Rollback

Set `unverifiedCapMinor: Infinity` for a currency in
`src/lib/money/currencies.ts`. `checkRaiseCap` returns `allowed` for a
non-finite cap, which is tested. One line, no migration, no data change —
there is no schema change in this work at all.

To remove the badge, delete the `<PendingVerificationBadge>` element from
`src/app/campaigns/[slug]/page.tsx`.

## 10. Verification record

| Check | Result |
|---|---|
| `npm run lint` | exit 0 (1 pre-existing warning in `review-gate.test.ts`) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **6397 passed / 6 skipped**, 197 files (was 6345 / 194) |
| `npm run test:integration` | **91 passed**, 12 files (was 83 / 11), throwaway PG 16.15 |
| Mutation test, cap arithmetic | **6 mutants, 6 killed** |
| Mutation test, badge | **2 mutants, 2 killed** |
| Ratchet injection | guard removed → 3 fail; **new uncapped route added → 4 fail** |
| Ratchet injection | unqualified SQL spelling restored → 1 fail |

The ratchet discovers money-in routes **from disk** by looking for
charge-creating calls (`stripe.checkout.sessions.create`,
`stripe.paymentIntents.create`, `initiateStkPush`), so a fourth collection
route added later without the cap fails the build. That was proven by adding
one. `stripe.paymentIntents.retrieve` is deliberately not in that list — the
webhook retrieves an already-settled intent, which is settlement, not
collection.

## 11. Not checked / still open

- **Nothing was deployed.** Production still runs the image released as v95 on
  2026-10-24; this work is on a branch. Per CLAUDE.md the owner deploys.
- **No live donation was run against the cap.** The only working rail is
  KES/PayHero and exercising it means collecting real money. The cap's SQL is
  proven against a real Postgres; the cap's behaviour in a real M-Pesa flow is
  **[UNKNOWN]**.
- **The concurrency overshoot is open by decision**, not closed. §6.
- **`create-intent` still hardcodes `currency: 'usd'`** on the Stripe call
  (`route.ts:113`) while reading the campaign's real currency for the cap. That
  is a pre-existing defect, unrelated to this change, and was left alone rather
  than widening scope. It is unreachable today (Stripe's key is dead, `docs/72`)
  and no UI calls that route.
- **The badge is only on the campaign detail page**, not on cards in listings.
  Adding it to `CampaignCard` would change every listing and was not asked for.
- **`site_settings` is empty (0 rows)**, so the caps are constants in code
  rather than operator-editable. If they should be tunable without a deploy,
  that is a separate change.
