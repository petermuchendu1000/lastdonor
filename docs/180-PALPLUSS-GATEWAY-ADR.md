# 180 — Palpluss: a second M-Pesa rail, probed before it was written

**Status:** BUILT, TESTED, **NOT ROUTED**. No currency names
`gateway: 'palpluss'`, so nothing in production calls this code yet. The flip
is one line in `src/lib/money/currencies.ts`.

**Date:** 2026-11-24

---

## 1. What was decided

Palpluss (Nairobi; `api.palpluss.com`) is added as a **second M-Pesa
collection rail alongside PayHero**, not as a replacement for it. A client
(`src/lib/palpluss.ts`) and a callback-signature verifier
(`src/lib/palpluss-webhook.ts`) exist, with 78 tests, and the currency table
can route KES to it whenever the owner chooses.

### 1.1 The premise this started from was false

The work was requested as *"payhero was disabled"*. It is not.
**[VERIFIED twice, 20 minutes apart]** `GET /api/v1/health` in production
reports `payhero: ok`, and that check is not cosmetic — `health/route.ts:111`
calls `getWalletBalance` and `assessFloat`, so the credential authenticates and
the wallet answers.

That changed the shape of the task. Replacing a working rail that **102 files**
reference, and that is the only rail which has ever taken money here
(`docs/92`, `docs/147`), is a large money-path migration. Adding one beside it
is reversible and breaks nothing. Owner decision, after being shown the health
reading: **add alongside**.

⚠️ So this doc does **not** record that PayHero is being retired. If that is
wanted it is a separate decision, and `docs/150`'s float monitor, the abuse
guard, settlement, refunds and the health check all move with it.

---

## 2. The method: probe, then write

`docs/92` found four PayHero traps, *"every one absent from or contradicting
its docs"*. Palpluss's published documentation
(`docs.palpluss.com`) contradicts **itself** in twelve places, including the
auth header. So nothing below was taken from the docs without a probe, and
every claim is marked.

### 2.1 Findings that changed the code

**(a) A blank transaction id returns another tenant's ledger, with HTTP 200.**
[VERIFIED] `GET /v1/transactions/` — an empty path segment — collapses onto the
LIST endpoint and answers **200 with 20 rows from the whole tenant**.
`GET /v1/transactions/../transactions` does the same. A *malformed but
non-empty* id (`not-a-uuid`, `%20`) correctly answers 400, so **the dangerous
input is specifically the empty one**, which is exactly what an `undefined`
variable produces. This is PayHero's probed trap #2 in a new costume.

`getTransactionStatus` requires the **UUID shape** before a URL is built — not
merely non-emptiness, because `../transactions` is non-empty and reaches the
list. It also refuses a reply whose id is not the one asked for, which is cheap
and is the only thing that would catch a recurrence through some other path.

⛔ This is not theoretical. See §3: the tenant is shared, and those 20 rows are
other businesses' real customers.

**(b) The two endpoints of one flow use different casing — and different
names.** [VERIFIED by executing both against one transaction]

| | `POST /payments/stk` | `GET /transactions/{id}` |
|---|---|---|
| id | `transactionId` | `transaction_id` |
| phone | `phone` | `phone_number` |
| our reference | `accountReference` | `external_reference` |
| description | `resultDescription` | `result_desc` |
| fee | `transactionFee` | `transaction_fee` |

Both conflicting doc claims were right about one endpoint each, which is why
neither could be trusted alone. `pick()` reading either spelling is therefore
**load-bearing, not defensive habit**: committing to one would read `undefined`
on exactly one of the client's two calls, and an `undefined` transaction id is
a payment this platform cannot verify. Proven by injection in both directions —
snake-only fails 1 test, camel-only fails 11. ⛔ Do not tidy it into one
spelling.

**(c) HTTP 200 + `success: true` + `resultCode: "0"` does not mean the donor
paid.** [VERIFIED by a real KES 1 push] Initiation answered

