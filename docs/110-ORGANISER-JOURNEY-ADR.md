# 110 — The organiser journey: nobody was ever asked to verify

**Date:** 2026-10-25
**Status:** BUILT. Surfaces and defects done; the reminder ladder is §7, still to build.
**Read before:** touching anything an organiser sees, adding a status label, or
linking to `/campaigns/<slug>` from a dashboard screen.

---

## 1. The question that started it, and the answer

> *"When do we ask the user to start the process of verification? Why is so
> much info hidden too deep that users can't know how to interact with it?"*

**We never asked.** Not once.

`notifyVerificationReminder` exists with four urgency levels — gentle, firm,
warning, final. `notifyVerificationEscalation` exists beside it. **Neither has
a single caller**, and there is no verification job in `CRON_SCHEDULE`. No
email has ever asked anybody to verify anything.

Every moment in the journey, and what each said about verification:

| Moment | What it said |
|---|---|
| `/how-it-works`, before sign-up | nothing — the word does not appear |
| the six-screen wizard | nothing |
| the submission receipt | nothing |
| `/dashboard/campaigns` | nothing — and no verification row at all |
| `/dashboard` index | `VerificationRow`, the product's only prompt |
| `/dashboard/campaigns/[id]` | a link, fourth of five, labelled with a raw enum |
| "Your campaign is live" | nothing |
| scheduled reminders | **none** |

So the only way to learn that getting paid requires an ID was to notice one
grey line on one of two screens, and nothing ever said it mattered.

---

## 2. Three defects behind it

### 2.1 ⛔ The verification screen was wired to the dead provider

`CampaignVerificationDashboard` decided "verification in progress" from
`campaign.stripeVerificationId`. Didit replaced Stripe Identity in `docs/81`
and writes `didit_session_id` / `didit_session_url` plus
`verification_status: 'pending'` — **it never writes the Stripe column.**

So `identityPending` was permanently `false`, which meant the status poll
guarded by `if (!identityPending) return` **never armed**. An organiser
started verification, completed it in the Didit tab, came back, and the screen
looked exactly as it had before — forever.

This is `docs/83` a second time: the integration worked, and the UI meant to
reflect it pointed at a provider that had been replaced.

### 2.2 The return from Didit landed nowhere

The session route sends them to `/dashboard?verification=<slug>`. **Nothing
read that parameter.** `IdentityReturnNotice` now does.

⛔ It does not say "you are verified". `docs/81` records that Didit's "In
Review" is their manual queue and is **not** a pass; returning from the
provider is not a decision. All the screen knows is that they came back.

### 2.3 The guide was linked everywhere except where it was needed

`/campaign-verification-policy` was linked from the footer, the terms, the
refund policy, campaign-rules and transparency — and from neither the
verification screen, nor the dashboard, nor the wizard. It is now in
`JourneyChecklist`, which renders on all three.

---

## 3. What was built: one definition, six surfaces

`src/lib/organiser-journey.ts` computes the ordered path to being paid: each
step's state, a plain sentence, **what it unblocks**, and the link.

Everything renders from it — the submitted notice, both dashboard lists, the
campaign page and the verification screen — so the surfaces cannot hold six
partial ideas of the journey again. That was the actual defect: not one
missing feature, but no shared answer to "what am I in for".

**`consequence` is the field the old UI had nothing like.** Without it,
verification reads as paperwork. With it, the ID step says *"Until this is
done, this campaign can raise up to $500.00, and we cannot pay you anything."*
The consequence is stated in money, because "your campaign is unverified"
tells an organiser nothing about what waiting costs.

### 3.1 ⚠️ Two tiers, which nothing used to name

| status | what it actually does |
|---|---|
| `identity_verified` | lifts the pre-verification raise cap (`docs/101`) |
| `fully_verified` | what `withdraw/route.ts:272` requires before a payout |

So "verified" is not one thing, and a campaign could be past the cap, raising
freely, and **still unable to take a penny out** — with no screen saying so.
The journey names them as two steps, each with its own consequence. The tests
read both gates from `campaign-raise-cap.ts` and the withdrawal route's own
source rather than retyping them.

### 3.2 `VerificationRow` was retired, not renamed

`docs/83` added it, and it was right as far as it went: one step of six, on
one screen of two. `NextStepRow` renders `nextOrganiserAction` instead, so
both lists agree and a new step appears without anybody remembering to come
back. ⚠️ When nothing is waiting on the organiser it says so — silence on a
campaign row is indistinguishable from "there is nothing to know".

