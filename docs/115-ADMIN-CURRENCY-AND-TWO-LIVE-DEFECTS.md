# 115 — The admin currency sweep, and two live defects found on the way

**Status:** admin done and browser-verified; two public/donor-facing defects
fixed; ⛔ five findings reported and NOT fixed (§7).
**Date:** 2026-10-26. Follows `docs/114`, which did the 23 user-facing surfaces.
**Read with:** `docs/92` (one currency per campaign), `docs/88` F4/F5 (the
admin's five formatters), `docs/107` (an admin query no test runs).

---

## 0. Corrections to `docs/114`, first

Two numbers in the previous doc were wrong, and both were wrong because I
counted a list without filtering it.

| `docs/114` said | Actually |
|---|---|
| "20 admin components, 46 call sites" (§9.1, and the CLAUDE.md index) | **17 files, 44 `centsToDollars` call sites.** The 20/46 counted `lib/utils/currency.ts` (the definition) and `DonationForm.tsx` (not admin) in the file list, and summed wrongly. |
| "six hand-rolled formatters" (§4) | `centsToDollars` is the shared helper; on top of it there were **five local `formatCents` wrappers** (`email-adaptive`, `email-templates`, `SystemSettings`, `SimulationAnalytics`, `FundPoolManager`), two of which hardcoded USD outright. |

⚠️ The 44 also **undercounted the render sites**: four admin files called a
local `formatCents` wrapper, so a sweep counting `centsToDollars(` missed
those call sites entirely. The true figure is 44 direct + 10 through
wrappers.

---

## 1. Two live defects, found while taking the admin inventory

Neither was in the admin. Both are more severe than what I was asked to fix,
so they were fixed first.

### 1.1 `/campaigns` "Load more" rendered every appended card in dollars

[VERIFIED, reproduced in a browser on an all-KES fixture]

| | cards | rendered as |
|---|---|---|
| First page (server-rendered) | 12 | **0 dollars** — `Ksh 18,400` |
| Appended by one click (`/api/v1/campaigns`) | 5 | **5 of 5 dollars** — `$12,350` |

Same campaigns, same rows, one click apart.

**Root cause, three independent confirmations:**
1. `src/app/api/v1/campaigns/route.ts:73-88` — the select had no `currency`
   (zero occurrences of the word in the file).
2. The **production** payload confirms it: the live endpoint's keys contain
   no `currency`.
3. `src/components/campaign/CampaignGrid.tsx:79` — `(json.data as
   CampaignData[])`, an **unchecked cast**, which is why the compiler never
   objected although line 18 requires the field. At runtime it was
   `undefined`, and `<Money>`'s `currency` prop defaults to USD.

**The fix is not just the field.** `campaigns-listing-shape.test.ts` derives
the required keys from `CampaignGrid`'s own interface and the selected keys
from the route, then asserts the second covers the first — so the NEXT field
to go missing fails too. Proven by two mutations: removing `currency`, and
adding a new required field to the consumer.

### 1.2 The campaign-update digest told donors a shilling total in dollars

[VERIFIED by rendering the real template, not by reading it]

An organiser posts an update → `notifyCampaignUpdateDigest` →
**every subscribed donor** is emailed. For a KES campaign the body read:

```
$18400.00 of $50000.00 raised (37%)
```

where the campaign had raised KES 18,400.00 of KES 50,000.00. Three faults
in one line: the symbol, no thousands separator, and a hardcoded `/100` that
understates a zero-decimal currency 100x (`docs/103`).

**Root cause:** `src/lib/email-adaptive.ts:108` was
`` formatCents(cents) => `$${(cents / 100).toFixed(2)}` `` — no currency
parameter — used at **28 sites across nine templates**.

⚠️ **My first reading of this was wrong and I corrected it before acting.**
I believed donation *receipts* were going out in dollars. They were not:
`notifyAdaptiveDonationReceipt` has **zero callers**, and the entire live
PayHero path (4 files) contains no `notify*` or email call at all. Eight of
the nine templates are unreachable; the digest is the only live one. Stating
the severity before running that check would have been a false alarm.

**The fix made `currency` REQUIRED** on `formatCents`, so the compiler
enumerated all 28 sites rather than me guessing at them — it surfaced 32
errors and walked them out to the two live routes. A default is what let 28
call sites inherit dollars without anyone choosing it.

⛔ **Three of the 28 were deleted rather than converted.** They printed a
donor's LIFETIME total (`donorContext.totalDonatedCents`) — see §3, that
figure is in no currency at all, so passing it the campaign's currency would
have *introduced* a false claim.

---

## 2. The admin sweep

**17 files, 44 direct call sites plus 10 through local wrappers. All gone.**
Verified in a real browser on an all-KES fixture, signed in as an admin:

```
14 admin routes · 0 dollar figures · Ksh throughout
/admin  /admin/reports  /admin/campaigns  /admin/donations  /admin/users
/admin/verification  /admin/governance  /admin/payouts  /admin/simulation
/admin/simulation/analytics  /admin/simulation/fund-pool  /admin/settings
/admin/refunds  /admin/audit-log
```

⚠️ **Three of those screens were empty on the first pass and proved
nothing**, so the fixture was extended until each rendered money: a fund-pool
allocation, a refund batch, and a campaign moved into the verification queue
(`submitted_for_review`). A route measured with no data is not a measurement.

The work split in two, and the distinction is the whole thing:

**Per-row figures** (campaign, donation, withdrawal) — the currency was
always one column away and simply not selected. Mechanical.

**Cross-currency aggregates** — ten `SUM(donations.amount)` with no currency
in the GROUP BY. [VERIFIED] **14 of the 15 admin pages that render money
contained no mention of `currency` at all.** These needed their *queries*
changed, not their rendering, and now go through
`src/lib/admin/donation-totals.server.ts` — a module, because `docs/107` §7
records that **no admin page's data query is executed by any test**. It has
13 integration tests against real Postgres; four mutations killed.

`getReportPeriods` returns **one row per currency** and still issues ONE
query — the `GROUP BY` was added without a round trip, so the `docs/87`
fan-out budget is unchanged. `/admin/reports` renders one report section per
currency; with a single currency it looks exactly as before.

---

## 3. `users.total_donated` cannot be rendered in any currency

[VERIFIED from the live schema] It is a single `integer` column with **no
currency dimension**, written only by `payment-service.ts:307` as
`total_donated + amount` — whatever rail the donation came over. A donor who
gives KES 5,000 and US$50 ends up with `505000`: a number in neither
currency. Three admin screens printed it with a dollar sign, and a fourth
used it in email.

Falsification run: no per-currency aggregate table exists anywhere
(`information_schema` has only `users.total_donated`,
`campaigns.total_released_amount`, `campaigns.total_withdrawn_amount`,
`refund_batches.total_amount`).

So the figure is **recomputed from `donations`**, grouped by (user, currency)
— one query for a 200-row list, not 200 (`donorTotalsForUsers`), and an
email-keyed companion for guest donors who have no `users` row at all.

⚠️ `UsersList` also **sorted** by that column. Amounts in different
currencies are not orderable without a rate, and `docs/102` forbids a rate
deciding anything but display — so the column now orders by donation
**count**, the one figure that is comparable.

---

## 4. What is legitimately in dollars, and how that was established

Not everything with a `$` was wrong. Each of these was traced before being
left alone:

- **`campaign_withdrawals.amount`** — always USD, because
  `withdraw/route.ts:196` **refuses** any campaign whose currency is not USD.
- **`PipelineMonitor`** — AI spend, billed in dollars to four decimal places.
  Running it through a cents renderer would be wrong, not consistent.
- **`DonationForm`** — the Stripe branch, reached only when
  `getCurrency(c).gateway !== 'payhero'`, and USD is the only Stripe
  currency (`docs/114` §6 tripwires this).

⚠️ And one that was traced in the *opposite* direction: `payout.ts`'s header
says `campaigns.total_released_amount` is "USD cents throughout". It is not —
both writers clamp it to `raised_amount`, and the live schema has
`campaigns_released_lte_raised CHECK (total_released_amount <= raised_amount)`.
It is in the **campaign's** currency, which confirms the `docs/114` fix that
rendered it that way.

---

## 5. The ratchet now checks the property, not the symptom

`docs/88` F4/F5 made the admin use ONE renderer. That renderer was
`centsToDollars`, which hardcodes USD — so the screens became **consistent
and stayed wrong**. The ratchet enforced consistency and could never have
caught this.

It now also asserts: no `centsToDollars` in admin, no hardcoded `currency:
'XXX'` in an `Intl` formatter, and **every `<Money>` is given a currency**.
All three proven by injection.

⚠️ **That third rule immediately caught nine misses in my own sweep** —
`<Money minor={...} />` tags in `GovernancePanel` and `PayoutsDashboard` that
were never `centsToDollars`, so a symptom-based sweep never saw them.

⚠️ **A file-level exemption hid a second code path.** `SystemSettings` was
exempt because "its `CentsInput` is an editable field, and a form input must
hold a bare numeric string" — true, and that input is untouched. But the same
file had a read-only `DisplayValue` using
`Intl.NumberFormat('en-US', { currency: 'USD' })`, which the exemption never
justified. The exemption is now narrowed to the divide-by-100 rule alone.
**Exempt the narrowest thing you can.**

---

## 6. Three things that cost me time, recorded so they don't cost it twice

- ⚠️ **A duplicate key in an object literal silently wins.** `addDonation` in
  `report-periods.integration.test.ts` already ended with `currency: 'USD'`;
  I added `currency: opts.currency ?? 'USD'` earlier in the same object, and
  the later one took precedence, so the fixture ignored its own argument and
  the composite FK rejected the insert. **tsc reports this as `TS1117`** — I
  went to the database before running the type checker, and then wrongly
  claimed tsc was silent about it. One typecheck would have said so.
- ⚠️ **No backticks inside a `sql\`` template.** A markdown-style
  `` `docs/92` `` in a SQL comment terminates the JS template literal. It
  fails as `TS1005 ',' expected`, which does not point at the comment.
- ⚠️ **A screenshot caught a regression no test did.** Rewiring
  `/admin/reports`' category query I dropped `count(distinct campaigns.id)`
  and hardcoded `campaigns: 0`, so the table reported "Campaigns: 0" for
  every category while the revenue beside it was right. Typecheck, 7,485
  unit tests and the admin sweep (which counts currency symbols, not
  values) all passed. **A figure that is always zero reads as an empty
  platform, not as a bug** - which is why the sweep could not see it. Fixed,
  and now covered by an integration test proven by mutation.
- ⚠️ **`formatMoney` emits a NON-BREAKING space** (U+00A0). Asserting
  `'Ksh 18,400.00'` with an ordinary space against raw HTML fails;
  `testing-library` normalises whitespace, which is why component assertions
  elsewhere never had to notice.

---

## 7. ⛔ Reported and NOT fixed

1. **The donor segmentation thresholds still compare a currency-blind
   figure.** `major_donors` is `totalDonated >= 50000` — so somebody who gave
   KES 50,000 (about US$385) is classified by a US dollar rule. The
   *display* is fixed; redefining what "major donor" means is a product
   decision.
2. **`fund-pool/allocate` does not check that the target campaign shares the
   source campaign's currency.** [VERIFIED] It validates allocation ids and
   status only. ⚠️ Severity traced before claiming it: allocations are
   inserted only behind `campaign.simulationFlag`
   (`payment-service.ts:335`), and disbursing one flips a status and writes
   an audit row **without crediting any campaign** — so this is a reporting
   defect, not a payment one. It would become a payment one the moment
   disbursement credits a balance.
3. **The admin campaign editor cannot set a currency.**
   `CreateCampaignInput` carries none, so every campaign created in `/admin`
   takes the database default (USD). Editing a KES campaign now *displays*
   correctly; choosing a currency on creation does not exist.
4. **Four `inputType: 'cents'` settings are inert.** [VERIFIED]
   `donation.min_amount`, `donation.max_amount`, `campaign.min_goal` and
   `campaign.max_goal` are read by nothing but the settings route's own
   min-below-max validation. No money path reads them — the real bounds are
   `CURRENCIES[code].minDonationMinor` (`docs/98`). They now display in minor
   units with no invented symbol, but they should probably be removed.
5. **The `docs/110` §10 Stripe claim**, unchanged from `docs/114` §9.2: 32
   user-facing files name Stripe as the processor on a platform whose only
   money arrived over M-Pesa. Owner decision.

---

## 8. Test counts, as run

| Suite | Result |
|---|---|
| `npm run lint` | clean (1 pre-existing warning in an untouched test file) |
| `npm run typecheck` | clean |
| `npm run test:unit` | **7,485 passed / 16 skipped / 0 failed**, 249 files |
| `npm run test:integration` | **212 passed / 0 failed**, 21 files, fresh database |
| admin browser sweep | 14 routes, **0 dollar figures** (three screens were empty on the first pass and were seeded until they rendered money) |
| `/campaigns` load-more | 12 + 5 cards, **0 dollars** (was 5 of 5) |

**Mutations run and killed:** 2 on the listing-shape check, 3 on the email
currency fix, 5 on the admin aggregates module, 3 on the admin ratchet's new
rules. None survived.

---

## 9. ⛔ What was NOT checked

- **Production was unreachable.** Both Supabase pooler ports (5432 and 6543)
  time out from this sandbox, so I could not query live data. Whether any
  production campaign has subscribed donors — which decides whether the
  §1.2 email has actually been *sent* wrongly, as opposed to being able to
  be — is **[UNKNOWN]**. The public API confirmed 14 active campaigns and
  that `stripe` reports `error` while `payhero` reports `ok`.
- **No admin screen's data query is executed by an E2E test**, and the browser
  sweep is a scratchpad harness, not a spec. `docs/107` §7 is unchanged: the
  only automated coverage of these queries is the new integration module.
- **The eight dead email templates were not otherwise reviewed.** They now
  take a currency and render it, but their copy has not been through the
  `docs/94` plain-language pass as living templates, because nothing sends
  them.
