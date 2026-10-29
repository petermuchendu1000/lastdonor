# 147 — The general fund, on the rail that works

**Date:** 2026-10-29
**Status:** ✅ LIVE (v140, 2026-10-29). The fund exists and the M-Pesa rail accepts it; see §9.
**Owner decision:** option **B** of `docs/146` §9.1b — *"wire it with payhero"*,
plus general-fund CTAs across the pages.

---

## 1. What this closes

`docs/146` §9.1b found that `/donate` serves *"not accepting donations"* and
renders no form, because [VERIFIED from production]
`GENERAL_FUND_CAMPAIGN_ID` (`d7fcb01f-468a-49e1-848f-bee7377a35ea`) matches
**0 rows** — the general fund campaign has never existed. `docs/42` built that
fail-closed branch after the same id produced a form whose every submit
answered 404.

Creating the row was not a one-row change, and the reasons are the content of
this doc.

---

## 2. Why a row alone could not work [VERIFIED]

`/donate:167` hardcoded `<DonationForm>` — the **Stripe** form — and `:153`
told donors *"Donations are processed in U.S. dollars by Stripe."*

| probe | result |
|---|---|
| `POST /api/v1/donations/create-checkout` for a real active USD campaign | **503 `PAYMENTS_UNAVAILABLE`** |
| the same for the general fund id | **404 `NOT_FOUND`** (the control: the two outcomes are distinguishable) |

The 503 branch is emitted **only** on `StripeAuthenticationError`
(`create-checkout/route.ts:320-331`), so the card rail is dead, and
`:124-135` refuses any non-Stripe currency with **400 `WRONG_PAYMENT_RAIL`**.

So a **USD** fund would have shown a complete card form that answers 503 on
submit, and a **KES** fund would have shown that same dollar form for a
shilling campaign. Either way `/donate` got worse, which is what
`docs/146` §9.1b reported before doing anything.

The fund is therefore **KES**, collected over M-Pesa — the rail that has taken
real money (`docs/92`).

---

## 3. The decision: eligibility and listing are different questions

`payhero/initiate/route.ts:99-119` will only collect for a campaign that is
`active` or `last_donor_zone`. **So the fund must hold a listed status**, and
public surfaces were using that exact predicate to decide what to put in front
of a visitor. [VERIFIED] 17 files select active campaigns; **nine of them are
listings** and would have shown the platform's own fund as if it were a
family's appeal:

the homepage grid, the homepage category tally, `/campaigns` **and its "Active
N" count**, the category page, the listing API (which is what "Load more"
calls), search, `src/lib/blog/link-graph.ts`, `src/lib/utils/similar-campaigns.ts`,
the newsletter's featured campaign — plus `sitemap.ts`, which filters on
**status alone**, so with `published_at` NULL it would have advertised
`/campaigns/<fund slug>` to Google while the page requires that column
(`docs/131`) and answers 404.

`src/db/public-campaigns.ts` now holds the one predicate:

```ts
listedCampaignFilter() = and(or(active, last_donor_zone), notInArray(id, PLATFORM_FUND_CAMPAIGN_IDS))
```

⛔ **A per-site `ne(id, …)` was rejected.** That is the shape this codebase has
found broken four times — `docs/119` (`_hasCampaigns`), `docs/124` (the scrub
list), `docs/144` (`TOP_CATEGORIES`), `docs/146` (the completed pair) — always
because a hand-maintained list is only as good as whoever remembered to extend
it.

⚠️ **The nine eligibility sites keep the raw pair deliberately.** They ask
about ONE campaign the caller already named — may it take this donation, may it
be viewed — and the fund must answer **yes** to all of them. Putting the
listing filter there would make the fund unable to take the donation `/donate`
exists to collect. The ratchet names each with a reason.

### 3.1 A falsifier that held, and one that did not

- `similar-campaigns.ts:60` also requires `verificationStatus = 'fully_verified'`,
  so it already excluded the fund — **but by coincidence of the trust rule, not
  by a decision about listings**, and the coincidence disappears the day
  anybody verifies it. Converted anyway.
- The `/campaigns` **"Active N" count** was the sharper catch: `docs/146`'s
  invariant is that the predicate which COUNTS a group must be the one that
  LISTS it. Measured locally, the raw pair made the header read **15** over a
  list of 14.

---

## 4. The four defects found doing it

### 4.1 `MpesaDonationForm` hand-wrote two campaign links