---

## 4. Seven label maps, three of them wrong

The audit found **seven** campaign-status maps and **three** verification maps.
The organiser-facing ones had drifted in ways that showed:

- `FinancesClient` invented `pending_review` and `rejected`, which **are not
  campaign statuses**, and was missing `under_review`, `archived`, `paused`
  and `cancelled` — so an organiser whose campaign was in the queue read the
  raw enum `under_review`.
- `/dashboard/campaigns/[id]` had no map at all and rendered the raw enum.
- `CampaignVerificationDashboard` showed **"Identity Verified (Tier 1)"**,
  leaking internal tier jargon, and called a `rejected` check "Needs Review".

⚠️ A missing key is not a blank: every one of those maps falls back to the raw
value, so drift surfaces as `documents_uploaded` printed at somebody in the
middle of a crisis.

`src/lib/campaign-labels.ts` is now the one copy, and its test reads
completeness from `campaignStatusEnum.enumValues` and
`verificationStatusEnum.enumValues` rather than restating the list — a test
that retyped it would have drifted with them. It also forbids the word "tier"
and forbids `identity_verified` being labelled "verified", because the word a
payout depends on must not be spent on the tier that does not grant one.

⛔ **`src/components/admin/` is deliberately excluded.** An administrator
reading a verification queue is better served by precision than plain
language, and `docs/88` shaped those screens for that reader. Two audiences,
two vocabularies — stated rather than blurred.

---

## 5. The first ask now lands at submission

Owner decision, 2026-10-25: ask at submission, then escalate.

- The wizard's confirmation screen names the ID step **with a link** (it
  previously said "You can start verifying your ID now" with no link, on the
  one list that had no verification row — a patch of mine, and the complaint
  that produced this doc).
- The submission receipt carries it, costing **18 words**.
- The approval email carries it, since the cap is live from that moment.

### 5.1 The brevity contract was relaxed deliberately

`docs/93` cut that receipt from 95 visible words to 43 and pinned it at 60
with exactly one action. The ID ask took the render to **61** — one word over.

The bound was raised to **70** and the single action re-pointed, each with the
reason recorded in the test, because `docs/93`'s own header says to relax
deliberately rather than by deleting. Its argument was against *repetition and
an unkept promise*, not against saying a second true thing — and the bound has
always permitted a genuinely new fact. ⛔ It is still a ratchet. Do not raise
it again for copy that restates something already said.

The action was **replaced**, not added beside: one call to action is the
property worth keeping, and the ID check is the thing we want them to do.

---

## 6. A third door to the `docs/109` 404

`/dashboard/campaigns/[id]` had an ungated "View public page" link — the third
link to `/campaigns/<slug>` written without reference to what that page
serves, after the wizard redirect and the dashboard "View" button. Now gated
on `hasPublicPage` (`docs/109` §5a).

---

## 7. ✅ RESOLVED 2026-10-25: the reminder ladder

Owner approved wiring the four reminder emails to a cron. **They could not be
wired as they stood**, and the finding below is the reason. The replacement
ships as `cron/verification-reminders`, daily at 09:00 UTC.

### 7.1 The original finding, which still holds

`notifyVerificationReminder` had four urgency levels and zero callers. Every
one of the four opens with *"Your campaign reached its goal N days ago"* and
threatens *"we may have to send the money back to the people who gave it"*.
That copy is written for a **funded** campaign whose money is stuck. Fired on
the chosen trigger - live, unverified, possibly with zero donations - every
sentence of it would be false.

### 7.2 ⚠️ A correction to this document's own proposal

The table below originally said level 4 could reuse *"the existing funded
ladder"*. **That was wrong**, and it was wrong for a reason worth recording:
the funded ladder's problem is not only that it counts days.

[VERIFIED 2026-10-25, by enumerating every refund call site in `src/`] **No
mechanism sends money back on a clock.** Every refund path is admin-initiated
(`admin/donations/[id]`, `admin/campaigns/[campaignId]/cancel`,
`admin/refund-batches/[id]`) or a gateway webhook reacting to a failed charge.
There is no deadline clock, no constant naming a verification deadline, and
`deadlineDays` exists only as a field an admin types into an **info request**.

So the threat has nothing behind it and the countdown counts down to nothing.
A cron is exactly what turns dormant bad copy into mail somebody receives, so
level 4 got new copy too. `verificationReminderEmail` is left in place,
unused, for its own hypothetical situation.

### 7.3 What shipped

