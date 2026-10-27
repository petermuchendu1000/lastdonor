# 119 — Doors that open on nothing, and doors that are not there

**Date:** 2026-10-27
**Status:** implemented on `main`, **not deployed** (owner runs deploys, `docs/96`).
**Journey audited:** the **organiser** journey — create → review → live. Second
of a journey-by-journey pass; `docs/118` was the donor journey and §7 of it
holds the inventory.

Also records the **production verification of `docs/118` §9 and §10** (v110),
and a measurement anomaly found by a control that failed.

Every claim is **[VERIFIED]** (with its receipt), **[INFERRED]** or **[UNKNOWN]**.

---

## 1. ✅ `docs/118` §9 and §10 verified against production (v110)

Deployed 2026-10-27T04:57:00Z, 362s. v109 → **v110 complete**, machine version
110, `started`, 1/1 checks passing.

The behavioural before/after, with controls that could have failed:

| probe | before (v109) | after (v110) |
|---|---|---|
| `/campaigns/zz-payments-test-mpesa-gateway` (`archived`) | **404** | **200** |
| …"has closed" / "Campaign Closed" / "record of every donation" | absent | **all three present** |
| …`noindex` present | — | **yes** |
| `/campaigns/alicia-reeves` (`under_review`) — control | 404 | **404** |
| `/campaigns/help-john-…` (`active`) — control | 200 | **200** |
| `/campaigns/<uuid>` — control | 404 | **404** |
| health | 503 degraded, stripe error | **identical** |

So §9 is **[VERIFIED] in production**: the page serves `archived` with its
notice, `noindex` holds (serving is not indexing), and the three controls prove
nothing else was opened. The rotted notification row from `docs/118` §2.5 now
resolves, with no backfill.

⚠️ **§10 could NOT be verified by HTTP, and the attempt is instructive.** The
plan was to grep the live `/share-your-story` HTML for the currency selector.
The pre-deploy baseline showed **0** matches for `Fundraising goal amount` —
an aria-label that definitely existed in the code then. The wizard is a
multi-step client component: step 0 is in the initial HTML and the goal step is
not. So the probe was **non-discriminating** either way, the `docs/104` §5.1a
trap. It is caught here only because a baseline was taken first; without one,
"0 matches after deploy" would have read as a failed deploy.

§10 therefore remains **[UNKNOWN] in production** until somebody advances the
wizard to the goal step in a browser.

---

## 2. ⚠️ A failed control found something: the sitemap advertises no campaigns

The sitemap assertion for §9 was *"the archived slug must not appear"*. It did
not. But its positive control — *"the active campaign must appear"* — **also
returned 0**, which voids the measurement (Gate 5: an anomalous sample means
diagnose before interpreting).

**[VERIFIED]** production `/sitemap.xml`: 42 `<url>` entries, being static
pages plus 23 category pages, and **zero campaign detail URLs** — against 14
`active` campaigns. `x-nextjs-cache: HIT`, identical across three requests and
unchanged by a cache-busting query string or by going direct to
`lastdonor.fly.dev`.

**[VERIFIED]** `sitemap.ts:54` is `export const revalidate = 3600`, and its
query is `inArray(campaigns.status, ['active','last_donor_zone','completed'])`
— which 14 rows match.

**[VERIFIED]** `scripts/deploy.sh:18-22` documents the cause: `--build-secret`
exists so that *"the 24 routes that combine `export const revalidate` with a
database read pre-render real content instead of empty."* **This deploy did not
pass `--prerender`**, and the build log carries
`[build] database read failed, pre-rendering as empty` for several routes.

**[INFERRED]** (chain: the route is ISR; the build had no database; the empty
render was cached; the cache reports HIT) the sitemap self-heals once the entry
ages past 3600s.

⛔ **[UNKNOWN] whether it was populated before this deploy.** I did not capture
the pre-deploy sitemap, which is the one measurement that would settle whether
this is a transient artifact of my deploy or a standing defect. A re-check is
scheduled for 06:09 UTC; §2.1 will record the answer.

