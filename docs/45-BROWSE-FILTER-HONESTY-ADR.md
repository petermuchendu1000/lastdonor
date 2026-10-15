# 45 - Browse, Filter and Search Honesty (ADR)

**Date:** 2026-10-15
**Status:** Implemented
**Surfaces:** `/search`, `/campaigns`, `GET /api/v1/campaigns`,
`src/lib/campaign-search.ts`, `src/app/campaigns/browse-params.ts`
**Related:** docs/29 (audit), docs/31 (remediation plan), docs/33 (seed
disclosure), docs/34 (migration freeze), docs/36 (seed content sanitization)

---

## 0. Context

A live browser audit of production (2026-10-14/15) found five defects in the
browse and search path. All five share one failure mode: **the page acted on
less than the URL said, and told the visitor nothing about it.** Nothing was
broken loudly; everything was wrong quietly, which is the worse kind on a
platform that asks strangers for money.

| # | Symptom (verified in production) |
|---|---|
| D1 | `/search?q=fire` 200s, lands on `/campaigns` with `q` gone: all 12 campaigns, no chip, no "no results". |
| D2 | `/campaigns?close_to_target=1` printed "**12** active campaigns" directly above "No active campaigns at the moment. Check back soon.", with no visible Clear control. |
| D3 | `?category=bogus`, `?category=disaster-relief`, `?sort=bogus`, `?status=completed` all returned the full list of 12 under the normal header. |
| D4 | Header subtitle asserts campaigns are reviewed before publication. **Owner decision pending; deliberately untouched.** |
| D5 | Keyword search matched only 4 short columns, so 9 of 12 realistic donor queries returned zero results while relevant campaigns existed. |

---

## 1. D1 - `/search` forwards every param the listing understands

**Decided.** `/search` resolves its own `searchParams` and redirects to
`/campaigns` carrying `q`, `category`, `location`, `sort`, `close_to_target`
and `status`. With nothing to forward it still redirects to a bare
`/campaigns`.

**Why it mattered more than it looked.** *Verified by reading
`src/app/layout.tsx:53`, 2026-10-15:* `/search?q={search_term_string}` is the
`SearchAction` target in the site's JSON-LD, so this is the URL a Google
sitelinks search box, a bookmark, an email or any external link uses. The old
body was `redirect('/campaigns')` with no query string, so **every** such URL
silently became an unfiltered listing.

**Rejected:** making `/search` a real page with its own UI (a second listing to
keep in sync, for no gain); redirecting with the raw query string untouched
(would carry `utm_*` and anything else into the canonical listing URL, and into
the ISR cache key space).

**Trade-off accepted:** params the listing does not understand are dropped at
the redirect, so campaign tracking params do not survive a `/search` hop.

---

## 2. D2 - The count may not contradict the list beneath it

**Decided, three parts:**

1. The header count reports **what is actually being shown**, labelled against
   the unfiltered total: "0 of 12 active campaigns match these filters". With
   no filter active the previous copy is unchanged ("12 active campaigns").
2. With a filter active and no rows, the empty state reads **"No campaigns
   match these filters."** instead of "No active campaigns at the moment. Check
   back soon.", which blamed the platform for the visitor's own filter.
3. A **visible `Clear filters` control** sits on the filter bar itself (a real
   `<button type="button">`, accessible name "Clear filters", pushing
   `/campaigns`), and a `Clear filters` link is rendered inside the empty state.
   Reset previously existed only inside the Filters drawer, so the only visible
   exit from a zero-result URL was the browser Back button.

`0 results` for `close_to_target=1` is arithmetically correct: it means ">= 90%
funded" and every campaign is at $0 raised (*verified in production,
2026-10-15*). The defect was entirely in what the page said about it.

**Also fixed in the same area:** the filter bar is now rendered in **both**
branches of the page. When a category resolved, the page swapped the header,
status tabs and the whole filter bar for a category hero, so `?category=medical`
had no filter UI and no exit at all.

**Rejected:** dropping the social-proof count when filters are active (loses
the anchor the header is there for, and leaves "0" unexplained); showing only
the filtered count (a visitor cannot tell whether the platform is empty or
their filter is narrow); keeping the unfiltered count and adding a tooltip (a
contradiction a hover explains is still a contradiction).

