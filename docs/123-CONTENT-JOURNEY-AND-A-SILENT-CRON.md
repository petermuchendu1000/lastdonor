# 123 — The content journey, and a cron that did nothing for nine days

**Date:** 2026-10-27
**Journey:** 6 of the end-to-end walk (after `docs/119` organiser doors,
`docs/120` review, `docs/121` money out, `docs/122` donor after giving)
**Status:** three defects fixed, two owner decisions open
**Read before touching** `src/lib/blog/`, `src/app/api/v1/cron/blog-*`,
`src/app/api/v1/newsletter/subscribe/route.ts`, or adding any mail sender.

---

## 1. The journey, with production row counts

The content journey is: ingest news → discover topics → generate articles →
publish → put them in front of a reader → email the list. Walked step by
step, every figure read from the production database on 2026-10-27.

| Step | Mechanism | Production state | Verdict |
|---|---|---|---|
| 1. Ingest news | `cron/ingest-news`, `cron/fetch-news` | `news_items` **5,718 rows** | works |
| 2. Discover topics | `cron/blog-topics`, daily 06:00 | `blog_topic_queue` **28 rows, all `pending`**, priority 70–100, newest **today 06:00** | works |
| 3. Generate articles | `cron/blog-generate`, daily 08:00 | `blog_posts` **0 rows, ever** | ⛔ §2 |
| 4. Publish | `autoPublish` in step 8 of the pipeline | never reached | ⛔ §3 (latent) |
| 5. Reader surfaces | `/blog`, `/blog/[slug]`, `feed.xml`, two sitemaps | 200, empty state, 0 items, 0 URLs | §6 |
| 6. Refresh | `cron/blog-refresh`, weekly Sunday 10:00 | 3 `blog_refresh_check` rows; nothing to refresh | works |
| 7. Email the list | `cron/send-newsletter`, weekly Thursday 14:00 | **4 active subscribers, 0 emails ever sent** | ⛔ §5 (owner) |

So the front of the pipeline runs daily and the back of it has never
produced a single artefact. Steps 1, 2 and 6 all leave audit rows. Step 3
left none at all, which is the subject of §2.

---

## 2. ⛔ `blog-generate` returned `200 { skipped: true }` and wrote nothing

### What happened

`src/app/api/v1/cron/blog-generate/route.ts:40` reads
`BLOG_PIPELINE_ENABLED !== 'true'`, logs a `console.warn`, and returns
`200 { ok: true, skipped: true }`.

