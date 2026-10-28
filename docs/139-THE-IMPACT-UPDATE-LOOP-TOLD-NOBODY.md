# 139 — The impact-update loop told nobody, at either end

**Date:** 2026-10-28
**Status:** fixed, verified in a browser, not deployed at time of writing
**Journey:** notifications

---

## 1. UNDERSTANDING — the surface

An **impact update** is an organiser's report on how a family's money was
spent: a title, a body, photos and receipts. It is the strongest trust
artefact this platform has, and `docs/113` recommended exactly this over
paying institutions directly — *"most of the donor trust, no licence, no
destination that can be wrong."*

Three routes exist and all three are correct:

| route | gate |
|---|---|
| `POST /api/v1/user-campaigns/[id]/impact-update` | creator only |
| `GET /api/v1/admin/impact-updates` | `requireRole(['admin'])` |
| `PATCH /api/v1/admin/impact-updates/[id]/review` | `requireRole(['admin'])` |

The organiser's door exists too — `docs/119` §5 gated the dashboard tile.

---

## 2. EVIDENCE

### 2.1 Twelve of forty notification functions have no caller

Derived by scanning every `.ts`/`.tsx` under `src/` (excluding the module
itself and tests) for a call to each of the 40 `notify*` exports:

```
total 40 | reachable from app code 28 | ONLY from tests 0 | ZERO callers 12
```

Three of the twelve are deliberate and documented — `notifyVerificationReminder`
(`docs/110` §7 says ⛔ do not wire it, its copy promises money back on a clock
that nothing delivers) and the two adaptive ones (`docs/115`, `docs/122`).

⚠️ The other nine are dead with **no recorded reason**. Most of them appear in
`docs/118` — but only because that doc added a required `campaignStatus`
parameter to every helper, which is not a statement that the function is
deliberately dead. That inference was available and is not made here.

Three of the nine are the impact-update trio.

### 2.2 Neither end of the loop notifies — [VERIFIED]

Neither route imports `@/lib/notifications` at all. `grep` for `notify` in
`admin/impact-updates/[id]/review/route.ts` returns **nothing**; the submit
route's matches are all `status:` lines.

So:

```
organiser submits  ->  status 'submitted'  ->  no admin is told
admin decides      ->  audit row written   ->  the organiser is never told
```

### 2.3 And there was no admin screen — [VERIFIED four ways]

1. `grep -rn "api/v1/admin/impact-updates" src/` excluding the route itself:
   **zero callers**. Nothing fetches the queue.
2. `grep -rln "impactUpdate|impact-update|milestone" src/components/ src/app/admin/`:
   the only hit is `src/components/campaign/ImpactUpdate.tsx`, which is the
   **public donor-facing** renderer, not an admin surface.
3. The route tree has no `src/app/admin/impact-updates/` directory.
4. **Executed**, not read: the codebase's own route oracle from `docs/128`.

```
NOT NAVIGABLE  /admin/impact-updates
NAVIGABLE      /admin/campaigns          <- positive control
NAVIGABLE      /admin/settings           <- positive control
NOT NAVIGABLE  /admin/fabricated-not-real <- negative control
```

`notifyAdminImpactUpdateSubmitted` linked at `/admin/impact-updates`, so even
if it had been wired, it pointed at nothing.

### 2.4 Production — [VERIFIED]

`impact_updates` holds **0 rows**, and `audit_logs` holds **0** `impact_update%`
rows. Nobody has submitted one. **This is latent, not a repair.**

---

## 3. ROOT CAUSE — [VERIFIED]

The feature shipped **route-first**: the API half complete and correct, the
admin door and both notification ends never built.

Same shape as `docs/88` F1 — *"`/admin/verification` now renders the queue that
can actually approve — the API was always correct, only the door was missing"*
— which is the precedent for treating this as a defect to fix rather than a
feature to propose.

**Falsification attempts, all three run:**

- *"There is an admin surface under another name — milestones, or inside the
  campaign detail page."* **Refuted** by 2.3 methods 1, 2 and 4.
- *"`/dashboard/campaigns/<slug>/impact-update` in the rejection email is a
  404, so the whole thing is worse than stated."* **Refuted** — that page
  accepts either a UUID or a slug (`impact-update/page.tsx:26-28`), so the link
  resolved. It is still hand-written where `docs/118` requires a builder, but
  it was not broken and is not reported as such.
