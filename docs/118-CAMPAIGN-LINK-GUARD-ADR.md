# 118 — Notifications handed people links to pages that are not there

**Date:** 2026-10-27
**Status:** implemented on `main`, **not deployed** (owner runs deploys, `docs/96`).
**Journey audited:** the **donor** journey — discover → donate → receipt → be
told what happened. First of a journey-by-journey pass; the inventory of the
remaining journeys is §7.

Every claim is **[VERIFIED]** (with its receipt), **[INFERRED]** or **[UNKNOWN]**.

---

## 1. What this pass was looking for

`docs/83`, `docs/109`, `docs/110` §3, `docs/112` §6 and `docs/117` are all the
same shape: **every piece works and nothing joins them up.** A redirect points
at a page that cannot render what was just created; a grant is real and has no
door; a route silently stops being reachable because of work in another file.

So the audit was not "read the donor code". It was four mechanical sweeps for
that shape, run across the whole product at once because the results inform
every journey:

| sweep | question |
|---|---|
| notification destinations | for each of the 32 `notification_type`s, where does the link go, and can it serve the recipient? |
| email URLs | for each of ~45 templates, does every URL exist and serve the state the mail implies? |
| unreachable routes | which of the 93 page routes has no door, or only doors behind unsatisfiable conditions? |
| zero-caller capability | what user-facing code is built and never invoked? |

Two of those sweeps independently reported several of the same findings. That
is corroboration, not proof — they read the same source — so **every finding
below was re-verified here by three independent methods**, one of which is a
live probe of production.

---

## 2. ⛔ The defect: a notification is a link, and nothing checked it

`docs/109` set the rule and CLAUDE.md states it:

> **Before rendering ANY link to `/campaigns/<slug>`, call `hasPublicPage`.**

It was enforced for links rendered in the UI (`CampaignsListClient`).
**Notifications were never swept.** A notification *is* a link — it is just
stored in a column and rendered later — so the rule applies to it exactly, and
nothing applied it.

### 2.1 `campaign_archived` → 404, to the people who gave money

**[VERIFIED] three ways.**

1. **Code.** `notifications.ts` wrote `link: /campaigns/${p.campaignSlug}` for
   **all three** branches of `notifyCampaignStatusChange`, the `archived` one
   included.
2. **The rule.** `archived` is absent from `PUBLICLY_VIEWABLE_STATUSES`
   (`campaign-visibility.ts:25-32`) *and* from the page's own filter
   (`campaigns/[slug]/page.tsx:117-122`) — two places, agreeing.
3. **Live HTTP.** `GET /campaigns/zz-payments-test-mpesa-gateway`, a real
   `archived` row in production → **404**. The control: an `active` slug →
   **200**, so the probe can tell them apart (Gate 4).

So the *only* condition that produces a `campaign_archived` notification was
the *only* condition under which its link cannot resolve — 100% broken, not
conditional. Recipients are real un-refunded donors.

⚠️ Both reaching paths are live: the admin PATCH transition map allows
`draft|active|last_donor_zone|completed → archived`, and `DELETE` on a campaign
that has any donation writes `status: 'archived'` and then notifies.

### 2.2 `message_flagged` → a UUID in the slug position

**[VERIFIED] three ways.** `moderate/route.ts` wrote
`link: /campaigns/${campaignId}`, and `:25` validates `campaignId` as a
**UUID**. `/campaigns/[slug]` resolves only `eq(campaigns.slug, slug)`. Live:
`GET /campaigns/<uuid>` → **404**.

The recipient is a donor being told their message was hidden, sent to a dead
page. The route never selected the slug, so it could not have built the link
correctly.

### 2.3 Two more, conditional but live

- **Refund notices.** `notifyDonationRefund` carried no status at all, so its
  link could not be guarded. A refund is very often issued *after* a campaign
  is wound up, and `DELETE` archives a campaign while leaving its donations in
  place — so the common case for this notification is a campaign with no
  public page.
- **Update digests.** `notifyCampaignUpdateDigest` likewise carried no status.
  The organiser route rejects only `archived`, and `active → draft` is allowed
  while the campaign **keeps its donors** — so a digest can reach subscribed
  donors naming a page that 404s.