**Trade-off accepted:** one extra `COUNT(*)` round trip, and only when a
narrowing filter is active. It runs inside the same `Promise.all` and the page
is ISR with `revalidate = 300`.

---

## 3. D3 - An unrecognised value is reported, never silently widened

**The rule, applied identically to `category`, `sort` and `status`:** a value
we cannot apply is **named to the visitor**, and the listing is shown
deliberately unfiltered on that dimension.

Concretely, `/campaigns?category=bogus` now renders, above the list:

> category "bogus" is not one we recognize, so it was not applied. The list
> below is not filtered by category.

**Why this and not "treat it as zero results".** Both options were on the
table; the deciding argument is `sort`. A sort value cannot narrow anything,
so "unrecognised sort = zero results" is incoherent, and a rule that applies to
two of three params is not a rule. Zero results would also turn every stale
link and every typo into an empty page that looks like a platform with no
campaigns, which is exactly the lie D2 was about. Reporting the value is the
only answer that is both honest and consistent across all three.

**Status is handled by kind, not by guess:**

| `status` value | Behaviour |
|---|---|
| `active`, `last_donor_zone` | Accepted, no-op: this is what the page lists. |
| `completed`, `archived` | Real statuses served elsewhere. The notice links to `/completed-campaigns`. |
| anything else | Reported as unrecognised. |

**The label/value mismatch is reconciled, not papered over.** *Verified in
`src/lib/categories.ts`, 2026-10-15:* the category menu renders `label` while
the UI emits `value`, so the menu displays **"Disaster Relief"** while the link
carries `?category=disaster`. `disaster-relief` is therefore the value a
visitor, or an old link, would most plausibly carry. `browse-params.ts` derives
an alias table by slugifying every label (`Disaster Relief` ->
`disaster-relief` -> `disaster`), so the displayed string resolves. The table is
derived, not hand-written, so a new category cannot forget to join it.

**Rejected:** `notFound()` or a 400 for an unrecognised value (a browse URL
with a stale filter is not a missing page, and it punishes the visitor for our
own label drift); redirecting to a canonicalised URL (hides that the original
link was wrong, and the visitor keeps sharing it); renaming the `disaster` enum
value to `disaster-relief` (that is a schema change under the docs/34 freeze,
and it would orphan every existing row and link).

**Trade-off accepted:** an unrecognised value still returns a full listing, so
a careless link still shows 12 campaigns. It now shows them with an explicit
statement that the filter was not applied, which is the difference between a
wide answer and a false one.

---

## 4. D5 - Keyword search covers the story body and the category

**Measured by the coordinating audit against the 12 live active campaigns
(2026-10-15), reported as given:**

| term | old search returned | genuinely relevant |
|---|---|---|
| fire | 1 | 5 |
| cancer | 1 | 1 |
| medical | 1 | 7 |
| veteran | 0 | 2 |
| ambulance | 0 | 1 |
| surgery | 0 | 1 |
| hospital | 0 | 5 |
| disaster | 0 | 2 |
| memorial | 0 | 1 |
| paralyzed | 0 | 1 |
| soldier | 0 | 1 |
| crash | 0 | 2 |

Nine of twelve returned **zero** results while relevant campaigns existed. The
old predicate matched `title`, `subject_name`, `location`, `subject_hometown`
and nothing else; the words donors type live in the story.

**Decided:** one exported predicate, `campaignSearchCondition` in
`src/lib/campaign-search.ts`, used by both `/campaigns` and
`GET /api/v1/campaigns`. Each had its own copy of the match, which is how
"Load More" could have disagreed with page 1. **Factored out, both call it now.**

It matches: `title`, `subject_name`, `location`, `subject_hometown`, the story
**prose**, and the **category**.

### 4.1 Story body: markup is stripped in SQL before matching

*Verified by reading `src/lib/ai/prompts/generate-campaign.ts:105` and
`src/lib/ai/prompts/story-validation.ts:141`, 2026-10-15:* every story is
generated as HTML and is **required** to contain a source `<a href="...">`, and
on seeded content that href is an `example.invalid/lastdonor-seed/...` URL
(docs/36). A naive `ILIKE '%q%'` over `story_html` would therefore match all 12
campaigns for "https", "href", "lastdonor-seed", "noopener" or "data-section"
and read as a broken relevance engine.

