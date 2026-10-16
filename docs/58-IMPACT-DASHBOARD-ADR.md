# 58 — "Your impact": per-sharer stats, built against GoFundMe's own spec

**Date:** 2026-10-16
**Status:** Implemented
**Supersedes nothing.** Extends `docs/57` (the attributed share loop), which
built the plumbing this surface reports on.

---

## Why this doc exists

`docs/57` shipped attributed links: `/s/<token>` → cookie → Stripe metadata →
`donations.share_link_id`. It recorded the mechanism but left the reporting
surface unspecified. This records what that surface is, where the
specification came from, and the two defects found while building it.

---

## Where the specification came from (VERIFIED)

Not from imagination, and not from the rendered help centre, which blocks
fetchers. GoFundMe's Zendesk help-centre API serves the article text and an
`edited_at` timestamp:

```
https://support.gofundme.com/api/v2/help_center/en-us/articles/<id>.json
```

Read on 2026-10-16:

| Article | Title | `edited_at` |
|---|---|---|
| `24972788571803` | "See your impact with unique share links" | 2026-10-07 |
| `360001489648` | "Fundraising with co-organizers" | 2026-09-23 |

What article `24972788571803` states, quoted:

1. The surface is called **"Your impact"**.
2. It has **two levels**: "your overall impact from all fundraisers you've
   donated to", and "the impact you've had on individual fundraisers".
3. It shows **"the names and amounts of those you've inspired to donate"** —
   names and money, not a bare count.
4. **"Anyone who chooses to donate as 'Anonymous' will also be 'Anonymous' on
   your impact dashboard."**
5. A signed-in user generates a unique link from **any** share option, not
   only after donating.
6. An email goes out on the **first** attributed donation — to donors and
   supporters. **Organizers and beneficiaries get none.**
7. Data is only available from **April 2024** onward.

Three of those I would have got wrong by guessing, and two of them were
already wrong in our code:

- I assumed per-link stats. They aggregate overall **and** per fundraiser.
- I assumed counts. They show **names and amounts**.
- I assumed links were minted post-donation. **Any share option mints one.**

The method the owner asked for — study GFM, borrow, perfect — only works if
the "study" step precedes the "build" step. It did here, and it changed the
design three times before a line was written.

---

## What was decided

### 1. Two levels, matching the spec, plus a third number they do not have

`/dashboard/impact` renders:

- four overall tiles: **Raised through you**, **Donors you brought**,
  **Link visits**, **Campaigns shared**;
- a per-campaign list, each row with its copyable link and its own three
  numbers;
- **People you brought in** — names and amounts, anonymity preserved.

**Link visits is ours, not theirs.** Their article never mentions clicks. It
is included because a sharer deciding what to do next must distinguish two
failures a donor count cannot tell apart:

| visits | donors | what it means |
|---|---|---|
| 0 | 0 | a distribution problem — nobody saw it |
| 50 | 0 | a campaign problem — they saw it and did not give |

`ImpactLinkRow` says exactly this in words, per row, rather than leaving the
sharer to infer it: *"People are opening this link but not donating yet"* /
*"No one has opened this link yet."*

**Rejected: showing clicks only as a percentage conversion rate.** With the
counts most sharers will have (visits in single digits) a percentage is
noise dressed as precision — "0% conversion" off two visits reads as a
verdict and is not one.

### 2. Anonymity is resolved in SQL, not in the component

```sql
case when donations.is_anonymous then 'Anonymous' else donations.donor_name end
```

The real name never leaves `getAttributedDonors`. **Rejected: selecting both
`donor_name` and `is_anonymous` and branching in JSX.** It works, and it puts
a donor's stated wish one typo away from being broken, in a file whose other
changes are visual. There is now exactly one place that decision is made.

Verified against the live database (see §4): a donation with
`is_anonymous = true` and `donor_name = 'Secret Donor'` renders `Anonymous`,
and the real name is absent from the result set entirely.

### 3. Refunded money is never credited

`COUNTS_AS_IMPACT` (`refunded = false`) is applied in all three queries.
`docs/41` made refund accounting single-writer precisely so `refunded` can be
trusted as the answer to "did this money stay". Crediting a sharer for money
that went back would be a claim the platform cannot substantiate.

### 4. Minting moved to *any* share surface (spec item 5)

