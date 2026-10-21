# 93 — The submission receipt, and a promise the product never kept

**Date:** 2026-10-21
**Trigger:** owner feedback — *"email after submitting campaign looks too
repetitive. A lot of info should be scrapped of. Be precise, and to the
point."*

The brief was to cut copy. Reading the whole send path to do that turned up
two defects behind it: a sentence promising something nothing in the product
does, and a second email nobody meant to send. Both are fixed here. A third
finding — the missing path the promise referred to — is **open and needs an
owner decision**.

---

## 1. What the email said, measured

`campaignSubmittedForReviewEmail` rendered through the `docs/67` shell, read
in order as a person receives it. **Verified** by rendering the template.

| Slot | Before |
|---|---|
| Subject | `We have your campaign: "Help Amina Walk Again"` |
| Preheader | `Thank you for submitting "Help Amina Walk Again" . A person reads every campaign before it is published, so...` |
| H1 | `Your campaign is with our reviewers` |
| Body | `Dear Peter,` / `Thank you for submitting "…". A person reads every campaign before it is published, so it is not public yet and cannot receive donations until it is approved.` / `We will email you as soon as it is decided. If anything needs changing first, we will tell you exactly what.` / `You can see the campaign and its status any time in your dashboard.` |
| Button | `Open your dashboard` |
| Tail | `Questions? Reach us at support@lastdonor.org` |

**95 visible words** to deliver three facts. The repetition, counted:

- **"it is in review" — five times.** Subject, preheader, h1, body sentence 1,
  and again in "as soon as it is decided".
- **The campaign title — three times.** Subject, preheader, body.
- **The dashboard — twice, adjacently.** A sentence describing the button,
  then the button.

Nothing is wrong with any single sentence, which is how copy like this passes
review. The repetition only exists in the sequence, so the fix had to be
measured against the whole render rather than the template source.

### The preheader was spending itself on an echo

`renderEmail` derives the preheader from the opening body text when none is
given (`derivePreheader`). The body opened by restating the subject, so the
inbox preview line — the one slot that could carry information the subject
does not — carried the subject again. It is now passed explicitly.

---

## 2. What it says now

| Slot | After |
|---|---|
| Subject | `Received: "Help Amina Walk Again"` |
| Preheader | `A person reviews every campaign before it goes live.` |
| H1 | `Your campaign is in review` |
| Body | `Thanks, Peter. It is not public and cannot take donations until a reviewer approves it.` / `We will email you when it goes live.` |
| Button | `Check status` |

**43 visible words**, including the wordmark and the shell footer. The title
appears once, in the subject; the body refers back to it rather than
reprinting it.

**A correction worth recording.** The first measurement of the old email said
117 words. That was wrong: the stripper counted the Outlook VML button label
*and* its non-Outlook twin, only one of which ever renders, and it counted the
hidden preheader as visible text. Re-measured with a stripper that drops the
`<!--[if mso]>` branch and merely unwraps the `<!--[if !mso]>` one, the real
figures are **95 → 43**. The same class of mistake as `docs/59`: measure the
measuring harness before quoting it.

---

## 3. The promise the product does not keep

The removed sentence was:

> *"We will email you as soon as it is decided. If anything needs changing
> first, we will tell you exactly what."*

**Neither half is true for a campaign that is refused.** Traced through the
code, **verified**:

1. `src/app/api/v1/admin/campaigns/[campaignId]/route.ts` defines the legal
   transitions. `under_review: ['active', 'suspended']` — there is **no
   rejection and no changes-requested state at all**.
2. On `active`, `notifyWelcomeCampaigner` sends "Your Campaign Is Live!" to
   the organiser. That path works.
3. On `suspended`, the only notifier reached is
   `notifyCampaignStatusChange`, which opens with
   `NOTIFY_STATUSES = ['completed', 'archived']` and returns early for
   anything else. Even had it run, its audience is **donors**, and a campaign
   that has never been published has none — the route's own comment says so.

