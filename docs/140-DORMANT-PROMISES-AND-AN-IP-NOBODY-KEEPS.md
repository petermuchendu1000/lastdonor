# 140 — Dormant promises, and an actor IP nobody keeps

**Date:** 2026-10-28
**Status:** one guard added; both reported items end in an owner decision
**Scope:** the two items `docs/139` §12 and `docs/138` §7 left open

---

## PART A — the nine dead notification functions

### 1. UNDERSTANDING

`docs/139` reported *"nine notification functions are dead with no recorded
reason… Each is a product call, not a sweep."* That framing turns out to be
wrong in a way that matters.

[VERIFIED, re-derived this session] 40 `notify*` exports, **9 with zero
callers** (12 before `docs/139` wired three):

```
notifyVerificationReminder      notifyAdaptiveDonationReceipt   notifyAbandonedDonation
notifyAdaptiveRefund            notifyCreatorMotivation         notifyVerificationEscalation
notifyDonorReengagement         notifyPostDonationImpact        notifyCreatorThankYouUpdate
```

### 2. EVIDENCE — they are not nine things, they are one

[VERIFIED] **8 of the 9 render templates from `src/lib/email-adaptive.ts`.**
Only `notifyVerificationReminder` is outside it.

[VERIFIED] `email-adaptive.ts` has **exactly one importer** —
`notifications.ts:76` — and every function importing from it is dead. The
module is unreachable in its entirety.

So this is **one product call** — *"do we run a lifecycle email programme?"* —
not nine. And the material is not neutral while it waits:

| `email-adaptive.ts` | copy |
|---|---|
| `:856` | *"You have **N days remaining** to complete verification. After that, **we may need to return funds to donors**."* |
| `:869` | subject: *"**N days left** to verify …"* |
| `:860` | *"We can **extend deadlines**, help with documents…"* |

and in `email-templates.ts`, the one `docs/110` §7 already refused to wire:

| `email-templates.ts` | copy |
|---|---|
| `:805` | subject: *"`${p.deadlineDays}` **days left** to finish your checks"* |
| `:808` | *"reached its goal N days ago… **send the money back**"* |

### 3. ROOT CAUSE — [VERIFIED three independent ways]

**No mechanism returns money on a clock**, so every one of those sentences is
a promise this platform cannot perform:

1. **Call sites.** Every refund path is under `src/app/api/v1/admin/` —
   `donations/[id]` (admin PATCH, `:233` `stripe.refunds.create`, `:283`
   notify) and `campaigns/[campaignId]/cancel` (admin POST, `:269`, `:324`).
2. **Cron sweep.** Only two cron files contain the word "refund".
   `verification-reminders:41-42` is **the comment recording this very
   finding**; every `reconcile` mention (`:50-52`, `:211`, `:215`) is
   `donations.refunded = false` inside a **read**.
3. **No cron route imports a refund helper.**

`docs/110` §7 established this for `verificationReminderEmail` and wrote the
ruling as prose about that one function. **Its sibling was never swept.**

#### Falsification attempts

- *"The adaptive family is reachable some other way."* **Refuted** — one
  importer, all importing functions dead.
- *"An info-request deadline proves the platform does enforce dates, so the
  copy is fine."* **Refuted, and it sharpened the rule**:
  `infoRequestCampaignerEmail` (`:517`, **wired**) renders an **admin's own
  typed date** as *"Send it by"*. That is a person asking, with no countdown
  and no automatic consequence. Probed: it does **not** match the rule below.
- *"The hazard is the send mechanism — these mail guests through
  `sendEmailOnly`, which has no suppression."* **Half-refuted, and a rule
  built on it was abandoned.** `sendEmailOnly` genuinely has zero suppression
  (read in full: `{to, subject, html}` → `resend.emails.send`), but **11
  WIRED functions already use it** — registration, password reset, refunds,
  campaign status — because it is the right mechanism for transactional mail
  to a guest. A rule over the mechanism would have failed on correct code.
  The hazard is the **copy**.

### 4. BLAST RADIUS

One new test file. **No production code changed. Nothing deleted** — the
adaptive programme is kept for the owner. Rollback: delete the test.

### 5. PLAN — the guard, and what it deliberately refuses to do

