# 158 — "Nothing has been charged" was a guess on the one branch that cannot know

The FAILURE journey on the money-in path: press the pay button, make it fail
each distinct way, and read what the donor is told. `docs/151` walked this form
at 390px and recorded explicitly that **the pay button was never pressed**;
`docs/125` probed `create-checkout` at the API level and never saw the page.

---

## 1. The finding

`classifyInitiationFailure` put a **timeout** in the same bucket as a gateway
that answered, and the route then told the donor:

> We could not reach M-Pesa just now and **nothing has been charged**. Please
> try again in a moment.

That is a statement about somebody's money, made on the one branch where **no
response arrived**. The push is dispatched with a 20-second client deadline and
the client's own comment says *"this call reaches Safaricom synchronously"* — so
a request that got there can have raised a prompt on the handset while we were
giving up on it. The donor is then told their money is untouched **and invited
to retry**, which is how somebody pays twice.

`docs/121` settled the identical question on the way **out**: *"'your withdrawal
failed' there is a claim it cannot substantiate, and it is the one case where
the money may actually have moved."* This is that rule on the way in.

### 1.1 How far it goes, traced rather than assumed

- The request row is inserted **before** the call (`:221`) and the PayHero
  reference recorded only **on success** (`:258`), so a lost response leaves a
  row with no reference.
- The catch then writes `status: 'failed'` with `settledAt` — **terminal**.
- `settlePayHeroRequest` refuses such a row by its own design:
  `{ kind: 'unverifiable', reason: 'No PayHero reference was ever recorded for
  this request.' }` — and it only ever claims rows that are still `pending`.
- Nothing sweeps that table: its only consumers are the settlement service
  (driven by callback or poll) and the abuse guard.

So a collection that did happen would be invisible to the platform, and the
donor was told it had not.

## 2. Severity, stated honestly

⚠️ **[VERIFIED from production] this has never fired.**
`payhero_payment_requests` holds **3 succeeded and 2 failed**, and both
failures read `"PayHero reported the payment as FAILED."` — which is the
*settlement* path, where PayHero answered. The initiate catch writes
`"Initiation failed (…)"` and **has produced no row, ever**.

