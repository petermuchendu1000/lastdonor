# 85 — Phone verification over SMS, exercised in the sandbox

**Date:** 2026-10-17
**Status:** Built and deployed with **sandbox** credentials, deliberately.
**Follows:** `docs/82` (phone normalisation), `docs/84` (the provider probes),
`docs/83` (trace the path a person clicks), `docs/41` (consent is a timestamp).

---

## Why this is in sandbox and not waiting for a live account

`docs/84` listed a live app, a registered Sender ID and account activation
as blockers. That framing was wrong, and the owner said so:

> "you must test with the sandbox first before we can test with real
> production!"

Correct. The sandbox exercises **every line of this code** — normalisation,
the minting, the send, the attempt budget, the consent gate — and the only
thing it does not do is make a handset ring. Waiting for a live key to
write any of it would have meant writing it all untested and then testing
it with real money on real strangers' phones.

So `AT_USERNAME=sandbox` is set on Fly and the flow runs end to end in
production. **The UI says so**, in as many words, rather than claiming a
text was sent (see "Sandbox is announced" below).

---

## The storage question `docs/82` left open

> `verification_tokens` (identifier/token/expires) already fits an
> `sms:+254…` identifier, but it carries **no attempt counter**, so
> brute-force resistance has to come from the `auth` rate-limit tier
> (`docs/44`) or from a new column. Decide before building.

**Decided: a table of its own, `phone_verification_codes`**
(`migrations-v2/0004`). Both alternatives were rejected, and for different
reasons.

### Rejected: `verification_tokens` with an added column

It is NextAuth's table, keyed on `(identifier, token)`. You cannot read
"the live code for this user" without already knowing the code — so there
is nowhere to hang a count, and adding a column would not give you one.
Overloading the adapter's own table with a second meaning is the smaller
objection; the primary key is the fatal one.

### Rejected: the rate-limit tier as the only guard

**A rate limit does not protect a six-digit code.** The limiter keys on
IP. An attacker spreading 1,000,000 guesses across addresses — or simply
being patient — walks through it, and nothing in the limiter notices that
all those requests are aimed at one code.

The counter has to live **on the code**. That is `attempts`, and it is what
turns one-in-a-million into **five-in-a-million**.

### What is actually stored

```
phone_verification_codes
  id            uuid pk
  user_id       uuid not null  -> users(id) on delete cascade
  phone_e164    text not null      -- the number being PROVED
  code_hash     text not null      -- sha256; never the code
  attempts      integer not null default 0
  expires_at    timestamptz not null
  consumed_at   timestamptz
  created_at    timestamptz not null default now()

  unique index on (user_id)        -- one live code per person
```

Three bounds, all in `src/lib/phone-verification.ts`:

| Bound | Value | Why that number |
|---|---|---|
| Attempts per code | **5** | 5/1,000,000. Not 3: people mistype a code they are reading off a screen, and 3/1,000,000 is not meaningfully safer. |
| Expiry | **10 minutes** | A code should not be a standing target. |
| One live code per user | enforced by the unique index, and by delete-then-insert | Without it, requesting 50 codes gives an attacker 50 targets and 250 guesses. |

Plus a **60-second resend cooldown**, which is not a security control but a
cost one: each send bills us and lands on somebody's handset, so a free
"resend" is a way to pay us to harass a stranger.

The code is stored as SHA-256. A database read must not hand somebody a
working code.

### A deliberate detail in `generateCode`

Six digits drawn one at a time from `randomInt`, not `randomInt(0, 1e6)`
padded. The padded version is correct too, but the per-digit form makes it
obvious that a code starting `0` is as likely as one starting `9` and the
space really is 10^6. A test draws 1,000 codes and asserts a leading zero
appears.

---

## Verifying a number is not consent to message it

`phone_verified_at` says the number reaches this person.
`sms_consent_at` says they agreed to be messaged. They are set by two
different calls, and `PATCH` fails closed: **consent cannot be granted for
a number that has not been verified**, or "they agreed" would be recorded
against whatever somebody typed into a box.

Timestamps, not booleans, for the reason `docs/41` gave about mail: "did
they agree" is never the question anybody actually asks — "when, and is
that still current" is.

---

## The route

`/api/v1/users/phone`, one file, four verbs:

| Verb | Does | Notes |
|---|---|---|
| `GET` | current state | the number comes back **masked**, even to its owner |
| `POST` | `{ phone }` → send a code | 503 when SMS is unconfigured, 429 on cooldown |
| `PUT` | `{ code }` → verify | the ONLY thing that writes `users.phone_e164` |
| `PATCH` | `{ smsConsent }` | 400 `PHONE_NOT_VERIFIED` if the number is not proved |

