# 84 — Africa's Talking: what the sandbox actually does

**Date:** 2026-10-17
**Status:** Client built and exercised against the live sandbox.
**⛔ Not usable in production yet** — see "What is still blocked".
**Resolves the ⛔ in** `docs/82`. **Follows** `docs/81` (probe before you build).

---

## The question

> "let's understand the issue with africa talking / sandbox api"

The dashboard shows an orange banner — *"Your account is not fully active
yet; Interact with our APIs to activate it"* — and the help article says an
app you own must interact with the API, **and that if you choose SMS as
that interaction you need a Sender ID first**. That reads as a
chicken-and-egg: you cannot activate without sending, and you cannot send
without a Sender ID you have to be activated to get.

**It is not one.** The sandbox needs no Sender ID. Probed, not inferred.

---

## Probe transcript (2026-10-17, live sandbox, this account's key)

Every line below was run against `api.sandbox.africastalking.com`.

| # | Request | Result |
|---|---|---|
| 1 | `GET /version1/user?username=sandbox` | `200` `{"UserData":{"balance":"KES 5.0000"}}` |
| 2 | `POST /version1/messaging`, **no `from`** | `201` `status:"Success"` `statusCode:101` cost `KES 0.8000` |
| 3 | same, `from=LASTDONOR` | `201` `{"Message":"InvalidSenderId","Recipients":[]}` — **nothing sent** |
| 4 | `GET https://api.africastalking.com/version1/user?username=sandbox` | `401` `The supplied authentication is invalid` |
| 5 | `to=0712345678` (no `+`) | `201` **Success, delivered to `+254712345678`** |
| 6 | `to=notanumber` | `201` `status:"InvalidPhoneNumber"` `statusCode:403` cost `0` |
| 7 | `to=+12025550143` (US) | `201` Success, cost **`USD 0.0200` = `KES 2.5880`** |
| 8 | `message=` (empty) | `400` **`text/plain`**: `requirement failed: The message to send should not be empty` |
| 9 | no `message` field | `400` **`text/plain`**: `Request is missing required form field 'message'` |
| 10 | bad `apiKey` | `401` **`text/plain`**: `The supplied authentication is invalid` |
| 11 | no `Accept` header | `200` **XML**: `<AfricasTalkingResponse><UserData><balance>…` |
| 12 | send with balance `KES 0.0120` | `201` **Success**; balance went to `KES -0.7880` |
| 13 | `GET /version1/messaging/senderId` | `404 page not found` |
| 14 | `POST /version1/messaging/bulk` (JSON body) | `404 page not found` |

All VERIFIED by execution on 2026-10-17.

---

## The answer to the question

**The sandbox works, and it works without a Sender ID.** Row 2 is a
successful send with no `from` field. The help article's Sender ID warning
describes the **live** product; the sandbox falls back to the shared sender
Africa's Talking supplies. So the loop the banner appears to create is not real: an API
interaction can be made today.

**Whether a *sandbox* interaction clears the activation banner is not
something the API can tell us.** There is no account-status endpoint, and
the help article does not mention the sandbox at all — it says "an app you
own", and the sandbox app is one the account owns, but that is inference,
not a stated rule. The honest position: **five successful sandbox calls
have now been made from this account; refreshing the dashboard is the
test.** If the banner persists, the activation interaction must happen on a
live app, which means the real prerequisite is the one in the next section.

> **Resolved 2026-10-17, later the same day (OBSERVED).** The dashboard was
> refreshed and **the banner is gone**, alongside `Wallet: KES 10` and
> `Plan: Basic`. The account is activated.
>
> What this does **not** establish is the cause. We made the sandbox calls
> and the banner cleared, but nothing was controlled — the owner may have
> done something else in the console in between, and Africa's Talking
> publishes no account-status endpoint to check against. Record it as
> *"the banner cleared after sandbox activity"*, not as *"sandbox activity
> clears the banner"*.
>
> A related inference made in chat and **withdrawn**: that the live host
> answering `401` to the sandbox key proved the account was still
> unactivated. It proves nothing of the sort. A sandbox-scoped key is
> refused by the live host either way; key scope and account state are
> different facts.

**The key supplied is sandbox-only** (row 4: `401` against the live host).
A live app issues its own separate key.

---

## Three things about this API that will break a naive client

These are the reason `src/lib/africastalking.ts` exists at all rather than
a four-line `fetch`.

### 1. A failed send answers HTTP 201

Rows 2, 3 and 6 all returned `201`. `res.ok` is `true` for a delivered
message, for a rejected number, and for a request that sent nothing. The
outcome is in the body — and in the `InvalidSenderId` case there is **no
recipient entry at all**, so code that reads `Recipients[0].status` reads
`undefined` and has to decide what that means.

The client branches on `Recipients.length === 0` first (whole request
refused, reason in the top-level `Message`), then on
`Recipients[0].status !== 'Success'`.

### 2. Errors are `text/plain`, not JSON

Rows 8, 9 and 10. `await res.json()` throws on every one of them, and the
thrown parse error hides the actual cause. The client reads the body as
text, checks the status, and only parses when the request succeeded.

Row 11 is the same hazard from the other side: **without an explicit
`Accept: application/json` the API answers XML.** A client that omits the
header and calls `.json()` fails on the success path too.

