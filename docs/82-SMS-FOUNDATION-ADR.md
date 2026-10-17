# 82 — Phone numbers, before any SMS provider

**Date:** 2026-10-17
**Status:** Foundation implemented. **⛔ The Africa's Talking client itself
is NOT built — it needs a sandbox key.**
**Chosen capabilities:** SMS notifications + phone verification (OTP).
**Related:** `docs/41` (mail consent and CAN-SPAM, the same shape),
`docs/81` (the probe-first rule this follows).

---

## Why this exists before the provider

Africa's Talking was asked for. Every capability it offers — SMS, OTP,
USSD, mobile money — sends to an **E.164 number**, and this codebase did
not have one.

What `users.phone` actually was, before today:

| | |
|---|---|
| Type | free text |
| Written by | an admin, on one screen |
| Validated | never |
| Normalised | never |
| Verified | never |
| Consent recorded | never |
| Read by | **nothing** |

Sending to that column would have meant sending to whatever somebody once
typed into a box. So the foundation goes in first, and it is the same
foundation whichever Africa's Talking capability ships.

---

## What was built

### `src/lib/phone.ts`

`normalisePhone()` → E.164 or `null`, `isSendablePhone()`, `maskPhone()`.

**A library, not a regex.** `libphonenumber-js@1.11.17`. African numbering
plans are not uniform — Kenya is 9 digits after `+254` with a leading `0`
locally, Nigeria is 10 after `+234` — and a regex that looks right for one
silently accepts nonsense for another. Checked against the library before
the module was written (2026-10-17, VERIFIED):

```
0712345678   + KE  -> +254712345678  (KE)
+2348012345678     -> +2348012345678 (NG)
+256772123456      -> +256772123456  (UG)
+254712345         -> INVALID  (too short for its country)
+15551234567       -> INVALID  (555 is a reserved US range)
```

That last line is the argument for the dependency: a number of the right
length and the right shape that still is not dialable. A length check
passes it; the library does not.

`null` rather than a throw, because an unusable number is an ordinary
outcome of a text input and every caller has to handle it anyway.

### `maskPhone()`

`+254712345678` → `+254 ••••••678`. A phone number is personal data and it
will land in audit rows, error logs and support conversations read by
people who do not need all of it. One masking function, so no call site
invents its own slice. Enough for a person to say "yes, that's mine"; not
enough to dial.

### Schema (`migrations-v2/0003`)

```
users.phone_e164          text        -- the only number anything sends to
users.phone_verified_at   timestamptz
users.sms_consent_at      timestamptz
```

`users.phone` is **kept** as the free-text display value a human typed.

**Timestamps, not booleans** — the same choice `docs/41` made for mail
consent. For a message somebody did not ask for, "did they agree" is never
the question that actually gets asked; "when, and is that still current"
is.

---

## The default region is a product decision, and it is parked in one place

`DEFAULT_REGION`, from `SMS_DEFAULT_REGION`, defaulting to `KE` because
that is where the SMS provider operates.

This is worth naming rather than burying: the Organization schema in
`src/app/layout.tsx` declares `areaServed: United States`, and every live
campaign is a US city. A US-facing platform is acquiring a **Kenyan-default
phone pipeline**. `0712345678` is a Kenyan mobile here and is nothing at
all in the US.

A test pins the consequence directly: the same local string read against
the wrong region is **rejected, not silently re-homed** to a different
valid number. That is the failure mode worth guarding — a wrong region does
not produce an error, it produces a plausible wrong number.

Whoever decides which markets this serves resolves it at that constant, not
in a form handler.

---

## ⛔ What is NOT built, and why

**The Africa's Talking client.** No credentials exist — not in Fly secrets,
the session environment, or `.env.example`. Africa's Talking requires a
username *and* an API key even for sandbox, so the API cannot be probed.

`docs/81` is three days old and says, about exactly this: writing a
provider branch that has never been executed is what `docs/76` and
`docs/77` were about. The same rule applies to its own successor. **The
client gets written after a sandbox key exists and the endpoints have been
probed**, not before.

What that work will need, recorded now so it is not rediscovered:

1. `AT_USERNAME` (`sandbox` for the sandbox environment) and `AT_API_KEY`,
   as Fly secrets.
2. A client in `src/lib/africastalking.ts`, written against probed
   responses, with the `NotConfigured` / `ApiError` split `src/lib/didit.ts`
   uses and a `SMS_UNAVAILABLE` → 503 code.
3. OTP storage. `verification_tokens` (identifier/token/expires) already
   fits an `sms:+254…` identifier, but it carries **no attempt counter**,
   so brute-force resistance has to come from the `auth` rate-limit tier
   (`docs/44`) or from a new column. Decide before building.
4. A consent gate that fails closed, like `SEED_DONATIONS_OPT_IN` in
   `docs/41`: no `sms_consent_at`, no message.
5. Sender ID / shortcode registration, which is an account-level step in
   the Africa's Talking console, not code.

---

## A note on scope

Four capabilities were on the table (SMS, OTP, mobile money, USSD). SMS and
OTP were chosen. **Mobile money was not**, and it is worth recording why
that choice is live rather than closed: `docs/72` means the platform cannot
take a single donation, because the Stripe key is a placeholder. M-Pesa
through Africa's Talking is the one option on that list that would make the
site able to accept money at all. It remains the highest-value thing this
provider could do here.