### 2.4 The empty slug, which is not a 404 and is worse

Two admin call sites pass `campaignSlug: full?.slug ?? ''`, which built the
string `'/campaigns/'`. **[VERIFIED] live: that answers 308**, redirecting to
the whole listing — so a donor told their campaign had concluded landed on a
browse page with no explanation. A 404 at least says something is wrong.

---

### 2.5 ⛔ A STORED link ROTS, and one in production is a 404 right now

Found by closing the one `[UNKNOWN]` this document originally shipped with
("has a real person already been handed one of these?"). Reading all **7**
production notification rows answered it, and the answer is worse than the
question:

```
type=campaign_donation_received
link=/campaigns/zz-payments-test-mpesa-gateway
read=True            created_at=2026-10-21 04:52:09
```

That campaign is `archived`. **[VERIFIED]** `GET` on that path answers **404**
today. And the row's own timeline shows the link was *correct when written*:

| UTC 2026-10-21 | event |
|---|---|
| 04:46:41 | `published_at` — campaign goes public |
| 04:52:09 | donation recorded; this notification written, link valid |
| 04:54:48 | `updated_at` — campaign archived; **the link dies** |

The link was good for **2 minutes 39 seconds** and has been dead for six days.

⚠️ **This means the §4 fix is necessary and not sufficient.** Guarding at
*write* time stops a link being born broken. It cannot stop one **rotting**:
a notification is a string in a column, rendered whenever the person opens
the bell, and the campaign's status moves underneath it.
`NotificationsClient.tsx:279` renders `n.link` straight from the row with no
revalidation, so nothing on the read side notices.

Two candidate fixes, and **both are owner calls**, so neither was taken:

1. **Clear the links when a campaign leaves public visibility.** One `UPDATE`
   inside a transition that already performs several writes. Cheap, but it
   mutates existing rows and needs a one-off backfill for the row above.
2. **⚠️ Serve `archived` on the public page, with a notice.** This is probably
   the real answer, because `campaign-visibility.ts:18-21` already makes
   exactly this argument for two other statuses: *"`suspended` and `cancelled`
   ARE here, deliberately. The page serves them and renders an explanatory
   notice; a donor following an old link deserves to be told what happened
   rather than that the appeal never existed."* `archived` — "concluded, your
   contributions have been recorded" — is the same case, and appears to have
   been omitted rather than decided. Including it would make §2.1 and this
   section disappear together.

   ⛔ Not taken unilaterally because it changes what is publicly visible and
   what a crawler can reach. `isIndexable` (`page.tsx:202`) is already the
   narrower set `active|last_donor_zone|completed`, so indexing would not
   change — but visibility is a policy call, not a bug fix.

---

## 3. ⚠️ The root cause is not those four lines

**Nothing in this codebase built a link to a campaign.** Twenty-plus call
sites each decided slug-vs-id and public-vs-not for themselves, and they
disagree — which is why some were correct by luck and others were not.

The sharpest evidence, and **[VERIFIED]** by reading all seven:

| route | keyed on |
|---|---|
| `[id]/verification:27`, `[id]/impact-update:26`, `[id]/payout-destination:55` | slug **or** UUID |
| `[id]:33`, `[id]/updates:19`, `[id]/donors:30`, `[id]/edit:19` | **UUID only** — a slug hits `notFound()` |

So `/dashboard/campaigns/<slug>/verification` works and
`/dashboard/campaigns/<slug>` is a 404. That split is what made the mistake
survivable long enough to spread: `notifications.ts` had one line passing a
slug to a child that accepts it (fine) and another passing a slug to the bare
route (404), **and the two lines look identical**.

---

## 4. The fix

`src/lib/campaign-links.ts`, two functions:

- **`publicCampaignPath({ slug, status })`** → the path, or **`null`** when
  there is no public page, or when the slug is empty.
- **`organiserCampaignPath(campaignId, screen?)`** → always keyed on the
  **id**, which is correct on all seven screens.