`:261` and `:290` built `` `/campaigns/${campaignSlug}` `` — the link
`docs/118` forbids. The fund has **no public campaign page**, so reusing the
form as-is would have handed a donor a **404 immediately after their money
left their phone**. The prop is now `backTo: { href, label } | null`, resolved
by the caller with `publicCampaignPath`, and every screen keeps a way out.

⚠️ `MpesaDonationForm.test.tsx` had **no assertion about either link**, which
is why the prop change was invisible to the suite until `tsc` named the
fixture.

### 4.2 A third hand-written link, one line up the same flow

`campaigns/[slug]/donate/client.tsx:160` built the same literal for its header
"Back to campaign". Fixed with the same value, which cost one column:
`publishedAt` added to a select that already runs (`docs/87`, `docs/131`).

### 4.3 The rail sentence was prose

*"Donations are processed in U.S. dollars by Stripe"* is `docs/136` §7's defect
in another costume: prose that becomes false the day the thing it describes
changes. It is now derived from the fund's own currency through a
`RAIL_WORDS: Record<'stripe' | 'payhero', string>` map, so `tsc` names it the
day a third gateway exists.

### 4.4 `generalFundIsDonatable()` returned a boolean

A boolean cannot choose a rail. It returns `{ currency }` now, and the page
refuses outright for a currency the platform cannot collect — a real state,
since `WORLD_CURRENCY_EXPONENTS` knows 152 currencies and `CURRENCIES` can
collect two (`docs/103`).

---

## 5. The CTAs

[VERIFIED] `/donate` had **three** UI links before this: `Navbar.tsx:277`
(desktop bar), `:391` (mobile sheet — mounts only when opened) and
`transparency/page.tsx:185`. So the page that collects for the platform was
close to invisible, and absent from the only crawler-visible navigation
(`docs/143`).

Added: a **footer** link in the Platform group, and `<GeneralFundCta>` on
`/campaigns` (after the listing and its pagination), `/how-it-works` and
`/completed-campaigns`.

⛔ **The CTA names no payment method and no processor.** The rail is a property
of the fund's row, so a CTA that said "by M-Pesa" would have to read the
database on four pages — a query each, against `docs/87`'s cap of three per
entry point — and would be wrong the moment the currency changed. It says what
is true whatever the rail; `/donate` states the method where it matters. It
quotes no rate (`fee-claims.test.ts`, `docs/116` §5).

⛔ **Nothing was added above the listing or to the homepage.** `docs/71`
measured 486px of chrome before the first card on `/campaigns` and cut it;
`docs/59`-`61` tuned the homepage height budget. A general-fund band there
would spend those budgets on something the visitor did not come for.

### 5.1 A control I had to repoint, and did not weaken

`site-navigation-is-crawlable.test.ts` asserted `/donate` was in the navbar
**and not** in the footer — deliberately, to prove the rule is not "everything
must be in the footer". Adding the footer link broke it, and [VERIFIED by
computing the sets] **no claimed path is navbar-only any more**. The control
moved to the home link, which the navbar carries and `LINK_GROUPS` does not,
so its force — *is the navbar extractor really being read* — is unchanged.

---

## 6. ⛔ TWO LIMITS THE OWNER SHOULD KNOW, NEITHER OF THEM FIXED HERE

**6.1 The fund stops collecting at KES 50,000.** `verification_status`
defaults to `unverified` [VERIFIED from the live schema],
`CURRENCIES.KES.unverifiedCapMinor` is `5_000_000` = **KES 50,000**, and
`payhero/initiate:162-173` applies `checkRaiseCap`. Past that the route
answers **409**. There is no organiser whose ID could be checked, so the cap
does not clear itself.

⛔ **I did not write `verification_status`.** That column's writers are
enumerated on purpose (`docs/106`, `docs/108`: a vouch grants
`identity_verified` and nothing else, and `approve_t2` releases money in the
same transaction). Setting it by hand on the fund bypasses that enumeration
and is an owner decision, not an audit's side effect. KES 50,000 is roughly
250 gifts at the KES 200 preset, so it is headroom, not a blocker.

**6.2 A KES fund is M-Pesa only, and `layout.tsx:29` still claims
`areaServed: United States`.** Every CTA leads to a form that asks for a
Kenyan number. That tension is `docs/82`'s, parked at one constant, and it is
now visible on a page with four entry points rather than one.

---

## 7. Checks

