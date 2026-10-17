# 77 — Wizard screens 3–6, and a claim the platform makes everywhere but does not keep

**Date:** 2026-10-17
**Status:** Screens 3–6 implemented. **⛔ The review claim is OPEN and needs an
owner decision.**
**Completes:** `docs/75` (screens 1 and the shared chrome), `docs/76` (screen 2).

---

## ⛔ The finding: campaigns are not reviewed before publication

`POST /api/v1/user-campaigns`, the endpoint the wizard's "Launch fundraiser"
button calls:

```ts
status: 'active',
publishedAt: new Date(),
verificationStatus: 'unverified',
source: 'manual',
```

followed by a `campaign.published` audit event, and its own comments:

> `// Notify admins (FYI - campaign is live, no review needed)`
> `// Send welcome email to campaigner (sharing focus, zero document requests)`

**A user-submitted campaign is public the moment the button is pressed.**
There is no gate. `under_review` exists in `campaignStatusEnum` and an admin
can move a campaign *into* it afterwards, but no creation path ever sets it.
Review is post-publication and reactive.

This appears to be a deliberate product decision — "instant-live" is written
in the code — and it is not, in itself, wrong. What is wrong is that the
site says the opposite.

### Where the claim is made: ~30 places across 18 files

Including, but not limited to:

| File | Claim |
|---|---|
| `src/app/layout.tsx` | Organization JSON-LD: *"reviews campaigns before publication"* |
| `src/app/compare/page.tsx` | A comparison table row against GoFundMe: *"Campaign review — Before publication"* |
| `src/app/about/page.tsx` | *"A person reviews the campaign before it goes live"* |
| `src/app/how-it-works/page.tsx` | *"Before publication, a real person reviews the campaign…"* |
| `src/app/editorial-standards/page.tsx` | *"LastDonor reviews fundraisers before publication"* |
| `src/app/campaign-verification-policy/page.tsx` | *"What We Review Before Publication"* |
| `src/app/transparency/page.tsx` | *"Every published campaign is reviewed before it goes live"* |
| `src/app/donor-faq/page.tsx`, `HomepageFAQ` | FAQ answers, **inside `FAQPage` JSON-LD** |
| `HeroSection`, `TrustBar`, `TrustBanner`, `HowItWorks`, `Testimonials` | *"Human reviewed"*, *"Reviewed by a person"*, *"each one reviewed before it goes live"* |
| `src/app/campaigns/page.tsx`, every category page | *"Each one reviewed before going live"* |

Two of those are worse than marketing copy: the **Organization JSON-LD** and
the **`/compare` table** make the claim machine-readable and
competitor-relative.

The 12 campaigns currently live do not support it either — all are
`source = 'automated'`, published by the `publish-campaigns` cron.

### What was changed here, and what was not

**Changed: the three places that directly contradict the code path the
reader is about to trigger, or that I wrote myself.**

| Where | Was | Now |
|---|---|---|
| Screen 6 "What happens next?" | *"Our editorial team reviews your campaign, typically within 24 hours"* / *"Once approved, your campaign goes live"* | *"Your campaign page goes live and can accept donations straight away"* / *"LastDonor can review it at any time, and will contact you if anything needs changing"* |
| Screen 6 step subtitle | *"A person reads every campaign before it goes live."* | *"Check everything before your page goes live."* |
| Wizard desktop aside | *"Draft in minutes. Reviewed before publication."* | *"Draft in minutes. Your page is live as soon as you launch it."* |
| `DonationForm` protection block | *"Every campaign is reviewed by a person before it goes live."* | removed; the refund-policy sentences stay |

The last two of those I wrote on 2026-10-16, carrying the claim over from
the rest of the site without checking the endpoint. Correcting them is not
optional.

*"typically within 24 hours"* was unsupportable twice over: there is no
pre-publication review to time, and **no user-submitted campaign has ever
existed**, so there is no "typically" to report. Same class as the `$5,000`
in `docs/76` and the five statistics `docs/67` removed from email.