⛔ **`null` is a real answer and every renderer already handled it.**
`NotificationsClient.tsx:279-285` renders the title as plain text and
`NotificationBell.tsx:246-249` does not navigate. So an unlinkable
notification still tells the person what happened; it just stops promising a
page that is not there. That is `hasPublicPage`'s own stated philosophy one
layer out: *hiding a working link costs a button; showing a broken one costs a
404*.

⚠️ Only the **type** needed widening: `createAndEmail`'s `link` was
`string | undefined` while the runtime already did `p.link ?? null`. The
guarded link could not be passed in.

### 4.1 The status is a REQUIRED parameter, and the compiler found the callers

`notifyDonationRefund` and `notifyCampaignUpdateDigest` gained
`campaignStatus: string` — required, not optional. `tsc` then named **every**
call site (the `docs/115` trick): three production routes and one test
fixture. One of the three already selected `campaigns.status` and simply was
not passing it; two needed it added to their existing `select` rather than a
new query, because `docs/87` caps a route at three concurrent queries and the
whole point of that cap is to stop routes growing a query at a time. The
moderation route got its slug and status by a **join on the query it already
ran**.

⛔ An optional `campaignStatus?:` would have let every existing call site keep
its 404 and still compile. That is the entire value of the change.

### 4.2 The dead code was fixed too, deliberately

Seven notification helpers that link to a campaign have **zero callers**
(`notifyAdaptiveDonationReceipt`, `notifyAbandonedDonation`,
`notifyAdaptiveRefund`, `notifyPostDonationImpact`,
`notifyCreatorThankYouUpdate`, `notifyCreatorImpactUpdateApproved`,
`notifyCreatorMotivation`). They were given the required `campaignStatus`
anyway, and `AbandonedDonationContext` and `CreatorContext` gained the fields
needed to supply it.

⚠️ They have no callers, so this breaks nothing — and that is why it is worth
doing *now*: whoever finally wires them **cannot** reintroduce the 404,
because the type will not let them. `CreatorContext` previously carried only
`campaignSlug`, so the six "Post an Update" / "View Dashboard" buttons built
from it **could not have worked** — the type could not supply what the route
needs. It now carries `campaignId` and those six build the id form.

---

## 5. Checks

| check | count | proves |
|---|---|---|
| `campaign-links.test.ts` | 14 | the builder, every status in the enum, both boundaries, the empty slug |
| `campaign-links.ratchet.test.ts` | 7 | no hand-built campaign link survives, discovered from disk |

The unit test **derives** the public set from `PUBLICLY_VIEWABLE_STATUSES` and
walks every value of the `campaign_status` enum, asserting each lands in
exactly one of the two sets — so adding a status cannot silently land in
neither.

### 5.1 Mutations, all killed

| mutation | result |
|---|---|
| restore the hand-built archived link (the original defect) | rule 1 fails |
| point an organiser link at the UUID-only route with a slug | rule 2 fails |
| builder never refuses (drop the `hasPublicPage` guard) | **4** unit tests fail |
| builder accepts an empty slug | 1 test fails |

Restored: **21/21**.

### 5.2 ⚠️ The ratchet strips comments, and that is load-bearing HERE

The `docs/116` §4 lesson, demonstrated rather than asserted: the comment in
the moderation route that *explains* the old broken link necessarily quotes
it. A test asserts that the raw file still matches `/campaigns/${…}` and the
**stripped** file does not — so a sweep without stripping would report the fix
as the defect, which is exactly what happened in `docs/116`.

⚠️ Rule 2's negative lookahead is deliberately narrow, and a test pins that
too: five real call sites build `/dashboard/campaigns/<slug>/verification`,
which is **correct**, because that child accepts a slug. An over-broad rule
would have sent somebody to "fix" working code.

⚠️ **One of my own assertions in this file was false and was replaced, not
satisfied.** It claimed `campaign-links.ts`'s own prose contained the
forbidden pattern; the prose writes `/campaigns/<slug>`, not a template, so it
did not. The replacement asserts the same property against a file where it is
genuinely true.

---

## 6. ⛔ OWNER DECISION — no campaign on this platform can accept money