```
200 {"success":true,"data":{"status":"PENDING","resultCode":"0",
     "resultDescription":"Success. Request accepted for processing"}}
```

and that same transaction settled 29 seconds later as
`{"status":"FAILED","result_code":"1038","result_desc":"No response from user."}`.

All three signals a caller would reach for were present on a payment that never
happened. PayHero's trap #1, measured here too.

**(d) The meaningful error code is nested one level deeper than the envelope
suggests.** [VERIFIED] A 404 carries `error.code: "HTTP_404"` — the status
restated — and the real code at `error.details.code:
"TRANSACTION_NOT_FOUND"`. Code reading `error.code` never sees it.

**(e) `error.message` is a string on some failures and an ARRAY on others.**
[VERIFIED] A 400 from `POST /payments/stk` returned
`["amount must be a positive number", "phone must be a string", …]` while the
404 returned a plain string. Handling only the string case discards the one
piece of text saying what was wrong, so a validation bug reports as "Bad
Request" and nothing else.

**(f) The service fee is prepaid, flat, and NOT charged on failure.**
[VERIFIED across 50 ledger rows plus the live push] `transaction_fee` is **3**
on every success at or above KES 10, **0** at KES 1, and **0** on all 26 failed
rows. The published pricing page says fees are charged even when a request
later fails; the ledger contradicts it. The fee comes from a prepaid service
wallet, so an empty wallet refuses collection before Safaricom is reached
(`402 INSUFFICIENT_SERVICE_BALANCE`) — the `docs/147` §11.3 hazard. ⛔ There is
no float monitor for this rail. `docs/150` is the shape one would take.

**(g) Palpluss throttles 2 pushes per phone per minute, and reports it as
`result_code: "17" "Rule limited."` rather than an HTTP error.** [VERIFIED: two
such rows in the ledger, both seconds after a burst to one number.]

⚠️ **Our existing guard is too permissive for this rail.**
`payhero-abuse-guard.ts` (renamed `mpesa-abuse-guard.ts` 2026-11-24, `docs/182`
§5) sets `RETRY_COOLDOWN_MS = 20_000`, which permits
**three** pushes a minute. Correct for PayHero, and here the third is silently
rule-limited. `MIN_PUSH_INTERVAL_MS` is **derived** as
`60_000 / STK_PUSHES_PER_PHONE_PER_MINUTE`, with a test asserting the product
is 60s and a tripwire asserting it stays stricter than PayHero's cooldown.

**(h) Both auth spellings work.** [VERIFIED] `Basic base64(KEY:)` and a raw
`Basic <KEY>` both authenticate; a fabricated key answers
`401 INVALID_API_KEY`, so the credential is genuinely checked rather than
ignored. We send real Basic auth — the trailing colon is the empty password.

### 2.2 What is still unverified, and marked as such

- **The webhook signature scheme has never been checked against a real
  delivery**, because no domain is registered (§3.2). It is implemented to the
  Standard Webhooks spec and its own published sample. `expectedSignature` is
  exported precisely so the first real delivery can be compared without
  re-deriving the algorithm by hand.
- **No payment has SUCCEEDED through this rail.** The live probe reached the
  handset and expired unanswered (`1038`). So `mpesa_receipt` on success, and
  the `SUCCESS` branch generally, are [UNVERIFIED by execution].

---

## 3. The tenant is shared, and that is the main open risk

The key supplied belongs to a Palpluss tenant **shared with at least two other
products**. [VERIFIED from its own ledger] callbacks point at
`invest254-api.fly.dev` and `printpesa.com`; references include `Invest254`,
`TamuTraders`, `Madolar`, `66Investors`; there are successful collections up to
KES 500 from ~15 distinct third-party phone numbers.

This is `docs/86`'s shared-`elopis` problem and `docs/92`'s BETWOIN problem
again. **Owner decision: LastDonor gets its own Palpluss account.** So
`PALPLUSS_API_KEY` in production must be that tenant's key, not the shared one.

