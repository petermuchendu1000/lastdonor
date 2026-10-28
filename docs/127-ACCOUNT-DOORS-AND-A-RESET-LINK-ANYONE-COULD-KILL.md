# 127 — The account doors: two claims nothing backs, and a reset link anyone could kill

**Date:** 2026-10-28
**Journey:** 9 of the end-to-end walk (sign-in and credentials), continued from
`docs/126`
**Status:** three findings fixed and injection-proven, one reported and
deliberately not fixed (§6), nothing deployed (the owner deploys)
**Read before touching** `/login` or `/register` copy,
`src/lib/password-reset-tokens.ts`, or `anonymiseAccount`.

---

## 1. The journey, walked in a browser

`/login` → `/register` → `/login/forgot-password` → `/login/reset-password`,
desktop (1280) and mobile (390), against production at **v113**. Fourteen
screenshots. Error states exercised with a deliberately non-existent address
(`j9-probe-nobody@example.invalid`), so `recordFailedAttempt`'s UPDATE matched
no row and no real account could be locked by the measurement.

What already works, recorded so it is not re-investigated:

| surface | state |
|---|---|
| wrong password | *"Incorrect email or password. Check both, or continue with Google."* — `docs/46`, correct |
| forgot-password submitted | *"If an account with that email exists…"* — `docs/32`/`docs/74`, correct |
| reset link, bogus token | **Invalid Link** with "Request a new reset link" — correct |
| email normalisation | `.trim().toLowerCase()` on all five validators **and** `auth.ts:340`. No case-mismatch dead end |
| console / HTTP errors | **none** across all ten page loads |

---

## 2. ⛔ Finding 1 — the reset link anyone could kill, and the inbox anyone could fill

`POST /api/v1/auth/forgot-password` takes an address from an anonymous body
and, on every accepted call, (a) **mails that address** and (b) **deletes the
live reset token** before minting a new one. Its only control was the `auth`
rate-limit tier.

### 2.1 Evidence — three methods, from three directions

**Method 1 — the route.** `route.ts:85-93` (before this change) was
`DELETE … WHERE identifier = 'reset:<email>'` then `INSERT`. One live token per
address, by construction.

**Method 2 — executed against a real Postgres.** Reproducing exactly those two
statements:

```
after request 1 | live_tokens 1 | token_one_valid t
after request 2 | live_tokens 1 | token_one_valid f | token_two_valid t
```

The first link is dead. Not inferred — run.

**Method 3 — the live tier, probed against production.** Thirteen POSTs with a
malformed body, which the limiter (middleware, *before* the handler) counts and
which can therefore send no mail at all:

```
 1..10 -> 400      (reached the handler)
11..13 -> 429      (the limiter)
```

So the tier is real, it is enforced on this path, and it is exactly
`slidingWindow(10, '60 s')` **per IP**.

Put together: one stranger who knows an address could put **ten emails a
minute** into that inbox — off the single shared Resend quota every
transactional email on this platform draws from — and kill the recovery link
roughly **every six seconds**.

### 2.2 ⚠️ Gate 3 — the falsifier, which partly held

**"What would most likely falsify this?"** → *every one of those requests mails
a fresh, valid link to the victim's own inbox, so they always have a working
link.*

**That is true**, and it narrows the claim: this is a **race, not a permanent
lockout**. The newest email works if the person reaches it in time — which at
ten a minute is a mean window of about six seconds between the link being
minted and the next request destroying it, against a human reading an email,
finding the link and loading a page.

It is recorded this way rather than as "password recovery can be denied"
because the second is bigger than the evidence. What makes it matter anyway is
the composition: the account lockout is **per email address** by design
(`docs/126` §7), so one stranger could hold an account locked *and* make
recovering it a race.

### 2.3 The fix — a per-address cooldown, and why not a tighter IP tier

`src/lib/password-reset-tokens.ts`. One send per address per **60 seconds**.

This codebase has already reasoned this out once, for the identical hazard.
`phone-verification.ts:145` carries `RESEND_COOLDOWN_MS = 60_000` and justifies
it in its own comment — *"A cooldown, not a rate-limit tier. Each send costs
real money"* — and `docs/85` states the general form: **an IP limit does not
protect a resource keyed by something other than IP.** Email is the same shape
at a lower unit price. The cost lands on a mailbox and on a shared quota;
neither is keyed by who asked.

