# 135 — The admin communications journey, and a P0 gate pressed for the first time

**Date:** 2026-10-28
**Status:** **NO CODE CHANGE.** One control verified by execution, one claim
verified by reading, one owner question sharpened.
**Sub-journey:** admin journey, part 7 of 10 (COMMUNICATIONS — bulk email)

---

## 1. Why this journey found nothing to fix, and why that is the result

`/admin/communications` is one page (`page.tsx`, 29 lines) rendering
`BulkEmailDashboard`, behind two routes. It is the only admin surface that
puts mail in a real person's inbox on demand, so it was chosen ahead of
simulation and settings.

It turned out to be the best-defended area walked so far. That is a finding in
itself, and the useful part of this doc is **which of its defences are now
proven by execution rather than by reading** — plus one question that is the
owner's, not mine.

⚠️ Like `docs/129`, the honest outcome is "no code change". Three of my own
probes were broken during it, and those are recorded in §5 because each one
produced a confident wrong reading first.

---

## 2. The blast-radius gate, pressed for the first time

`bulk_emails.campaign_id` is nullable. An unscoped draft therefore has no
campaign predicate, and the route's own comment
(`[id]/send/route.ts:126-131`) records what that once meant:

> `campaignId` is optional on a draft, and the old resolver simply omitted the
> campaign predicate when it was absent — so one POST, with no second
> confirmation and no cap, mailed every donor who had ever donated.

The fix is at `:132-138`: an unscoped send is refused unless the body carries
`confirmAllDonors: true`. Nothing had ever exercised it.

**Three independent methods, each able to produce the worse answer:**

| | Method | Result |
|---|---|---|
| A | HTTP: POST the send endpoint, unscoped draft, no flag | **400**, message naming the entire donor base |
| B | STATE: read `bulk_emails.status` after that refusal | still **`draft`** — no partial send, no `sending` limbo |
| C | UI: open the confirm dialog | checkbox present; **Send Now disabled** before ticking, **enabled** after |

**And the control in each case** — without it, "refuses everything" would pass
A and B: a campaign-**scoped** draft sent with no flag answered **200** and
proceeded. **7/7.**

The dialog's wording, captured verbatim from the run:

> *This draft is not scoped to a campaign. It will email the entire donor
> base: 2 people, as resolved when the draft was created. ☐ I confirm this
> email should go to all 2 donors.*

⚠️ The scoped send finished as `status = 'failed'` — correct and expected:
this sandbox sets no `RESEND_API_KEY`, so every delivery failed. That is also
what proves the send path actually executed rather than short-circuiting.

---

## 3. The suppression claim is true

`[id]/send/route.ts:161-163` claims recipients are resolved "minus everyone
who has opted out (newsletter unsubscribes, per-campaign unsubscribes, and
user preferences)". [VERIFIED by reading `filterOptedOut`,
`src/lib/bulk-email-recipients.ts:170-230`] it is true, and all three stores
are really consulted:

- `newsletter_subscribers.unsubscribed_at` → global unsubscribe
- `donor_campaign_subscriptions.subscribed = false` → per-campaign, only when
  the draft is scoped
- `users.preferences.emailNotifications === false` **or**
  `emailCampaignUpdates === false` → preference opt-out

So the bulk sender is the **best-behaved sender in the codebase** for
suppression — better than `sendEmailOnly`, which `docs/122` §8.3 records as
applying none at all. Worth stating plainly, because the natural assumption
from `docs/122` would be the opposite.

The preview count cannot drift from the audience either: `countBulkEmailRecipients`
is defined as the **length of the list the send uses** (`:246-252`), not a
parallel query.

---

## 4. The one open question, which is the owner's

⚠️ **I started this journey believing I had found a defect, and I had not.**

