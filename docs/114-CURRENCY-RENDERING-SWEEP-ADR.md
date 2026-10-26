# 114 — The currency rendering sweep: every user-facing money figure

**Status:** done for the 23 user-facing surfaces; ⛔ the 20 admin components
are untouched and listed in §9.
**Date:** 2026-10-26.
**Read with:** `docs/92` (one currency per campaign), `docs/103` (known vs
collectable), `docs/107` (a query no test runs), `docs/110` §10 (the Stripe
fee claim, still an owner decision).

---

## 1. The finding, from the live site

[VERIFIED 2026-10-26] `https://lastdonor.org/transparency` published:

```
$100.00     Raised So Far
```

The production database, read in the same session, held:

```json
[{"currency": "KES", "n": "2", "total_minor": "10000"}]
```

That is **KES 100.00**, roughly **US$0.77**. The page overstated the
platform's entire lifetime fundraising by about **130x**, under a heading
promising it "publishes LastDonor statistics … in one place".

Two independent defects produced it, and both recur across the codebase:

1. **A cross-currency sum.** `SUM(donations.amount)` over the whole table,
   no grouping. `docs/92`: *two currencies are never added together … report
   per currency — never sum.*
2. **A hardcoded currency.** `centsToDollars` formats as dollars whatever
   the row holds.

⚠️ The digits were right. KES and USD share exponent 2, so every figure on
every screen was numerically correct and only the **symbol** lied. That is
why nothing caught it: no test compares a symbol to a column, and a reader
who does not know the platform's rail cannot tell.

---

## 2. What is NOT a defect, and why the distinction matters

Three shapes look identical to the one above and are correct. Stating them
so nobody "fixes" them:

- **A sum within one campaign.** `donations_campaign_currency_fk FOREIGN KEY
  (campaign_id, currency) REFERENCES campaigns (id, currency)` [read from the
  live schema] makes a campaign single-currency. Per campaign the sum is
  sound; per **donor**, per **sharer**, per **organiser** or platform-wide it
  is not, because a *person* is not single-currency.
- **`PLATFORM_PAYOUT_CURRENCY = 'usd'`** (`src/lib/validators/payout.ts:21`).
  The Stripe payout rail genuinely settles in dollars.
- **`DonationForm`** is genuinely a dollar form — §6.

---

## 3. What was built

Three modules, because `docs/107`'s rule applies: a query written inline in
a server component is a query no test runs, and logic written inline in a
component is logic no test runs.

| Module | Replaces | Tested by |
|---|---|---|
| `src/lib/donor-totals.server.ts` | the donor dashboard's blended sum | 6 integration tests, real Postgres |
| `src/lib/platform-totals.server.ts` | `/transparency`'s whole-table sum | 5 integration tests, real Postgres |
| `src/lib/dashboard-finance-totals.ts` | four `campaigns.reduce(…)` on the payout screen | 7 unit tests (pure) |
| `impactAmountsByCurrency` in `share-impact.ts` | `getImpactSummary`'s `amountBroughtCents` | 5 unit tests (pure) |

Each returns **one row per currency, biggest first, and `[]` when there is
nothing** — so a caller renders no tile rather than a zero in a currency the
person has never touched.

---

## 4. The six hand-rolled currency formatters

`docs/88` F4/F5 removed five from admin and established that `Money` /
`formatMoney` are the only renderers. Two more had grown since, both on
organiser money screens:

- `FinancesClient.tsx` — `fmt(cents) => '$' + (cents / 100).toLocaleString('en-US', …)`
- `PayoutSettingsClient.tsx` — a local `centsToDollars` with a literal
  `currency: 'USD'`

Both are gone. Both screens also had a withdrawal field with a literal `$`
prefix, `min`/`step` of `"0.01"` and `max={availableBalance / 100}`; those
now read the currency's own exponent through `minorToMajor`.

⛔ **And both withdraw handlers computed `Math.round(dollars * 100)`.** Right
by coincidence — KES and USD share exponent 2 — and **100x wrong** for a
zero-decimal currency (UGX, RWF, XOF, XAF are all in `WORLD_CURRENCY_EXPONENTS`,
`docs/103`). Now `majorToMinor(major, currency)`. This is the same mutation
survivor `docs/102` records fixing rather than excusing.

---

## 5. The bare `<Money>` — a default that reads as a decision

`Money`'s `currency` prop defaults to `'USD'`. Three components relied on
that default and were therefore wrong on every KES campaign:

- **`DonorFeed`** — the public campaign page's donor list. A KES 2,500.00
  gift rendered as **$2,500**. `donations.currency` exists for exactly this
  and was never read. Fixed in all four paths that feed it: the SSR query
  (`CampaignActivity`), the polling API, the campaign detail API, and the
  component.
- **`ImpactTiers`** — the campaign sidebar. ⚠️ The currency was **already in
  scope at the call site** and simply not passed; worse, the visible figure
  used the `<Money>` default while the `aria-label` was built by
  `centsToDollarsWhole`, so the two could disagree.
- **`ImpactLinkRow`** / `/dashboard/impact` — three bare calls.