This was a **real gap, not a nicety**. Before today the only mint site was the
post-donation screen. The campaign sidebar's Share button — the main share
surface, and on mobile the only one most people will use — handed out the
plain campaign URL. So `/dashboard/impact` was structurally incapable of
reporting anything for almost everyone. **The stats surface and the minting
surface are one feature; shipping either alone ships nothing.**

New: `POST /api/v1/campaigns/[slug]/share-link`, signed-in only, idempotent
per (campaign, user). `SidebarShareButton` calls it on click and shares
`/s/<token>`.

Decisions inside that, each with its rejected alternative:

- **Minted on click, not on mount.** *Rejected: prefetching the link when the
  campaign page renders*, which would make the share sheet open instantly with
  no network wait. It also writes a row for every campaign a signed-in person
  merely **looked at**, so "Campaigns shared: 47" would count 47 pages they
  scrolled past. A dashboard that reports something untrue to save 100ms is a
  bad trade, and this project's working agreement forbids exactly that class
  of claim.
- **Bounded at 1,500ms, falling back to the plain URL.** The share sheet must
  open. An uncredited share is a worse outcome than a credited one and a far
  better outcome than a button that appears broken. *Rejected: blocking until
  the mint returns.*
- **`unknown` auth state shares the plain URL.** Per `docs/44` a 429 or failed
  session read must never render as signed out; here the harmless reading is
  "no attribution", not "sign in first".
- **Guests get no link at all.** `mintShareLink` with no `user_id` produces a
  row attributable to nobody. *Rejected: minting for guests*, which fills the
  table with rows no dashboard can ever show.
- **Not rate-limited.** The write is idempotent per (campaign, user), so a loop
  achieves at most one row per campaign that already exists — bounded, and
  indistinguishable from someone who genuinely shared everything. Recorded
  here so it is a decision rather than an oversight.

The route is **not** in `PUBLIC_API_ROUTES`, so middleware default-deny covers
it in addition to its own `auth()` check. `middleware.public-routes.test.ts`
confirms this in both directions and passes unchanged.

### 5. "You gave X and brought in Y" (spec, verbatim)

> "Not only will you be able to see the amount you donated, but you'll also
> be able to see how many other donations you brought to the fundraiser!"

Found on a second, line-by-line pass over the article, after the first build
was already committed. Gave-and-brought together is the whole claim a sharer
can make about a campaign, and either number alone understates it.

`getOwnGivingByCampaign` is a **separate query**, not another join on
`getImpactByCampaign`. *Rejected: folding it in*, because the two aggregates
share nothing but a campaign id, and folding a second independent aggregate
into that query is precisely how the visit count got multiplied (§Defect 1).

Keyed on `donations.user_id`, not on the sharer's own links: a gift counts
whether or not it happened to arrive through their own link.

Shown only when they actually gave. *Rejected: rendering "You gave $0"* for
the many sharers who have not donated — that is a reproach, not information,
and this surface exists to encourage sharing, including by people who cannot
give money.

Verified against the live database on 2026-10-16 inside `BEGIN … ROLLBACK`:
a sharer with $50 + $99 (refunded) on one campaign and $25 on another, plus a
$77 donation from somebody else, reports **$50 and $25**. Both exclusions
hold.

### 6. Placement: the global account menu, not only the dashboard

The article's navigation steps are explicit: *"Go to the menu in the top right
corner, and select 'Your impact'."*

Ours was reachable only from the `/dashboard` sidebar. That is the wrong
place, and not for reasons of parity: someone who has just shared a campaign
is **on the campaign page**, and making them go via `/dashboard` means the
one moment a sharer most wants to check their link is the moment the page is
hardest to find.

It is now in both — `UserNav`'s account dropdown (global, matching GFM) and
the dashboard sidebar's primary nav. *Rejected: moving it out of the sidebar*
to avoid duplication; the two menus serve different moments, and a sharer
already inside the dashboard should not have to reach up to the avatar.

### 7. Deliberately NOT built, with reasons

- **The first-attributed-donation email (spec item 6).** Their article is
  explicit that organizers and beneficiaries get none, and our transactional
  mail is down anyway (Resend returns 401). Building a send path that cannot
  be tested end to end would be shipping an unverified claim. Deferred.
- **An April-2024-style data cutoff (spec item 7).** That is an artefact of
  when **they** launched the feature. Our attribution column was created on
  2026-10-15 and no donation predates it, so a cutoff notice would explain a
  gap that does not exist.
