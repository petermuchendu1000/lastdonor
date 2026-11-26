# 185 — One line moved, and five sentences went false

**Date:** 2026-11-26
**Status:** BUILT. **NOT DEPLOYED** (standing owner instruction, CLAUDE.md).
**Owner decision:** `KES` collects over **Palpluss**, the flip `docs/184` §9,
`docs/182` §6 and `docs/180` §7 each left as the owner's call.
**Resolves:** `docs/182` §6 in full (its second half was still open).
**Read with:** `docs/180`–`184` (the Palpluss rail), `docs/152` (processor
disclosure), `docs/150` (the float alert).

---

## 1. The change, and why it is not one line

```diff
-    gateway: 'payhero' as const,
+    gateway: 'palpluss' as const,
```

That is the whole product decision. What it moved:

| | Before | After |
|---|---|---|
| `mpesaRailFor('KES')` | `payhero` | `palpluss` |
| The donation form's paths | `…/payhero/*` | `…/palpluss/*` |
| `payHeroChargeCurrency()` | `'KES'` | **threw** → now `null` |
| `palplussChargeCurrency()` | `null` | `'KES'` |

`docs/184` §5.2 proved by execution that every *form* surface follows the
table, and it did. **Sixteen unit tests failed anyway**, and three of them were
real defects rather than stale pins:

| Failures | What |
|---|---|
| 10 | `payhero.test.ts` — its KES fixtures depended on the live table |
| 2 | `palpluss.test.ts` — a toggle that had become a no-op |
| 1 | `money.test.ts` — a pin on `KES.gateway === 'payhero'` |
| **3** | **`/privacy` and `/refund-policy` disclosure — real** |

Plus one defect **no test caught at all**, found by reading (§2), and one found
by a test failing to *collect* (§5).

---

## 2. The 500 that `docs/182` recorded and did not fix

`payhero/initiate/route.ts` called `payHeroChargeCurrency()` at line ~204 —
**after** the campaign lookup, the amount check and the raise cap — and that
function **threw** when no currency named its rail. So after the flip, a donor
whose browser still held the old client chunk POSTed there and got a bare
**HTTP 500** out of the route's outer catch, four queries in.

`docs/182` §6 saw it coming and said so: *"`payhero/initiate/route.ts:204` has
the same call, where it would surface as a 500."* It fixed the donate page and
left the route, correctly, because at the time the route was unreachable. The
flip is what made it reachable.

⚠️ **Nothing could have caught it.** `tsc` cannot see a throw; the signature
said `string`. And [VERIFIED] no test executes that route — `docs/182` records
it: *"the PayHero twin has no behavioural test at all."*

### 2.1 Why `payHeroChargeCurrency()` stopped throwing

`docs/182` §4 justified the asymmetry between the two rails in one sentence:

> `payHeroChargeCurrency` throws because exactly one currency has always named
> it, so there it means "the currency table is broken".

**True when written, and the flip spent it.** Zero currencies name PayHero now,
deliberately. A function cannot answer *"the table is broken"* for a state the
table is supposed to be able to hold. It returns `string | null`, like its
twin, and the route asks it **before the body parse** — which is before all
database work, since the campaign lookup needs `campaignId` out of that body.

`mpesa-rail-symmetry.test.ts` holds the two rails to one shape: both
derivations typed to allow null, both asked before the parse, both answering a
`503` on the falsy branch, and — executed under a simulated card-only table —
neither throwing.

---

## 3. Five sentences, and a guard that would have gone green on two

`docs/152` put a processor name into five public policy sentences, because
naming a sub-processor on a policy page is a compliance disclosure. All five
became false at once:

| Surface | Said |
|---|---|
| `/privacy` sharing list | **PayHero:** For M-Pesa payment processing |
| `/privacy` security | *…and M-Pesa payments to PayHero.* |
| `/refund-policy` | *Card payments are processed by Stripe, and M-Pesa payments by PayHero.* |
| `/terms` | *…and M-Pesa donations by PayHero.* |
| `/fund-release-policy` | *M-Pesa donations are processed by PayHero.* |

Three of the five failed a guard. **Two did not, and that is the finding.**

`collection-rails.test.ts` and `refund-rails.test.ts` both spell an M-Pesa rail
as `/\bPayHero\b|\bM-?Pesa\b/i`. That alternative is **right** for what those
rules ask — a donor reading how a refund reaches them needs the word *M-Pesa*,
not the name of a company they have never heard of — but it means neither rule
can tell one M-Pesa rail from another. *"M-Pesa payments by PayHero"* satisfies
a rule asking whether Palpluss is named, so `/terms` and
`/fund-release-policy` stayed green while false.

`src/app/no-dead-processor.test.ts` asks the question neither can: **is a
company named as a processor when it processes nothing?** The dead set is
derived from the currency table, so it needs no editing when a rail is flipped
back, and it is bidirectional — mutation row 1 (KES reverted to PayHero with
the pages still saying Palpluss) fires it.

⛔ It is a **claim** rule, not a **name** rule, and that distinction is
load-bearing (§3.2).

### 3.1 The derivation that was built and BACKED OUT