| level | when it is true | what the email says |
|---|---|---|
| `first_money` | live, unverified, first real donation arrived | you have money coming in; we cannot send it until we check your ID; the campaign can raise up to `<cap>` |
| `approaching_cap` | real raised ≥ 70% of the cap | it can raise up to `<cap>`, then it stops taking gifts |
| `at_cap` | real raised ≥ the cap | it has stopped; people who try to give are turned away |
| `funded_and_stuck` | goal reached, not `fully_verified` | we hold the money and cannot send it until a person checks your ID and your papers |

Keyed on **consequence, not elapsed days**. A day count is the easy trigger
and it says nothing: *"it has been 14 days"* is not a reason to act, *"this
campaign stops taking money at $500"* is.

- **Pure decision**: `src/lib/verification-reminders.ts` (no database).
- **Queries**: `src/lib/verification-reminders.server.ts` - extracted so a
  test can execute them, because `docs/107` is a doc about a query that lived
  inline in a handler and was run by nothing.
- **Route**: `src/app/api/v1/cron/verification-reminders/route.ts` - the loop
  and the mail, nothing else.
- **Schedule**: one row in `CRON_SCHEDULE`, `0 9 * * *`.
- **Ledger**: `audit_logs` rows of type `verification_reminder.sent`, keyed
  `target_id = campaign id`, level in `details.level` - the `docs/41` pattern.

### 7.4 ⚠️ The two tiers, again

`identity_verified` **lifts the raise cap**. So for such a campaign all three
cap levels are FALSE - telling that organiser their campaign stops at $500
would be a lie, and it is exactly the state a naive "not fully verified"
filter would mail. Only `funded_and_stuck` survives there, and it is still
true, because a payout needs `fully_verified`.

### 7.5 Bounds, and what was deliberately not built

- **Four emails, ever.** Each level sends at most once per campaign for its
  whole life, plus a 24-hour floor between any two sends. A unit test walks a
  campaign across all four levels and asserts the bound.
- **Silence at zero donations.** `first_money` requires a real donation.
  REJECTED: firing level 1 a fixed number of days after publication - that is
  the day-count trigger this ladder exists to avoid, and per `docs/72` most
  campaigns have never had a donation, so it would have mailed nearly every
  organiser about nothing.
- **No retry on a failed send.** `createAndEmail` logs and swallows every
  failure, so the ledger row is written AFTER the send and records
  `emailed: true|false` rather than an intention. A failed or opted-out email
  still spends the level. REJECTED: retrying tomorrow - the in-app
  notification exists either way, the dashboard ladder says the same thing,
  and a retry loop around a send nobody can un-send is how an organiser gets
  mailed twice about their own money. The accepted cost is that a Resend
  outage silently eats one level per affected campaign; `details.emailed`
  makes it visible rather than guessable.
- **The lock fails CLOSED.** Send-once is written after the send, so two
  overlapping runs could both read "not sent" and both mail. That is the one
  duplicate the ledger cannot prevent on its own, so overlap is refused
  instead.
- **No cap claim in a currency we cannot price.** `capMinor` returns null
  rather than letting `getCurrency` throw mid-sweep (`docs/92`), and a null
  cap reaches no level that quotes one.
- **Daily, not hourly.** The decision is already send-once with a 24-hour
  floor, so hourly would send exactly the same emails 23 times more often
  over an empty candidate set.
- **A per-run ceiling of 25**, oldest-published first. A backlog must not
  become a hundred sequential Resend calls in one request against a pool of
  five (`docs/87`); a campaign deferred today is at the front tomorrow.

### 7.5a ✅ Observed firing in production, 2026-10-25T09:00:05Z

`docs/66`'s rule: a cron is not done until it is seen running. Read from the
Worker's own observability log (Cloudflare telemetry API, script
`lastdonor-cron`, version `a3e5031f`):

```
09:00:04  tick=09:00:03  [cron] dispatching 5: update-phases, ingest-news,
                                publish-campaigns, screen-documents,
                                verification-reminders
09:00:05  tick=09:00:03  [cron] verification-reminders ok 200
```

⚠️ **The control is the adjacent ticks.** 08:55 and 09:05 each dispatched
**two** jobs and neither included this one, so `minute === 0 && hour === 9` is
firing once a day rather than on every `*/5` tick. A log line showing the job
ran proves it ran; only the neighbours prove it is not running constantly.