Two consequences hold either way:

### 3.1 Reference namespacing is mandatory, and the limit is tight

`accountReference` is `maxLength: 12`, which leaves **9 characters** after
`LD-`. A UUID does not fit, so a caller passes a short id and keeps the mapping
in our own table. The `LD-` prefix is enforced at the one place a reference
reaches the wire, reusing `LASTDONOR_REFERENCE_PREFIX` from `payhero.ts` rather
than declaring a second answer to one question (`docs/146`).

⚠️ The 12-char limit is **not enforced server-side** — the shared ledger holds
`PAL-1795473367727` (17 chars), accepted and settled. We hold to the documented
limit anyway: an unenforced limit is one that starts being enforced one day.

### 3.2 Callbacks will arrive UNSIGNED until a domain is registered

Palpluss signs **per domain**, configured in its console (Webhooks → Add
domain), and callbacks to an unregistered domain are delivered unsigned. So
`lastdonor.org` must be added in the LastDonor tenant. **Owner action.**

`verifyPalplussSignature` reports that as `unsigned` rather than `invalid`,
because conflating "nobody signed this" with "someone forged this" would make a
correct delivery look hostile.

⛔ **And it is survivable, because a callback body is never the outcome.** The
route must read one id from the body and then re-ask Palpluss over our own
authenticated call — the `docs/81` / `docs/92` shape. A forged callback
claiming a nine-million-shilling success is then ignored because nothing in it
is believed, not because a signature caught it.

---

## 4. Rejected alternatives

**Replace PayHero now.** Rejected on §1.1: it works, 102 files reference it, it
is the only rail that has ever collected money, and there would be no fallback
if Palpluss misbehaved.

**Route KES to Palpluss in this commit so the path is exercised.** Rejected.
`docs/81`, `docs/76` and `docs/77` forbid shipping an *unexercised* provider
path, and that rule is satisfied differently here: the path is exercised by 78
tests and by a real push against the live API. Pointing production donations at
a rail that has never completed a single successful collection (§2.2) would be
the larger risk. The dormancy is a recorded owner decision, not an oversight.

**Use `minorToMajor()` for the gateway amount.** Rejected — its own contract
says the float it returns must *"never be sent to a gateway"*. The client
proves whole-shilling alignment first and then divides exactly, mirroring
`payhero.ts`. A fractional shilling is **refused, not rounded**, for the reason
that client already gives: rounding money without telling anyone is how a
ledger stops matching a bank.

**Trust a signed callback as the outcome.** Rejected; see §3.2.

**A tighter IP rate limit instead of a per-phone interval.** Rejected for
`docs/85`'s reason, which `docs/127` restates: the cost lands on a resource
keyed by something other than the caller's address. An attacker spamming a
stranger's number gets that bystander throttled, and an IP limit cannot see it.

---

## 5. What a test could not catch, and what was done instead

**A timing side-channel is invisible to every functional test.** An injection
replacing `timingSafeEqual(left, right)` with `a === b` **passed all 71 tests**
in the signature suite. The comparison stays functionally correct — it matches
when it should and not when it should not — so no assertion about *results* can
see the difference.

So the property is asserted **structurally**: the module must call
`timingSafeEqual`, must guard the length first (it throws on a mismatch), and
must not compare a candidate with `===`. With an anti-vacuity control, because
every rule in that block is a `not.toMatch` and a stripper that ate the file
would satisfy all of them (`docs/163` §5.1).

This is the mirror of `docs/162` §5.1: there, text could not see which way a
branch pointed and the fix was to execute a pure function. Here, execution
cannot see the property at all and the fix is to read the text.

### 5.1 Injection record