The obvious fix is to render those five sentences from the gateway table, so a
flip can never make them stale. It was built —
`cardProviderName()` / `mpesaProviderName()`, five pages converted — and the
anti-vacuity row of `collection-rails.test.ts` immediately reported:

```
no collection claim found anywhere - the matcher is broken: expected 0 to be greater than 0
```

That sweep reads page source as **text**. Moving the prose into
`{cardProviderName()}` expressions took the only claims in the corpus out of
its sight: the rule went vacuous and would have protected nothing.

⚠️ **This is `docs/184` §3 in a different costume, one day later.** There, a
`` `…/${rail}/status` `` template would have disarmed the guard written to arm
on that very change, and the lesson was recorded. Here the same instinct
reached a different file and the instrument caught it instead of me.

**A derivation that hides the subject from the instrument is not an
improvement.** So the prose is literal and readable, five hand edits are the
accepted cost of the next flip, and the build failing until they are made is
the actual protection. What survives of the derivation is
`src/lib/payment-providers.ts` — one `Record<gateway, string>` the three guards
share, so a fourth gateway fails the build until somebody decides what it is
called in public.

### 3.2 PayHero is KEPT on `/privacy`, and that is a judgement

`docs/152` removed **Vercel** from the sharing list because it hosts nothing
here, ever, and wrote: *"disclosing a recipient that receives nothing is as
wrong as omitting one that does."*

PayHero is not that. It processed every M-Pesa donation this platform has taken
and [VERIFIED] still holds those donors' phone numbers —
`payhero_payment_requests.msisdn_sent`, 5 rows since 2026-10-21. Dropping it
would **understate** the disclosure, which on a privacy policy is the worse
direction to be wrong in.

So only the **tense** changed:

> **PayHero:** Processed the M-Pesa payments made before we moved to Palpluss,
> and still holds the records of those payments

⛔ No date and no retention period is invented, because neither is a fact this
codebase holds — `docs/152` already records that no retention period is stated
for the stored phone at all. And the guard forbids *presenting a dead provider
as processing*, never *naming* it, with that sentence as the control.

---

## 4. The health endpoint was watching the wrong rail

`/api/v1/health` checked `stripe` and `payhero` and **said nothing about
Palpluss**. After the flip it reported `payhero: ok` — authenticated, float
healthy — for a gateway no currency routes to, while the rail taking every
shilling went unmentioned. *"Can this platform collect money?"* had no answer
there. `docs/136` §7's shape: a screen reporting confidently on something that
is not running.

It now reports `palpluss`. ⚠️ **Configuration only, and no network call** —
not by choice: `src/lib/palpluss.ts` exposes no balance read, so there is
nothing to probe. That answers the question the flip made urgent (is the key
set at all, or does every donor get a 503?) and nothing more.

⛔ **This rail has no float monitor**, and `docs/150`'s alert has no equivalent
here. Recorded in §7 rather than implied.

---

## 5. A constant that two rails shared, in one rail's module

Adding that health check made `health/route.test.ts` fail to **collect**:

```
No "LASTDONOR_REFERENCE_PREFIX" export is defined on the "@/lib/payhero" mock
```

That test mocks `@/lib/payhero` wholesale — and `palpluss.ts` imported
`LASTDONOR_REFERENCE_PREFIX` **from `./payhero`**. So the client of the rail
that collects depended on the module of the rail that collects nothing, and
mocking one rail broke the other.

The constant is the `LD-` isolation namespace on a shared account: a fact about
**our own rows**, which is `mpesa-prompt.ts`'s own stated criterion —
`docs/159` set the rule and `docs/183` §8 renamed that file for it. This is its
third application. `payhero.ts` re-exports the name so the move broke no call
site, and a new rule in `mpesa-rail-symmetry.test.ts` forbids either client
importing the other.

⚠️ Found by a collect failure, not by reading. The same signature that
`docs/124` §5.1 and `docs/138` §6.1 both record as reading like zero failures
was, this time, the only thing pointing at a real coupling.

---

## 6. Two of my own mistakes

1. **A control that pinned today's copy.** Mutation row 11 reworded
   `/privacy`'s historical PayHero sentence while keeping it historical — a
   change this rule must permit — and my control **fired**, because it matched
   `/PayHero:<\/strong>\s*Processed the M-Pesa payments/`. That is `docs/160`
   §5.2 (and `docs/163` §5.2, and `docs/161` §6.1) in a test written an hour
   after reading them. It now asserts the property: PayHero is still
   disclosed, and is not presented as processing anything.