Found while walking this journey, and it is the journey's real headline.
**[VERIFIED] five ways. Nothing was changed for it: the root cause is a
credential and a product call.**

1. **Production data.** 23 campaigns: **14 `active`, all `USD`**; 8
   `under_review`, all `USD`; 1 `archived`, `KES`.
2. **The rail is chosen by currency, with no fallback.** `currencies.ts:172`
   USD → `gateway: 'stripe'`; `:238` KES → `payhero`. `donate/client.tsx:248`
   renders the M-Pesa form only for `payhero`; `create-checkout:124` refuses
   anything but `stripe`; `payhero/initiate:140` refuses anything but
   `payhero`.
3. **Live page.** The donate page for an active campaign answers **200 and
   renders the card form** with `$50` presets. A donor sees a form that looks
   like it works.
4. **Stripe does not authenticate.** `health/route.ts:65` calls
   `stripe.balance.retrieve()` and production reports
   `stripe = error` right now, with `database`, `payhero` and `redis` all `ok`.
5. **History.** Both donations ever recorded are `provider=payhero`,
   `currency=KES`, on `zz-payments-test-mpesa-gateway` — a test campaign, now
   `archived`.

**Falsification attempted (Gate 3):** *what would most likely show this
wrong?* That the donate path does not pick the rail from the currency, or
falls back. It does pick by currency, and there is no fallback — three call
sites confirm it.

⚠️ **Correction to a worse claim I nearly made:** the journey does **not**
dead-end at a bare 500. `create-checkout:317-339` detects
`StripeAuthenticationError` and returns **503** with honest copy — *"Card
payments are unavailable right now. This is a problem on our side, not with
your card, and nothing has been charged."* `docs/72` was fixed at that layer.
The code is better than the assumption.

So the accurate statement is: **no genuine campaign on this platform has ever
been able to accept a donation**, and a donor today fills in the whole form
before being told so.

### 6.1 Why nothing was changed

Three options, each an owner call:

| option | why it is not mine to take |
|---|---|
| Replace the Stripe key | a credential |
| Move campaigns to KES so they route to PayHero | mutates production money rows, and a campaign's currency is **immutable once any donation exists** (composite FK, `docs/92`) |
| Hide the donate form when its gateway is down | suppresses donations platform-wide if the check is ever wrong — the opposite and worse failure. A static hide would also keep donations off after the key is fixed |

⚠️ The structurally interesting one: **`docs/116` §3 records that a campaign's
currency is settable by API and reachable from NO screen**, so every campaign
ever created defaults to USD — on a platform whose only working rail is
PayHero/KES. That is the same "no door" shape as this document, one layer up,
and closing it would let an organiser create a campaign that **can** collect.
Recorded here, not built: it is the organiser journey, not this one.

---

## 7. The remaining journeys, with production exercise counts

Derived from actors × state machines × the 93 routes, and ordered by evidence
rather than preference. Counts are live production rows, read 2026-10-27.

| journey | rows | state |
|---|---|---|
| collaborator: invited → accept → use | 2 | ✅ `docs/117` + §7 of it |
| **donor: discover → donate → receipt** | **2 donations** | **this document** |
| organiser: create → review → live | 23 campaigns | partly `docs/109`, `docs/110` |
| account: register → login → reset → settings | 9 users, 6 OAuth | partly `docs/39`, `docs/74` |
| organiser: verify identity → lift cap → payout | **0** documents, **0** withdrawals | partly `docs/83`, `docs/110` |
| donor: subscribe → digest → unsubscribe | **0** subscriptions | partly `docs/40` |
| organiser: impact update → review | **0** | ⛔ not audited |
| organiser: respond to an info request | **0** | ⛔ not audited |
| donor: request a refund | **0** | ⛔ not audited |
| admin: review queue → approve/refuse | — | partly `docs/93` |
| admin: verification queue | **0** | partly `docs/88` |
| institution: created → vouch → revoke | **0** institutions | `docs/108`, not deployed |
| support conversation | **0** | ⛔ not audited |
| phone verification + SMS consent | **0** codes | `docs/85` |
| share → visit → donate → impact | 1 share link | `docs/57`, `docs/58`, `docs/112` |