**An unverified number never enters `users.phone_e164`.** `POST` writes the
number onto the *code row*, not onto the user; only a code that came back
from that number promotes it. That column is the one anything sends to.

**The provider's own failure token is logged, not returned.**
`InvalidSenderId` and `SmsNotConfiguredError` describe our configuration
and tell the person nothing they can act on, so the caller gets
`SMS_SEND_FAILED` and the detail goes to the log.

### A new rate-limit tier, and the trap in adding one

`/api/v1/users/phone` sits under `/api/v1/users`, whose tier is 30/60 s —
far too generous for a path that bills us per request. It gets its own
`sms` tier at **5/60 s per IP**.

The trap: **both** the distributed tier lookup (`getLimiterTier`) and the
in-memory fallback (`ROUTE_LIMITS`) match by prefix in order, so the
narrower entry has to come first in **each**. Getting it right in one and
wrong in the other is completely silent — the in-memory path is the one
that runs whenever Upstash is unconfigured, which is every test run.
`rate-limit.sms.test.ts` drives the fallback to an actual 429 rather than
only asserting the tier name, and the ordering mutation turns it red.

### Two defects the production walk-through found, that tests did not

Both were caught by signing in to the deployed site and actually using
the flow (below), after 29 green unit tests.

**1. The tier covered every verb.** It matched on path alone, so GET (the
card reads its state) + POST (send) + PUT (verify) + PUT (the code was
mistyped) + PATCH (consent) is **five requests of entirely honest use** —
and the sixth got a 429. The limiter was refusing a person typing a code
we had just texted them.

Only `POST` costs anything, so the tier is now `isSmsSendRequest`: that
path **and** that verb. `PUT` is the one that looks like it still needs a
limit, and it does not — guessing a code is bounded by the per-code
attempt counter, which is the control that actually works. The original
unit test asserted *"covers every verb on the path, including the read"*
as though it were the intent; it encoded the bug. It now asserts the
opposite, with the reason.

**2. The in-memory limiter had no tier separation, and never has.**
Its key was `${ip}:${path}`. Upstash gives each tier its own Redis prefix,
so its buckets are independent — the in-memory store had nothing of the
kind, so two tiers sharing a path shared **one counter with two different
ceilings**, and the narrowest ceiling silently governed every verb. Fixing
defect 1 alone would not have helped: the free `PUT`s would still have
spent the send budget.

The key is now `${tier}:${ip}:${path}`. This is a pre-existing defect in
shared code, not something this change introduced — it was simply
unobservable until a path had two tiers on it.

---

## Sandbox is announced, not hidden

`GET` returns `smsSandbox`, and the card says, in the person's own view:

> **Test mode.** Codes go to the Africa's Talking simulator, not to a real
> handset.

and after a send: *"Test mode: the code went to the Africa's Talking
simulator, not to +254 ••••••678."*

Telling somebody "we sent you a text" while the message went to a simulator
is a false statement about something they are about to stare at a blank
phone waiting for. The honesty here is not decoration — it is the
difference between a testable deployment and a support ticket.

---

## Where a person clicks

`PhoneVerificationCard`, on `/dashboard/settings`, which is a page people
already visit.

This is `docs/83` applied before the fact rather than after: that document
exists because a working Didit integration shipped behind a link nobody
could reach, and the check it asks for — *trace the path from a signed-in
person to the feature, through the UI, before calling it done* — is the
reason this card exists in the same commit as the route.

---

## Tests

| File | Count | What it pins |
|---|---|---|
| `phone-verification.test.ts` | 23 | the attempt budget, expiry, one-live-code, consent separation |
| `rate-limit.sms.test.ts` | 6 | tier ordering in both lookups |
| (`africastalking.test.ts`) | 26 | `docs/84`, unchanged |

The fake `db` in the first models **one real mutable row** rather than
returning canned values, because the thing under test *is* the state
transition. Mutation-checked: deleting the `attempts` write — the
`docs/82` "no counter" world — turns three tests red, including the one
that matters, *"will not accept the correct code once the budget is
spent"*.

Full suite after this change: **5,821 passing across 159 files.**

---

## ⛔ Still open

- **A live app and its own API key.** The sandbox key answers 401 against
  the live host (`docs/84`), and Africa's Talking's connector docs say the
  sandbox key is not usable in production.
- **A registered Sender ID**, for live only. The sandbox needs none.
- **Nothing sends SMS except this flow.** Notification SMS — the other
  capability chosen in `docs/82` — is not wired, and should not be until a
  live account exists and `sms_consent_at` is actually being set by real
  people.
- **The region question from `docs/82` is still parked** and now has a
  price on it (`docs/84`: a US recipient costs 3.2× a Kenyan one through
  this aggregator).