- `src/db/public-campaigns.ratchet.test.ts` — 18 tests, four rules.
  Rule 1 is **absolute**: a public surface may not name the raw active status
  at all; the nine eligibility sites are named with reasons and this module is
  the one place the pair lives. Rule 2 fails on a **stale** allowlist entry and
  derives the money-in routes from disk. Rule 3 reads the **rendered** SQL
  (`PgDialect().sqlToQuery`, the `docs/130` habit). Rule 4 covers the sitemap,
  which has its own wider status set and so cannot use rule 1.
- `src/app/donate/page.test.tsx` — 8 tests: KES renders the M-Pesa form and no
  card form, USD the reverse, and an uncollectable currency is refused rather
  than guessed.

### 7.1 ⚠️ My own rule was too weak TWICE, each proven by an injection that did not fire

- **v1** asked whether the file `includes('listedCampaignFilter')`. Restoring
  the raw pair at a call site left the **import** behind, which satisfied it —
  `docs/146` §6.1's hole, in my own new test, the day after writing that doc.
- **v2** asked whether the file **calls** it. `campaigns/(index)/page.tsx`
  calls it **twice** (the rows query and the tab count), so regressing one of
  the two stayed green. A file-level question cannot see one regressed
  occurrence.

Hence the absolute rule. A fourth broken probe also appeared: my browser check
looked for `input[name="phone"]` when the field is `id="mpesa-phone"`, and
reported `0` M-Pesa fields on a page that had one.

### 7.2 Injection results

7 injections, sha256-verified clean restore after each:

```
BASELINE: 0 failing / 50 collected
PASS  1. a LISTING goes back to the raw status pair: 1 failed, matched 1/1
PASS  2. search goes back to the raw pair: 1 failed, matched 1/1
PASS  3. the sitemap stops excluding the fund: 2 failed, matched 1/1
PASS  4. the fund list is emptied (anti-vacuity): 4 failed, matched 3/3
PASS  5. /donate hardcodes the card rail again: 1 failed, matched 1/1
PASS  6. a stale eligibility entry names a file that does not filter: 1 failed, matched 1/1
PASS  7. CONTROL: a harmless export must fire nothing: 0 failed (expected 0)
FINAL CLEAN: 0 failing
```

### 7.3 Browser verification, paired, against a KES fund at the real id

A local fixture: 14 active USD campaigns plus the general fund at
`d7fcb01f-…`, KES, `active`, `published_at` NULL. The fund's fixture
`raised_amount` was then raised so it would rank **first** in the homepage's
top-six ordering — without that the homepage arm could not discriminate, and
saying it had been proven would have been false.

| | exclusion EMPTY (control) | exclusion in place (the fix) |
|---|---|---|
| homepage grid: fund card | **1** | **0** |
| `/campaigns`: fund card | **1** | **0** |
| `/campaigns`: "N active campaigns" | **15** | **14** |
| sitemap: fund URL | — | **0** (with 14 fixture campaign URLs as the control) |
| search `?q=general` | — | **0 campaigns** (with `?q=urgent` → 6 as the control) |
| `/donate`: `input#mpesa-phone` | — | **1**, no card element |
| `/donate`: "paid by M-Pesa" / "U.S. dollars by Stripe" | — | **true / false** |
| CTA on `/campaigns`, `/how-it-works`, `/completed-campaigns`, footer link | — | **present** |

Zero console errors on every page.

---

## 8. Gate

```
npm run lint              1 warning, pre-existing
npm run typecheck         clean
npm run test:unit         8043 passed | 16 skipped  (277 files passed | 3 skipped)
npm run test:integration  315 passed (33 files)
```

---

## 9. ✅ LIVE: v140, and the row

Deployed as **v140** (machine version 140, 1/1 checks, `payhero: ok`). The
exclusions shipped **first** and were confirmed serving - the CTA present on
`/campaigns` and `/how-it-works`, and *"U.S. dollars by Stripe"* absent - and
only then was the row inserted, so the fund was never listed for a minute.

⚠️ **Seven release attempts failed across the three deploys of 2026-10-29**:
`no capacity available in arn` six times and **`insufficient memory available
to fulfill request`** once, which is a second wording for the same thing. An
aborted release leaves production untouched (`docs/146` §9.1a), and the retry
loop's transient-failure match now covers both.

### 9.1 The row, read back after the insert

```
id=d7fcb01f-468a-49e1-848f-bee7377a35ea | slug=lastdonor-general-fund
status=active | currency=KES | goal_amount=10000000 | published_at=None
verification_status=unverified | category=charity | subject_name=LastDonor
created_at=2026-10-29 09:19:35Z
```