Three properties worth keeping:

- ⛔ **The claim is ONE statement.** `INSERT … ON CONFLICT DO UPDATE …
  WHERE expires <= now RETURNING`. A read-then-write would let ten concurrent
  callers all read "no cooldown" and all send — which is not a hypothetical
  here, it is the attack, and it is precisely the shape `docs/126` measured on
  the login lockout three days ago (five concurrent attempts recorded 2).
- ⚠️ **It is claimed BEFORE the account lookup**, so all three `docs/74`
  outcome branches share one decision. A cooldown applied only where a token is
  minted would throttle real account holders, leave every other address
  unprotected, and make the difference observable.
- ⚠️ **It does not reopen `docs/32`'s oracle.** The HTTP response is byte for
  byte identical, and `docs/74`'s property survives: *"a reset link has been
  sent"* stays true of that mailbox, because a send inside the last minute is
  exactly what suppresses the next one.

⚠️ No migration. `verification_tokens` is keyed `(identifier, token)`, so a
constant token under a `reset-cooldown:` prefix is one row per address, and
`expires` is the timestamp. `docs/85` noted there is nowhere on that table to
hang an attempt *count*; a cooldown needs only a time.

⚠️ `sql.param(value, column)`, not `${date}` — the `docs/107` trap, two Dates in
one statement. Injection 3 below confirms it is live.

---

## 3. ⛔ Finding 2 — two claims on the two front doors

CLAUDE.md: *never add a claim the platform cannot substantiate.*

### 3.1 `/login` — "…and saved campaigns."

*"Log in to track your donations and saved campaigns."*

[VERIFIED three ways] There is **no saved-campaigns feature**: nothing matching
`saved|bookmark|favou?rite|watchlist` in `schema.ts`; no route; no component,
button or handler anywhere in `src/`. Before this change the words **"saved
campaign" appeared in exactly one place in the entire codebase** — the sentence
promising them.

⚠️ `docs/122` deleted the **identical** claim from `/register` ("Save campaigns
and get updates as they close") and the sweep did not reach the sibling page in
the same flow.

Now: *"Log in to see the campaigns you have supported and the updates you
follow"* — `/dashboard/supported` and `/dashboard/subscriptions`, both of which
exist.

### 3.2 `/register` — "Ask for your money back without digging out a receipt."

A benefit of **registering** that registering does not confer.

| method | result |
|---|---|
| route enumeration from disk | every refund route is under `/api/v1/admin/`. No donor-facing one exists |
| the donor dashboard | `refund` appears on those screens **only** as the SQL filter `refunded = false`. Zero controls |
| the platform's own policy | `/refund-policy:88-97` tells the donor to email support with *"the donor email address, donation date, campaign name, amount, and a short explanation"* — which **is** the receipt |

So the two pages contradict each other, and the stronger claim is the one on
the signup page.

⚠️ **A correction to my own first reading.** An admin *can* find a donation
from the address alone — `admin/donations/route.ts:46`,
`ilike(donations.donorEmail, pattern)` — so the effort the claim offers to save
is real and achievable. What is false is that an **account** saves it: a guest
emails support in exactly the same way, and 1 of the 2 real donations this
platform has ever taken was a guest's. Making the claim true means building a
donor-facing refund request, which is a product decision, not a copy edit.

Replaced with something account-only and verified: `SidebarShareButton.tsx:63`
mints an attributed `/s/<token>` only `if (isAuthenticated)`, and
`/dashboard/impact` reports what each link brought in (`docs/57`, `docs/58`).

### 3.3 Checked and found substantiated

Recorded so the other two bullets are not re-litigated: *"Track every donation
and the impact it made"* (`/dashboard/supported` lists them per campaign with
totals) and *"Get campaign updates by email, and stop them whenever you want"*
(`/dashboard/subscriptions` plus `DELETE /api/v1/campaigns/[slug]/subscribe`,
which accepts a session **or** a signed token — `docs/40`).

---

## 4. ⛔ Finding 3 — a fifth store erasure had never looked at

Found while adding the cooldown, because the cooldown would have made it worse.

