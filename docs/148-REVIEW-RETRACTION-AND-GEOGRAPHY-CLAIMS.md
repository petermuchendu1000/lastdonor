# 148 — Six campaigns retracted, and the geography the site claimed

Two parts of one thing: claims the platform could not substantiate. PART A is
a production data change the owner authorised; PART B is copy and structured
data.

---

## PART A — the six live campaigns nobody had approved

### A.1 The finding, and a correction to `docs/116` §8.5

⛔ `docs/116` §8.5 says **five** live campaigns were published without review.
There were **six**, and the sixth has a different root cause. `docs/142`
counted 6 and was right; `docs/116`'s five is incomplete.

⚠️ `docs/116` §8's forensic premise, *"`published_at = created_at`"*, is
**literally false**: the gap is **−3 to −4 milliseconds**. A query asserting
equality finds nothing. The substance holds — one statement, with
`publishedAt: new Date()` evaluated just before the DB's `created_at` default
— but the stated form does not.

| slug | signature | root cause |
|---|---|---|
| `brent-ledbetter` | `published_at − created_at = −0.003057s` | `docs/116` §4, the news pipeline |
| `nicholas-cabo` | `−0.003847s` | ″ |
| `samuel-pierre-jr` | `−0.003153s` | ″ |
| `maj-sorffly-davius` | `−0.003435s` | ″ |
| `david-l-jones` | `−0.004628s` | ″ |
| `help-john-recover-after-a-car-accident` | `campaign.submitted 02:27:17.57 → published_at 02:28:52.64` = **+95s** | `docs/120` §2, the editor route that published on save |
| **CONTROL** `tuan-nguyen` | **+3 days 23:22:22** | a real review |

That +95s matches `docs/120` §2's own measurement to the second — *"the
owner's own submission went public 95 seconds after `campaign.submitted`"* —
so the sixth is that defect's unretracted artefact, confirmed by execution.

**[VERIFIED five independent ways, each challenging the last]:**

1. No `campaign.published` audit row (8 of 14 had one, these 6 did not).
2. The timestamp signatures above, with a control three orders of magnitude
   away.
3. The sixth's full audit trail: `campaign.submitted`, then nothing.
4. **Falsifier:** any audit row mentioning the six ids *anywhere*, including a
   `LIKE` over `details::text` — `docs/142` was burned by guessing the JSON
   key. Result: only `campaign.auto_drafted` ×5, `campaign.submitted` ×1 and
   two collaborator events. **No publication event under any key.**
5. **Falsifier:** any `%status%` event for them. **0 rows.**

⚠️ My own first aggregate reported `have_published_audit=14`, which read as a
clean bill — it counted `DISTINCT target_id` across **all** campaigns, not
live ones. **That query could not have failed.** Only the per-campaign
breakdown is evidence.

### A.2 What was done

Owner decision, option 1 of `docs/116` §8.5. Both root causes were already
fixed and deployed, so this is rows, not code.

```sql
UPDATE campaigns SET status='under_review', published_at=NULL, updated_at=now()
WHERE id IN (<the six>) AND status='active' AND published_at IS NOT NULL
RETURNING slug, status, published_at;          -- returned exactly 6
```

⛔ `published_at = NULL` is **not optional**. `docs/131` made the public page
require `isNotNull(published_at)`, so a status change alone would keep serving
them.

⚠️ `active -> under_review` is **absent** from `ALLOWED_TRANSITIONS`
(`admin/campaigns/[campaignId]/route.ts:21`), so the admin route cannot do
this and a direct write was the only path. `under_review: ['active']` (`:40`)
means the resulting state is recoverable by the normal approval flow, which
will stamp `published_at` and write the `campaign.published` row that was
missing.

**Blast radius, measured before writing:** all six had `raised_amount 0`,
`donor_count 0`, **0 donations, 0 subscribers, 0 share links, 0 messages**.
The only dependents were 4 `campaign_updates` each on the five pipeline ones,
written by `update-phases` (`docs/89`). `publicCampaignPath` already returns
`null` for `under_review` (`docs/118`), so no stored link rots.