[VERIFIED] `cron/send-newsletter/route.ts:56-65` **refuses** to send when
`MAILING_POSTAL_ADDRESS` is unset, logging `MISSING_POSTAL_ADDRESS_REASON` and
writing `skipped: true` to `audit_logs`. [VERIFIED] the bulk-email route reads
the same value at `:158`, **does not refuse**, omits the address line
(`:285-287`), and records `postalAddressPresent: false` on the audit row
(`:252`).

Two outbound paths, same legal requirement, opposite behaviour. That looked
like a defect. It is not: it is **written down as deliberate** in
`src/lib/mail-senders.ratchet.test.ts:70-77`, where the newsletter's allowlist
entry says in so many words that it

> is the one sender that REFUSES to send when MAILING_POSTAL_ADDRESS is unset
> rather than omitting the line.

and there is a dedicated test (`send/route.test.ts:275`) asserting the
omission. So this was decided, not overlooked, and my "two paths disagree"
framing was a correct observation and a wrong finding.

**What I can add is the consequence, stated more precisely than `docs/123`
did.** [VERIFIED three ways: absent from `fly secrets list`, absent from
`fly.toml [env]`, referenced nowhere outside code and tests]
`MAILING_POSTAL_ADDRESS` is unset in production. `docs/123` records that as
blocking the newsletter cron. It does more than that:

⛔ **If an administrator sends a bulk email today, it goes out with no postal
address** — and the one send that is most clearly commercial (the unscoped
"entire donor base" blast) travels the same code path as the arguably
relational campaign-scoped one.

Whether that is acceptable is a **legal and policy call**, so Gate 8 applies
and it is not mine to make. Setting one secret resolves it for both senders at
once.

---

## 5. Three of my own probes were broken, and each read as a result first

Recorded because the pattern repeated from `docs/134` §3.1 within one session.

1. **`page.request` does not carry the NextAuth session.** Every API call came
   back **401**, and the run reported `1/7`. Worse, the "CONTROL passed" line
   was a **false pass**: it asserted `status !== 400`, and 401 satisfies that.
   A control that passes on the wrong status proves nothing. Fixed by issuing
   the calls through in-page `fetch`, which demonstrably carries the cookie.
2. **The dialog's button is "Send Now", not "Send".** A `/^Send$/` locator
   matched nothing, `isDisabled()` threw into `.catch(() => null)`, and `null`
   rendered as a FAIL — a broken probe presenting as a product defect.
3. (`docs/134`) the `innerText` sweep blind to icon-only buttons.

The common shape: **a probe that cannot see its subject reports the same thing
as a subject that is absent.** The only reason all three were caught is that
every measurement was paired with a control expected to come out the other
way.

---

## 6. Recorded, not actioned

- **The hard ceiling cannot bite at current scale.**
  `DEFAULT_BULK_EMAIL_CEILING = 5000` (`bulk-email-recipients.ts:48`) and
  `BULK_EMAIL_MAX_RECIPIENTS` is not set in `fly.toml`. Production has 9 users
  and 2 donations, so the ceiling is a safety net for a future donor base, not
  a present constraint. Not a defect; just not evidence of safety today.
- **`subscribed_donors` requires a campaign** and yields nothing without one
  (`:64-67`), deliberately, "rather than silently widening to every donor".
  Verified by reading only.
- `/admin/communications` is correctly gated to `admin` (`page.tsx:13`), as
  are both routes — `docs/132`/`docs/133`'s class does not apply here.

---

## 7. What was NOT checked

- **A real delivery.** No `RESEND_API_KEY` in the sandbox, so every send
  failed at the provider. The gates, the audience resolution and the status
  transitions were exercised; the rendered email that would reach an inbox was
  not.
- **The failure accounting** (`sent_count` / `failed_count` and the
  `completed`/`failed` transition) beyond observing that a send with a dead
  key lands on `failed`.
- **Production.** Nothing in this journey was exercised against the live
  system: sending a bulk email in production would mail real people, which
  Gate 8 forbids without an explicit instruction.
- `/admin/notifications`, `/admin/activity` and `/admin/audit-log` — those are
  the observability sub-journey, not this one.