So a campaign refused at review notifies **nobody, including its organiser**.
The person who submitted it waits indefinitely, holding an email that told
them they would hear either way.

This is the `docs/74` pattern exactly: the forgot-password flow had a branch
that "returned silence forever", and the fix was to make every branch send
something. The same shape is now recorded here for campaign review.

**Decision taken:** say only what is true. The email promises a mail *when it
goes live* and nothing about any other outcome. Approval is the one decision
the product actually writes about.

**Rejected: leave the sentence and build the rejection path now.** The
sentence is live in production mail today, so correcting it is urgent in a way
that shipping a new review outcome is not; and what *should* happen to a
refused campaign — reject with a reason, request changes and allow resubmit,
or suspend silently — is a product and policy call, not an engineering one.
Writing one would have meant inventing the policy.

**Rejected: say "we will be in touch if we need anything".** It reads as
reassurance while committing to the same thing the product cannot do. A vague
promise is not more honest than a specific one.

### ⛔ OPEN — owner decision

**A campaign refused at review tells its organiser nothing.** The options are
a product call:

- **Reject with a reason**, mailed to the organiser, campaign stays read-only.
- **Request changes**, mailed with the reason, organiser can edit and
  resubmit (needs a transition back to `under_review`).
- **Leave as is** and accept that refusal is silent — in which case the
  dashboard should at least show the status plainly, since "Check status" is
  what this email now points at.

Until one is chosen, the honest copy is what shipped. Whoever builds it should
relax the assertion in
`src/lib/email-templates.submission-receipt.test.ts` deliberately rather than
delete it.

---

## 4. One event, two emails to the same person

`notifyAdminsCampaignSubmitted` mails every row with `role = 'admin'`. It was
never given the submitter's id, so an **admin who submits a campaign received
both mails for the one event**: their own `Received:` receipt, and an
`[Admin] Review needed: <their own title>` telling them somebody was waiting
on them.

On a platform whose admin set is small, that is most of the mail this event
produces — and it is a plausible part of what "repetitive" described, since
the two arrive together. **Assumed, not verified:** whether the owner's own
account holds `role = 'admin'` could not be checked from this session, because
the database credential is non-persisted and Postgres cannot traverse the
sandbox's TLS-inspecting proxy (`docs/92`).

The route now passes `creatorId`, and the loop skips that one admin.

**Rejected: suppress the admin mail whenever the submitter is an admin.** That
would leave a genuinely unreviewed campaign with nobody told on a
single-admin deployment. The skip is scoped to the submitter alone; every
other admin still gets the request. A test pins that half specifically,
because it is the half a careless "fix" would break.

---

## 5. Tests

- `src/lib/email-templates.submission-receipt.test.ts` — 10 tests. Reads the
  **rendered** email, not the template source, since that is where the
  repetition lived. Pins: the word budget (≤ 60, measured 43), the title
  appearing once, the preheader differing from both subject and body opening,
  one call to action of its own, no turnaround time (`docs/77`, `docs/78`),
  the three facts still present, and the escaping of `campaignerName`.

  Its text-extraction helper is itself guarded by a test. The first version
  deleted the whole `<!--[if !mso]>` branch and silently dropped the CTA
  label, which would have let the one button vanish without any assertion
  noticing — a measuring harness that under-reports is worse than none.

- `src/lib/notifications.admin-self-submit.test.ts` — 4 tests, including that
  every *other* admin is still mailed. **Verified by injection:** removing the
  skip line fails exactly the two tests that target it and leaves the two
  controls passing.

No existing test pinned this copy, so nothing was rewritten to match a
change — checked before editing.

---

## 6. Also removed

The `Questions? Reach us at support@lastdonor.org` line. Not repetitive, just
not load-bearing in a receipt whose only action is "check status", and the
shell footer already identifies the sender. Easily restored if the owner wants
a support route in transactional mail; it was a judgement call, not a defect.