2. **A regex flag that needed es2018.** `/gms` on the new import scan broke
   `tsc`, and the `s` was redundant — `[^;]` already crosses newlines.
   ⚠️ The tell was that **every** mutation row, including both MUST-PASS rows,
   reported `tsc=TSC_FAIL`: a uniform failure across rows is a dirty baseline,
   not seventeen defects (`docs/162` §5.2's signature). The harness's separate
   tsc column is the only reason it read that way instead of as fifteen
   successful fires.

---

## 7. Verification

### 7.1 Mutation table

17 rows, all behaving: 15 fire, 2 must-pass hold. sha256-verified restore after
every row; the harness refuses to score a row whose file sha did not change
(`docs/152` §5.2) and detects a collect failure (`docs/124` §5.1).

| # | Mutation | Want | Result |
|---|---|---|---|
| 1 | **the real pre-flip state**: KES back on PayHero | fire | FIRED (2) |
| 2 | **production (`docs/182`)**: the derivation throws again | fire | FIRED (5) |
| 3 | the route stops asking before the body parse | fire | FIRED |
| 4 | the route's 503 refusal deleted | fire | FIRED |
| 5a–e | **production**: each of the five sentences credits PayHero | fire | FIRED (1–2 each) |
| 6 | vacuity: `/refund-policy` names no processor at all | fire | FIRED (1) |
| 7 | `deadGateways()` returns the live set instead | fire | FIRED (3) |
| 8 | `PAYMENT_PROVIDER_NAME` loses its palpluss entry | fire | FIRED (tsc) |
| 9 | `collection-rails` PROSE_NAME loses palpluss | fire | FIRED (2) |
| 10 | MUST PASS: comment-only edit | pass | GREEN |
| 11 | MUST PASS: the historical sentence reworded | pass | GREEN |
| 12 | `palpluss.ts` imports the prefix from `payhero` again | fire | FIRED (2) |
| 13 | health stops checking the rail that collects | fire | FIRED (3) |

Rows 5a–e are run **one at a time** deliberately: a single row reverting all
five would have passed with four of the five guards missing.

### 7.2 Suites

- lint clean (one pre-existing warning in `review-gate.test.ts`)
- typecheck clean
- unit **8839 passed / 16 skipped, 320 files passed + 3 skipped = 323**
- integration **392 passed / 38 files** against a throwaway Postgres

The unit delta is **+26**, reconciled per file (`docs/89`):

| Δ | File |
|---|---|
| +13 | `mpesa-rail-symmetry.test.ts` (new) |
| +7 | `no-dead-processor.test.ts` (new) |
| +3 | `payhero.test.ts` — it had **no** test of `payHeroChargeCurrency` at all |
| +2 | `health/route.test.ts` |
| +1 | `collection-rails.test.ts` — the missing tripwire |

### 7.3 Tripwires that fired, as designed

Two guards written on earlier passes caught this change rather than being
caught by it, and both are worth naming:

- **`docs/182`'s integration control** reported *"a currency now routes to
  Palpluss — the stub in this file is no longer standing in for an unreachable
  state, and docs/182 should be re-read"*. It fired on the one change it was
  written for, and is now inverted (the route is live; its premise is that
  something routes here).
- **`refund-rails.test.ts`'s premise tripwire** said *"a gateway has no prose
  spelling"* — a clean sentence naming the gap. Its sibling in
  `collection-rails.test.ts` lacked that check and died with
  `Cannot read properties of undefined` instead. It has one now.

---

## 8. What was NOT changed, and is open

- ⛔ **Whether `PALPLUSS_API_KEY` is set in production is [UNKNOWN].**
  `flyctl` is not installed in this sandbox, so the secret list could not be
  read. **If it is unset, this flip means the platform collects nothing** —
  `palpluss/initiate` answers 503 to every donor. The new health check is what
  reports it; read `/api/v1/health` after deploying.
- ⛔ **The Palpluss tenant is shared with another product** (`docs/180` §2 —
  its ledger carries `Invest254`, `TamuTraders` and callbacks to
  `printpesa.com`). Isolation is the `LD-` reference namespace. The owner
  already decided LastDonor gets its own tenant; that has not happened, and
  this flip points real donations at the shared one.
- ⛔ **Palpluss callbacks arrive UNSIGNED** until `lastdonor.org` is registered
  as a webhook domain (signing is per-domain). Survivable only because a
  callback body is never the outcome (`docs/181`), and the status poll settles
  payments on its own.
- ⛔ **No float monitor for Palpluss** (§4). Its fee is prepaid and an empty
  service wallet refuses collection before Safaricom is reached.
- ⚠️ **`cron/payhero-float` now watches a rail that collects nothing.** Its
  hourly check and its email (`docs/150`) still read PayHero's wallet. That is
  noise rather than danger, and narrowing it is an owner call — they asked for
  that alert explicitly.
- ⛔ **Nothing sweeps `palpluss_payment_requests`** (`docs/183`), so the
  donor's own poll remains the only path by which a late settlement is found.
- ⛔ **The Palpluss routes have never taken a real donation.** PayHero has
  taken every one — three, all KES, all settled.
- ⚠️ The general fund is a KES campaign and now collects over Palpluss. Its
  three historical donations keep `provider: 'payhero'`; both providers take
  the manual refund branch, so `docs/122`'s path is unchanged.

## 9. Not checked

- **No browser and no deploy.** Nothing here was rendered in Chromium, and no
  donate page was loaded; the flip's effect on the form is carried by
  `docs/184`'s executed tests rather than re-measured.
- **No money moved**, and no Palpluss API call was made in this pass.
- **The E2E suite was not run** (it needs a build and a seeded fixture). Its
  fixture seeds `stripe`/USD rows, so no E2E test drives either M-Pesa rail.