### 2.1 Result of the re-check

_To be filled by the scheduled re-check. If campaign URLs are present, the
inference above is confirmed and the operational note is: **a deploy without
`--prerender` blanks the campaign sitemap for up to an hour.** If they are
still absent, this is a real defect and the next step is to run the sitemap's
own query against production and look for a `try/catch` degrading to the
static floor._

---

## 3. ⛔ The journey promised an edit the editor refuses

### 3.1 Understanding, cited

`organiser-journey.ts:279-287` built its `write` step **unconditionally**:

```ts
state: 'done',
detail: 'Done. You can still edit it.',
href: `/dashboard/campaigns/${f.campaignId}/edit`,
action: 'Edit',
```

with no reference to `f.status`, while `edit/page.tsx:63` was
`if (!['draft','active'].includes(campaign.status)) redirect(...)`.

**[VERIFIED] three independent ways**, each able to refute the others:

1. **The step** — read above; `href` and `action` always set.
2. **The target** — `edit/page.tsx:63`, the redirect.
3. **The renderers** — both show a step's button on `step.href && step.action`
   (`JourneyChecklist.tsx:92`, `NextStepRow.tsx:121`). Both were always truthy,
   so nothing stood between the step and the organiser.

⚠️ This is `docs/83` inverted. There a working route had no door; here a door
is always shown and the room refuses to open — the same thing `docs/117` §3.3
calls *"a control that can only fail is worse than no control"*, reached from
the other side.

### 3.2 Blast radius — narrower than first reported, and that is a correction

**[VERIFIED]** `nextOrganiserAction` (`organiser-journey.ts:433-440`) returns
only a step whose state is `attention` or `now`. The `write` step is
`state: 'done'`, so **`NextStepRow` never renders it.**

So this appears on the **two `JourneyChecklist` surfaces only** —
`[id]/page.tsx:256` and `[id]/verification/page.tsx:124` — not on the dashboard
list or `/dashboard`. An earlier summary of mine implied the list too; that was
wrong.

### 3.3 ⚠️ Live exposure is 2 organisers, and the falsification is why

The first count was *"9 of 23 campaigns are in a status the Edit link bounces"*
(8 `under_review` + 1 `archived`). **Gate 3's falsification query refuted the
severity:** joining to `users` returned only **2** rows.

**[VERIFIED]** `campaigns.creator_id` is **nullable**, and in production:

| status | with a creator | with NO creator |
|---|---|---|
| `active` | **1** | **13** |
| `under_review` | **2** | 6 |
| `archived` | 0 | 1 |

So the platform has exactly **three** campaigns with a real organiser, and only
the two `under_review` ones can see this defect today.

⛔ **The by-product is the bigger finding: 13 of 14 publicly live campaigns
have no organiser at all.** [INFERRED, chain: `docs/116` §8 established that
machine-written campaigns went live from the news pipeline, and `docs/79` moved
12 automated ones into the queue] those are the ownerless rows. Consequences
worth stating, none of them fixed here: no one can verify them, no one can be
reminded to, and no one can withdraw — consistent with `docs/113`'s finding
that money has never left this platform. **What should happen to a live appeal
about a named real person with no accountable organiser is an owner decision**,
and it is the same question `docs/116` §8.5 left open.

### 3.4 The fix

`src/lib/campaign-editability.ts` — `ORGANISER_EDITABLE_STATUSES` and
`isOrganiserEditable`. The rule was written out **twice**
(`edit/page.tsx:63`, `[id]/page.tsx:150`) and the journey consulted neither;
there is one decider now, and the journey's `href`, `action` **and `detail`**
all turn on it. Leaving the sentence while hiding the button would still be
telling the organiser something untrue.