`verification_tokens.identifier` holds the address as **plaintext**
(`reset:<email>`), the table has **no foreign key to `users`** —
`reset-password/route.ts:97` says so itself — and `anonymiseAccount` never
touched it. So an erased person's address survived them there, and this change
would have written a second row holding it.

`docs/124` checked four stores and was explicit that *"a hand-written list is
only as good as whoever remembered to extend it"*. This is that, one journey
later.

⛔ The identifiers come from `resetTokenIdentifiersFor` in the module that
**writes** them, not from a second list of prefixes in the erasure file, and
they are matched **exactly** rather than with a `LIKE`: `%` and `_` are legal
in the local part of an address, so a pattern built from one erases other
people's rows. A control test asserts a bystander's rows survive — injection E2
below is exactly that mistake, and it fires.

---

## 5. The tests, and what each would have to see to fail

### 5.1 `password-reset-tokens.integration.test.ts` — 9 tests, real Postgres

The real functions, not a replica of their SQL (`docs/101`'s trap in test
form). It asserts the security property (**a live link survives ten requests
from somebody else**), its control (**a genuine re-request after the cooldown
DOES replace the token**, so the single-live-token invariant the reset route
depends on is intact), both window boundaries, that each address is throttled
**separately** (a per-address control that became global would be a denial of
service wearing the costume of a rate limit), that ten concurrent claims
produce exactly **one** winner over three rounds — a race is probabilistic —
and the cheapest one, that the statement runs at all.

| injection | fails |
|---|---|
| no cooldown (always claim) | 5 |
| read-modify-write instead of one statement | **1** — and that is the point: the concurrent test is the *only* one that can see it |
| bare `Date` for `sql.param` (`docs/107`) | 8 |
| suppress everything (denies recovery) | 8 |
| `issueResetToken` stops replacing the old token | 1 |

### 5.2 `forgot-password/route.test.ts` — the call site