`src/lib/notification-promises.test.ts`.

**Invariant:** *a notification that is WIRED may not render copy promising a
countdown the platform does not run, or money it does not return.*

It derives both ends — which `notify*` have a caller anywhere in `src/`, and
what their templates say — and matches **string literals only**, so a
`deadline: string` parameter declaration is not a hit.

⛔ **It does not delete the family and does not forbid the programme.** It
makes the two templates impossible to *wire* while they still say it.

⛔ **Its anti-vacuity control does NOT assert the two templates still contain
the bad copy.** That would make *fixing the copy* fail the build — `docs/138`
rule 1's auto-relaxation lesson inverted. The control proves the **matcher**
works, against synthetic samples.

⚠️ **Comments are stripped first.** `email-templates.ts:849` is `docs/110`'s
own note *"no deadline, no countdown, no turnaround time"* — a raw-text sweep
reports the record of the fix as the defect (`docs/116`).

### 6. RESULT — the rule fires on exactly the right things

Probed before it was written: **exactly two templates match, both dead**
(`verificationReminderEmail`, `verificationEscalationEmail`); **zero wired
templates match.**

| Injection | Result |
|---|---|
| **wire `notifyVerificationEscalation`** (the real case) | FIRED (2 rules) |
| **wire `notifyVerificationReminder`** (`docs/110`'s refusal) | FIRED (2) |
| forbidden copy added to a WIRED template | FIRED (rule 2) |
| forbidden copy added INLINE in a wired notifier | FIRED (rule 3) |
| **CONTROL** the matcher emptied | FIRED (rule 1) |
| **CONTROL** the notifier scan blinded | FIRED (rule 0) |
| **AUTO-RELAX** copy fixed, then wired | **PASSES** |

#### 6.1 ⚠️ Two of those injections "passed" first and both were VOID

Gate 4 in practice. The matcher-emptying edit produced
`[].concat([ …same items… ])` — semantically identical, so the control did not
fire and read as a pass. And the auto-relax injection's heredoc created a file
literally named `"$CALLER"` (it appeared in `git status`), so it never wired
anything. **Both were redone**; only then did they mean what their labels said.

#### 6.2 ⚠️ Rule 3 found a second surface, and that is why it exists

In the auto-relax run, fixing the EMAIL relaxed rule 2 while **rule 3 still
fired**. [VERIFIED] `notifications.ts:1702` —
``message: `Verification for "${p.campaignTitle}": ${p.daysRemaining} days remaining.` ``
— the **in-app** notification carries the same countdown, independent of the
template. So wiring it honestly requires fixing both surfaces, and a
template-only rule would have let the in-app claim through.

### 7. What is NOT done

The nine stay dead. Wiring any is a product call, and for the two named
templates it additionally requires rewriting copy that is false today.
`docs/110` §7 states the hazard exactly: *"a cron is what turns dormant bad
copy into mail somebody receives."*

⛔ Also unexamined here: whether an abandoned-donation or re-engagement
programme is **lawful** to send at all. `notifyAbandonedDonation` mails a
guest who never completed a donation, via `sendEmailOnly` (no suppression);
[VERIFIED] **no template in the codebase declares `commercial: true`** (only
tests do), and [VERIFIED] **`MAILING_POSTAL_ADDRESS` is unset on Fly** — so
such a send would go out classified transactional, with no postal block and
no opt-out store. That is `docs/135`'s open owner item, and it gates the whole
programme.

---

## PART B — the 27 admin routes that audit with no actor IP

### NO CODE CHANGE. `docs/138` §7's framing was incomplete.

That section said the fix is *"one line per route plus a derived rule"*.
Acting on it would create something this project has never had.

### 1. EVIDENCE

[VERIFIED] 35 admin routes contain a literal `insert(auditLogs)`: **5 set
`actorIp`**, 3 have no request object, **27 have a `NextRequest` and set
nothing.**

[VERIFIED] Production: **1,262 audit rows, `actor_ip` NULL on every one.**
57 carry an `actor_id`; 33 distinct event types. The 5 routes that do set it
have never been exercised in production (institutions: 0 rows, `docs/108`;
settings: 0 rows, `docs/138`).

[VERIFIED] **Nothing displays it.** ⚠️ My first grep said nothing *reads* it,
which was wrong: both the API (`audit-log/route.ts:48`) and the page
(`admin/audit-log/page.tsx:20`) use a bare `.select()`, which a grep for the
identifier cannot see. But the page projects to 9 named fields before passing
them on, and `AuditLogViewer`'s own type (`:22-32`) has no `actorIp`. So it is
fetched and dropped. The API returns the whole row, which is correct for an
admin-only audit endpoint (`docs/06` §9.4).

[VERIFIED] **Nothing erases or purges it.** `account-erasure.ts` never touches
`audit_logs`; no `delete(auditLogs)` exists anywhere in `src/` — while
`docs/06` §9.3 specifies retention of 1 year / 7 years / 1 year by log type.
**That policy is implemented by nothing.**

[VERIFIED] **Nothing discloses it.** `/privacy` contains no mention of IP
address, log data, device information, technical information or server logs.
And `audit_logs.actor_ip` (`schema.ts:894`) is the **only** IP-storing column
in the schema.

### 2. ROOT CAUSE

The defect is not *"27 routes are missing a line"*. It is that **the project
has no decision about `actor_ip` at all**: the original design specifies it
(`docs/06` §9.2 shows `"actor_ip": "203.0.113.42"` in the log entry schema),
5 of 35 routes implement it, no screen shows it, no job purges it, erasure
does not reach it, and the privacy policy does not mention it.

The two directions are both defensible and both are the owner's:

- **Capture it.** The forensic case is real and `docs/138` §3 argued it: on a
  compromised admin account, the actor IP is the single most useful field, and
  `docs/116` §8's forensics were done by querying `audit_logs` directly, not
  through the UI. A column the UI never shows can still be the thing you need.
- **Do not capture it.** Filling 27 routes would create, for the first time, a
  permanent store of IP addresses that is undisclosed, never purged contrary
  to this project's own policy doc, and outside the erasure path that
  `docs/124` built to honour a published 30-day promise.

### 3. Prerequisites, if the answer is "capture it"

Both are owner calls, and neither is engineering:

1. **Disclose it** in `/privacy` — it is personal data and currently
   undisclosed.
2. **Implement the retention `docs/06` §9.3 already specifies.** That means a
   scheduled job that DELETES audit rows, on a live money system, which is a
   Gate-8 action in its own right and conflicts with `docs/06` §9.4's
   *"append-only. No update or delete operations permitted."*

Until both exist, widening capture is not an improvement.

---

## 8. Suites

| Suite | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 1 warning, pre-existing, in a file not touched here |
| `npm run test:unit` | **7776 passed / 16 skipped**, 269 files (+4, one new file) |
| `npm run test:integration` | **301 passed**, 31 files |

### 8.1 ⚠️ The integration suite reported 262 then 186 failures, and both were void

Gate 5. Neither could come from adding one test file, and neither was
interpreted before it was diagnosed:

- **262 failed:** `Error: connect ECONNREFUSED 127.0.0.1:5432` — Postgres was
  not running at all.
- **186 failed:** `PostgresError: column "terms_accepted_at" of relation
  "campaigns" does not exist` — the instance I restarted is **not the one that
  had been serving 5432**. That one was already running when this session
  found it; the Debian cluster I started has its own data directory, with a
  `lastdonor_test` whose schema predates `docs/113`. `db:migrate` against it,
  then **301/301**.

The transferable part: *"Postgres on 127.0.0.1:5432"* is not a pinned subject.

---

## 9. What was NOT checked

- **Whether the nine should exist at all.** This doc establishes that wiring
  them is unsafe today and guards against it; it does not recommend keeping or
  deleting the programme. ~900 lines of `email-adaptive.ts` remain unreviewed
  for anything other than the countdown and money-back claims.
- **The other seven dead templates' copy** beyond the forbidden-phrase scan.
  `creatorMotivationEmail`, `donorReengagementEmail`, `postDonationImpactEmail`
  and the rest were not read line by line for other unsubstantiable claims;
  the rule covers one class only.
- **Whether `actor_ip` would survive a legal review either way.** Stated as a
  decision with its evidence, not resolved.
- **Nothing was deployed.** This change is one test file and two documents, so
  the built image is unchanged.