⛔ **NOT merged with `createCampaignSchema`'s `status: z.enum(['draft','active'])`**
(`validators/campaign.ts:86`). That is which status an *admin* may **create** a
campaign in. Same two values, unrelated reasons; folding them together would
let a change to admin creation silently change what an organiser may edit. The
ratchet exempts that file by name and says why.

⚠️ **And the obvious test shape would not have worked.** `docs/109`'s pattern
is to parse the page's literal and assert the constant equals it — but once the
page *calls* the helper there is one decider and "they agree" is a check that
**cannot fail**. So the rules instead forbid a fourth site hardcoding the pair,
and forbid the journey going back to unconditional — with a control asserting
both screens still call the helper, so deleting the call sites cannot satisfy
the rule.

---

## 4. ⛔ The list had no permanent door, and the flag to open it was discarded

### 4.1 Understanding, cited

**[VERIFIED] four ways**, with the falsifier run:

1. `DashboardSidebar.tsx:28-34` — `PRIMARY_NAV` was `/dashboard`,
   `/dashboard/finances`, `/dashboard/impact`. No `/dashboard/campaigns`.
2. `UserNav.tsx` — links `/dashboard/payout-settings`, `/dashboard`,
   `/dashboard/impact`. Not the list.
3. **Falsifier A** — *"is it reachable from the mobile nav?"*
   `DashboardMobileNav.tsx:32` **renders `DashboardSidebar` itself**, so it has
   the same `PRIMARY_NAV` and the same gap. Did not overturn it.
4. **Falsifier B** — every inbound link in `src/`. The three persistent ones
   are each conditional:
   - `dashboard/(index)/page.tsx:207` "View all", inside
     `{myCampaigns.length > 0 && …}`, and `myCampaigns` is
     `where(eq(campaigns.creatorId, userId))` — **creator only**
   - `FinancesClient.tsx:275`, inside `if (campaigns.length === 0)` — the
     **empty state**
   - `PayoutDestinationFlow.tsx:193`, inside a creator-only flow

   The rest are one-shot `router.push` calls or comments.

**So `docs/117` taught that list to include campaigns a person merely HELPS
with, and the only persistent doors to it are hidden from exactly those
people** once the redirect after accepting has been used. That is the
`docs/117` shape one layer up, in my own work.

### 4.2 ⚠️ And the flag was already being paid for

**[VERIFIED]** `dashboard/layout.tsx:18-22` ran a dedicated
`count(*) … where creator_id = …` on **every dashboard page load** and passed
the result to `DashboardShell`; `DashboardSidebar:48` destructured it as
`_hasCampaigns` — **exactly one occurrence in the file** — and used it for
nothing. One of three permitted concurrent queries (`docs/87`), spent on a dead
prop. `layout.tsx:17`'s comment ("to conditionally show Finance section")
describes an intent never implemented.

### 4.3 The fix

- `hasAnyCampaign(userId)` in `my-campaigns.server.ts`, **sharing
  `liveMembership` with `listMyCampaigns`** so the nav entry cannot disagree
  with the list's contents. Still one query, `limit(1)` rather than `count(*)`
  because the question is existence.
- `/dashboard/campaigns` → `PRIMARY_NAV`, marked `requiresCampaign` so somebody
  with nothing to list is not sent to an empty page. The mobile nav inherits it
  by rendering the same component.
- The prop is read.

⚠️ The icon was added to `DashboardSidebar`'s **existing** heroicons import.
`docs/70` forbids new direct heroicons imports — and **[VERIFIED]**
`icon.test.tsx:170-172` counts *files* (`toBeLessThanOrEqual(80)`), not icons,
and this file is already one of the 80. So the count does not move.

---

## 5. ⛔ One tile shown to a helper threw them off the campaign

**[VERIFIED]** In the Quick Actions grid on `[id]/page.tsx`, **Donors** and
**Verification** carried `showsOrganiserOnly` and **Impact Update did not** —
while its target (`impact-update/page.tsx:38`) filters
`and(campaignCondition, eq(campaigns.creatorId, session.user.id))` and then
`redirect('/dashboard')`. A collaborator was shown a tile that ejected them
from the campaign entirely, with no message.

