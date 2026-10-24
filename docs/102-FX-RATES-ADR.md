# 102 — Exchange rates: provider, boundary, and the traps

**Date:** 2026-10-24
**Status:** Implemented, not deployed (deployment is manual; the owner runs it).
**Scope:** DISPLAY ONLY. Nothing here changes the one-currency-per-campaign
guarantee of `docs/92`, and a ratchet enforces that.

---

## 1. What was decided

| | |
|---|---|
| **Primary** | `open.er-api.com` (ExchangeRate-API open access), keyless |
| **Fallback** | `@fawazahmed0/currency-api` via jsDelivr, keyless |
| **Refresh** | Daily, 02:00 UTC, via the existing cron worker |
| **Storage** | One `site_settings` row, key `fx:usd-rates:v1` |
| **Staleness** | `MAX_FX_AGE_HOURS = 48`; past that, conversions **refuse** |
| **Use** | Display only, enforced by an import allowlist |

## 2. Measured, not researched

Every candidate was probed from this sandbox **and** from the production
machine in `arn` (`fly ssh console`), because `docs/90` found BBC, Guardian,
NYT and LA Times returning 403 to the sandbox and 200 from Fly — a provider
list "verified" from a laptop would have been wrong. **[VERIFIED 2026-10-24]**

| Provider | Result | Verdict |
|---|---|---|
| `open.er-api.com` | 200, 166 currencies, KES present, 170ms from prod | **primary** |
| `cdn.jsdelivr.net/@fawazahmed0` | 200, 288 3-letter codes, 75ms from prod | **fallback** |
| `api.frankfurter.dev` | 200, **29 currencies, `has_KES: false`** | **rejected** |
| `api.exchangerate.host` | **401** — now requires an API key | rejected |
| `api.exchangerate-api.com/v4` | 200, works fine | **rejected — same operator as primary** |
| `www.floatrates.com` | 200, 25KB nested, no freshness contract | rejected |

Two rejections are worth keeping:

**Frankfurter is the obvious choice and is useless here.** It is clean, free,
keyless and ECB-backed — and ECB reference rates are 29 currencies that **do
not include the Kenyan shilling**. KES is the platform's only working payment
rail (`docs/92`), so the tidiest API on the list cannot price the one currency
we actually take money in. This is why the probe ran before the decision.

**`api.exchangerate-api.com/v4` would have been fake redundancy.** It answers
independently and carries KES, but it is the *same operator* as the primary, so
pairing them buys nothing. This is the `docs/86` finding again, where a
candidate SMS fallback turned out to resell the same upstream and was no
redundancy at all. The chosen fallback is separate infrastructure *and* a
separate aggregation.

## 3. ⚠ Two traps, both measured

**1. The primary reports its own errors with HTTP 200.**
`GET /v6/latest/ZZZ` returns `{"result":"error","error-type":"unsupported-code"}`
with status **200**. A client that trusts `res.ok` accepts an error body as a
rate table. Success means `result === 'success'`, nothing less. This is exactly
the PayHero trap in `docs/92`, where `success: true` arrived alongside
`status: "FAILED"`. **[VERIFIED]**

**2. The fallback's keys are lowercase and include cryptocurrencies.** Its 339
keys contain `1inch`, `aave`, `ada`, `btc`, `eth`; fiat codes are lowercase.
Passing that table through would put asset prices in a money store. Only codes
present in `CURRENCIES` are kept, and the loader **rejects the whole snapshot**
if any supported currency is missing rather than storing a partial table.
**[VERIFIED]**

A third guard with no trap behind it yet: a table where `1 USD ≠ 1 USD` is not
USD-based, and every conversion off it would be silently scaled, so that is
rejected too.

## 4. The boundary, and how it is enforced

An exchange rate is the one tool that makes violating `docs/92` feel
reasonable — "just show a combined total" is a five-line change that turns a
database guarantee into a figure that moves daily.

So a converted figure is never written to an amount column, never summed across
currencies, and never used to decide a payout, refund, cap or goal.