A sealed module is worthless if the caller works around it (`docs/111`). Four
new tests: nothing is sent **and nothing is deleted** when suppressed; the
response is identical whether it sent or suppressed (a different one would be a
*new* oracle, worse than the one `docs/32` closed, because "this address was
mailed a minute ago" is a fact about somebody else's account); the control that
it still sends otherwise; and that the claim is made **before** the lookup.

⚠️ **Gate 4 caught that last one being unable to fail.** It searched the source
for `claimResetSend` and matched the **import on line 9**, which is above
everything — so moving the call below the lookup left it green. It now looks
for `await claimResetSend(`, and the injection fires.

### 5.3 `account-promises.test.ts` — the sweep, both ends derived

Neither rule pins today's answer. **Rule 1**: if the copy names a saved or
bookmarked campaign, `schema.ts` must declare storage for one. **Rule 2**: if
the copy promises anything about refunds, a donor-facing refund route must
exist — discovered from disk, with `admin/` excluded. Build either feature and
the rule passes on its own.

⚠️ **Scope, and why it is a boundary and not an exception.** The first version
also swept `src/components/user/` and fired on `AccountPageClient.tsx:397`,
where *"Refunds, campaign status changes, verification and withdrawal notices"*
is the **label on a notification toggle** — factual, correct. The rule was too
wide, not the copy wrong. The line taken is the one the file is about: a screen
that **sells** an account, not a screen for somebody who already has one. The
alternative was an allowlist entry, and `docs/121` §3 made the same call for
the same reason — an exception somebody has to maintain is how the next unswept
claim gets written.

⚠️ Comments are stripped first. Both edited files quote the removed claim in
the comment explaining its removal, so a raw-source match reports the fix as
the defect (`docs/116` §4).

Controls: the sweep must actually reach the screens, and both pages must still
say something — an empty page passes every absence rule there is
(`fee-claims.test.ts` carries the same control).

| injection | fails |
|---|---|
| put "saved campaigns" back on `/login` | 2 |
| put the refund bullet back on `/register` | 2 |
| delete the `/login` subtitle entirely | 1 — absence is not a fix |
| empty the surface list | 3 |

⚠️ **The fourth injection first reported "no tests".** A `!` lookup at module
scope threw during **collection**, which emits no `×` line and reads like a
broken file — the probe that lied in `docs/124` §5.1, met again. The control
now resolves safely and asserts it found the screen, so it fails as an
assertion.

Every restore verified clean after every injection (`docs/120` §11.1).

Gate result: lint clean (1 pre-existing warning, 0 errors), typecheck clean,
**7,702 unit passed / 16 skipped (263 files)**, **291 integration passed
(30 files)**.

---

## 6. ⛔ Reported, not fixed — `/api/auth/register` has the same hazard

It mails the submitted address on **both** outcomes (`docs/39`), so a stranger
can put the *"somebody tried to sign up as you"* notice into somebody else's
inbox at the same ten a minute, off the same shared quota. Minus the part that
matters most: no link is destroyed, so there is no recovery race.

**I built the fix and then took it out**, which is the useful part of this
section.

Throttling **only the duplicate branch** creates a **timing oracle**. Two
requests distinguish the outcomes: for an address that already exists the
second one skips a Resend round trip that the same second request for a fresh
address still makes. The route hashes the password unconditionally *before*
the existence check for exactly this reason, and `notifications.ts:250` states
the invariant outright — *"keep the call shape identical … so response time
does not encode the outcome either."* Trading an enumeration oracle, which
`docs/32`, `docs/39` and `docs/74` were spent closing, for a reduction in
inbox noise is the wrong way round.

Throttling **both branches** instead — claiming before the existence check, as
`forgot-password` does — is symmetric and costs the thing the screen promises:
the welcome email a new account is told to go and look for.

So it needs a design that keeps both branches equal in cost (an off-request
send, or a matched delay on the suppressed path). That is a decision, not a
copy-level fix. The reasoning is recorded in a comment in
`password-reset-tokens.ts` next to the control it deliberately does not reuse.

⚠️ **`auth.enumeration.test.ts` is what caught it** — four of its assertions
went red on the half-fix, including *"sends exactly one email on each path, so
the send cannot encode the outcome"*. The test was right and my change was
wrong.

---

## 7. What was NOT checked

- **Nothing is deployed.** The owner deploys (CLAUDE.md), so the two claims are
  still live on `lastdonor.org` and the reset endpoint still has only its IP
  tier until this ships.
- **No email was sent, and no reset was completed end to end.** The live probe
  used a malformed body precisely so the limiter would count it without the
  handler mailing anything; `docs/74` walked the real send path and is not
  re-walked here.
- **Whether anyone has actually abused the reset endpoint.** I did not read
  Fly's logs; `audit_logs` records nothing for this route. The exposure is
  [VERIFIED]; any claim about exploitation would be [UNKNOWN].
- **The Resend quota the mail-bomb would consume is [UNKNOWN].** `docs/92`
  established that the key available to this session is rejected by Resend
  while production holds its own, so the plan's daily and monthly caps could
  not be read. The finding does not rest on the number.
- **Multi-instance behaviour.** Fly runs one machine. The cooldown is atomic in
  the database, so it is correct either way, but only the single-machine case
  was measured.
- **The `auth` tier's 10/60 s was not changed.** It is the right bound for
  sign-in attempts, where the lockout (`docs/126`) is the binding control. This
  adds a second control for the one endpoint whose cost is not borne by the
  caller; it does not retune the first.
- **`/register`'s own rate limiting and the reset-password endpoint's** were
  read but not probed; `reset-password` is bounded by a 122-bit random token,
  which is the control that matters there.
- **Google OAuth sign-in and sign-out** were not walked — no credentials for
  the former, and the latter writes nothing this journey is about.

---

## 8. ⚠️ An operator error worth writing down

A paired integration run reported **24 failures** across five files, including
`campaign-filters` and the FX reader — none of them anywhere near this change.

The cause was mine: I started a second `vitest` against the **same database**
while the gate's integration run was still in flight. Every file calls
`clearDatabase()` in `beforeEach`, so the two runs truncated each other's
fixtures. That is `docs/98` exactly, reproduced by hand rather than by
configuration.

Run alone, the suite is **291/291 across 30 files** (294 while the reverted
§6 work was briefly in the tree), and the pair re-ran clean three consecutive
times. Recorded because a wall of unrelated red is a
convincing thing to misdiagnose, and the tell is simply *"what else is talking
to this database right now?"*
