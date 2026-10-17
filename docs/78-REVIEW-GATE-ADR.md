# 78 — The review gate: making "reviewed before publication" true

**Date:** 2026-10-17
**Status:** Implemented for user submissions. **⛔ The automated pipeline is
still ungated — one decision outstanding.**
**Resolves:** the open question in `docs/77`.
**Amends:** `docs/77` (which corrected the copy to match the old behaviour;
the behaviour is what changed instead).

---

## The decision

`docs/77` found that `POST /api/v1/user-campaigns` published instantly —
`status: 'active'`, `publishedAt` set, comments reading "instant-live" and
"no review needed" — while ~30 places across 18 files promised a human
review before publication, including the Organization JSON-LD and the
`/compare` table as a competitive claim against GoFundMe.

It offered two ways out: make the claim true, or change the claim. **The
owner chose to make the claim true.**

This is the better of the two. The positioning is the product: `/compare`
is built on it, the trust bar states it, and every category page repeats
it. Walking it back would have meant surrendering the one thing that
distinguishes this platform from the incumbent.

---

## What a submission now does

| | Before | After |
|---|---|---|
| `status` on insert | `'active'` | **`'under_review'`** |
| `publishedAt` | `new Date()` | **`null`** |
| Publicly visible | immediately | **not until approved** |
| Audit event | `campaign.published` | **`campaign.submitted`** |
| Email to organiser | "Your Campaign Is Live!" | **"Your campaign is with our reviewers"** |
| Email to admins | "New Campaign Live" (FYI) | **"Review needed"** |
| Submit button | "Preview & Launch" | **"Preview & submit"** |

**What makes it invisible is the pair `(status, publishedAt)`**, not either
alone: every public read filters on
`status in ('active', 'last_donor_zone')`, and ordering and the sitemap
read `publishedAt`. Both are asserted in tests, and a mutation back to
`'active'` fails three of them.

Nothing new was needed in the schema or the admin UI. `under_review` was
already in `campaignStatusEnum`, the transition `under_review → active` was
already allowed, and `/admin/campaigns` already builds its filter tiles from
whatever statuses exist — so the queue appeared on its own.

### Approval

`PATCH /api/v1/admin/campaigns/[campaignId]` with `status: 'active'`:

1. **Stamps `publishedAt`.** It previously did this only for
   `draft → active`, so an approved submission would have been published
   with `publishedAt` null forever — and the homepage orders featured
   campaigns by it, `/campaigns` sorts on it, and the sitemap reads it. The
   condition is now **`publishedAt === null`** rather than a named previous
   status, so a later route into `active` cannot miss it and a resume
   cannot silently re-date a campaign that was already live.
2. **Logs `campaign.published`**, pairing with the `campaign.submitted`
   written at submission, so the queue is auditable end to end.
3. **Sends the organiser `welcomeCampaignerEmail`** — "Your Campaign Is
   Live!", with its four sharing steps. That email used to fire at
   submission, which was only ever accurate because nothing was reviewed.
   This is the moment it became true. It does not collide with
   `notifyCampaignStatusChange`, which writes to donors, of which a
   never-published campaign has none.

### No turnaround time is quoted anywhere

Not in the wizard, not in the submission email. `docs/77` removed
*"typically within 24 hours"* because no user-submitted campaign had ever
existed, so there was no "typically" — and building the gate does not
create the data. The organiser is told it is in the queue and that they
will be emailed; nothing promises a deadline the platform has never met
once. **Add one only when there is a measured median to quote, or when the
owner decides to commit to an SLA.**

### Rejected: an `approve` endpoint of its own

The generic status PATCH already enforces the transition table and writes
the audit log. A second route would have duplicated both and given two
places for the publish stamp to drift apart — which is exactly the bug
being fixed.

---

## ⛔ Still ungated: the automated pipeline

`src/lib/news/campaign-publisher.ts` inserts `status: 'active'` directly.
**All 12 campaigns currently live came from it**, and none was read by a
person before publication.

So the claim is now true of everything a *user* submits, and still false of
everything a donor can see today. Donor-facing copy that says "**every**
campaign is reviewed by a person" is therefore still not accurate, and the
sentence removed from `DonationForm` in `docs/77` has deliberately **not**
been restored.

The fix is one line — `status: 'under_review'` and `publishedAt: null` in
that insert — but it is a different decision from this one, with real
consequences:

- the news pipeline stops being autonomous; someone has to work the queue
  before anything new appears;
- `docs/65` means no cron has ever run, so nothing is queueing today
  regardless, which makes this cheap to turn on now and expensive to
  discover later;
- it touches the territory `docs/33` governs (machine-generated campaigns
  published as appeals from named people), which CLAUDE.md marks
  read-before-touching.

**Recommendation: gate it too, and review the 12 existing campaigns.** Until
that happens, the honest scope of the claim is "every campaign you submit",
not "every campaign".

---

## Tests

`review-gate.test.ts`, 7 tests, driving the real route against a stub
driver and asserting the row it tried to write:

- lands as `under_review`, never `active` or `last_donor_zone`;
- carries `publishedAt: null`;
- records `campaign.submitted` and **not** `campaign.published`;
- notifies admins, sends the organiser a submission receipt, and **does
  not** send the "campaign is live" email.

Mutation-tested: restoring `status: 'active'` with a `publishedAt` fails
three of them.

The wizard copy tests were updated in the same commit — they asserted the
pre-gate wording, which `docs/77` had made correct and this change makes
wrong again. They now assert the review language **and** that no turnaround
time has crept back in, with a regex for any `N hours / N days` phrasing.