All three now take `currency` as a **required** prop, following the call
`StickyMobileDonateBar` already makes: *required, not defaulted*. A default
is what turns "nobody passed it" into "somebody chose dollars".

---

## 6. `DonationForm` is legitimately in dollars, and that is now tripwired

`src/app/campaigns/[slug]/donate/client.tsx:248` picks the form by
**gateway**: `getCurrency(currency).gateway === 'payhero'` renders
`MpesaDonationForm` (which reads bounds, presets and symbol from the currency
registry); everything else renders `DonationForm`, which is dollars
throughout — a USD-cent preset ladder, impact hints keyed by USD cents, `$`
in its copy.

`CURRENCIES` holds exactly two entries — USD on `stripe`, KES on `payhero` —
so every campaign reaching `DonationForm` is a dollar campaign. Correct by
construction, **and silently false the moment a third collectable currency
lands on Stripe**: a euro campaign would render the dollar ladder with no
error anywhere, the shape `docs/112` describes ("the only non-USD campaign is
archived, so no reader has seen it yet").

`src/components/campaign/donation-form-usd-premise.test.ts` fails the build
at that moment. It asserts the **premise** (at most one Stripe currency, and
it is USD), not today's count — adding a third PayHero currency leaves it
green. ⛔ If it fails, do not widen it: rewrite the form to read its currency
as `MpesaDonationForm` does, or route the new currency to a form that can.
Its bounds are now read from `CURRENCIES.USD` rather than re-declared, so
they cannot drift from the server-side validator.

---

## 7. Two findings that are not currency bugs

**7.1 A fabricated statistic.** The congratulations screen read: *"On
average, each share can inspire $50 in donations."* This platform has taken
**two donations in its entire history** (KES 50 each, `docs/92`), so there is
no average to quote — and it was quoted in dollars on a shilling campaign.
CLAUDE.md: *never add a claim the platform cannot substantiate*; the same
rule under which `docs/67` removed five invented figures from outgoing mail
and `docs/94` another five. Replaced with a reason, not a different number.

**7.2 Dead code holding a currency bug.** `src/components/dashboard/
WithdrawalsClient.tsx` (135 lines) had **zero importers** anywhere in the
repository, and its only route — `/dashboard/withdrawals` — redirects to
`/dashboard/finances/payouts`. It contained two cross-currency `reduce` sums
and a hardcoded currency, waiting for somebody to wire it up. Deleted, the
`docs/88` F3 precedent; recoverable with
`git show <this commit>^:src/components/dashboard/WithdrawalsClient.tsx`.

**7.3 Two unguarded links.** `docs/109` requires `hasPublicPage` before any
link to `/campaigns/<slug>`. The donor's donation history linked there for
every row — and a campaign given to can since have been moved out of the
served statuses, as `docs/79` did to twelve live campaigns. The
congratulations screen had two more. All three now guarded.

---

## 8. How it was verified: a browser, on a KES-only fixture

A unit test cannot catch a wrong currency symbol, and neither can a grep.
The method:

1. A throwaway Postgres seeded so **every campaign is KES** — live, completed
   with a named last donor, cancelled with a reason, and under review — plus
   a donor with three attributed donations, a subscription, and a released
   balance on the live campaign.
2. `next build && next start` against it. **Not `next dev`**: our CSP blocks
   `unsafe-eval`, so no client component hydrates there (`docs/63`, `docs/64`).
3. Playwright signs in as the donor and as the organiser and reads
   `document.body.innerText` on 18 routes, counting money-shaped matches and
   splitting them into dollars and shillings.

On that fixture **a dollar sign anywhere is the defect**. Final result: **0
dollar figures on all 18 routes**, with one expected exception — the homepage
fee ledger (§9).

Four things that tripped the harness itself, each worth knowing:

- ⚠️ **`innerText`, not `page.content()`.** The HTML carries the RSC flight
  payload, where pre-fix strings still appear, so a naive grep over the
  source matches both the fixed and the broken version.
- ⚠️ **`input[type="email"]` is not the login field.** The footer newsletter
  input comes first in the DOM (the footer renders on `/login` — it is gated
  only on `/admin` and `/dashboard`, `docs/106`), and the login form is
  hydrated, so the server HTML holds exactly one email input and it is the
  wrong one. The first run reported "sign-in failed" for both users.
- ⚠️ **The fixture users were seeded without `PASSWORD_PEPPER`.** `hashPassword`
  falls back to bcrypt-only when it is unset, so hashes made by a bare
  `npx tsx` seed do not match a server that has the pepper. Sign-in failed
  with HTTP 200 on the credentials callback and a `null` session.
- ⚠️ **The congratulations screen is two phases.** Every money figure is
  behind a "Share fundraiser" button, so the first sweep reported
  `shillings=0` for it — the harness's blind spot, not a defect. *A route
  measured in one state tells you nothing about the state it spends its life
  in.*

---

## 9. ⛔ What is NOT fixed

**9.1 Twenty admin components, 46 call sites.** Worst first:
`FinancialReports` (14), `AdminDashboard` (6), `DonationsList` (4),
`CampaignDetail` (4), `PayoutsDashboard` (3), then fourteen files with one or
two each. Each needs the same per-site judgement made here — some are
genuinely platform-USD figures (`PLATFORM_PAYOUT_CURRENCY`), some are not.
Listed rather than swept in one commit for the reason the icon ratchet gives:
rewriting all of them at once is how migrations get abandoned.
⚠️ `PayoutsDashboard.tsx:147-151` also holds **cross-currency JS sums**, the
same shape as §3.

**9.2 The Stripe fee claim — `docs/110` §10, OWNER DECISION — and it is
bigger than that doc records.** The homepage's remaining dollars
(`$50.00 / $0.30 / $1.75 / $48.25`) are `WhereYourMoneyGoes`, a worked
example on Stripe's published US rate. [VERIFIED] exactly **10 non-test
user-facing files** quote `2.9%`, matching `docs/110`'s count.

⚠️ **The count that matters is not 10, it is 32.** [VERIFIED 2026-10-26 by
enumerating `.tsx` under `src/app` and `src/components`, excluding admin and
tests] **32 user-facing files name Stripe to a donor or an organiser** — the
22 that do not quote a rate still assert *who processes the payment*. Among
them:

- `src/components/layout/Footer.tsx:188` — **"Secured by Stripe", on every
  page of the site.** Its own comment defends keeping it because *"who holds
  the card details is a real question a donor has"* — reasoning written when
  Stripe was assumed to be the rail.
- `src/app/transparency/page.tsx` — *"Standard Stripe processing fees
  apply"* and *"Stripe charges its standard card processing fee"*, on the
  page whose stated job is publishing what is true about this platform.
- `src/app/campaigns/[slug]/donate/page.tsx` and `DonationForm.tsx:1137` —
  on the pay screen itself.

[VERIFIED, `docs/72`] Stripe answers `status: error` in production and has
never taken a payment here; [VERIFIED, `docs/92`] the only two donations in
the platform's history came over **M-Pesa through PayHero**. A Kenyan donor
paying by phone is told, on the page they pay from and in the footer of
every page they visit, that Stripe secures a card they never used.

CLAUDE.md: *trust copy is a factual assertion, not microcopy.* This is not a
currency-rendering defect and is **not fixed here**, because the replacement
wording is the same owner decision `docs/110` §10 is already waiting on —
and `docs/92` found PayHero's own published fee table to be wrong, so there
is no correct number to substitute yet. Recorded with the real count so the
decision is made against 32 surfaces and not 10.

**9.3 The preset donation ladder** is USD-denominated by design in
`DonationForm` (§6) and A/B-tested at GoFundMe, which `docs/72` records as
uncopyable. A product decision.

**9.4 `/dashboard/impact` remains a `docs/87` fan-out offender at 4
concurrent queries** against a pool of `max: 5`. This work deliberately did
**not** add a fifth: the per-currency figures are folded from rows the page
already fetches (`impactAmountsByCurrency`). The allowlist in
`pool-fanout.ratchet.test.ts` may only shrink, and paying a query for
arithmetic already in hand is the wrong trade.

**9.5 No admin page's data query is executed by any test** — `docs/107` §7,
unchanged. And the 18 routes swept here have **no automated regression**: the
sweep is a scratchpad harness, not a spec. Turning it into an E2E project
needs the signed-in fixture `docs/99` records as missing.

---

## 10. One mutation that survived, and what it taught

Gate 4 says a check that cannot fail is not a check. Every test added here
was proven by injection. One mutation **survived** and is recorded because
the lesson is general:

Adding `currency: donations.currency` to `getImpactSummary`'s `perLink`
subquery broke **no test**. `share-impact.test.ts` runs the real query
builder against a **stub driver**, so it asserts the SQL *text* and not
whether Postgres accepts it — and that statement groups by `share_link_id`,
so a bare currency column is a `must appear in the GROUP BY clause` error the
stub happily returns rows for.

Widening that subquery is exactly how `docs/58`'s two visit-count defects
arose, so the invariant is now pinned directly: the folded subquery must not
contain `currency`.

A second, smaller one: the first version of the `pendingRelease` flooring
test passed against a running `Math.max(0, total + raised - released)`,
because for that fixture the clamp fired on the first element either way.
**Reversed, the two diverge** (90,000 vs 20,000). The order was load-bearing
and only mutation testing showed it.

---

## 11. Test counts, as run

| Suite | Result |
|---|---|
| `npm run lint` | clean (1 pre-existing warning in `review-gate.test.ts`, untouched) |
| `npm run typecheck` | clean |
| `npm run test:unit` | **7,414 passed / 16 skipped / 0 failed**, 244 files |
| `npm run test:integration` | **197 passed / 0 failed**, 20 files, on a freshly migrated database |
| browser sweep | 18 routes, **0 dollar figures** outside §9.2 |

⚠️ One test had to be **corrected rather than satisfied**:
`instant-live-architecture.test.ts` asserted the congratulations client
*contains* `centsToDollars` — a stale assertion pinning the defect, in the
same file `docs/109` records for exactly this ("a test was holding it in
place"). It now asserts the fix, and is proven by three mutations at three
distinct lines.