⚠️ **`submit_impact_update` is in neither `DELEGATABLE` nor
`NEVER_DELEGATED`** — an undeclared power, which `isDelegatable` fails closed
on. So the fix is to **gate the tile**, matching the target. Moving it into
`DELEGATABLE` would reopen the `docs/111` §1 decision, and an impact update
reports how a family's money was spent; that is not a content capability and
not a bug fix.

### 5.1 ⚠️ My own test had the hole this came through

`collaborator-screens.test.ts` (written in `docs/117`) enumerated **four**
sealed regions — `CampaignTeamPanel`, `JourneyChecklist`, `/verification`,
`/donors` — and `/impact-update` was not among them. A hand-written list is
only as good as whoever remembered to extend it.

Both halves are fixed: the fifth entry is added, **and** a structural rule now
finds every `/dashboard/campaigns/${id}/<child>` link in the file and requires
each child to be inside the gate or named deliberately open.

⚠️ That structural rule **failed first, and the rule was wrong, not the page**:
it flagged `edit`, which is correctly open because `edit_content` is one of the
two `DELEGATABLE` capabilities and `edit/page.tsx` admits a collaborator
holding it. The open set is now exactly the two delegatable surfaces —
`updates` and `edit` — which is what makes the rule mean something.

---

## 6. Two raw enums and a mislabelled button, found while doing the above

- **`{impactUpdate.status}` rendered raw at an organiser, in TWO places** on
  `[id]/page.tsx` — the tile badge and the Impact Update section's "Status"
  row. The Verification tile beside them carries a comment explaining they
  stopped doing exactly this. Now `impactUpdateStatusLabel`, added to
  `campaign-labels.ts` with completeness read from `impactUpdateStatusEnum`
  (`docs/110` §4). The section is gated to match its tile.
  ⚠️ I fixed one occurrence and the test caught the second — the check found
  what the edit missed.
- **`FinancesClient.tsx:275` said "Create Campaign" and pointed at
  `/dashboard/campaigns`** — the list, not the wizard. The single button
  offered to somebody with no campaigns did not do what it said. Now
  `/share-your-story`.

---

## 7. Checks

| check | count | proves |
|---|---|---|
| `campaign-editability.test.ts` | 9 | the rule, every enum value, and that no fourth site hardcodes it |
| `dashboard-nav-door.test.ts` | 10 | the nav entry, the flag being read, the shared predicate, the one-query budget |
| `collaborator-screens.test.ts` | 15 (was 13) | the fifth sealed region, plus the structural tile rule |
| `campaign-labels.test.ts` | 17 (was 15) | impact-update labels, derived from the enum, and the tile rendering them |

### 7.1 Mutations, all killed

| mutation | result |
|---|---|
| journey offers Edit unconditionally again (the reported defect) | 2 tests fail |
| a fourth site hardcodes `['draft','active']` | 2 fail |
| un-gate the impact-update tile | 2 fail |
| sidebar discards the flag again | 1 fail |
| layout returns to a creator-only count | 1 fail |
| "Create Campaign" points at the list again | 1 fail |

Restored: **50/50** on the four files.

---

## 9. ✅ The browser walk, and the claim it found

Run 2026-10-27 against a **production build** (`docs/63`) on a throwaway
Postgres seeded with the E2E fixture plus three states it does not carry: an
`under_review` campaign, an `archived` one, and an **accepted** collaborator.
**21/21 assertions passed, zero console errors.**

Each shot asserts what it should show, so a screenshot cannot quietly capture
the broken state and look fine as a thumbnail:

