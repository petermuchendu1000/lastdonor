# 137 — The activity filter hid two thirds of the evidence

**Date:** 2026-10-28
**Status:** fixed, not deployed at time of writing (owner deploys — `docs/96`)
**Sub-journey:** admin journey, part 9 of 10 (OBSERVABILITY)

---

## 1. The surface, and why it matters more than it looks

`/admin/activity` is where somebody goes to ask **what happened**. It is the
same evidence `docs/116` §8's forensics rest on — that five machine-written
campaigns about named real people went public unreviewed was established by
reading `campaign.published` rows against `campaign.auto_drafted` ones.

All five observability pages are correctly gated (`docs/132`/`docs/133`'s work
holding): `reports`, `monitoring`, `activity` and `audit-log` on
`role !== 'admin'`, `notifications` via `requireRole(['admin'])`.

⚠️ And `AuditLogViewer:186` is a model of the right thing: it renders the raw
`eventType` inside a `<code>`, so **there is no label to drift**. The defect
below is what happens when the neighbouring screen does the opposite.

---

## 2. The defect

`ActivityCenter.tsx` offered category chips — donations, campaigns, users,
system — built from a hand-written map:

```ts
const CATEGORY_EVENTS: Record<string, string[]> = {
  donations: ['donation.recorded', 'donation.failed', 'donation.refunded'],
  campaigns: ['campaign.phase_transition', 'campaign.completed',
              'campaign.auto_published', 'campaign.auto_drafted', 'campaign.created'],
  users:     ['user.login', 'user.deleted', 'user.role_changed'],
  system:    [ /* six cron types, two admin, one audit_log */ ],
};
```

**20 event types listed. The code writes 94+.**

⛔ **And it was not cosmetic, because there were two code paths for one
question.** The badge called `getEventCategory` (`:274`); the chip filter read
the map **directly** (`:133-134`):

```ts
const eventTypes = CATEGORY_EVENTS[categoryFilter] ?? [];
result = result.filter((a) => eventTypes.includes(a.eventType));
```

So a row could be badged `campaigns` by one path and then **hidden by the
`campaigns` chip** by the other. There was no `other` chip either — `:251`
built the list from `Object.keys(CATEGORY_EVENTS)` — so an unlisted event had
nowhere to be selected from at all.

### 2.1 What that hid, measured on production data

[VERIFIED] production `audit_logs`, `campaign.*` only:

| event type | rows | in the old map? |
|---|---|---|
| `campaign.published` | **14** | ⛔ no |
| `campaign.auto_published` | 12 | ✅ yes |
| `campaign.status_changed` | **10** | ⛔ no |
| `campaign.auto_drafted` | 8 | ✅ yes |
| `campaign.cancelled` | 5 | ⛔ no |
| `campaign.deleted` | 5 | ⛔ no |
| `campaign.submitted` | 3 | ⛔ no |
| `campaign.resumed` | 2 | ⛔ no |
| `campaign.paused` | 1 | ⛔ no |
| `campaign.queued_for_review` | 1 | ⛔ no |
| `campaign.suspended` | 1 | ⛔ no |

**62 rows. 20 visible. Pressing "campaigns" dropped 42 of them — 68% —
including every one of the 14 `campaign.published` rows**, silently: no
count, no indicator, no `other` chip to find them under.

Every category under-covered, not just campaigns:

| chip | listed | written in code |
|---|---|---|
| donations | 3 | 8 |
| campaigns | 5 | 13 |
| users | 3 | 4 |
| system | 9 | 13 (`cron.*` alone) |

And **20 prefixes had no chip at all** — `institution`, `info_request`,
`collaborator`, `fund_pool`, `bulk_email`, `settings`, the whole blog family,
and more.

---

## 3. Root cause — [VERIFIED]

The category of an event was **enumerated** rather than **derived**, and the
two consumers of that category disagreed about where to read it.

