# 134 — The admin content screens, and a probe that could not see its own subject

**Date:** 2026-10-28
**Status:** implemented, not deployed (owner deploys — `docs/96`)
**Sub-journey:** admin journey, part 6 of 10 (CONTENT: news feed, blog, blog topics)

---

## 1. What this closes

`docs/133` §5 reported, and deliberately did not fix:

> `/admin/news-feed` and `/admin/blog` carry the same class of defect in the
> other direction — controls on pages that legitimately serve an editor whose
> routes require `admin`. Reported, not fixed: that is its own change.

This is that change. It is the **third** instance of one rule (`docs/119` on
the organiser side, `docs/133` on campaigns, this), which is why the check
written for it is a **sweep rather than a third set of assertions** —
`docs/110` §9.2.

⚠️ **And `docs/133` named the wrong controls.** It said "three controls —
`Create campaign` and `Review` on the news feed, `Delete` on the blog list".
That was wrong in both directions: `Review` lives in `PipelineMonitor`, which
renders only on `/admin/monitoring`, and that page **is** gated
(`monitoring/page.tsx:27-29`), so it was never a defect; while the **blog
topic** Delete, which `docs/133` never mentioned, is one. The count was taken
from the two components that happened to be open rather than from the callers
enumerated out of the tree.

---

## 2. The defect

[VERIFIED] `src/app/admin/layout.tsx:30` admits `editor`; the sidebar's
`Content` group carries no `adminOnly`; and `news-feed/page.tsx`,
`blog/page.tsx` and `blog/topics/page.tsx` contained **zero** `auth()` or
`requireRole` calls. [VERIFIED] none of `NewsFeedMonitor`, `BlogPostsList`,
`TopicQueueList` or `BlogEditor` contained the string `isAdmin`, `role` or
`session`.

| Control | Rendered at | Calls | Route role |
|---|---|---|---|
| **Create** (campaign from a news item) | `NewsFeedMonitor.tsx:487`, inside `{!isCampaign && …}` | `:188` | `create-campaign/route.ts:40` `['admin']` |
| **Delete** (blog post) | `BlogPostsList.tsx:388`, **unconditional on every row** | `:165` | `blog/[id]/route.ts:178` `['admin']` |
| **Delete** (blog topic) | `TopicQueueList.tsx:543`, inside `{actions.includes('delete') && …}` | `:257` | `blog/topics/[id]/route.ts:125` `['admin']` |

Each component has exactly one render site.

### 2.1 These pages SHOULD serve an editor — that is the whole point

This is not "editors do not belong here". [VERIFIED] the editor-admitting
admin API is almost entirely content: `blog` GET+POST (`:18,105`), `blog/[id]`
GET+PATCH (`:21,65`), `blog/topics` GET+POST (`:17,72`), `topics/[id]` PATCH
(`:22`), `news-feed` GET (`:14`), plus the two campaign routes `docs/133`
found. So an editor may write a post, publish it, add a topic, boost it,
generate from it, reject it and restore it. Three controls out of that set
call routes that refuse them.

### 2.2 Unlike `docs/133`, there is no disclosure half

[VERIFIED by reading all three `select()` blocks] the pages send news-item
metadata, blog-post metadata and topic-queue rows — no personal data — and the
editor already holds GET on all three APIs. `docs/133` had to narrow donor
names and emails out of the payload; **nothing here needs narrowing**, and
saying so is part of the finding: the two cases look identical and are not.

---

## 3. Verified three ways, and the third could have returned worse

**Method 1 — static.** Route roles, page gates and component props, each read
at file:line (§2).

**Method 2 — a real browser, paired.** Signed in as an editor, then as an
admin, against a production build. The editor sees all three controls; so does
the admin, which is what makes the measurement discriminate.

**Method 3 — pressing them.** This one could have produced a far more serious
answer, and that is why it was run:

| | editor | admin (control) |
|---|---|---|
| Delete blog post | **403**, toast *"Insufficient permissions"* | **200**, *"Post deleted"* |
| posts in DB afterwards | **1 (survived)** | 0 |
| Delete blog topic | **403** | **200**, *"Topic deleted"* |
| topics in DB afterwards | **3 (survived)** | 2 |

8/8. So the severity is **dead controls, not privilege escalation** — the
escalation answer was reachable by this probe and did not occur. The admin
column is not decoration: without it a 403 is indistinguishable from a button
that is simply broken.

⚠️ **One harness artifact, so the numbers are not over-read.** The
`page.on('response')` listener from the first press stays registered, so the
first press's status array accumulates the second press's entry — which is why
the blog delete reads `[403, 403]` and the topic `[403]`. It is one request
each. The conclusion is unaffected (every editor status is 403, every admin
status 200), but "two 403s on the blog delete" would be a false reading of my
own output.

### 3.1 ⚠️ The first browser probe was VOID, three times over

It reported `10/13` with the three *editor* checks passing. That looked like
"no defect". It was three independent blindnesses, and only the **paired admin
control** revealed them — each one would have produced a confident wrong
answer on its own:

1. **Wrong pattern.** It searched for `create campaign`; the button says
   **`Create`**.
2. **Blind to icon buttons.** It read `innerText`, and both Delete controls
   are `<Button>`s whose only child is a `<TrashIcon>`, with the name in
   `aria-label` — so `innerText` is empty and `.filter(Boolean)` discarded
   them. The admin UI uses icon-only buttons **specifically for destructive
   actions**, which is the worst possible blind spot for a probe about
   destructive controls.
3. **Assumed menus.** My first reading of the failure blamed closed dropdowns
   (`docs/130`'s trap). That was wrong too — these are plain inline buttons.

The tell was that the three **controls** failed while the three subject checks
passed: the admin "did not have" the controls either. A probe whose control
fails has not measured anything. The fix was to read the **accessible name**
(`aria-label || innerText`), after which the same run returns the same 10/13
with the *other* three failing — the identical score meaning the opposite
thing.

---

## 4. The fix

Required `isAdmin` on all three components (so `tsc` names every render site —
`docs/118`), with the role placed **inside** each control's existing
condition rather than beside it:

```
{isAdmin && !isCampaign && ( … Create … )}
{isAdmin && actions.includes('delete') && ( … Delete topic … )}
{isAdmin && ( … Delete post … )}
```

"Will the route behind this button accept this viewer, for this row?" is one
question; splitting the state half from the role half is how a screen comes to
render a control its route refuses. Each page reads the session once and
passes it down. Nothing else on these screens changes — every editor-permitted
control stays exactly as it was.

### 4.1 The same walk, after the fix

Re-run against a rebuilt production build, same fixture, same pairing:
**13/13**, and critically **all three controls still pass** — the admin still
has `Create`, the blog `Delete` and the topic `Delete`. Without that the score
would be meaningless, because deleting the controls outright would also make
the editor checks pass (which is exactly what the void first run looked like).

| | editor | admin (control) |
|---|---|---|
| news feed `Create` | absent | **present** |
| blog `Delete` | absent | **present** |
| topic `Delete` | absent | **present** |
| `/admin/blog/new`, `/admin/blog/[id]/edit` | **served** | served |
| console errors / 4xx-5xx | none | none |

### 4.2 Suites

- `npm run lint` — clean (one pre-existing unused-arg warning, untouched)
- `npm run typecheck` — clean
- `npm run test:unit` — **7743 passed / 16 skipped / 0 failed**, 265 files
- `npm run test:integration` — **301 passed**, 31 files

---

## 5. The check is a SWEEP, and it found its own shape by being wrong twice

`src/components/admin/admin-control-role.ratchet.test.ts` discovers its inputs
rather than naming them: for every component under `src/components/admin/`, it
extracts each `fetch` to an admin API route **with its HTTP method**, resolves
that to the route file on disk (literal segments match directories, `${…}`
matches any `[dynamic]` one), reads that handler's own `requireRole` list, and
flags a component that calls an admin-only route.

⚠️ **Version 1 was too broad, and the RULE was wrong, not the code.** It
flagged twelve components — `UsersList`, `SystemSettings`,
`VerificationQueue` and more — all of which sit on pages gated to `admin`,
where only an admin can be present to press anything. The predicate has to
know the page's gate. (`docs/119`'s lesson, from the other direction.)