| shot | what it proves |
|---|---|
| dashboard | the "My campaigns" nav entry exists (§4) |
| `under_review` detail | **zero** links to the editor; the old sentence gone; the new reason present (§3) |
| `active` detail | the editor **is** offered — the control |
| wizard goal step | `select#currency` offers USD and KES, and choosing KES renders **`Ksh`** (`docs/118` §10) |
| `/campaigns/shot-archived` | **HTTP 200**, closed notice, no donate CTA (`docs/118` §9) |
| collaborator list | not the empty state; badged *Helping*; nav entry present |
| collaborator detail | **no** Impact Update / verification / donors — but updates still reachable (§5) |

**This closes `docs/118` §10's [UNKNOWN].** §1 of this document records that an
HTTP probe could not see the currency selector, because the wizard's goal step
is not in the initial HTML. A browser at step 2 shows it, and the three-character
`Ksh` prefix confirms the length-dependent padding works.

⚠️ **Three of my own harness mistakes, each the lesson it illustrates:**

1. The fixture was seeded under one `PASSWORD_PEPPER` and served under
   another, so every sign-in failed — `docs/99` §6's hazard, met directly.
2. `getByRole('button', { name: /yourself/i })` matched nothing, so the first
   run screenshotted **step 1 instead of the goal step** and reported "no
   currency selector". Those options are `role="radio"`, and an explicit ARIA
   role **replaces** the implicit one — `docs/99`/`docs/100`, now met from the
   test side.
3. `a[href$="/donate"]` reported a donate CTA on the closed campaign. It was
   matching the **global navbar link** to `/donate`. The rule was wrong, not
   the page; the scoped version plus a control for the navbar link both pass.

### 9.1 ⛔ The claim the screenshot found

The archived page rendered, directly above *"It can no longer take
donations"*:

> ⏳ **Pending verification** — We have not checked this organiser's ID yet.
> **This campaign can raise up to $500.00** until we do…

**[VERIFIED three ways] the class PREDATES serving `archived`:**

1. **Code** — `campaigns/[slug]/page.tsx:556` mounted
   `PendingVerificationBadge` gated only on `verificationStatus` and
   `currency`. Nothing about whether money can still arrive.
2. **Logic** — `isDonatable` is `active || last_donor_zone`, so `completed`,
   `paused`, `suspended` and `cancelled` have all been served and
   non-donatable for months.
3. **A live render** — a `completed` campaign, a status served long before
   this change, answers 200 with the same banner. So serving `archived` added
   **one more instance** and is what made somebody look; it did not create the
   defect.

A ceiling on future giving, on a campaign with no future giving, is a claim
the platform cannot substantiate — which CLAUDE.md forbids outright.
`isDonatable` is now a **required** prop, so `tsc` named both existing test
files rather than letting the old calls compile.

⚠️ A control test asserts the badge **still renders** on a live unverified
campaign: this must not become a way to quietly delete a disclosure donors are
owed. Mutation: dropping the guard fails 1 test; restored, 20/20.

---

## 8. ⛔ What was NOT checked

- ~~No browser walk of any of this.~~ **Done — see §9**, 21/21 with
  screenshots. What remains unseen: **mobile width** (the walk was 1280px
  only), and no axe pass on the changed surfaces.
- **Nothing in §3-§6 is deployed.** Production serves v110, which has §9/§10
  and none of this.
- **The ownerless-campaign finding (§3.3) is reported, not acted on.** 13 of 14
  live campaigns have no organiser; what to do about a published appeal naming a
  real person with nobody accountable is an owner decision.
- **§10 of `docs/118` is still unverified in production** (§1).
- **The sitemap question is open** until §2.1 is filled in.
- **`/dashboard/supported`, `/dashboard/updates` and
  `/campaigns/[slug]/congratulations` remain orphaned** — 463, 157 and 104
  lines with no inbound link anywhere, carried forward from `docs/118` §7.1 and
  still not addressed. Whether they are dead by intent is **[UNKNOWN]**; no doc
  mentions their orphaning.
- **The impact-update review loop still notifies nobody** (`docs/118` §7.1).
  Gating the tile does not change that an organiser who submits one is never
  told what happened to it.