This is the pattern `docs/110` named (seven status maps, three of them wrong)
and `docs/119` named again (*"a hand-written list of sealed regions is only as
good as whoever remembered to extend it"*). The list drifts the moment anybody
adds an event type, and nothing says so.

**Falsification attempt:** *"the default view shows everything, so this is
cosmetic."* It fails on two counts. The chip is labelled `campaigns`, so a
reader narrowing to campaign events reasonably believes they are seeing
campaign events; and there is no `other` chip, so the unlisted majority has no
reachable home. A filter that silently returns a third of the matching rows is
worse than no filter, because the reader cannot tell.

---

## 4. The fix

Derive the category from the event **prefix**, have the filter call the **same
function** the badge uses, and render an `other` chip so everything is
reachable:

```ts
const CATEGORY_PREFIXES = { 'donation.': 'donations', 'campaign.': 'campaigns',
                            'user.': 'users', 'cron.': 'system',
                            'admin.': 'system', 'audit_log.': 'system' };
export const ACTIVITY_CATEGORIES = ['donations','campaigns','users','system','other'];
```

A new `campaign.*` event is categorised the day it is written, with nothing to
remember. `other` is not decoration — it is what makes the invariant hold.

**Invariant:** *every event type the code writes must be reachable through
exactly one chip.* Before: 20 of 94+. After: all of them.

**Blast radius:** one client-side filter and a badge on one admin page.
`ActivityCenter` is rendered only by `admin/activity/page.tsx`, and
`CATEGORY_EVENTS` had no consumer outside the file. No data, no money, no
schema. Rollback is `git revert`.

---

## 5. ⚠️ The test's own anti-vacuity control caught the test

`activity-categories.test.ts` **derives** the event types from `src/` rather
than listing them — a list restated in a test would drift exactly as the map
did. Its first rule is the control: *the scan must find a lot of types, and
must find these three families.*

That control **failed on the first run**, and it was right to. The scan used

```
eventType:\s*'([a-z0-9_.]+)'
```

which requires a literal immediately after the key — and
`admin/campaigns/[campaignId]/route.ts:159` writes a **ternary**:

```ts
eventType: isFirstPublication ? 'campaign.published' : 'campaign.status_changed',
```

So the scan silently missed both — **the two most common campaign events in
production, 14 and 10 rows.** The earlier grep that produced the figure "94"
had the identical flaw, so the real total is higher than 94 and every count in
§2 derived from it is a **floor**.

⚠️ This is `docs/120`'s lesson in a different costume: there, a sweep over
`.update(campaigns)` missed the six sites passing `.set(variable)`. A
literal-only match misses the site that matters. The scan now reads the whole
expression after `eventType:` and extracts every string literal in it.

⛔ Still uncovered by that scan, and stated rather than hidden: an event type
assembled from a **variable** (`eventType: someVar`) yields nothing. No such
site is known, and none was searched for.

### 5.1 Five rules, all injection-proven

| Injection | Result |
|---|---|
| **the original enumerated map restored** | FIRED (2 rules) |
| the `campaign.` prefix dropped | FIRED (2) |
| **CONTROL** everything collapsed to `other` | FIRED (2) |
| **CONTROL** the `other` chip removed | FIRED (2) |
| the filter reverted to a second lookup | FIRED |

The two controls matter: without them, `getEventCategory = () => 'other'` plus
an `other` chip would satisfy "everything is reachable" while telling the
reader nothing. The last one pins the **root cause** rather than the symptom —
the filter must decide the category the same way the badge does.

---

## 6. What was NOT checked

- **The rendered filter in a browser.** The rules execute `getEventCategory`
  for real and pin the wiring by reading source, but no test mounts
  `ActivityCenter` and clicks a chip. The local production-build server had
  been stopped when this was written.
- **`/admin/reports`, `/admin/monitoring`, `/admin/notifications` beyond their
  gates and queries.** Three of the reports page's four queries are now in
  modules with tests (`docs/107`, `docs/115`) and the fourth (`topCampaigns`)
  is a typed drizzle builder with no `sql` interpolation, so the `docs/107`
  Date trap cannot apply to it — but it is executed by no test, which is
  `docs/107` §7's standing gap.
- **Whether any production reader was actually misled.** The rows were hidden
  from a filter; whether anybody pressed that chip is unknowable from here.
