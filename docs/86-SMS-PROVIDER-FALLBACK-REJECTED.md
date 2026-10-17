# 86 — No second SMS provider, and the Africa's Talking account is the wrong one

**Date:** 2026-10-17
**Status:** Decided. TalkNTalk rejected; LastDonor needs its own Africa's
Talking app.
**Follows:** `docs/82` (phone foundation), `docs/84` (the AT probes),
`docs/85` (the verification flow built on them).

---

## What was asked, and what was decided

A second SMS provider — **TalkNTalk** — was proposed as a fallback behind
Africa's Talking, with a live API key supplied.

**Decided: no second provider.** The live blocker is an Africa's Talking
*account* problem, and it is free to fix inside the account we already
have. A fallback was rejected for a reason stronger than any doubt about
the vendor: **it shares the upstream it is supposed to fall back from.**

The key was probed as far as authentication, never used to send, and has
been removed from the session environment. It should be deleted at the
provider rather than left live.

---

## The Africa's Talking account is Elopis's, not LastDonor's

This is the finding that actually matters, and it was invisible until a
screenshot of the callback settings arrived.

**VERIFIED 2026-10-17** from the AT app console: the app is `elopis`, and
its Delivery Report callback is
`https://elopis.com/api/webhooks/africastalking/dlr?token=…`. The
`KES 10` wallet is that product's.

LastDonor must not send through it. Four reasons, and the first is
structural rather than a preference:

| | Consequence |
|---|---|
| **One callback URL per app** | Delivery Report, Incoming Messages, Bulk SMS Opt-Out and Subscription each take exactly **one** URL. Point them at lastdonor.org and Elopis's break; leave them and ours go to elopis.com. **There is no configuration in which both products work.** |
| **One sender ID** | A LastDonor verification code would arrive branded with Elopis's registered sender name. A code claiming to be from a different company is indistinguishable from phishing, and it is the single message where that matters most. |
| **One opt-out list** | AT's opt-out and blacklist are per-app. Someone who texts STOP is opted out of **both** products. After the care `docs/41` took over mail consent, silently coupling two products' consent states is not a trade this codebase makes. |
| **One wallet and one message log** | LastDonor's sends spend Elopis's credit, and neither product's delivery history is separable from the other's. |

**The fix is a second app under the same account.** Verification lifted
the account to 5 apps per team (`docs/84`), so there is room. Each app
carries its own username, API key, four callback URLs and sender ID, while
still drawing on one account wallet — which is the right split: separate
identity and consent, shared billing.

### The live key that would not authenticate

**OBSERVED, UNRESOLVED.** A live key was generated and probed against
`api.africastalking.com` with username `elopis` and 15 other candidates,
in three case variants, and once a minute for eight minutes to rule out
the documented propagation delay. Every attempt: `401`.

It cannot be diagnosed further from outside. **Africa's Talking returns
the identical `401` for a wrong key and a wrong username**, and exposes no
endpoint that validates a key without one — so key-is-dead and
username-is-wrong are indistinguishable by probing. Guessing was stopped
deliberately rather than continue generating failed auths against a live
account.

A new app sidesteps it: a fresh key with a known username is unambiguous.

---

## TalkNTalk: assessed, and rejected on architecture rather than doubt

`talkntalk.africa`, "a brand of Techspace Softwares Limited".

### What verified (2026-10-17)