A pre-flight refused to run unless the row was absent (`n=0`), so the script
could not double-insert. `goal_amount` is `CURRENCIES.KES.minGoalMinor` -
KES 100,000, this project's own floor for a KES campaign. ⚠️ Note that the
raise cap is **half** that floor, so the fund cannot reach its own goal before
somebody verifies it; `docs/101` states that relationship deliberately
("the floor is 2x the pre-verification cap").

### 9.2 The M-Pesa rail accepts it - four probes, none of which pushes

Each stops at a check **before** PayHero is contacted, so no STK push rang a
real phone:

| probe | result |
|---|---|
| the fund, valid KES amount, deliberately invalid phone | **400 `VALIDATION_ERROR`** on `phone` - so it cleared the campaign lookup, the currency, the gateway, the amount AND the cap |
| the fund, KES 60,000 (over the cap) | **409 `CAP_EXCEEDED`**: *"can accept up to Ksh 50,000.00 before the organiser's ID is checked"* |
| **control**: a USD campaign on the M-Pesa route | **400 `WRONG_PAYMENT_RAIL`**: *"collected in USD, which is paid by card"* |
| **control**: the fund on the CARD route | **400 `WRONG_PAYMENT_RAIL`**: *"collected in KES, which is paid by mobile money"* |

That last control is the whole reason `/donate` had to stop rendering the card
form: `create-checkout` refuses this fund outright. The first probe answered
**404** twenty minutes earlier, which is the before-and-after.

### 9.3 The exclusions, against the live row

0 fund cards on `/campaigns` page 1, page 2 or the homepage; **12 + 2 = 14**
campaigns across both pages, unchanged from the pre-insert baseline;
`?q=general` returns 0 campaigns; the listing API returns 0; the sitemap's 14
campaign URLs do not include it.

### 9.4 Two things this doc had listed as unverified, now checked

- **`/campaigns/lastdonor-general-fund` answers 404** (its `published_at` is
  NULL - `docs/131`'s guard), with a real campaign 200 as the control. That is
  the designed state, and it is why `backTo` is `null`.
- **Its share card answers 200 `image/jpeg`, 38KB** - no 502. `probeHeroSrc`
  rendered the designed fallback for the webp hero rather than throwing
  mid-stream (`docs/112` §7), verified rather than assumed.

### 9.5 ⚠️ `/donate` took 5 minutes to change, and that is the ISR window

The first five reads after the insert answered `x-nextjs-cache: HIT` on the
**pre-insert** body, then one `STALE`, then `HIT` with the form. `revalidate`
is 300 and stale-while-revalidate serves the stale copy once while scheduling
the refresh - `docs/119`'s rule, met exactly. **A single read after a data
change on this page proves nothing.**

Final state, live, desktop and 390px: `input#mpesa-phone` present, the Ksh
50/100/200/500/1,000/2,000 ladder, a submit button, zero console errors, and
the "not accepting donations" notice gone.

⚠️ One cosmetic observation, not changed: the shared form renders a fee ledger
reading *"Your donation / LastDonor platform fee / Total charged today"*, all
`Ksh 0.00` before an amount is typed (present in the HTML, not visible in the
rendered text). On a page whose recipient **is** LastDonor, "LastDonor platform
fee" is an odd line even at zero. It is the campaign form's copy, unchanged
since `docs/92`, and a fund-specific variant is a product call.

---

## 10. What is NOT verified

- Rollback, if ever needed:
  `DELETE FROM campaigns WHERE id = 'd7fcb01f-468a-49e1-848f-bee7377a35ea'`,
  safe only while `donations` has no row referencing it (the composite FK).
- **No real M-Pesa donation has been taken through `/donate`.** The rail is
  proven by `docs/92`'s two live KES donations and by the form and route being
  the same ones they used — not by a payment through this page. An STK push
  rings a real phone and costs a real fee, so it is the owner's to run.
- **The raise cap was not exercised** against the fund (§6.1): the 409 path is
  `checkRaiseCap`'s, covered by its own tests, not re-run here.
- **The newsletter and blog link-graph exclusions** are verified by the query
  change and the ratchet only. [VERIFIED] `blog_posts` has 0 rows ever
  (`docs/123`) and the newsletter has sent nothing, so neither surface can be
  measured today.
- **`/donate`'s own OG card and metadata** were not re-examined for the
  currency change.