⚠️ **[UNKNOWN] whether a lost response can actually leave a collection**, and
it is not provable here: it would mean initiating a real STK push and cutting
the response, which moves money. Recovery is shut too — the callback reads
**only our own `ExternalReference`** (deliberately, `docs/81`'s shape: never
trust a callback's assertion of an outcome), and `docs/147` §11 records that
whether PayHero posts at all is still unproven.

So this is a copy-and-classification defect on an armed path, not an incident.

## 3. The fix

**`unknown` is now a kind of its own**, and the distinction is the whole point:

| kind | means | may it say "nothing has been charged"? |
|---|---|---|
| `configuration` | unconfigured, 401/403/404, an unregistered channel — or **our own pre-flight guard refused to send it** | yes |
| `rejected` | PayHero answered 4xx about this request | yes |
| `transient` | PayHero answered 5xx or 429 — it had the request and did not act | yes |
| **`unknown`** | **no response at all**: timeout, DNS, TLS, socket reset | **no** |

The `unknown` branch answers a new `PAYMENT_OUTCOME_UNKNOWN` code and says what
is true — it cannot tell, check your own M-Pesa messages, email support if money
left, and do not send it again until you have. The row's `failureReason`
records `"Initiation outcome UNKNOWN: no response from PayHero. A collection may
exist and cannot be verified…"` rather than agreeing with its own `failed`
status, and the audit severity rises to `error`, because this is the one case
where money may exist that nobody can see.

⛔ The row still carries `status: 'failed'`. Nothing can resolve it either way,
and changing an enum on a live money table buys nothing today — `docs/129`'s
reasoning. **Reported, not changed.**

## 4. ⚠️ My own fix over-reached, and execution caught it

The first version classified *everything* that was not a `PayHeroApiError` as
`unknown`. Running the walk against a real server produced:

```
kind=unknown  providerMessage="callbackUrl must be https."
```

That is not a lost response. It is **our own pre-flight guard refusing to send
anything** — one of **eight** bare `throw new Error(...)` sites inside
`initiateStkPush` (amount bounds, minor-unit alignment, an unusable phone, the
callback URL). So the fix told donors we might have charged them for requests
that provably never left the building: the original defect, mirrored.

Fixed with `PayHeroRequestNotSentError`, classified `configuration` — nothing
was dispatched, so the reassurance is substantiated there. ⚠️ I had read this
as a network block and was wrong; the audit row's `providerMessage` is what
corrected me. **Read the record, not your expectation of it.**

## 5. The second finding: the button contradicted the sentence above it

The walk measured `payStillEnabled: true` on **every** refusal — including the
one whose copy ends *"Please do not send it again until you have checked."* An
instruction and its opposite in one viewport, which is `docs/119`'s shape
inverted: not a door onto a room that refuses to open, but a control the product
has just told you not to use.

`PAYMENT_OUTCOME_UNKNOWN` now latches the pay button shut until the donor ticks
**"I checked my M-Pesa messages and no money left my account. I want to try
again."** A native checkbox inside its own `<label>`, so it is named without an
`aria-label` that could drift from the visible words (`docs/156`).

⛔ It latches on **that code only**. Latching on every refusal would put a
confirmation in front of donors whose money we know was never touched — the cap
refusal is decided before the gateway is called at all — and a test pins that.

## 6. Verified by execution, with discriminating controls

The walk, at 390px (`isMobile: false`, so overflow stays measurable per
`docs/128` §5):

| walk | response | donor sees | latch |
|---|---|---|---|
| A/B before the §4 fix | 503 | the unknown-outcome message | — |
| A/B after | 503 `configuration` | "a problem on our side … nothing has been charged" | none |
| C | **409** | "This campaign can accept up to Ksh 50,000.00 … Nothing has been charged." | none |
| D | 503 `PAYMENT_OUTCOME_UNKNOWN` | the honest message, verbatim | **button disabled, checkbox present, enabled after ticking** |

The A/B pair is the discriminating re-measurement: the **same** lab condition
gives a **different** answer after the §4 fix. The row was read back from the
database and carried the UNKNOWN wording with `ref=(none)`, so the fix is proven
at every layer — classifier, copy, screen, stored record. 0px horizontal
overflow.

### 6.1 Two probe failures, each of which read as a result

⚠️ **Walks B and C first measured nothing.** All three of A, B and C returned
the *identical* configuration refusal, and that sameness was the only tell: the
route's credential gate sits **above** validation, so with no credentials in the
lab it refuses before parsing and neither the phone nor the cap branch is
reachable. Re-run with dummy credentials — which pass a gate that only checks
the variables are present, and cannot authenticate — both became real
measurements, with nothing leaving, because the parse (`:94`) and the cap
(`:172`) both sit above the gateway call (`:243`). `docs/135` §5's rule: a probe
that cannot see its subject reports the same thing as a subject that is absent.

⚠️ **And "walk B: unusable phone" never was one** — `0700000000` is a
well-formed Kenyan number, so it passed validation and reached the gateway. The
walk is reported as what it measured, not what it was named.

⚠️ `npx next start` then exited 1 on EADDRINUSE while the port kept answering
**from the old server** — `docs/144` §5.2 exactly. Every restart since confirms
the port is free *before* starting.

### 6.2 ✅ Live on production as v164

Deployed 2026-10-30 after CI went green on all eight jobs (both E2E legs
included), because this is money code. `release v164 complete` on the first
attempt, live machine on 164, 1/1 passing, 0 orphaned release machines; `/`,
`/campaigns` and `/donate` all 200 against their pre-deploy baseline, and the
sitemap carried **8** campaign URLs on two consecutive reads — matching the
deploy script's own report, so `--prerender` did its job (`docs/119`).

The changed route was then smoke-tested live, with probes that cannot move
money:

| probe | result |
|---|---|
| invalid phone | **400** `VALIDATION_ERROR` field `phone` |
| amount above the cap | **409** `CAP_EXCEEDED` — *"This campaign can take Ksh 49,950.00 more for now…"* |

⚠️ Only the second is worth much, and the distinction matters: a 400 on `phone`
fires at the schema parse (`:94`), **before** the campaign lookup (`:102`), so
it proves the route is alive and validating and nothing more. The cap check
(`:172`) fires **after** campaign, currency, rail and bounds and **before** the
gateway call (`:243`), so the 409 is what establishes the whole KES path is
healthy on the new image. Its figure also reconciles with the real KES 50
collected in `docs/147` §11.

## 7. The guard

`src/app/api/v1/donations/payment-outcome-claims.test.ts`. ⚠️ **Derived at both
ends**: it executes the real classifier on a real no-response error to learn
which kind that is, then brace-matches the route's branch for *that* kind and
forbids the claim there. Renaming the kind, re-pointing the branch, or
reclassifying the timeout each fail it; pinning the string `'unknown'` would
have caught none of them.

⚠️ Its own first version failed on correct code: `indexOf("kind === 'configuration'")`
matched the **audit severity ternary** I had just added, so it brace-matched the
audit object and reported the configuration branch as carrying no reassurance.
Anchored on `if (kind === '…')` now.

Anti-vacuity in both directions — the branches that *can* substantiate the claim
must still make it, or the rule is satisfied by frightening every donor; and the
latch must not fire on other refusals.

**12 injections, all 12 behaved**, restore verified. Row 1 restores the real
production state (a timeout as `transient`) and fires; rows 11 and 12 must pass
(a comment quoting the claim, and a reworded-but-still-honest message, so the
rule checks the property rather than today's copy).

Gate: lint 1 pre-existing warning, typecheck clean, unit **8199 passed / 0
failed** (291 files, +10 tests).

## 8. What was NOT checked

- **The card rail.** `DonationForm` and `create-checkout` were not walked;
  `docs/125` established that rail answers 503 to everybody, so its refusal copy
  is the next thing to read, not this one.
- **The waiting and polling screens.** This walk stopped at initiation. What a
  donor sees when a prompt is raised and then expires, or when the poll returns
  FAILED, is untouched — and that is the path both production failures actually
  took.
- **Whether a lost response leaves a collection** — §2, [UNKNOWN] and
  unprovable without moving money.
- No screen reader; the `role="alert"` on the error is asserted to exist and its
  announcement was not heard.