The predicate matches against
`regexp_replace(regexp_replace(story_html, '<[^>]*>', ' ', 'g'), '&[a-zA-Z]+;|&#[0-9]+;', ' ', 'g')`:
tags first (which takes every attribute, and so every URL, with them), then
entity references (so "amp" and "nbsp" cannot match). The two patterns are
exported constants, and `plainTextForSearch()` is their JS mirror, so the unit
tests and the SQL cannot drift apart silently.

Story and category matching require a query of **at least 3 characters**;
title, name and location stay unrestricted so short real queries ("TN") work.
Prose matching on one or two characters matches nearly everything.

**Rejected:** matching `story_html` raw (the seed-URL problem above); stripping
tags in TypeScript after fetching rows (that is filtering in the application
after the database already returned the wrong set, and it breaks pagination
counts); a stored or generated plain-text column, which is the clean fix and
needs a migration - **deferred under docs/34**, recorded in §6 as the durable
follow-up.

### 4.2 Category: resolved in TypeScript, matched as an enum

`category` is a Postgres enum (`USER-DEFINED`), so comparing it with `ILIKE`
needs an explicit `category::text` cast. Instead, the query is folded against
`CAMPAIGN_CATEGORIES` in TypeScript (value **and** displayed label, punctuation
normalised), and the matches become an indexable `category IN (...)`.

This is also what makes "disaster", "disaster relief" and "disaster-relief" all
find the `disaster` campaigns, closing the same label/value gap as §3 from the
search side.

**Rejected:** `category::text ILIKE '%q%'` (a second scan over a cast column,
and it still would not match the displayed label "Disaster Relief" for a query
of "disaster relief"); maintaining a separate search-synonym list (a second
source of truth for category names).

### 4.3 Performance, stated rather than shipped quietly

`ILIKE '%term%'` over a computed text value **cannot use a btree index** and
table-scans every active campaign on a public, unauthenticated endpoint. At 12
rows this is irrelevant. *This is an assumption about scale, not a measurement:*
no load test was run. It is not a pattern that survives growth, and the real
fix is a `pg_trgm` GIN index (or a `tsvector`) over a stored plain-text column.
That needs a migration, so it is the follow-up in §6, not a claim of done.

---

## 5. D4 - The review claim was left exactly as it is

"Each one reviewed before going live" in the `/campaigns` header is
**unchanged**, and no new copy anywhere in this change asserts that campaigns
are reviewed, verified or checked before publication. Whether that claim is
true is an open owner decision being handled separately.

**Noted, not changed, for whoever closes that decision:** the same assertion
also appears in this page's `metadata.description` ("Every campaign is reviewed
before publication"), in its OG description, and in the FAQ answer "Are
campaigns reviewed before they appear here? Yes." If the decision goes the
other way, those are the other places to fix. Per CLAUDE.md, trust copy is a
factual assertion, not microcopy.

---

## 6. Follow-ups this change does not do

1. **Plain-text search column + trigram/full-text index** for `story_html`.
   The durable fix for §4.1 and §4.3. Needs a migration in
   `src/db/migrations-v2/` under docs/34.
2. **`src/app/campaigns/campaign-filters.integration.test.ts` holds its own
   copy of the old four-column predicate** and so no longer mirrors the shipped
   query. It should call `campaignSearchCondition` and assert the story/category
   matches against a real database. Not changed here because no database was
   available in this session to run the integration suite, and shipping an
   unrunnable test is worse than naming the gap.
3. **`/completed-campaigns` has the same D2/D3 shape** (unfiltered framing,
   silently ignored unknown values, no visible clear control). Out of scope for
   this change; it should adopt `browse-params.ts` and the same notice.
4. **Unit tests cover a JS mirror of the SQL regexes, not Postgres.** The
   patterns are POSIX and identical in both engines, and the emitted SQL is
   asserted to use the same exported constants, but end-to-end proof belongs in
   the integration suite (follow-up 2).