⚠️ **Version 2 was still wrong, by one case: `CampaignVouches`.** It calls two
admin-only routes and renders on `/admin/campaigns/[id]`, which deliberately
serves an editor — yet it needs no role prop, because `docs/133` chose the
**other** valid protection and does not render it for a non-admin at all.
**Not rendering beats passing a flag down**, so the rule accepts either.

The final predicate: *a component is flagged only if it calls an admin-only
route AND has at least one render site that neither gates out editors nor
wraps it in an `isAdmin &&` guard.* Both ends derived from source.

### 5.1 Ten injections

| # | Injection | Result |
|---|---|---|
| 1 | `isAdmin` removed from `BlogPostsList` props | FIRED |
| 2 | `isAdmin` made optional on `TopicQueueList` | FIRED |
| 3 | the blog Delete guard removed | FIRED |
| 4 | **CONTROL** `New Post` gated on `isAdmin` | FIRED |
| 5 | **CONTROL** `Add Topic` gated on `isAdmin` | FIRED |
| 6 | the page stops passing `isAdmin` down | FIRED |
| 7 | the news-feed page stops reading the session | FIRED |
| 8 | `CampaignVouches` loses its guarded render site | FIRED |
| 9 | **ANTI-VACUITY** blog DELETE widened to admit an editor | FIRED |
| 10 | **ANTI-VACUITY** `/admin/blog` gated, so its component drops out | FIRED |

Rows 9 and 10 are the ones that matter most: they prove the two derived halves
(the route's role list, the page's gate) are actually load-bearing rather than
decoration around a hard-coded list.

⚠️ Rows 4 and 5 first came back as **anchor misses, not silent passes** — my
injection string occurred twice in each file (once in a comment, once in a
second control). An anchor miss tests nothing, so they were re-run with unique
anchors and both fire. Reporting them as "8 of 10 fired" would have been a
false pass.

---

## 6. Reported, not fixed

- ⛔ **`DELETE /api/v1/admin/blog/topics/[id]` and `DELETE /api/v1/admin/blog/[id]`
  are admin-only while PATCH and POST admit an editor.** So an editor can
  create a post and a topic but cannot remove either. That may well be
  deliberate, and it is now a visible rule rather than an accident — but
  nobody has decided it in writing. Same open question `docs/133` §5 raised
  for campaign updates.
- ⛔ **`.../news-feed/[id]/review` (`['admin']`) is reachable only from
  `/admin/monitoring`**, an `adminOnly` screen. Nothing is broken; it is worth
  knowing that the news feed's own screen has no review control at all, so an
  editor browsing it cannot flag anything.
- [INFERRED, not verified] a crude grep suggests `GET /api/v1/admin/blog` and
  `GET /api/v1/admin/news-feed` have no client caller (the pages read the
  database directly). The grep conflates methods and I did not confirm it, so
  it is recorded as a lead, not a finding.

---

## 7. What was NOT checked

- The content pipeline itself — `docs/123` covers it (the silent
  `blog-generate` cron, step 9 publishing behind the operator).
- Whether an editor can complete the **whole** blog flow end to end (write →
  publish → read on `/blog`). The walk confirms the screens serve them and the
  controls are correctly gated; it does not author a post as an editor.
- The news-feed **Create** path as an admin: pressing it would generate a
  campaign about a fixture news item. Not exercised; `docs/116` §4 covers that
  insert's review gate.
- Production. This cannot be verified live: zero editors exist
  ([VERIFIED 2026-10-28: 8 donors, 1 admin, 0 editors]) and creating one is a
  write to the live database that was not authorised. The evidence is the
  local paired run against a production build.