**Not changed: the other ~26 occurrences.** Rewriting the platform's central
positioning is an owner's decision between two real options:

1. **Make the claim true** — have `POST /api/v1/user-campaigns` insert
   `status: 'under_review'` and leave `publishedAt` null until an editor
   approves. The statuses, the admin transitions and the notification
   templates already exist; what is missing is the gate and a queue someone
   actually works. This keeps the positioning that `/compare` is built on.
2. **Change the claim** — adopt "published immediately, reviewed
   continuously, removed when it fails", and correct all ~26 places
   including the JSON-LD and the comparison table.

Option 1 is the one the rest of the product is written for. Option 2 is
honest about what ships today. **Doing neither is the only unacceptable
outcome**, because today the site tells donors a human checked a page that
nobody checked.

---

## Screens 3–6: the copy pass

Same rule as `docs/75`: one heading per screen, and it is the question.

### Screen 3 — photos

The step heading said **"Add photos"**, an `h2` below it said **"Add a cover
photo or video"**, and a paragraph restated the subtitle. Three lines for
one instruction, and the two headings disagreed about whether video counted.

Heading is now *"Add photos or video"*; the `h2` is gone; one line carries
the only facts the visitor needs: *"Up to 5 photos, plus a YouTube link if
you have one. You can change them later."*

### Screen 4 — category and place

Two defects:

- **The duplicate.** *"What best describes why you're fundraising?"* is the
  step heading asked again in longer words. Now just **"Category"** — the 23
  chips below explain themselves.
- **A heading that asked about money over a field that collects a town.**
  *"Where will the funds go?"* asks about destination of funds, which on a
  crowdfunding page is a donor-facing promise governed by `docs/41`. The
  input is the beneficiary's location. Now **"Where is the person based?"**

### Screen 5 — title and story

The step heading was *"Tell the story"* and the field heading below it was
*"Tell Maria's story"*. The personalised one is better, so the **step**
heading changed to *"Title and story"* rather than flattening the warm one.

The title helper described the shape of a good title in 17 words while the
placeholder below already demonstrated it; now *"Name the person and what
happened."*

**Writing tips are collapsed, not cut.** Five bullets and 50 words sat
permanently between the heading and the textarea they describe — advice in
front of the box rather than beside it. Closed by default: someone who knows
what to write meets the textarea; someone who does not is one tap away.

### Screen 6 — review

*"Review Your Campaign"* and *"Check the details below, then agree to our
guidelines and submit"* both restated the step heading, on the longest
screen in the flow, above a legal notice that already says what agreeing
means. Both removed.

---

## An accessibility defect the tests found

A test could not locate the story textarea by its accessible name, because
it did not have one. Three fields — `subjectHometown`, `title` and `story` —
had a visible `h2` acting as their label and **nothing connecting the two**.
A screen reader announced each as "edit text, blank".

Fixed with `aria-labelledby` pointing at the existing headings, which keeps
the visual design exactly as it is. `goalAmount` was already fine — it
carries an explicit `aria-label`.

Worth recording for the method: the test was written to check copy, and it
failed for a reason that had nothing to do with copy. **Querying by
accessible name finds missing labels for free**, which querying by test id
or CSS class never would.

---

## Result

Measured at 390px, mobile, against the state before `docs/75`:

| Screen | Before | After screens 1–2 | After this pass |
|---|---|---|---|
| 1 Who | 2,715px / 310w | 1,323 / 78 | 1,323 / 78 |
| 2 Goal | 2,784 / 310 | 1,323 / 84 | 1,323 / 84 |
| 3 Photos | 2,770 / 321 | 1,323 / 103 | *see below* |
| 4 Category | 3,092 / 325 | 1,519 / 106 | |
| 5 Story | 3,298 / 361 | 1,725 / 139 | |
| 6 Review | 3,963 / 520 | 2,391 / 303 | |

Post-deploy figures for 3–6 are recorded in the commit that follows this
doc, measured the same way.