**Rollback, durable beyond the session:** `_review_gate_backup_20261029` holds
all six original rows (`rows=6, active=6, with_published_at=6`), mirroring
`docs/79`'s `_review_gate_backup_20261017`, which still exists.

```sql
UPDATE campaigns c SET status=b.status, published_at=b.published_at, updated_at=now()
FROM _review_gate_backup_20261029 b WHERE c.id = b.id;
```

### A.3 Verified after

- **DB:** the six `under_review`/NULL; the 8 approved still active+published
  with `touched_in_last_5min=0`, so the UPDATE did not graze them.
- **The invariant:** `published_live=8, approved_by_person=8`. **8 of 8.**
  Every publicly published campaign now has a human approval record.
- **Live HTTP:** six → **404**, three approved controls → **200**.
- **Live browser:** 8 `<article>` cards, 8 distinct campaign links matching the
  approved eight *by name*, 0 on page 2, none of the six leaked. The page reads
  **"8 active campaigns · Each one reviewed before going live"** — true for the
  first time.

### A.4 ⚠️ An unexplained transient 404, NOT reproduced

During the first live probe, `tuan-nguyen` and `antonio-rivera` — both
approved — answered **404 once**. Per Gate 5 that voided the measurement and
it was diagnosed before anything was interpreted.

- **[VERIFIED]** not caused by the write: all three controls read `active`,
  `published_at` set, `updated_at` still 2026-10-18/19.
- **[VERIFIED]** both answer 200 consistently since: 5 consecutive `HIT`s on a
  pinned subject, plus **12/12** and **8/8** in two concurrency bursts.
- **[UNKNOWN]** cause. Two reproductions failed: 12 concurrent on warm
  entries, and 8 concurrent on deliberately expired entries after a 75s wait
  (all 200, sub-700ms).
- **[INFERRED, weak]** it coincided with six campaign pages regenerating for
  the first time into a `notFound()` — a condition that existed for one moment.

⛔ This matters because `docs/43`'s rule is that an unresolved campaign lookup
is a **5xx and never a 404**, and a campaign page that 404s transiently loses
donations silently. Establishing it needs instrumented logging on the page's
lookup, or retracting another campaign and bursting at a sibling — a further
production mutation, not taken.

---

## PART B — the geography and currency the site claimed

Owner instruction: emphasise Africa, Asia and South America; do **not** say
the USA, Canada and Europe are excluded, because that is where the donors are
expected to come from; a UK registration is **planned**.

### B.1 ⛔ `areaServed` was REMOVED, not relocated

`layout.tsx:29` published `areaServed: { '@type': 'Country', name: 'United
States' }`.

**Why that was wrong in both directions.** [VERIFIED 2026-10-29 by live POST
to the real donation route, not by a health check] `create-checkout` answers
**503 `PAYMENTS_UNAVAILABLE`** for a real reviewed published USD campaign — a
branch emitted only on `StripeAuthenticationError` — while the same campaign
on the M-Pesa route answers **400 `WRONG_PAYMENT_RAIL`**, which is the control
proving the probe discriminates. All 14 live campaigns are USD. So the site
asserted service in the one country where **nobody could give**, and said
nothing about the regions it is built for.

**Rejected: listing the regions.** `areaServed: [Africa, Asia, South America,
United States, Canada, Europe]` would be six machine-readable claims that we
serve places no gateway reaches. **Rejected: listing Kenya alone**, the one
place that works — that asserts we do *not* serve the others, which is exactly
what the owner ruled out.

**Taken: absent.** Absent asserts nothing, which is "we won't say we don't
cover the USA" without claiming we do. `docs/76` settled this same question
for `sameAs` in its own words: *"`sameAs: []` is a claim about nothing, and
absent is the honest encoding of 'none yet'."*

⚠️ Restore an `areaServed` only when a gateway can settle in the region being
claimed. The rule in `currency-claims.test.ts` is **derived, not a ban**: it
applies only while more than one currency is collectable.

The regional emphasis went into `description`, where it is positioning rather
than a coverage assertion: *"built first for people raising money in Africa,
Asia and South America."*

### B.2 Three single-currency claims, and a fourth found by the sweep