### 3. Africa's Talking will guess the country for you

Row 5 is the one worth stopping on. `to=0712345678` — no country code —
was accepted and **delivered to `+254712345678`**. The provider applied its
own default region.

Row 7 shows the price of being wrong about that: a `+1` number costs
`USD 0.0200`, **3.2× a Kenyan SMS**, and sends successfully. A US local
number passed through raw would be read as Kenyan and dialled at somebody
else's handset, or a mistyped one would quietly bill international rates.

So `sendSms` normalises through `normalisePhone` (`docs/82`) before the
wire, against **our** `SMS_DEFAULT_REGION`, and refuses rather than sends if
the result is not valid. A raw string never reaches Africa's Talking.

### And a fourth: balance is not a guard

Row 12. With `KES 0.0120` left, a `KES 0.8000` send **succeeded** and the
balance went negative. `getSmsBalance()` is exported as a liveness probe —
it is the cheapest authenticated call — and nothing consults it before
sending, because it would not stop anything. A test pins that.

The reading also lags: the balance read `KES -0.7880` immediately after
row 12 and `KES -1.5880` at the start of the next session, with no send in
between. Treat it as indicative, not as an accounting record.

---

## What was built

`src/lib/africastalking.ts` — `sendSms`, `getSmsBalance`, `isSmsConfigured`,
`isSmsSandbox`, with the `NotConfigured` / `ApiError` split `src/lib/didit.ts`
uses, per the plan recorded in `docs/82`.

26 tests, **every response body in them copied verbatim from the probes
above**. A test written from an imagined payload would prove nothing here:
the whole defect class is that failure arrives inside a `201`. Mutation-
checked — deleting the per-recipient status check turns the
`InvalidPhoneNumber` test red.

The module was then run **unmocked against the live sandbox** (the
`docs/83` lesson: exercise the real path, not just the unit):

```
sandbox mode: true
balance     : KES -1.5880
local form  : {"ok":true,"to":"+254711082300","messageId":"ATXid_882d96…","cost":"KES 0.8000"}
bad number  : {"ok":false,"to":"notanumber","reason":"InvalidPhoneNumber"}
```

`0711082300` in, `+254711082300` on the wire — normalised by us.

### Decisions inside it

- **The environment is chosen by the username**, not a separate flag.
  `sandbox` → sandbox host, anything else → live host. Africa's Talking
  models it that way, a key only works against one environment anyway
  (row 4), and a separate boolean is one more thing that can disagree with
  the key.
- **`AT_SENDER_ID` is optional and only sent when set.** Row 3: an
  unregistered sender ID does not error, it silently sends nothing. Unset
  delivers; wrong delivers nothing. The safe default is unset.
- **No status-code table.** Only `101` and `403` were observed. The client
  branches on the `status` **string**, which is always present, rather than
  enumerating codes copied from a doc page nobody here has verified. The
  published list is real but unprobed, and `docs/82`'s own rule applies:
  do not ship a branch that has never been executed.
- **A rejected recipient is a return value, not a throw.** "That number is
  not reachable" is an ordinary outcome every caller must handle. Throws are
  reserved for the cases where we learned nothing: no credentials, transport
  failure, unreadable response.
- **Config is read per call**, so a missing key is a 503 on one request
  rather than a module that will not load.

---

## ⛔ What is still blocked, and by what

**Nothing in the product sends an SMS yet, deliberately.** The client is
exercised; the pipeline into it is not built, because three of its
preconditions are account-level and one is a design decision:

1. **A live app + its own API key.** The supplied key is sandbox-only.
   Africa's Talking's own connector documentation is explicit that the
   sandbox key is not usable in production: *"This connector currently only
   works with production ready applications, so DO NOT use the default
   sandbox application's API key."*
   ([learn.microsoft.com](https://learn.microsoft.com/en-us/connectors/africastalkingsms/),
   publisher Africa's Talking, retrieved 2026-10-17.)
2. **A registered Sender ID**, for live. Console step, not code.
3. ~~**Account activation**, if the banner survives the sandbox calls
   above.~~ **Done 2026-10-17** — see the resolution note above.
4. ~~**OTP storage.**~~ **Resolved by `docs/85`:** its own table with the
   attempt counter on the row, because `verification_tokens` is keyed
   `(identifier, token)` and has nowhere to hang one.
5. ~~**A consent gate that fails closed.**~~ **Built in `docs/85`:**
   `PATCH /api/v1/users/phone` refuses consent for an unverified number.

**Sandbox messages reach the Africa's Talking simulator, never a handset.**
`isSmsSandbox()` exists so nothing can report a simulator send to a person
as delivered.

---

## The region tension, restated because it now costs money

`docs/82` parked it: `SMS_DEFAULT_REGION` defaults to `KE` while the
Organization schema declares `areaServed: United States`. Row 7 attaches a
number to that — a US recipient is billed at `USD 0.02`, 3.2× a Kenyan one,
and Africa's Talking is a Kenyan aggregator whose US delivery is a
pass-through. If this platform is genuinely US-facing, **Africa's Talking is
the wrong SMS provider for it** and that decision should be taken before a
pipeline is built on top, not after.

The one thing that has not changed since `docs/82`: M-Pesa through this
same provider remains the only option on the table that would let the site
accept money at all, given `docs/72`.