**⛔ What it SENT is [UNKNOWN], and the reason is structural.** The Worker
logs the HTTP status and deliberately does not read the response body - that
is what keeps it inside Cloudflare's 10 ms CPU ceiling on free (`docs/66`). So
`ok 200` establishes that the route completed without error and nothing more.
The counts live in the `cron.verification_reminders` audit row
(`considered`, `sent`, `emailed`, `levels`), and from this sandbox neither
path to them is open: direct Postgres egress is blocked, and `fly ssh console`
production reads were refused by the permission classifier. [INFERRED, from
the decision rules plus `docs/92`] it most likely sent nothing or close to it,
because `first_money` requires a real un-refunded donation and this platform
has recorded two in its history. `/admin/audit-log` answers it in one glance
for anybody signed in as an admin.

### 7.6 Measured against the real figure

The cap is read from `realRaisedMinorSql` (`src/db/real-raised.ts`), never
`campaigns.raised_amount`, which is blended with fabricated seed money
(`docs/33`). **Proven by injection**: swapping the expression for
`campaigns.raisedAmount` fails 8 of the 13 integration tests, including the
one that sets the two columns to disagree.

### 7.7 ⚠️ Still unresolved: the `verify@lastdonor.org` mailbox

The old ladder signs off to `verify@lastdonor.org`, a mailbox nothing else in
the product uses. **Its existence is [UNKNOWN]** - `dig` is not available in
this sandbox, so the MX records were not read, and Resend does not handle
inbound mail. The new copy uses `support@lastdonor.org`, which every other
template uses, and a test forbids the other address. Whoever has DNS access
should either confirm `verify@` receives mail or delete the old template.

---


## 8. Verified

Against a production build in Chromium, with one campaign seeded per journey
state (`under_review`/`unverified`, `active`/`pending`,
`active`/`identity_verified`, `active`/`fully_verified`,
`active`/`info_requested`):

```
[dashboard]                     200   next-step lines: 3
[campaigns list]                200   cap named on rows: 2
                                      "View" on queued campaign: 0 of it (4 of 5 live)
[detail, under review]          200   checklist rows: 6   raw enum shown: 0
[detail, identity_verified]     200   says payout still blocked: 1
[verification screen]           200   guide link present: 1
[didit return]                  200   return acknowledged: 1
[both at 390px]                 ok
[errors]                        none
```

`raw enum shown: 0` was `1` before the label consolidation — the status badge
on the detail page. Build unchanged at **32 static / 3 ISR / 185 dynamic**.

Gate: lint clean, typecheck clean, **6,977 unit tests pass + 16 skipped across
223 files**. The label contract is proven by injection: restoring
"Identity Verified (Tier 1)" and deleting one status fails three tests.

---

## 9. ✅ RESOLVED 2026-10-25: told before they start

§9 of this document used to say `/how-it-works` never mentioned verification
and that the wizard's six screens said nothing. Both are now fixed, and
fixing them turned up a defect worse than the one being fixed.

### 9.1 The outline lives beside the ladder, not on the page

`organiserJourneyOutline()` (in `organiser-journey.ts`) returns the same six
steps described for somebody with no campaign yet: no state, no links, no
campaign id, but each step's purpose and a flag for the one step where
LastDonor acts and the organiser waits.

It is in that module **because writing it as prose on the marketing page
would have been a seventh partial idea of the journey**, which is the exact
defect this document exists to end. `organiser-journey.test.ts` asserts the
outline and the ladder have the same steps in the same order, so a step added
to one cannot go missing from the other.

Rendered on `/how-it-works` as "If you are starting a campaign". Two FAQ
entries added there and one on `/share-your-story`, which is the page somebody
reads while *deciding* - and those feed the `FAQPage` JSON-LD, so the answer
is machine-readable too.

The wizard gets one line in the existing "What happens next?" block rather
than a new screen or a new panel: `docs/75` cut screen 1 from asking its
question three times down to once, and re-bloating it would undo that.

### 9.2 ⛔ The defect found on the way: a promise already deleted once

The wizard's "What happens next?" list said:

> *"We email you when it is decided, and tell you exactly what to change if
> anything needs changing"*

**That is the exact sentence `docs/93` deleted from the submission email**,
for a reason that has not changed: a REFUSED campaign notifies nobody.
`under_review` transitions only to `active` or `suspended`; the suspend path
reaches `notifyCampaignStatusChange`, which returns early for anything
outside `['completed','archived']` and addresses DONORS, of which an
unpublished campaign has none.

