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

## 7. ⛔ Still to build: the reminder ladder

Owner approved wiring the four reminder emails to a cron. **They cannot be
wired as they stand**, and this is the finding that matters most for whoever
picks it up:

Every one of the four levels says *"Your campaign reached its goal N days
ago"* and threatens *"we may have to send the money back to the people who
gave it"*. That copy is written for a **funded** campaign whose money is
stuck. Fired on the chosen trigger — live, unverified, possibly with zero
donations — **every sentence of it would be false.**

So the existing ladder stays as it is, for its own situation, and the chosen
policy needs one keyed on **consequence rather than elapsed days**:

| level | when | what is true |
|---|---|---|
| 1 | live, unverified, well under the cap | you can take donations; we cannot pay you |
| 2 | approaching the cap | at `<cap>` this campaign stops taking donations |
| 3 | at the cap | this campaign cannot take any more money |
| 4 | goal reached, unverified | the existing funded ladder — money stuck |

Send-once tracking belongs in `audit_logs.details`, the pattern `docs/41` uses
for the bulk-email filter.

⚠️ Also unresolved: the existing ladder signs off to **`verify@lastdonor.org`**,
a different mailbox from the `support@lastdonor.org` used everywhere else.
Whether it exists is unverified; `docs/73` would be the place to check.

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

## 9. What this does not fix

- The reminder ladder (§7) — approved, not built.
- ⛔ **A refused campaign still notifies nobody** (`docs/93`, open). The
  journey copy is careful never to promise a decision email, which is a
  mitigation, not a fix.
- `/how-it-works` still never mentions verification. Somebody deciding whether
  to start a campaign learns nothing about it until after they submit.
- The wizard's six screens still say nothing; only the confirmation after them
  does. Naming it earlier is a bigger copy change than this pass.
- No E2E coverage of any of it — `docs/99` records the missing signed-in
  fixture, which is the gap that let all of this sit unobserved.