Since `docs/118` §10 an organiser chooses the currency, and `docs/147` put the
platform's own fund on KES. A sentence naming one currency is false for every
other.

| file | was | now |
|---|---|---|
| `app/campaign-rules/page.tsx:63` | "A clear fundraising goal in U.S. dollars." | "…in the currency the campaign collects in." |
| `app/refund-policy/page.tsx` | "Donations are charged in U.S. dollars." | "…in the currency the campaign collects in." |
| `app/refund-policy/page.tsx` | "minimum donation is **$5.00** … maximum **$100,000.00**" | **derived** from `CURRENCIES`, per currency |
| `app/refund-policy/page.tsx` | "**Stripe** securely processes payment details." | both rails named: card by Stripe, M-Pesa by PayHero |

The bounds were correct for USD (500 / 10,000,000 minor) and wrong for KES
(5,000 / 25,000,000). They are now computed from
`SUPPORTED_CURRENCY_CODES`, so a third collectable currency appears the day it
is added — `docs/136` §7's lesson that the one string written as prose is the
one that goes stale.

⚠️ Naming PayHero on that page is permitted: `refund-policy` and
`campaign-rules` are both in `PROCESSOR_NAME_ALLOWED`
(`fee-claims.test.ts:142,145`), where naming a sub-processor is a **compliance
disclosure** rather than a claim (`docs/116` §5).

### B.3 The sweep found a fifth instance, and it was NOT a defect

⚠️ Gate 9. `src/lib/validators/donation.ts:64-65` carries
`.min(500, 'Minimum donation is $5.00')` / `.max(10_000_000, 'Maximum donation
is $100,000')`, and these are the same currency-blind `500` that `docs/98`
**removed from the database CHECK** as meaningless across currencies. I was
about to report it as a defect. The file's own comment (`:50-58`) says the USD
literals are deliberate, and the premise checks out:

- **[VERIFIED]** `createIntentSchema` has exactly two non-test importers,
  `create-intent/route.ts:5` and `create-checkout/route.ts:5`, both Stripe.
- **[VERIFIED]** the parse runs at `create-checkout/route.ts:31` and the
  currency guard not until `:124`, so the parse really is **first** — an API
  request for a KES campaign below 500 minor units is refused *naming
  dollars*. No wrong amount is ever accepted, and no UI reaches it because
  `docs/147` routes a KES campaign to the M-Pesa form.