- *"Inline email bodies are a systemic problem across the notification
  module."* **Refuted, and this narrowed the fix**: of the 40 functions,
  **37 go through a template, 1 sends no email, and exactly 2 write inline raw
  HTML** — and those 2 are these dead impact functions. Not a class; a
  consequence of never being wired.

---

## 4. BLAST RADIUS

One new admin page and one new client component; two existing routes gain
notification calls; three notification functions rewritten; two new email
templates; one nav entry; one route registered with `docs/128`'s oracle; one
line added to the E2E fixture's cleanup. No schema change, no migration, no
money path. Rollback is `git revert`.

The **behaviour change a user could notice**: an admin now receives mail when
an impact update is submitted, and an organiser now receives mail when one is
decided. Both are new sends; neither existed before. Both respect the
`emailNotifications` preference, which `createAndEmail` already gates on
(`notifications.ts:97-103`).

---

## 5. The defects the three dead functions carried

Wiring them unchanged would have shipped all of this. Each was fixed on the way
in:

| what | why it matters |
|---|---|
| `link: '/admin/impact-updates'` | pointed at no page (2.3) — now it exists, and a rule executes the oracle |
| `reviewerNotes` interpolated **raw** into email HTML | an **admin's own typed words** into markup — the exact hazard `docs/93` escapes on the campaign refusal reason |
| `creatorName` interpolated raw | same |
| inline `html:` literals | `createAndEmail` hands a caller's `html` straight to `resend.emails.send` (`:133`, `:153-157`), so these were outside `renderEmail` and therefore outside **both** email sweeps (`docs/123` §4) |
| hardcoded `https://lastdonor.org/...` | `appBaseUrl()` exists (`docs/57`) |
| `/dashboard/campaigns/${slug}/impact-update` | hand-written; now `organiserCampaignPath`, keyed on the id (`docs/118`) |
| `'campaign_milestone' as NotificationType` | an unnecessary cast — the value is in both the union and the enum. A needless cast is where a real mismatch hides |

⚠️ **One sub-plan was refuted and abandoned.** The enum carries
`milestone_approved` and `milestone_rejected`, which read as though they were
made for this. `NotificationsClient.tsx:79-80` marks both *"Legacy: renders
historical notifications"* — so using them would resurrect retired values. The
type stays `campaign_milestone`; only the cast went.

The new copy is grade **2.0** and **1.8**, longest sentences 12 and 10 words,
0 jargon — both email ratchets green. The colours are the same values the
refusal email already uses, so no new colour needs a dark-mode rule
(`docs/94` §9).

---

## 6. Two more defects found by EXECUTING the thing

### 6.1 ⛔ `impact_update.rejectd`

The review route wrote `` eventType: `impact_update.${action}d` ``. For
`action: 'reject'` that is **`impact_update.rejectd`**. Found by pressing the
button and reading the row it wrote — lint, typecheck, nine ratchets and 7,760
unit tests had all passed over the line.

[VERIFIED three ways: the executed audit row; the source at `:160`; production,
which holds 0 such rows, so it is latent.]

⚠️ **This is the site `docs/137` §5 said was unknown.** That doc's event-type
sweep recorded, as the one thing it could not cover: *"an event type assembled
from a variable (`eventType: someVar`) yields nothing. No such site is known,
and none was searched for."* Here is one — and constructing it is precisely
what hid the typo from every reader. Both spellings are now literals, as the
sibling submit route already wrote them. ⚠️ My own new log line had inherited
the same typo from the template beside it.

`impact_update.` is also now in `docs/137`'s category map, so these rows reach
the `campaigns` chip instead of falling to `other`.

### 6.2 ⛔ A refusal with no reason