22 rows, all behaving: 20 fire, 2 MUST-PASS rows stay green (a comment-only
edit, and a refusal's wording changing while the property holds — so the rules
check the property and not today's copy). sha256-verified clean restore after
every row.

⚠️ Three rows misbehaved on the first run and each was informative:
- Row 17 was the **real hole** in §5 above.
- Two were **my own harness bugs** (bad anchors — one escaped `&&` wrongly, one
  quoted a string that lives inside a ternary).
- And the corrected run was briefly **measured against a dirty baseline**: the
  new structural test used `import.meta.url`, which is not a `file:` URL under
  this vitest config and throws during **collection** — printing
  `Tests  no tests` with **no failure line**, which the harness read as zero
  failures. `docs/124` §5.1 and `docs/138` §6.1 both record that exact trap.
  The harness now prints the **Test Files** line too, so a collect failure
  cannot read as a pass. Use `path.resolve(__dirname, …)`, as
  `auth.enumeration.test.ts` does.

---

## 6. The live probe

Owner-authorised, KES 1 (the free fee band), to the owner's own test handset.

⚠️ **That number is deliberately not written down here, and the test fixtures
do not carry it either.** This repository is public (`private: false`), and a
real, dialable mobile number in a public repo is harvested. The fixtures use
`0712345678` — already this codebase's placeholder in 46 places, and the number
Palpluss's own docs use as their example — so the tests still exercise real
`libphonenumber` normalisation without publishing anybody's number. The live
probe read the real one from the environment at run time.

⚠️ **A pre-existing instance was noticed and left alone:** `0713572703` appears
10 times in `src/lib/payhero*.test.ts`, and a number in that exact form
(`254713572703`) shows up as a real settled transaction in the Palpluss
ledger — so it may be somebody's actual number, committed some time ago.
Reported rather than churned, since rewriting another rail's fixtures is not
this change's business, and the history would keep it anyway.

⚠️ It was run **against the raw API, not through `initiateStkPush`** — and
deliberately. KES 1 is below `CURRENCIES.KES.minDonationMinor` (KES 50), so the
client correctly refuses it. Probing the contract and weakening a donor-facing
floor are different things.

Result: prompt delivered, `PENDING`, then `FAILED` / `1038 "No response from
user."` 29 seconds later. Nothing charged (`transaction_fee: 0`, no receipt).
The prompt reached the handset and was not answered, which is a user action and
not a defect — and it still settled findings (b), (c) and (f).

**Settlement was by POLL, with no callback endpoint in existence.** That is
`docs/92`'s lesson holding: the status poll settles a payment on its own, so no
deploy was needed to learn the contract.

⚠️ The probe's first run reported every field as missing
(`"phone must be a string"`), which reads exactly like a rejected request. It
was a **broken probe**: `curl --config -` and `--data-binary @-` both read
stdin, so the config consumed it and the body never arrived. The body goes in a
file now. It did, however, expose finding (e).

---

## 7. Still open

- ⛔ **OWNER:** create the LastDonor Palpluss tenant and set
  `PALPLUSS_API_KEY` from it (§3). The probed key is the shared one.
- ⛔ **OWNER:** register `lastdonor.org` as a webhook domain in that tenant, or
  callbacks stay unsigned (§3.2).
- ⛔ **OWNER:** decide whether KES routes to Palpluss. One line, and it should
  wait for a successful collection (§2.2).
- ✅ **AMENDED 2026-11-24 by `docs/181`:** the callback route, the
  `palpluss_payment_requests` table and the settlement path are now BUILT and
  tested. Still not built: the **initiate** route (so nothing writes a row
  for that settlement to settle), a float monitor (§2.f), the per-phone guard
  wired to `MIN_PUSH_INTERVAL_MS` (§2.g), a status-poll route, and B2C
  payouts. None of it is needed while the rail is unrouted, and all of it is
  needed before it is.
- `redis: error` appeared in production health during this session (`ok` at
  00:17, `error` at 00:36). Unrelated to this work. Not fatal — the limiter
  falls through to an in-memory backstop, and with one app machine that is
  close to equivalent — but it is new and nobody was told.