- **"Generate more unique share links" per campaign.** `mintShareLink` is
  idempotent per (campaign, user) on purpose: one link per campaign keeps a
  sharer's total in one place instead of splitting it across links they cannot
  tell apart. Multiple links per campaign is a channel-attribution feature
  (which post worked), and nothing in the product asks that question yet.

---

## Two defects found while building, and how

### Defect 1 — visits were being counted wrongly, twice

The first draft of `getImpactSummary` joined links to donations and aggregated
across the join. Both forms are wrong, in opposite directions:

- `sum(click_count)` over the join multiplies each link's visits by its
  donation count;
- `sum(distinct click_count)` — the attempted fix — is **worse**, because
  DISTINCT deduplicates the *values*, so two links with 3 visits each report 3.

**Verified, not reasoned about.** Run against the live database on 2026-10-16
inside `BEGIN … ROLLBACK`, with two links of 4 visits each and 3 counting
donations (plus 1 refunded) on one of them. Truth: **8 visits, 3 donors,
$60.00, 2 campaigns.**

| form | donors | cents | campaigns | **clicks** |
|---|---|---|---|---|
| A: `sum(distinct click_count)` (first draft) | 3 | 6000 | 2 | **4** ❌ halved |
| B: `sum(click_count)` over join (naive fix) | 3 | 6000 | 2 | **16** ❌ 2× |
| C: donations pre-folded per link (**shipped**) | 3 | 6000 | 2 | **8** ✅ |

The shipped form folds donations to one row per link in a subquery *before*
joining, so each link contributes its `click_count` exactly once.

Both transactions rolled back; `campaign_share_links` and `donations` were
confirmed empty afterwards.

### Defect 2 — a syntax error the type checker caught, not the tests

A scripted edit to `DashboardSidebar.tsx` produced `ChevronDoubleRightIcon,,`.
Noted only because it is the second time in this session a scripted edit has
silently produced something invalid. Scripted edits need a typecheck, not a
glance.

---

## On the tests

`src/lib/share-impact.test.ts` runs the **real** query builder against a stub
driver, so what it asserts is the SQL that would reach Postgres and the
mapping of the rows that come back.

This is deliberate and it is the point of the file. **A mock that records
call shapes would have passed the broken query happily** — `sum(distinct …)`
is a perfectly well-formed builder call. The two guards that matter were
mutation-tested: reintroducing the original aggregation makes exactly those
two fail, and the other eleven still pass.

CI has no database, so the live-database verification above cannot run there.
The fixture and its numbers are recorded in this doc so the result is
reproducible rather than remembered.

---

## Files

| File | Role |
|---|---|
| `src/lib/share-impact.ts` | The three queries. Anonymity and refund rules live here. |
| `src/lib/share-impact.test.ts` | Real SQL, stub driver, mutation-tested guards. |
| `src/app/dashboard/impact/page.tsx` | "Your impact". |
| `src/components/dashboard/ImpactLinkRow.tsx` | One link, its numbers, its honest reading. |
| `src/app/api/v1/campaigns/[slug]/share-link/route.ts` | Mint from any share surface. |
| `src/components/campaign/SidebarShareButton.tsx` | Shares `/s/<token>` when signed in. |
| `src/components/layout/UserNav.tsx` | "Your impact" in the global account menu. |

---

## Full coverage of the article, line by line

Recorded so the next reader can see the section was finished rather than
sampled.

| Article statement | Status |
|---|---|
| Surface named "Your impact" | ✅ matched |
| Overall **and** per-fundraiser levels | ✅ matched |
| Names and amounts of those you inspired | ✅ matched |
| Anonymous stays Anonymous | ✅ matched, resolved in SQL |
| Unique link from **any** share option when signed in | ✅ built (§4) |
| Unique link immediately after donating | ✅ already existed (docs/57) |
| "The amount you donated" shown with what you brought | ✅ built (§5) |
| Reached from the top-right menu | ✅ built, and kept in the sidebar too (§6) |
| Email to donors/supporters on first attributed donation | ⏸ deferred — mail is down (Resend 401); an untestable send path is an unverified claim |
| Organizers/beneficiaries get **no** email | ✅ by construction — we send none |
| Email verification on first access | ✅ stronger — the page is session-gated |
| "Generate more unique share links" | ❌ rejected (§7) |
| Data only from April 2024 | ❌ N/A — our column dates from 2026-10-15 (§7) |
| Unsubscribe from impact emails | ❌ N/A — no impact emails |
| "Donations you've made", 14-day edit window | ➡ a different surface, not this section |