`notes` was optional for **both** actions, while the organiser is emailed the
admin's words — so a reject with no notes renders *"What they said:"* followed
by nothing (`docs/107` §8.2's shape) and tells them nothing about what to
change. This is `docs/93`'s decision applied one table over: the campaign
suspend route already demands at least three characters for the same reason.
Enforced at **both** ends (`docs/109`): the route answers 400, and the button
is disabled until there is something to send. There were no other callers, so
tightening it broke nothing.

---

## 7. ⚠️ A shared constant must not live in a `'use client'` module

The tiles first read `STATUS_LABEL` imported from `ImpactUpdateQueue.tsx`,
which is `'use client'`. It **typechecked, built, and rendered blank**: a
server component importing a plain value out of a client module receives a
client-reference proxy, not the object, so `STATUS_LABEL.submitted` was
`undefined`.

Nothing in the toolchain says so — `tsc` sees a valid `Record<string, string>`,
the build succeeds, and no console error appears. The tile simply had no label.

⚠️ **It was found by looking at a screenshot**, and only just: the probe's own
regex had printed `NONE` for that tile, I had correctly diagnosed that as a
probe artifact once (the `capitalize` class was title-casing the label), and
the second `NONE` was real. Two identical-looking signals, opposite causes.
`docs/119` §9.1 and `docs/121` both record finding a defect by looking rather
than by any assertion; this is the third.

The controlled comparison that settled it: **the same constant** rendered
correctly inside the client component (the row badge read "Published") and
blank in the server page, in the same response. The labels now live in
`src/lib/impact-update-labels.ts`, which neither side owns.

---

## 8. ⚠️ The E2E fixture's cleanup had the same omission twice

Seeding an impact update made `npm run e2e:seed` fail:

```
violates foreign key constraint "impact_updates_campaign_id_campaigns_id_fk"
```

The fixture deletes what it inserted, by campaign id, and its list named every
child table of a fixture campaign **except** `impact_updates`. The comment
directly above that list already records the previous instance: `docs/121`'s
hand-inserted verification document broke the same seed, *"and the failure was
invisible because `e2e:build` is `seed && build` and still exited 0."*
`docs/123` found the third instance in `clearDatabase` (`blog_posts` truncated,
`blog_topic_queue` not).

A hand-written list of child tables is only as good as whoever remembered to
extend it. One line added; `[e2e-seed] fixture rows removed` now appears at the
end of a suite run.

---

## 9. Checks — 9 rules, 10 injections, every one fires

`src/lib/notifications.impact-update-loop.test.ts`.

| Injection | Fires |
|---|---|
| the submit route stops telling an admin | rules 1 + 2 |
| **only the RESUBMISSION call removed** | rule 2 alone |
| the review route stops telling the organiser | rules 1 + 2 |
| **the admin notification points at a page that does not exist** (the original defect) | rule 3 |
| the route stops refusing a reasonless reject | rule 4 |
| the UI stops disabling the change button | rule 4 |
| an inline raw html body restored | rule 5 |
| the reason is no longer escaped | rule 6 |
| **CONTROL** the admin page loses its role gate | rule 8 |
| **CONTROL** the scan can no longer see the functions | rules 0 + 3 |

Rule 3 **executes** `isNavigablePath` rather than reading text, and carries its
own control (`/admin/not-a-real-page` must be false). Rule 6 **renders both
templates** with `<script>alert(1)</script>` and requires the escaped form to
be present, not merely the raw form absent — otherwise dropping the field
entirely would pass. Rule 7 forbids a constructed event type (§6.1). Rules 0
and 8 are the anti-vacuity controls: without 8, deleting the queue screen
leaves 1–4 satisfiable while no admin can reach the decision at all.

⚠️ Each injection verified it had actually **changed the file** (md5 before and
after) and printed `⚠️ ANCHOR MISS` otherwise, because an anchor that does not
match reads exactly like a rule that does not bite. `git status` was checked
after the run — `docs/120` §11.1.

---

## 10. RESULT — verified in a real browser

Production build, admin signed in, `REPORTING_TIMEZONE=Africa/Nairobi` chosen
deliberately because it is the configuration that would expose a client-side
zone read.

| check | result |
|---|---|
| unauthenticated `/admin/impact-updates` | **307** |
| **CONTROL** organiser signs in (verified) then opens it | ends on `/login` — refused |
| admin opens it | **200**, `/admin/impact-updates` |
| queue renders the submitted row | ✅ |
| tile | **"Waiting for a review = 1"** |
| zone named, and stamp rendered | **"Times are Africa/Nairobi."**, `Sent 28 Oct 2026, 16:39` |
| "Ask for a change" with no reason typed | **disabled** |
| …after typing a reason | **enabled** |
| PATCH → reject | **200**, status `rejected`, notes stored |
| PATCH → approve | **200**, status `approved` |
| in-app notification row written | `campaign_milestone | Your update on "…" needs a change | link /dashboard/campaigns/<uuid>/impact-update` — the **UUID**, built by `organiserCampaignPath` |
| the email call site is REACHED | `[notifications] Failed to notify … (campaign_milestone): Missing API key` — the `docs/129` method: the send fails only for want of a local Resend key |
| console errors | **none** — so no hydration mismatch from the timestamp |
| 390px horizontal overflow | **0px**, measured with `scrollWidth - clientWidth` at `isMobile: false` (`docs/128` §5) |

### 10.1 Suites

| Suite | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 1 warning, pre-existing, in a file not touched here |
| `npm run test:unit` | **7772 passed / 16 skipped**, 268 files |
| `npm run test:integration` | **301 passed**, 31 files |
| `npm run test:e2e` | **164 passed / 24 skipped / 0 failed**, both Chromium projects |

The unit delta is +12 on `docs/138`'s 7760: 9 from the new file, and **3 from
`currency-and-dates.ratchet.test.ts`**, which derives a case per admin
component and picked up the new one — an existing ratchet covering new code,
confirmed by measuring it at HEAD (116) and after (119).

---

## 11. ⚠️ Four probe failures, each of which read as a result

Recorded because three of the four produced a *plausible* answer:

1. **`pkill -f "next start"` matched this shell's own command line** and killed
   it mid-command — which silently aborted a heredoc rewriting the env file. I
   then misdiagnosed the resulting secret-validation failure twice, including
   once as a stale process. Kill by port (`fuser -k`), not by a pattern your
   own command contains.
2. **The sign-in probe swallowed its own failure.** `waitForURL(...).catch(() => {})`
   turned a failed login into a silent continue, so every later measurement read
   the login page — and the organiser landing on `/login` looked exactly like a
   **working admin gate**. The paired admin measurement is what exposed it: the
   admin landed there too. `docs/135`'s class, in my own probe.
3. **The real cause of that failure** was a pepper mismatch: I seeded with one
   `PASSWORD_PEPPER` and restarted the server with another, so stored hashes no
   longer verified. `docs/99` §6 already warns that variable is load-bearing.
4. **Repeated probe runs exhausted the `auth` rate limiter** (`slidingWindow(10, '60 s')`
   per IP, `docs/44`): the credentials POST 429s, the page never navigates, and
   `waitForURL` times out — indistinguishable from a broken login. Two sign-ins
   in a fresh window both succeed; the walk now waits 65s between them.

And twice a regex over `innerText` reported a missing element that was present
(§7) — the `docs/134` lesson that a probe which cannot see its subject reports
the same thing as a subject that is absent.

---

## 12. Reported, NOT fixed

- **Nine notification functions are dead with no recorded reason**:
  `notifyAbandonedDonation`, `notifyCreatorMotivation`,
  `notifyVerificationEscalation`, `notifyDonorReengagement`,
  `notifyPostDonationImpact`, `notifyCreatorThankYouUpdate`, plus the three
  documented ones. Several have matching enum values
  (`abandoned_donation`, `creator_inactivity`, `donor_reengagement`), so they
  were designed to be used. Whether each should be wired or deleted is a
  product call per function, not a sweep — and `docs/110` §7 is the warning
  that wiring dormant copy is how bad promises reach real inboxes.
- **27 of 35 admin routes that write an `auditLogs` row set no `actorIp`**
  (`docs/138` §7). Unchanged.

---

## 13. What was NOT checked

- **The organiser's side of the loop in a browser.** The submit route's two
  notify calls are covered by a rule and by typecheck, but nothing drove the
  wizard to submit an impact update and then read the admin's inbox. The
  admin's side was driven end to end.
- **The approval's effect on the public campaign page.** Approving sets
  `status: 'approved'`; whether `src/components/campaign/ImpactUpdate.tsx` then
  renders it to donors was not verified — the fixture campaign's public page
  was not re-read after approval.
- **The email bodies as rendered pixels.** Both pass the plain-language and
  dark-mode ratchets and were executed for escaping, but neither was opened in
  a mail client (`scripts/email-screenshot.ts` exists for this).
- **Production.** Nothing here can be observed on the live site: the screen is
  admin-only behind a default-deny middleware, so an external probe answers 307
  for real and fabricated admin paths alike (`docs/108`). Verification is the
  local production build above.