It was sitting on the screen immediately above the submit button - the most
load-bearing place in the product for it to be false. Now: *"We email you if
it goes live"*, which is the half that genuinely sends, and the same words
`organiserJourney`'s review step already used.

### 9.3 ⚠️ Why it survived, which is the transferable part

The rule was **already asserted in two places** when it was broken in a
third:

| surface | asserted by |
|---|---|
| `SubmittedForReviewNotice` | `submit-redirect.test.ts:154` |
| the submission email | `email-templates.submission-receipt.test.ts:163` |
| the wizard's own list | **nothing** |

Two correct assertions and one unswept surface read, from the outside,
exactly like coverage. So the fix is not a third assertion:
`src/app/share-your-story/organiser-promises.test.ts` **sweeps every
organiser-facing screen** under four directories and applies three rules to
all of them. Proven by injection - restoring the old line fails 3 of its 13
tests.

### 9.4 ⚠️ The sweep's own false positive, and why it was narrowed not excluded

The first version of the turnaround rule matched `within \d+ days` anywhere
and flagged `FundraiserPreviewModal.tsx`, which says a donor may request a
refund *"normally within 30 days of giving"*. [VERIFIED] `/refund-policy`
says the same thing, it is hedged, and it is about refunds, not review. A
false positive, not a defect.

The rule now requires the duration to sit in the same sentence as a word
about review or publication, and a test pins the refund sentence as
acceptable - because a rule that forbids every duration would push the next
person to delete a true, useful sentence to get the suite green.

---

## 10. ⛔ Found and NOT fixed: the Stripe fee claim

While reading `/how-it-works` and the wizard, both were found quoting
**Stripe's fee schedule**:

> *"Stripe charges 2.9% plus 30 cents to process the payment. On a $50
> donation that is $1.75, so the campaign gets $48.25."*

[VERIFIED 2026-10-25, from `/api/v1/health` in production] Stripe answers
`"status":"error"`, PayHero answers `"status":"ok"`. `docs/72` records that
`STRIPE_SECRET_KEY` on Fly is a placeholder and that `donations` had zero
rows on that rail; `docs/92` records the live rail as PayHero over M-Pesa,
with real money collected. `docs/94` already removed two Stripe-specific
lines from outgoing mail for this reason.

So the public pages quote a fee schedule for a gateway that cannot take a
payment, and omit the one that can.

**It is reported rather than fixed, deliberately.** It is in **ten files**:

```
src/components/campaign/DonationForm.tsx
src/components/homepage/Testimonials.tsx
src/components/homepage/WhereYourMoneyGoes.tsx
src/components/homepage/HomepageFAQ.tsx
src/app/donate/page.tsx
src/app/donor-faq/page.tsx
src/app/share-your-story/page.tsx
src/app/share-your-story/ShareYourStoryForm.tsx
src/app/compare/page.tsx
src/app/how-it-works/page.tsx
```

### 10a. ⚠️ It is not only the fee figure: two TRUST BADGES say Stripe

Found 2026-10-25 by looking at screenshots, which is the only way this class
of thing surfaces:

- the site footer, on **every public page**: **"Secured by Stripe"**
- the campaign sidebar trust row: **"Stripe secured"**

A fee figure being wrong is a number out of date. A padlock saying a dead
gateway secures the payment is a **trust claim**, and `CLAUDE.md` is explicit
that trust copy is a factual assertion rather than microcopy. Whatever is
decided about the fee table, these two should be decided with it - the live
rail is PayHero over M-Pesa (`docs/92`), and Stripe answers
`"status":"error"` on `/api/v1/health`.

Changing two of them would be a patchwork, and the replacement wording is not
a mechanical substitution: `docs/59` holds the fee ledger and GoFundMe's
verified published fees, and `docs/92` records that **PayHero's own published
fee table is wrong** (flat KES 8.9, not KES 6, so 17.8% is absorbed at the
floor). So there is no correct number to swap in without an owner decision
about what the platform says about each rail. Needs one pass over all ten,
with that decision made first.

---

## 11. What this still does not fix

- ⛔ **A refused campaign still notifies nobody** (`docs/93`, open — an owner
  policy call). Every piece of copy in this pass is careful never to promise a
  decision email, which is a mitigation, not a fix.
- ⛔ **The Stripe fee claim in ten files** (§10) — needs an owner decision
  first.
- ⚠️ The `verify@lastdonor.org` mailbox (§7.7) — existence [UNKNOWN].
- No E2E coverage of any of it — `docs/99` records the missing signed-in
  fixture, which is the gap that let all of this sit unobserved.