The cron Worker **logs the HTTP status of each call and deliberately never
reads the response body** (`docs/66`, because of the 10 ms CPU ceiling on
Cloudflare's free plan). So from the only log an operator has, a skip is
indistinguishable from a run that did the work. The one place a skip could
be seen is `audit_logs`, and nothing was written there.

[VERIFIED against production, three ways]

1. **Row counts.** `blog_posts` has 0 rows. `blog_topic_queue` has 28, all
   `pending`, created between 2026-10-18 02:49 and 2026-10-27 06:00.
2. **Audit history.** `blog_topics_discovered` × 11 (2026-10-18 → today),
   `blog_refresh_check` × 3, `cron.send_newsletter` × 2 — and
   `blog_pipeline_completed` **has never been written once**. So the job's
   sibling crons are firing and recording, and this one recorded nothing on
   any of its ~10 scheduled runs.
3. **Reader surfaces.** `GET /blog` → `200` with *"No posts published yet.
   Check back soon."*; `/blog/sitemap.xml` → `200`, **0** `<url>` entries;
   `/blog/feed.xml` → `200`, **0** `<item>` entries. The control for that
   sweep is `GET /blog/no-such-post-xyz` → **404** (so `docs/80` still
   holds and these 200s are real pages, not soft-404s).

### ⚠️ Why the cause is [INFERRED] and not [VERIFIED]

The flag is the obvious cause and I could not prove it from here. **All
three ways this route could do nothing wrote nothing:**

| Path | What it returned | Row written |
|---|---|---|
| `BLOG_PIPELINE_ENABLED` not `'true'` | `200 { skipped: true }` | none |
| Lock held (`lockSkipPayload`) | `200 { skipped: … }` | none |
| Pipeline threw | `500` + `console.error` | none |

They were therefore indistinguishable in the database, and the diagnosis had
to be made by **elimination**, not read off a row:

- The lock is ruled out on two grounds: `/api/v1/health` reports
  `redis: ok` (so the backend is up, and `blog-topics` shares the same
  `'skip'` policy and runs daily), and nothing else contends for this job's
  lock once a day.
- A throwing pipeline would have answered **500**, which the Worker *does*
  log — but that log is a Cloudflare tail nobody is watching, so this leg
  rests on nobody having reported one.
- `.env.example:101` ships `BLOG_PIPELINE_ENABLED=false`, and the flag
  appears in **no** deploy artefact: not `fly.toml`, not the `Dockerfile`,
  not `scripts/deploy.sh`, not `scripts/deploy.ps1`, and
  `scripts/validate-secrets.ts` does not require it. So the documented
  default is off and nothing in the repository turns it on. A Fly secret set
  by hand would not appear in the repository, which is the gap.

There is no first-party read of the value from this session: `/api/v1/health`
reports dependencies, not flags, and this session has no `flyctl`.

### The fix

Two of the three silent paths now leave a row before they return:

- the disabled path writes `blog_pipeline_skipped`, `severity: 'warning'`,
  with the reason;
- the catch writes `blog_pipeline_failed`, `severity: 'error'`, with the
  message.

The lock skip is deliberately left alone: it goes through the shared
`lockSkipPayload`, carries no `skipped: true` literal, and is transient
contention rather than a configuration decision somebody needs to see.

⚠️ The old reason string told the operator to set the variable **"in Vercel
env vars"**. This platform runs on Fly (`docs/26`, `docs/65`) and there is no
Vercel console to open. It now names Fly, and a test forbids the word.

### The rule

`src/app/api/v1/cron/scheduled-skips-are-recorded.test.ts` (7 tests, each
proven by injection). It derives the job list from **`CRON_JOBS`**, not a
typed list, which is what makes it apply to a job added tomorrow — and what
correctly exempts `simulate-donations`, which has three `skipped: true`
paths and is deliberately **not** scheduled (`docs/66`), so no log is being
misread.

⚠️ **The block finder has to walk out of object literals**, and the first
version of it did not. A `skipped: true` is always a property, so the
nearest enclosing brace pair is never the branch — the naive version flagged
`blog-generate` and `send-newsletter` while both were correct. It now treats
an opener preceded by `(`, `,`, `=`, `:`, `[` or the word `return` as an
object literal and keeps going; `)`, `;`, `{`, `}`, `=>`, `else`, `try`,
`finally`, `do` stop it. ⛔ And it stops at the **first** statement block,
because walking further reaches the handler body — where both routes audit on
their success path, so the rule would pass against anything. A fixture test
proves both bounds rather than trusting the routes.

⚠️ The `send-newsletter` control was itself a check that could not fail: it
asserted `auditLogs` appeared **anywhere in the file**, and injection 3
removed that route's refusal row and the control stayed green, because the
success path writes one too. It is now scoped to the refusal branch.

---

## 3. ⛔ The pipeline published AI drafts behind the operator

Found while establishing (Gate 3) whether enabling the flag would actually
produce anything, rather than assuming it.

`runBlogPipeline` reads `autoPublish` in **step 8**, where a new post is
inserted `published: autoPublish && seoScore >= 70`
(`blog-pipeline.ts:412,433`). So with `BLOG_AUTO_PUBLISH` unset a
machine-written article lands as a draft for an admin to read first. That is
the review gate, the same shape as `docs/78`/`docs/79` for campaigns.

**Step 9, in the same run, ignored the flag entirely.** It selected

```
published = false AND source = 'ai_generated' AND seo_score >= 70
```

took the five best, and published each one `canPublishNow()` allowed — and
`canPublishNow` is purely a cadence gate (weekly cap 7, per-category cap 3,
one-day minimum gap, `publishing-guardrails.ts:55,62,91`). **`autoPublish`
appears nowhere in it.**

Its comment says these are drafts "deferred by cadence limits", and that
story is coherent — but the predicate cannot tell a cadence-deferred draft
from one that is unpublished **because the operator said not to
auto-publish**, from one an admin has not read yet, or from one an admin
unpublished on purpose.

⛔ **`.env.example:103` ships `BLOG_AUTO_PUBLISH=false`, so the documented
configuration is the vulnerable one.** An owner who sets
`BLOG_PIPELINE_ENABLED=true` and leaves the second flag alone — reasonably
believing it governs publication — gets machine-written articles about
giving on the public blog with nobody having read them. With 0 published
posts every cadence check passes trivially, so the first run publishes up to
five. This is the `docs/116` §4 shape (a further path that publishes without
review) in the content pipeline rather than the campaign one, and it was
latent only because §2 kept the route from running at all.

### The fix

Step 9 returns early when `autoPublish` is false. Nothing legitimate is
lost: a cadence-deferred draft only exists because a run with the flag ON
created it, so there is nothing to promote while it is off.

This is treated as a defect rather than a policy question because step 8 of
the same function already establishes what the flag means; step 9
contradicted it.

### The proof

`src/lib/blog/draft-promotion.integration.test.ts` — 5 tests **executed
against a real Postgres**, because this one is about which rows an `UPDATE`
touches. It asserts both directions: off → the draft stays a draft; on → it
is still promoted (otherwise deleting step 9 would satisfy the rule and the
cadence deferral would be silently gone). Removing the guard fails **exactly
one** test and leaves the control green.

⚠️ **No model is called and nothing is stubbed.** Step 7 returns early on an
empty queue, so step 9 is unreachable without a pending topic — but the
generation loop does `if (topic.priorityScore < minPriorityScore) continue`,
so one topic **below** the floor executes step 9 with no network at all. The
first test is the control for that: it asserts the run reports *"below
minimum"* and **not** *"No pending topics in queue"*, which are mutually
exclusive and so pin which path ran.

Two further tests keep the rule narrow rather than absent: a `source:
'manual'` draft at score 95 is never swept (a post written by hand in
`/admin/blog`), and 69 vs 70 is the SEO boundary with a row on each side.

---

## 4. ⛔ The newsletter welcome escaped both email sweeps

`POST /api/v1/newsletter/subscribe` sent its welcome as a hand-written
`text:` string inline in the route handler.

`EMAIL_SOURCE_FILES` in `src/lib/email-readability.ts` is a **hand-written
list of two files**, and it is the input to *both* email sweeps: the
plain-language budget (`docs/94`) and the dark-mode contrast ratchet
(`docs/94` §9). A template written inline in a route is measured by nothing.

**This is the third time.** `docs/74` found two — the password reset and the
donor receipt, both inline in route handlers. The copy that escaped this
time told four real subscribers:

> You'll receive updates about campaigns making a real difference in
> people's lives. … Every dollar has a name behind it.

[VERIFIED] zero blog posts exist and `cron.send_newsletter` has written two
rows, both `sent: 0` (§5). So that promise has been kept for nobody.

### The fix

`newsletterWelcomeEmail` in `src/lib/email-templates.ts`, rendered through
the one shell. Being in that file is what puts it inside both sweeps —
confirmed by executing `measureAll()`, which now returns **50** templates
including this one at grade **2.5**, longest sentence 11 words, no jargon.

⚠️ **Why it is transactional and not `commercial: true`.** The shell omits
the CAN-SPAM postal block when `MAILING_POSTAL_ADDRESS` is unset and leaves
refusing to the caller (`email-shell.ts:196-199`) — and that variable **is**
unset (§5). So marking it commercial would send it without the address
anyway. Refusing to send it instead is worse than either: this message
carries the only unsubscribe link and `List-Unsubscribe` header the
subscriber will ever be given, so withholding it leaves somebody on a list
with no way off. The copy is therefore reduced to what it actually is — a
confirmation of a subscription the reader asked for, and how to leave —
which is squarely a transactional/relationship message and exempt.

**Rejected:** extending `EMAIL_SOURCE_FILES` to three files. The list is the
defect, not its length.

### The rule

`src/lib/mail-senders.ratchet.test.ts` (6 tests, 4 injections). It
**discovers** senders from disk by walking `src/` for
`resend.emails.send` / `resend.batch.send`, and requires each either to
reach `renderEmail` or to be allowlisted with a written reason. Three are
allowlisted: `bulk-emails/[id]/send` (an administrator composes the body and
it appends its own postal footer), `cron/send-newsletter` (AI-generated per
run, and the one sender that **refuses** when the address is missing), and
`users/me` (one sentence confirming an account deletion, to an address whose
account no longer exists).

⚠️ It also asserts `EMAIL_SOURCE_FILES` is still exactly those two files —
if a third appears, the allowlist reasons above ("there is no template to
measure") may have stopped being true, so it fails deliberately and asks.
And it fails on a **stale** allowlist entry, because an exemption nobody is
checking is worse than none.

### ⚠️ Two stale assertions, corrected rather than relaxed

`subscribe/route.test.ts` had two tests reading `sendCalls[0].text`. The
substance — the body must carry a token this process can verify, and must
fall back to a `mailto:` opt-out when the signing secret is unset — still
holds; only the field changed. They now read `html`, assert `text` is
`undefined`, and the token capture stops at `"`, whitespace and `&`, because
`[^\s]+` against markup swallows the rest of the anchor's style attribute.

---

## 5. ⛔ OWNER-ONLY: four people are on the mailing list and have had nothing

[VERIFIED] `newsletter_subscribers` holds **4 active** rows (no
`unsubscribed_at`). `cron.send_newsletter` has written **two** rows, on
2026-10-18 and 2026-10-22, both `severity: warning`, both:

> `{"sent": 0, "reason": "MAILING_POSTAL_ADDRESS is not set. Commercial
> email requires the sender's real physical postal address (CAN-SPAM 15
> U.S.C. §7704(a)(5)(A)(iii)); refusing to send rather than printing a
> placeholder address."}`

The cadence is weekly, Thursday 14:00 UTC, so two runs in nine days is
correct and the next is 2026-10-29.

**The refusal is right** and is the reason this is discoverable at all —
it is the worked example §2's rule is built on. What is needed is the
address, and **only the owner has it**. Until then the newsletter cannot
send, by design.

### Two owner decisions

1. **`MAILING_POSTAL_ADDRESS`** — a real physical postal address. Without
   it no newsletter and no bulk email can carry a lawful footer. There is
   deliberately no default (`docs/41` §5.1).
2. **`BLOG_PIPELINE_ENABLED`** — turning on AI-generated article
   publishing. Not recommended as a reflex: `docs/36` is this project's
   record of a content generator inventing quotes for real officials and
   forging press attribution. With §3 fixed, `BLOG_AUTO_PUBLISH` unset now
   genuinely means "a person reads it first", and the 28 queued topics score
   70–100 so there is real material waiting. **Enabling the pipeline without
   enabling auto-publish is now a safe combination; before §3 it was not.**

Neither is something an agent should set.

---

## 6. Reported, not changed

- **`/blog` is in the primary navbar and in the root sitemap, and is
  empty.** `Navbar.tsx:43` carries an unconditional `Blog` entry, and
  `https://lastdonor.org/sitemap.xml` advertises `/blog`. The homepage blog
  section is correctly gated on `latestPosts.length > 0` and renders
  nothing, so the navbar is the only door. This is the `docs/119` shape — a
  nav entry that does not mean what the page contains — but the fix is not
  free: hiding it needs a database read in the navbar, which sits in the
  **root layout**, so it would cost one of the three permitted queries
  (`docs/87`) on **every one of the 216 routes**. The page is honest ("No
  posts published yet"), it is not a 404, and it self-corrects the moment
  §5's second decision is taken. Publishing, or deciding not to have a blog,
  is the real fix and both are owner calls.
- **`feed.xml`'s channel description** claims *"Research-backed articles on
  charitable giving, donor impact, and nonprofit transparency"* for a feed
  with zero items. Left as a statement of intent, flagged here.
- **A `blog_pipeline_skipped` row is only visible to someone who looks.**
  `/admin/audit-log` will show it (`docs/88` F18), but nothing pushes a
  warning-severity cron row at an administrator. Out of scope here; worth a
  decision alongside §5.
- **CLAUDE.md calls the schedule table `CRON_SCHEDULE`**; the export is
  `CRON_JOBS` (`src/lib/cron-schedule.ts`). Corrected in CLAUDE.md with this
  commit.

---

## 6a. ⚠️ A contrast measurement that was wrong, caught by a control

The welcome email was rendered in Chromium at 420px in both schemes and
looked at, not only asserted (`docs/94` §9: a reading-level score says
nothing about whether the words can be seen). The first probe reported a
**worst contrast of 2.87:1 in light mode** — below the 4.5:1 floor — which
would have been a defect in new copy.

It was not. The selector was `p,h1,h2,a,span,td`, which picked up the
shell's 4px decorative rule, a `<td>` carrying `&nbsp;` at `font-size: 0`.
Re-run over `p,a` only, the welcome email has **no** text element under
4.5:1 in either scheme — and the control settles it: an existing template
(`manualRefundPendingEmail`) measured by the same probe reports exactly the
same, so the number was a property of the harness, not of this email.
`docs/59`'s lesson, measure the measuring harness.

Screenshots in the session scratchpad: `j6-shots/welcome-light.png`,
`j6-shots/welcome-dark.png`.

---

## 7. `clearDatabase` leaked the topic queue

`test/helpers.ts` truncated `blog_posts` and **not** `blog_topic_queue`, so
a test that seeded a topic leaked it into every later file. The integration
suite runs **serially against one shared database by design** (`docs/98`),
which is exactly the condition that turns a leak into a unique-constraint
failure three files away — which is how it surfaced: the first integration
test in this project's history to touch that table failed on
`blog_topic_queue_slug_unique` in three of its four cases while the fourth
passed. Added to the truncate list.

---

## 8. What was NOT checked

Stated plainly, per Gate 9.

- **The live value of `BLOG_PIPELINE_ENABLED` and `BLOG_AUTO_PUBLISH`.** No
  `flyctl` in this session and no endpoint reports flags. §2 explains the
  elimination and labels the conclusion [INFERRED].
- **Whether `blog-generate` has ever answered 500 rather than 200.** That
  is in the Cloudflare Worker's log, which this session cannot read. It is
  one leg of §2's elimination and it rests on nobody having reported one.
- **The generated article itself.** Nothing has ever been generated, so the
  quality of what the pipeline produces, its authority links, its dedup and
  its SEO scoring are all unexercised in production. `docs/36` is the
  standing warning.
- **`blog-refresh`.** It runs and records, but with zero posts it has never
  had anything to refresh, so its behaviour is unexercised too.
- **The newsletter's own HTML.** `buildNewsletterHtml` is its own document,
  not the shell, so it is outside the dark-mode and plain-language sweeps by
  the allowlisted reason in §4 — and it has never been rendered to a reader.
- **Whether any of the 4 subscribers received the welcome email.** The
  welcome send is independent of the cron and `docs/73` found all mail ever
  sent was delivered, but I did not query Resend for these four.
