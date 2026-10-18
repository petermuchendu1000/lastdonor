# 79 — Closing the review gate: the news generator, and the 12 live campaigns

> **Side effect found 2026-10-18, fixed:** gating everything to
> `under_review` also took every campaign out of scope of
> `reconcile` step 4, whose `raised_amount` integrity check selected
> `status IN ('active','last_donor_zone','paused')`. The financial
> drift detector would have inspected nothing, nightly, while
> reporting success. It is an exclusion list now. See `docs/66`.

**Date:** 2026-10-17
**Status:** Implemented. The claim now holds without qualification.
**Completes:** `docs/78` (which gated user submissions only).
**Amends:** `docs/77` (the donor-facing sentence it removed is restored here).

---

## What `docs/78` left undone

`docs/78` gated `POST /api/v1/user-campaigns`. It did not gate
`src/lib/news/campaign-publisher.ts`, which inserted `status: 'active'`
directly — and that path produced **all 12 campaigns that were live**.

So the state after `docs/78` was: true of everything a user submits, false
of everything a donor could actually see. That is not a smaller version of
the problem, it is the same problem with better paperwork. The sentence
removed from `DonationForm` had to stay removed, and a reader of
`/compare`, `/about` or the Organization JSON-LD was still being told
something untrue.

Closing it needed three things, not one.

---

## 1. The generator drafts; it no longer publishes

```diff
- status: 'active',
+ status: 'under_review',
- publishedAt: new Date(),
+ publishedAt: null,
```

**The cost is deliberate and it is the point.** The news pipeline is no
longer autonomous: it drafts, a person publishes. For content this platform
writes *itself*, in the names of real people it found in news articles
(`docs/33`, `docs/36`), that is the correct direction for the cost to run.

`docs/65` makes this cheap to turn on now — no cron has ever run, so nothing
is queueing today — and it would have been expensive to discover later, once
a scheduler was live and a backlog was accumulating unseen.

### The bug this change introduced, and the fix

The publisher dedups a new campaign against the 15 most recent, ordered by
**`publishedAt`**. With queued campaigns carrying `publishedAt: null`, that
ordering sorts every unreviewed campaign to the bottom: the window would
only ever see already-approved campaigns, and the pipeline would cheerfully
generate a **second campaign about the same person** while the first sat in
the queue.

Both the publisher's own dedup window and the cron's anti-repetition title
list now order by **`createdAt`**, which is set on insert either way. A test
asserts the window references `createdAt` and not `publishedAt`.

This is the kind of defect a one-line change hides: nothing in the diff
looks like it touches deduplication.

### Naming

`campaign.auto_published` becomes **`campaign.auto_drafted`** in the
publisher, the cron and the pipeline, because that is what the row now
records. The admin activity feed accepts **both**, so the historical rows
written under the old name stay visible rather than vanishing from the
timeline.

---

## 2. The 12 campaigns that were already live

They were published by the ungated generator. Nobody read them. Leaving
them public while restoring the sentence "every campaign is reviewed by a
person before it goes live" would have re-created the exact defect this
work exists to remove — so they were moved into the queue:

```sql
update campaigns set status = 'under_review', published_at = null
 where status = 'active' and source = 'automated';
```

**Before acting, what was at stake was checked, not assumed:** all 12 are
`source = 'automated'`, and **every one has zero donations**. No donor is
mid-flow, no money is in play, and `docs/72` means the platform cannot take
a donation at all. The cost of queueing them is a public campaign list that
is empty until they are approved. The cost of not queueing them is a
falsehood on the donate page.

**This is reversible in one statement.** The prior state of every row is
saved in `_review_gate_backup_20261017` (id, slug, status, published_at),
and an audit row records why:

```sql
-- restore all 12 exactly as they were
update campaigns c set status = b.status, published_at = b.published_at
  from _review_gate_backup_20261017 b where b.id = c.id;
```

The intended path is not that statement, though — it is
**`/admin/campaigns`**, which already filters by status, so the 12 appear
under an `under_review` tile. Approving one there stamps `publishedAt`,
logs `campaign.published` and emails the organiser, per `docs/78`. Drop the
backup table once they are through.

---

## 3. The claim, restored and tied to the code

`DonationForm` says again:

> Every campaign is reviewed by a person before it goes live.

It was removed in `docs/77` because it was false and is back because it is
true. To stop that being a matter of someone's memory, the test asserts the
**equivalence**, not the sentence:

```ts
expect(DONATION_FORM.includes(CLAIM)).toBe(bothGated);
```

If either insert is relaxed back to `'active'`, the test fails and names
the sentence that has to come out with it. A claim about other people's
money should not be able to drift away from the code that makes it true.

---

## Scope note: the other ~26 occurrences

`docs/77` inventoried roughly 30 statements of this claim across 18 files,
including `/compare`, `/about`, `/how-it-works`, `/editorial-standards`,
`/transparency`, the FAQ JSON-LD and the Organization JSON-LD. **They were
not edited, and they no longer need to be** — they were never wrong about
the intent, only about the implementation, and the implementation is what
changed. That was the better of the two options `docs/77` set out, and it
is why it was the better one: one gate makes thirty sentences true, where
rewriting thirty sentences would have left the product weaker and the gate
still missing.

## Still open elsewhere

- **Soft-404 on campaign pages.** A nonexistent slug returns HTTP 200 with
  "Campaign Not Found" — verified against a bogus slug, so it predates this
  work. It now also covers queued campaigns, which is correct behaviour
  through an incorrect status code. Touching it means touching the
  deliberate 404-vs-5xx logic in `docs/43`, so it is recorded, not changed.
- **`docs/72`**: the platform still cannot take a donation.
- **`docs/66`**: the cron Worker is still undeployed, so the generator will
  not queue anything until it is.