`src/lib/money/fx-display-only.ratchet.test.ts` makes that enforceable: the FX
modules have an **import allowlist** of six files. Adding one is not forbidden;
doing it unnoticed is. The ratchet also asserts that no file importing FX
contains a money-write signal, and names `payment-service.ts` and
`campaign-raise-cap.ts` explicitly. Proven by injection: adding
`import { convertMinor }` to the settlement writer fails 3 tests, and to the
raise cap fails 2.

## 5. Staleness is a refusal, and the cadence is an invariant

Rates update once a day. Past `MAX_FX_AGE_HOURS` every conversion returns
`null` and the UI renders **nothing**. A money figure a reader cannot date is
worse than no figure.

The invariant: **the refresh interval must be well under the staleness
tolerance**, or one failed run takes the feature down. Daily refresh against a
48h window leaves room for exactly one missed run, and a test asserts
`24 < MAX_FX_AGE_HOURS <= 48` so the two numbers cannot drift apart silently.

**A finding that qualifies this.** On the live contract run the fallback was
already **33.09h old** while the primary was 9.05h old — the fallback publishes
a date-only stamp and runs about a day behind. So it does **not** supply a full
48h of headroom; it supplies roughly 15h beyond its own age. If the primary is
down for more than about half a day, conversions will stop even though the
fallback is answering. That is the correct behaviour, but it means the fallback
is insurance against an outage, not against a long one. **[VERIFIED]**

## 6. Attribution is a licence term

The primary's documentation (read 2026-10-24) states the open endpoint
"requires attribution", is rate limited, and that caching is explicitly
permitted — *"You're welcome to cache the data we respond with"* — while
re-distribution is not. We display converted amounts and never serve the rate
table onward, which is inside those terms.

`FX_ATTRIBUTION` is therefore an obligation, and the ratchet asserts
`ApproxMoney` renders it. Proven by injection: replacing the href fails 1 test.

The rate-limit guidance is also why the refresh is daily — their own docs say an
hourly request "will never get rate limited", so daily is comfortably inside it.

## 7. Where the snapshot lives, and where it does not

`site_settings` (key/value jsonb) under its own key namespace.

- **Not a new table.** One row does not justify a migration against a live
  money database.
- **Not in-memory.** It would refetch on every cold start and let two
  instances show different numbers for the same page.
- **Not through `src/lib/settings.server.ts`.** That is a typed map of operator
  *configuration* which the admin settings screen renders and edits. Rates are
  machine-written *cache* with a provider and a timestamp. Routing them through
  it would put a rate table in a settings form.

Read sequentially on the campaign page, never inside a `Promise.all`:
`src/db/pool-fanout.ratchet.test.ts` caps an entry point at three concurrent
queries against a pool of five, and `/admin/settings` issuing seven is what
took 15 seconds and left wedged backends (`docs/87`).

## 8. The display surface

One component, `ApproxMoney`, rendering `about $X at the YYYY-MM-DD rate` plus
the attribution. It renders **nothing** when the snapshot is missing, stale, or
does not cover the pair.

Placed on the campaign detail page, and only in one direction: a **non-USD
campaign shows an approximate USD equivalent**. USD is the reference a diaspora
donor reading a KES appeal can interpret; the reverse would mean guessing which
currency a reader of a USD campaign thinks in, and this codebase has no
viewer-locale detection. When one exists, that is where it goes.

## 9. A mutation survivor that was worth fixing, not explaining

Mutation testing the conversion killed 6 of 7 mutants. The survivor:
**hardcoding `100` instead of reading each currency's exponent.**

It survived because it is an *equivalent mutant today* — `CURRENCIES` holds
only USD and KES and both are exponent 2, so `10 ** exponent === 100` always.
It is also precisely the 100× error that lands the day UGX, RWF, XOF or XAF is
added, since those are zero-decimal (CLAUDE.md, `docs/92`).

Rather than record it as untestable, the arithmetic was extracted into
`convertWithRates(amountMinor, from, to)` which takes exponents as parameters,
so the zero-decimal path is exercised **before such a currency exists**. The
mutant now dies (3 failures). Mutation score **7/7**.