- **The parent company is real.** Techspace Softwares Limited, Nairobi,
  Garage Kilimani / Pine Tree Plaza on Ngong Road, founder James Kimamo,
  ~10 staff, with a
  [TechBehemoths profile](https://techbehemoths.com/company/techspace-softwares-limited)
  and directory listings dating it to 2014–2017.
- **The domain is not fresh.** 104 certificates in CT logs, the earliest
  **2025-03-08**, with `api.` and `data.` subdomains on 2025-03-10.
- **The API is real and better designed than Africa's Talking's.**
  `POST https://api.v1.talkntalk.africa/v1/sms/send/`, Bearer auth plus
  `X-Organisation-Id`, `201` on accept, and genuine status codes
  (`400`/`401`/`402 insufficient_balance`/`429` with `Retry-After`).
  Probed: it distinguishes *"Authentication credentials were not
  provided"* from *"Missing 'X-Organisation-Id' header"* — where AT gives
  one indistinguishable `401`.
- **Terms and privacy are legally literate**, citing Kenya's Data
  Protection Act 2019 and separating controller from processor correctly.

### What did not

- **"5+ years in business messaging" is false for the brand.** First
  certificate 2025-03, first Wayback snapshot **2026-10-10, seven days
  before this was written**. The parent is that old; the brand is not.
- **"600M+ messages sent" and "2,000+ organisations" are unverifiable**,
  and sit badly against a brand with no independent web footprint — three
  searches returned zero mentions anywhere.
- **No phone, postal address or company registration number** on the site;
  only an email and a `mailto:` form. The parent's own listings carry both.
- **Not corroborated from the parent's own site.** `techspace.co.ke`
  returned 0 bytes to curl and `503` to a second fetch. **Inconclusive, and
  counted as neither evidence for nor against.**

**Assessment: a real small Nairobi firm with a recently launched messaging
brand, overstating that brand's track record.** Sloppy marketing, not
fraud. Recorded plainly because "I think it's a scam" is exactly the kind
of judgement that gets repeated without evidence, and the evidence does
not support it.

### Why it was rejected anyway

**Its delivery-code table is Africa's Talking's, verbatim** —
`100 Processed`, `101 Sent`, `102 Queued`, `401 RiskHold`,
`402 InvalidSenderId`, `403 InvalidPhoneNumber`, `404 UnsupportedNumberType`,
`405 InsufficientBalance`, `406 UserInBlacklist`, `407 CouldNotRoute`,
`409 DoNotDisturbRejection`, `500/501/502`. Identical numbering and
identical names to the table in `docs/84`.

That is not coincidence. TalkNTalk is reselling Africa's Talking or
sitting on the same upstream aggregator. Therefore, as a *fallback*:

1. **It does not remove the shared failure.** Gateway down, both down. A
   fallback sharing an upstream is not redundancy.
2. **It adds a second data processor** holding donors' phone numbers and
   message bodies — a ~10-person company to whom we would owe a DPA-2019
   processor agreement.
3. **It buys only account-level redundancy** — a dead key, an empty
   wallet, an unregistered sender ID. Real problems, and today's problems,
   but ones fixable inside Africa's Talking for free.

Paying in donors' privacy for redundancy that is largely illusory is the
wrong trade.

### Rejected alternatives, recorded so this is not reopened

| Option | Why not |
|---|---|
| **TalkNTalk as fallback** | Shares AT's upstream (above). Adds a processor without removing the failure mode. |
| **Send LastDonor through the `elopis` app** | Callbacks are one per app; the two products cannot both work. Plus a shared sender ID and a shared opt-out list. |
| **Keep hunting for the `elopis` live username** | AT cannot distinguish a bad key from a bad username, so the search has no termination condition, and each attempt is a failed auth against a live account. |
| **Any second provider, right now** | Worth revisiting only once LastDonor's own AT app works and there is a measured baseline to be redundant *about*. A second provider chosen before the first one sends a message is redundancy against nothing. It must also be one that demonstrably does **not** sit on AT — the delivery-code table is the test. |
| **Statum, mSpace, TextSMS, Celcom** | Surfaced while searching; none evaluated. Not rejected on merit — simply not needed yet. Recorded so the next person starts from a list rather than a search. |

---

## What is unchanged

Production still runs on the Africa's Talking **sandbox** key, which works
(`200`, balance `KES -7.1880` at the time of writing) and which generating
the live key did **not** rotate. `docs/85`'s verification flow is live and
announces test mode in the UI. Nothing in this document changed any code.

## ⛔ Still open

1. **Create a LastDonor app** in the Africa's Talking console, and
   generate its key. Console work; nobody else can do it.
2. **Point its four callbacks at lastdonor.org.** None of them are
   consumed yet — delivery reports in particular are a real capability we
   do not have, and worth wiring once the app exists.
3. **Register a sender ID** for it, if the live probe shows one is needed.
   The sandbox needs none (`docs/84`); live is untested.
4. Then flip `AT_USERNAME` off `sandbox` and redeploy. That one variable
   is the entire switch between the simulator and real handsets.