### 7.1 Carried forward, verified but NOT fixed here

Each is outside the donor journey and recorded so the next pass starts from
evidence rather than a re-sweep:

- **`/admin/impact-updates` has no page.** `notifications.ts` links there;
  **[VERIFIED]** there is no `src/app/admin/impact-updates` directory, only API
  routes. ⚠️ The HTTP probe for this was **non-discriminating** (307 — an auth
  redirect cannot be told from a missing page, the `docs/104` §5.1a trap), so
  it is settled on the filesystem instead.
- **The whole impact-update review loop notifies nobody.** All three helpers
  have zero callers, and `admin/impact-updates/[id]/review/route.ts` contains
  no `notify` call at all. An organiser submits proof of spending, an admin
  approves or rejects it with notes, and the organiser is never told.
- **`notifyWithdrawalFailed` has zero callers** while the `transfer.reversed`
  branch of the Stripe webhook reverses the withdrawal and notifies nobody.
- **Three orphan pages**: `/campaigns/[slug]/congratulations` (463 lines),
  `/dashboard/supported` (157), `/dashboard/updates` (104) — no inbound link
  anywhere, and a test now actively forbids the congratulations screen's
  former door.
- **`/dashboard/campaigns` is in neither navigation surface**, and
  `DashboardSidebar:48` destructures the `hasCampaigns` flag it would need as
  `_hasCampaigns` and discards it — a dedicated query per dashboard load,
  spent on a dead prop, against a budget of three (`docs/87`).
- **The organiser journey promises an edit it refuses**:
  `organiser-journey.ts:279-287` always renders "Write your campaign — Done.
  You can still edit it. **[Edit]**", while `edit/page.tsx:63` redirects
  anything outside `['draft','active']`. Every newly submitted campaign is
  `under_review`, so this is 100% of them.
- **The impact-update tile is not organiser-gated** (`[id]/page.tsx:321`)
  while its three neighbours are, so a collaborator sees a tile that throws
  them to `/dashboard` — the `docs/117` rule broken one tile wide.
- **The newsletter prompt renders money as `raised / 100` with a `$`** and no
  currency (`generate-newsletter.ts:31-45`), feeding the model that writes
  outgoing mail. Same family as `docs/114` and `docs/115` §2.
- **The impact-update emails are inline raw HTML**, bypassing the shell, so
  they are invisible to the `docs/94` plain-language and `docs/67` dark-mode
  ratchets, interpolate admin free text unescaped, and hardcode the host.

## 8. ⛔ What was NOT checked

- **Nothing was deployed.** All of §4 is on `main` only; production still
  serves the pre-fix links until the owner deploys.
- ~~No production notification was read.~~ **Closed — see §2.5.** All 7 rows
  were read; one carries a link that is a 404 today, by rot rather than by the
  write-time bug. **[UNKNOWN]** still: whether anybody clicked it. It is
  marked `read=True`, which records that the notification was *seen*, not that
  the link was followed — nothing logs a click.
- **The 503 was not reproduced by POSTing.** §6's claim that a donor reaches
  the "card payments unavailable" message rests on reading
  `create-checkout:317-339` plus the live `stripe = error`, **not** on
  submitting a donation. `create-checkout` writes nothing locally before
  calling Stripe (**[VERIFIED]**: no `.insert`/`.update`/`.delete`), so a probe
  would have been safe — it was not run because Gate 8 covers money routes and
  the three other methods already agree.
- **Email URLs were swept but not fixed.** §7.1 carries the findings; only the
  six organiser CTAs in `email-adaptive.ts` were corrected, as part of the
  same `CreatorContext` change.
- **The 20 zero-caller helpers were not wired.** Whether that family was
  parked deliberately is a product call, not a code question — and `docs/110`
  is explicit that `notifyVerificationReminder` must **not** be wired.
- **No browser walk of the donor journey.** This pass is source, production
  SQL and live HTTP. The `docs/117` lesson is that a walk finds what none of
  those do, and the donate form's rendered state was checked only by pattern
  matching the HTML.