The test spells the arithmetic out: correct gives 37,000; hardcoding 100 gives
3,700,000 — wrong by exactly 100×.

## 10. A defect found on the way: integration tests could not import server modules

`vitest.config.ts` aliases `server-only` to a stub; **`vitest.config.integration.ts`
did not.** So any integration test importing a module with
`import 'server-only'` died at collection with *"This module cannot be imported
from a Client Component module"* — an error naming the wrong problem.

**Eight server modules were unreachable from the integration suite**, silently:
`echo-counters.ts`, `crypto.server.ts`, `settings.server.ts`,
`wedge-watchdog.ts`, `volume-guards.ts`, `phase-out.ts`,
`simulation-readiness.ts` and the new FX store. Nothing failed; the tests
simply could not be written.

This is the `docs/89` finding again — one `server-only` import broke five
suites at collection while the summary still read "5898 passed", 80 tests
silently not running. That was fixed in the unit config only. Now both.

## 11. The lock policy, argued and then conceded

`CRON_LOCKS` was first given `onBackendUnavailable: 'run'` for this job, on the
grounds that it converges (an idempotent upsert of one key, no money) and that
skipping lets the snapshot age out.

`src/lib/locks.test.ts` broke, by design: *"Fail-open is only defensible for a
job that converges. Adding another one is a decision that should break this
test and be argued for."*

The argument was dropped rather than made, and the policy is **`'skip'`**. The
cost of skipping here is the mildest in the table: the snapshot ages and
approximate figures stop appearing. Nobody is paid wrongly and no page breaks.
`reconcile` remains the only job worth arguing fail-open for.

## 12. Verification record

| Check | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **6477 passed / 12 skipped**, 201 files (was 6397 / 197) |
| `npm run test:integration` | **108 passed**, 13 files (was 91 / 12) |
| Live contract (`FX_LIVE_CONTRACT=1`) | **6 passed** against the real endpoints |
| Mutation, `fx-convert` | **7 mutants, 7 killed** |
| Ratchet injection | FX import into settlement writer → 3 fail; into raise cap → 2 fail; attribution removed → 1 fail |

Live contract output, 2026-10-24:

```
primary:  open.er-api.com               asOf=2026-10-24T00:02:31Z  age=9.05h   KES=129.84786
fallback: cdn.jsdelivr.net/@fawazahmed0 asOf=2026-10-23T00:00:00Z  age=33.09h  KES=129.85584106
KES spread between providers: 0.0061%
KES 64,923.93 -> about $500.00
```

## 13. Not checked / still open

- **Nothing is deployed.** Production runs v95; this is on a branch.
- **The cron route has never run.** It is wired into `CRON_JOBS`, so the
  existing worker will call it, but no run has happened — the first one will be
  after a deploy. Until then **no snapshot exists in production**, and
  `ApproxMoney` correctly renders nothing. **[UNKNOWN: its first live run]**
- **"All countries" is still NOT done, and FX did not unblock it.** Adding a
  currency to `CURRENCIES` needs a `gateway`, and the gateways are PayHero
  (KES/M-Pesa only) and Stripe (whose key is the dead placeholder of
  `docs/72`, being worked on separately). A currency we cannot collect is an
  unexercisable path, which `docs/81` forbids. What FX *does* give: rates for
  any new currency are picked up automatically at the next refresh, because
  `narrowToSupported` is driven by `CURRENCIES`.
- **The zero-decimal path is tested but unused.** No zero-decimal currency
  exists in `CURRENCIES` yet, so `convertWithRates` is exercised with
  exponent 0 only by tests.
- **Rounding is half-up to the nearest minor unit** and is not configurable. For
  an indicative figure that is sufficient; it would not be for a settlement.
- **No alerting on a degraded fetch.** A fallback-only run writes an audit row
  at `warning` and nothing reads audit rows proactively, so a primary that has
  been down for a month is discoverable but not announced.