So: a wrong **message** on an unreachable path, not a money defect. It is
**exempted with a tripwire on its own premise** (`docs/111`'s shape): the
exemption holds only while every importer is a Stripe route, and injection
row 9 proves a third importer fails the build.

### B.4 The check

`src/app/currency-claims.test.ts`, 9 tests. It is a **sweep**, because three
instances of one rule is a sweep rather than three assertions (`docs/110`
§9.2). Comments are stripped first, and that is load-bearing: the `layout.tsx`
comment explaining the removal **quotes** the removed value, and the test's own
header quotes all four forbidden sentences (`docs/116` §4).

**All 9 injections fire**, sha256-verified clean restore after each
(`docs/120` §11.1).

⚠️ **Row 8 did not fire on the first attempt, and the TEST was wrong.** The
anti-vacuity control asserted `/description:/` over the **whole file**, where
the `metadata` export and its `openGraph` block each carry a `description:` of
their own — so renaming the Organization's key satisfied it anyway. Scoped to
the Organization object, it fires. A control that cannot fail is not a control.

⚠️ And the tripwire's own first version matched the bare name
`createIntentSchema` and reported `lib/money/currencies.ts` and
`lib/validators/payhero.ts` as importers — both of which only **name it in a
comment** describing their relationship to it. It now matches an `import`
statement against comment-stripped source. `docs/146` §6.1 and `docs/116` §4,
in a test written the day after both were quoted.

Gate: lint clean but for one pre-existing warning, typecheck clean,
**8052 unit tests passed / 16 skipped across 278 files** (+9, +1 file).

---

## What is NOT done

⛔ **ONE legal claim still open.** Two of the three were answered by the owner
on 2026-10-29 and are recorded in §B.5 below.

1. ⛔ **STILL OPEN — the published postal address.**
   `components/layout/Footer.tsx:124-126` and `app/privacy/page.tsx:186-188`
   both print *"LastDonor.org / United States / <email>"* — a country with no
   street. On a site now positioned for Africa, Asia and South America, with a
   UK registration **planned**, what should this say? ⛔ A planned
   registration is not a fact and must not be published as one (CLAUDE.md).
   The owner did not answer this, so both lines are **untouched**.

## B.5 The two company facts the owner settled (2026-10-29)

**`foundingDate` is `'2026'`, and `- Founded: 2026` in `llms.txt`.** It read
**2024** in both, on an entity whose domain [VERIFIED by `.org` RDAP,
independently of `docs/142`] was registered **2026-03-20T05:45:57.643Z** — a
founding date two years before the domain existed, in two surfaces search
engines and AI crawlers republish and no human reads.

⚠️ **A bare year, deliberately.** ISO 8601 allows it and schema.org's `Date`
accepts it. Writing `2026-03-20` would publish the *domain's registration* as
the *company's founding* — a more precise claim than anyone has
substantiated. Narrow it when somebody knows the date.

**`- Jurisdiction: United States` is REMOVED from `public/llms.txt`.**
[VERIFIED] it was the **only** jurisdiction claim in the entire product:
`/terms` contains no governing-law clause, no jurisdiction and no arbitration
provision. Removed rather than relocated, because there is no second
jurisdiction to relocate it to.

### B.5.1 The check, and why it is not about the year

`src/app/company-claims.test.ts`, 7 tests. The year is the least interesting
part; the rules encode three properties nothing was enforcing:

1. **Two surfaces asserting one fact must agree.** They drifted *together*
   here, and nothing would have caught them drifting apart.
2. **A founding year may not predate the domain registration.** A FLOOR, not a
   pin — it does not say which year is right, so the owner can correct it
   without touching the rule. 2024 fails; 2026 and later pass.
3. **No jurisdiction claim while `/terms` establishes none.** It DERIVES both
   ends and relaxes on its own: state a governing law in `/terms` and the
   `llms.txt` line becomes legal again (`docs/127`'s shape). A fourth rule
   forbids a **United Kingdom** claim in either surface, because the intention
   is now written down, and that is exactly when somebody adds it to a page.

**All 9 injections fire**, sha256-verified restore after each — including
row 1 (the real production state, `foundingDate: '2024-01-01'`), row 3 (the
two surfaces disagreeing at 2026 vs 2027), three controls that delete a claim
rather than correct it, and **row 9, the premise tripwire**: giving `/terms` a
governing-law clause fails the premise assertion, so somebody re-reads this
decision instead of the rule quietly relaxing.

⛔ **Converting USD to local currency at STK-push time** (owner's instruction,
not yet designed) collides with two ADRs and is in `docs/149`'s territory, not
this one. It is a money path: `docs/102` forbids an FX rate reaching any
money-writing module and enforces it with an import allowlist, and `docs/92`'s
composite FK on `(campaign_id, currency)` makes a campaign's currency a
database guarantee. Not started.

**Not checked:**

- Whether the five pipeline campaigns' **content** is fabricated — `docs/36`'s
  territory. Who approved them was checked; whether what they say is true was
  not.
- Whether `update-phases` keeps writing updates to an `under_review` campaign.
- Whether the approval email handles `creator_id = NULL` — five of the six have
  no organiser, so approving them later may hit a null recipient.
- The **sitemap** still advertised 14 campaign URLs when this was written;
  `revalidate` is 3600 (`docs/119`), so six point at 404s for up to an hour.
  The heal was not observed, and `docs/119` says it needs **two** requests.
- `src/lib/blog/authority-links.ts` is entirely US government sources (VA,
  HUD, DOJ, Dept of Education) — US-centric content for a platform now
  positioned elsewhere. Untouched: the blog pipeline has 0 posts and is
  disabled (`docs/123`).
- `src/lib/seed/simulation-engine.ts` hardcodes `America/New_York`. Untouched:
  verified inert four ways by `docs/136`.
