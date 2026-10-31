# 164 — `null` is not `undefined`, and the tab nobody lit

`/blog` at 390px — one of the three routes `docs/151` §7 names as never
walked:

> **Only five routes.** `/campaigns/[slug]`, the campaign donate page,
> `/blog`, `/search` and every signed-in screen were not walked at 390px.

⚠️ **`/search` turned out to have no screen at all**, so it is answered rather
than walked: it is a pure param forwarder (`redirect(campaignsHref(...))`,
`docs/45`), [VERIFIED live] `307 → /campaigns?q=medical → 200`. Its substantive
surface is `/campaigns`, already walked. So this doc is `/blog`.

---

## 1. The finding: one expression, two defects

`src/app/blog/(index)/page.tsx:63`

```ts
const categoryFilter = CATEGORIES.find((c) => c.value === params.category)?.value;
```

`CATEGORIES[0]` was `{ label: 'All', value: null }`. An absent `?category=` is
`undefined`. **`null === undefined` is false**, so `find` never matched the All
entry and `categoryFilter` was `undefined` — which produced two different
defects from the same six lines:

1. **The All tab was highlighted on no URL at all.** `isActive` compared
   `categoryFilter === cat.value`, i.e. `undefined === null`, which is false
   always. On `/blog` — the default, the landing state, an `index, follow`
   page — nothing appeared selected.
2. **An unrecognised value silently widened the list.** `find` also returns
   `undefined` for garbage, which is indistinguishable from "no filter", so
   `/blog?category=anything` served **every** post with no tab active and
   nothing saying the filter had been dropped.

(2) is forbidden in writing, by the module next door.
`src/app/campaigns/browse-params.ts`'s own header:

> The rule for a value we cannot apply is: **never silently widen the result
> set.** An unapplied value is reported to the visitor and the listing is
> shown deliberately unfiltered on that dimension, rather than being dropped
> in silence (which reads as "all 12 of these match your filter").

That is `docs/45`. It was decided for `/campaigns` and **never swept over
`/blog` or `GET /api/v1/blog`** — the shape of `docs/118`, `docs/121` §9 and
`docs/152`: a rule enforced on the surface it was written for, with a sibling
nobody looked at.

## 2. Verified three ways, against production, with controls that discriminate

| URL | active pills | notice | reading |
|---|---|---|---|
| `/blog` | **0** | none | the defect |
| `/blog?category=campaign_story` | 1 — *Campaign Stories* | none | **CONTROL** |
| `/blog?category=news` | 1 — *News* | none | **CONTROL** |
| `/blog?category=garbage-not-real` | **0** | **none** | silently widened |

The two controls are what make the zeroes evidence. A probe that simply could
not see an active pill would have reported 0 on all four rows.

Method 3 is the source reasoning in §1, which explains both rows without
appeal to anything else: the same `find` is responsible.

### 2.1 ⚠️ Severity, stated plainly

**(1) is live and visible today. (2) is latent.** [VERIFIED, `docs/123`]
`blog_posts` holds **0 published rows, ever**, so every category URL currently
renders the same empty page and no visitor can be misled about which posts
match. The silent widening arms itself the day the blog pipeline is enabled —
which is an owner-only switch sitting in `docs/123`, i.e. one configuration
change away.

## 3. Also found: eight copies of a three-value enum

The source of truth is `blogCategoryEnum` in `src/db/schema.ts:104`. Nothing
derived from it. [VERIFIED by enumerating them]

| file | what it holds |
|---|---|
| `src/app/blog/(index)/page.tsx` | 4 labelled entries incl. the `null` one |
| `src/app/api/v1/blog/route.ts` | its own `VALID_CATEGORIES` tuple |
| `src/app/api/v1/admin/blog/route.ts` | an inline array **and** a cast union |
| `src/lib/validators/blog.ts` | `BLOG_CATEGORIES` |
| `src/components/admin/BlogEditor.tsx` | labelled options |
| `src/components/admin/BlogPostsList.tsx` | a label map **and** `<SelectItem>`s |
| `src/components/blog/BlogCard.tsx` | a label map |
| `src/app/blog/[slug]/page.tsx` | a label map |

⛔ **One of them compiled with a hole**: `/blog/[slug]`'s was
`Record<string, string>` with a `?? post.category` fallback, so a fourth enum
value would have rendered the raw `some_new_value` to readers and failed the
build nowhere. `BlogCard`'s was `Record<BlogPost['category'], string>`, which
**does** enumerate — two maps of the same three strings, 160 lines apart, one
safe and one not. `docs/144`'s lesson exactly.

## 4. The fix

`src/lib/blog-categories.ts` holds the public vocabulary and the one decision
about what a `?category=` value means.

⛔ **A discriminated result, not a value.** The root cause is that ONE value
had to mean two things, so a resolver returning `BlogCategory | null` would
reintroduce it: "the visitor asked for everything" and "the visitor asked for
something we do not have" would both be `null` again.
`resolveBlogCategory` returns `all` | `category` | `unapplied`.

⛔ **`BlogCategory` is `BlogPost['category']`**, which `InferSelectModel`
derives from `blogCategoryEnum` — so a fourth enum value widens the union and
`Record<BlogCategory, string>` **fails to compile** until somebody writes a
label. The *ordered* runtime list cannot be derived by the type system, so a
test asserts it against `blogCategoryEnum.enumValues` instead of restating it
— the same shape `src/lib/campaign-labels.ts` uses.

⛔ **Both surfaces report.** The page renders a notice naming the value; the
API adds `meta.unappliedCategory`, additively, present only when there is
something to report. The API carried the identical defect
(`VALID_CATEGORIES.includes(x) ? eq(...) : null`) and was found only by
reading it — a page-only fix would have left `ok: true` with every post for a
caller whose filter was ignored.

⚠️ **The casts went with it.** The API needed `categoryParam as BlogCategory`
twice; the resolver narrows, so nothing casts now. A cast is what let the
string in.

⚠️ **`All` is active for BOTH `all` and `unapplied`**, and that is the honest
answer rather than a convenience: in both states the unfiltered list is what
is on screen, so that is the tab describing it. Keying it on `all` alone
leaves `/blog?category=garbage` with no tab active while showing every post —
a quieter version of the original defect, and injection row 5 fires on it.

### 4.1 The empty state was a third claim

`"No posts published yet. Check back soon."` is a statement about the **whole
blog**, rendered under a category filter. False the moment any other category
holds a post — latent for the same reason as §2.1, and wrong by construction.
It is now decided from the resolved filter, and a filtered empty state offers
a way out (`See every story`) rather than a dead end.

⚠️ An **unapplied** value keeps the whole-blog copy, which is TRUE there: the
filter was not applied, the list really is every post, and the notice above it
already names what was rejected. Pinned by a test so nobody "fixes" it into a
claim about a category that does not exist.

### 4.2 ⚠️ Not fixed, deliberately

`src/components/admin/` keeps its own labels, on the `docs/110` §4 precedent
(two audiences, two vocabularies — that doc declined to consolidate admin
status labels for the same reason). `src/lib/validators/blog.ts` and
`src/app/api/v1/admin/blog/route.ts` still restate the list; both are
admin-write paths, neither was on this walk, and widening the change to them
means touching the admin editor. **Recorded, not half-fixed** — 4 of the 8
copies remain, all behind the admin gate.

## 5. Gate 4 — and the hole it found in my own test

⚠️ **My first guard checked the tab strip as TEXT, and that cannot see which
way a branch points.** `docs/162` §5.1 had just proved this by inverting a
decider and passing every structural rule. So the two judgements —
which tab is active, and what the empty state says — were extracted into
**pure functions** (`blogCategoryTabs`, `blogEmptyState`) and are **executed**.
Injection **row 6 inverts the active test** (`resolved.value !== value`) and
fires; against the text version it would not have.

That is `docs/157` §4.1's cure applied before the harness, not after: a
judgement that must be correct is a function, not a conditional in JSX.

| row | injection | expect | result |
|---|---|---|---|
| 0 | baseline | pass | PASSED |
| 1 | **the real production state** — unrecognised value → `all` | fire | FIRED (1) |
| 2 | every value reported unapplied (anti-vacuity) | fire | FIRED (2) |
| 3 | absence resolves to a filter (the `null`/`undefined` confusion) | fire | FIRED (1) |
| 4 | **the real defect at the strip** — All never active | fire | FIRED (2) |
| 5 | All active only on `all`, not `unapplied` (the quieter defect) | fire | FIRED (2) |
| 6 | **INVERTED active test** — invisible to text | fire | FIRED (1) |
| 7 | a category dropped from the ordered list | fire | FIRED (4) |
| 8 | filtered empty state claims the whole blog is empty | fire | FIRED (1) |
| 9 | the reported value is unbounded | fire | FIRED (1) |
| 10 | the PAGE stops reporting (half-fix) | fire | FIRED (1) |
| 11 | the API stops reporting (the other half) | fire | FIRED (1) |
| 12 | the API restates the category list | fire | FIRED (1) |
| 13 | **reword the notice copy** | **pass** | PASSED |
| 14 | **a comment-only edit** | **pass** | PASSED |

Rows 13-14 are the `docs/160` §5.2 guard against a rule that pins today's
prose. Every row refuses to be scored unless its anchor matched exactly once
**and** the file's sha changed (`docs/152` §5.2: an injection that does not
apply reports exactly like a rule with a hole in it), and the restore is
sha-verified against all three files after every row (`docs/159` §5.1).

## 6. Verified by execution in a browser at 390px

Against a local production build on a lab Postgres seeded with one published
post per category. ⚠️ The posts had to be seeded: production has none, so the
only way to see a filter work is to give it something to filter.

| URL | active pill | `aria-current` | notice | articles |
|---|---|---|---|---|
| `/blog` | **All** | All | none | 3 |
| `/blog?category=news` | News | News | none | **1** |
| `/blog?category=campaign_story` | Campaign Story | Campaign Story | none | **1** |
| `/blog?category=garbage-not-real` | **All** | All | **names the value** | 3 |

**3 unfiltered against 1 filtered is the control that proves the filter still
works** — a resolver that rejected everything would show 3 on every row and
satisfy "All is active".

Filtered empty state, with the news post unpublished:

| URL | empty state | way out | articles |
|---|---|---|---|
| `/blog?category=news` | **"No news posts yet."** | `See every story` | 0 |
| `/blog` (CONTROL) | **none** | none | 2 |

And the 390px walk itself, on all four URLs: **0px horizontal overflow**
(`scrollWidth - clientWidth`, `isMobile: false` per `docs/128` §5), **0
nameless controls** against 32-34 named (read as accessible names via
`ariaSnapshot`, because `docs/134` proved `innerText` is blind to icon-only
controls), no soft 404, no error boundary, no 4xx/5xx subresources.

⚠️ `page.accessibility.snapshot()` no longer exists in this Playwright and
threw `Cannot read properties of undefined` — an outright error, which is the
good case. A probe that had silently returned nothing would have reported `0
nameless` and read as a pass.

## 7. ⚠️ Probe failures that each read as a result

- **`next start` answered 500 on every route, and the cause was not the
  change.** `[SECRET-VALIDATION] FATAL` for `CRON_SECRET` and
  `STRIPE_WEBHOOK_SECRET`, which `docs/99` §6 does not list. The page is fine;
  the server never started. Worth adding to that list.
- **Then it answered 500 again from a server I thought I had replaced.**
  `EADDRINUSE` on the retry — the **failed** process was still holding the
  port and answering, which is `docs/162` §6 word for word. My `/proc/*/comm`
  scan for `next-server` found nothing because a process that dies during
  startup never gets that name. Moved to a clean port rather than guessing.
  ⛔ Note the process inspection printed **pids and `comm` only**: a command
  line here carries a database URL.
- **An `awk` using `strtonum` failed** (`function strtonum never defined` —
  not GNU awk here), so the socket-inode lookup silently found nothing and
  printed `socket inode: none`. Had I trusted it I would have concluded no
  process held the port, which is what the `EADDRINUSE` had just disproved.

## 8. What was NOT checked

- **`/blog/[slug]` was not walked.** There are no published posts in
  production, so every slug 404s; the label change there is covered by
  `tsc` and by the shared map's test, not by a rendered page. The seeded lab
  posts were used for the index only.
- **No screen reader.** `aria-current="page"` is new on the active tab and is
  [INFERRED] from the snapshot, not heard.
- **The 4 remaining copies of the category list** (§4.2) are admin-side and
  unexercised here.
- **`GET /api/v1/blog`'s new `meta.unappliedCategory`** is proven by unit test
  and by reading the route; it was not called over HTTP, because the lab
  server was brought up for the page walk and the route's own integration
  test covers its query.
- **The remaining route from `docs/151` §7** — every signed-in screen at
  390px — is still unwalked.

---

## 9. Two things found walking the rest of the signed-in surface — REPORTED, NOT FIXED

Enumerating what `docs/151` §7's *"every signed-in screen"* still means (the
organiser dashboard was walked by `docs/154`, all 35 admin pages by `docs/128`
at both widths) left exactly three auth-gated routes outside those trees:
`/notifications`, `/profile`, and `/campaigns/[slug]/congratulations`.

### 9.1 ⚠️ A falsifier refuted the one that looked worst

`/campaigns/[slug]/congratulations` is auth-gated — [VERIFIED live: `307 →
/login?callbackUrl=…`] — and `docs/122` established that **the M-Pesa rail
creates only guests**, so an auth-gated post-donation screen would be a
thank-you no real donor could reach. It is not one: the query is
`eq(campaigns.creatorId, session.user.id)` and the title is *"Your Campaign Is
Live!"*. It is the ORGANISER's screen and the gate is correct. Refuted by
reading it, before it cost a browser pass.

⛔ **But nothing links to it.** A repo-wide sweep finds four references and not
one is a link: a comment in `ShareButtons.tsx`, two assertions in
`instant-live-architecture.test.ts` that the wizard does **not** redirect
there, and `navigable-routes.ts` listing it as served. `docs/109` moved the
wizard's redirect to `/dashboard/campaigns?submitted=1` and sent
`?launched=true` to the approval email, where `LaunchSuccessBanner` does this
screen's job. So it is `docs/83`'s shape — a working screen with no door —
and it duplicates a banner that IS reachable.

Not deleted here: it is `robots: index:false`, organiser-only and harmless, and
removing a screen is a product call rather than an audit's. Recorded so the
next reader does not assume it is live.

### 9.2 ⛔ TWO independent ideas of this site's own public base URL

`appBaseUrl()` (`src/lib/unsubscribe-tokens.ts:224`) reads
**`NEXT_PUBLIC_APP_URL`** and strips trailing slashes. Five sites hand-write
**`process.env.NEXTAUTH_URL || 'https://lastdonor.org'`** instead:

| site | what it builds |
|---|---|
| `api/v1/auth/forgot-password/route.ts:127` | the **password-reset link** |
| `campaigns/[slug]/congratulations/page.tsx:65` | the share URL on that screen |
| `lib/email-templates.ts:15` | `BASE_URL` for the template family |
| `lib/email-shell.ts:46` | `BASE_URL` for the shell |
| `lib/email-adaptive.ts:37` | `BASE_URL` for the dormant family (`docs/140`) |

[VERIFIED] `fly.toml:52` sets `NEXT_PUBLIC_APP_URL = "https://lastdonor.org"`,
`NEXTAUTH_URL` appears in `fly.toml` only inside comments, and
`flyctl secrets list` shows **`NEXTAUTH_URL` IS set as a secret** — so the two
sources are genuinely independent in production, and `docs/57`'s rule
(*"redirects must use `appBaseUrl()`"*) is unswept over all five.

⚠️ **Whether they AGREE today is [UNKNOWN], and the probe that looked like it
settled it does not.** `/api/auth/providers` answers
`signinUrl=https://lastdonor.org/...`, but with `AUTH_TRUST_HOST` on (which
`fly.toml:175-180` discusses at length) NextAuth derives that from the request
host, not from `NEXTAUTH_URL` — so it measures the hostname I asked on. The
secret's value is not readable here and must not be printed.

⛔ **Which is why this is not fixed.** Pointing the five at `appBaseUrl()` is
the right end state and it changes **every link in outgoing mail**, including
the password-reset link `docs/74` proved end to end. If the two variables
disagree, that switch silently re-hosts every emailed link. An owner call, and
one `fly secrets list` away from being safe.

✅ Fixed here, because it is zero-risk and actively misleading:
`email-templates.submission-receipt.test.ts` carried a comment stating
*"`appBaseUrl()` reads `NEXTAUTH_URL`"*. It does not. That comment is how a
reader concludes the two forms are equivalent.

### 9.3 Still unwalked

`/notifications` and `/profile` at 390px. Both [VERIFIED live] answer `307 →
/login?callbackUrl=…`, so walking them needs a signed-in fixture, which is the
next step rather than a finding.

---

## 10. The signed-in screens at 390px — NO CODE CHANGE, and what that rests on

`docs/151` §7's last named item. The surface is smaller than the phrase
suggests: the organiser dashboard was walked at 390px by `docs/154`, all 35
admin pages at both widths by `docs/128`, so what remained was
`/notifications`, `/profile` and `/campaigns/[slug]/congratulations` (§9.1
refuted the last one by reading it).

Walked signed in as the E2E fixture organiser against a local production build.

| route | lands on | overflow | nameless controls | tap targets < 24px not 2.5.8-exempt |
|---|---|---|---|---|
| `/notifications` | `/notifications` | **0px** | **0** / 30 named | **0** |
| `/profile` | `/dashboard/settings` | **0px** | **0** / 8 named | **0** |
| `/settings` | `/dashboard/settings` | **0px** | **0** / 8 named | **0** |
| `/dashboard` (control) | `/dashboard` | **0px** | **0** / 16 named | **0** |

⚠️ **The signed-OUT arm is the control that makes those rows mean anything**:
`/notifications`, `/profile` and `/dashboard` each bounce to `/login`, while
`/settings` stays and serves (`docs/122` §3's requirement). A walk that had
silently measured signed-out pages would have reported a clean login form four
times and read as a pass.

⛔ **The tap-target question was MEASURED, not assumed.** 16 of 20 targets on
`/dashboard` are under 24px, which looks alarming until WCAG 2.2 2.5.8's
exceptions are applied properly: for each one, whether a 24px circle centred
on it intersects another target's circle, and whether it is inline in a
sentence. **0 fail** on all three screens. Same answer `docs/153` §4 reached
for the wizard, by the same method.

### 10.1 ⚠️ What that "clean" actually covers

[VERIFIED] `notifications` holds **0 rows** in the fixture, so the
`/notifications` reading is **its empty state**, and the 30 named controls are
mostly navbar and footer rather than the page's own. `docs/128` walked 35
pages and pressed nothing; this walk pressed nothing on `/notifications`
either, and says so.

### 10.2 ✅ `docs/118` §2.5's rot, inventoried against production

A notification is a stored link, and `NotificationsClient.tsx:280` renders
`n.link` **verbatim from the database** — there is no render-time re-guard, so
`docs/118` §2.5's warning (*"a STORED link ROTS"*) stands. What `docs/118` had
was *"one production row was a 404"*. The full inventory now:

| | |
|---|---|
| notifications | **8** |
| carrying a link | **7** |
| links that resolve today | **7** |

- The one `/campaigns/...` link points at an **`archived`** campaign with
  `published_at` set and answers **200** — [VERIFIED, with a fabricated slug
  answering **404** as the control]. So `docs/118` §9's decision to serve
  closed campaigns did heal the rot it was argued to heal, on the only
  production row that could have rotted.
- Three `campaign_submitted` rows still point at
  **`/admin/campaigns/<id>/edit`** — the route `docs/120` §2 is entirely
  about. ⚠️ The **minter was repointed**: `notifications.ts:659` and `:993`
  now mint `/admin/campaigns/${campaignId}`, no `/edit`, and
  `AdminDashboard.tsx:177` carries the comment recording it. These three are
  historical rows minted before that fix. All three campaigns exist and are
  `under_review`, so the links resolve.

⚠️ **Low severity, and the reason is a fact about production rather than about
the code**: `docs/133` admin-gated `/admin/campaigns/[id]/edit`, and
[`docs/132`] **0 editors exist**, so nobody is currently bounced; the single
admin can open the editor. Were an editor created, those three rows would
become dead links for them.

⛔ **Not fixed, and not a one-liner.** A render-time guard needs each link's
*kind* and the campaign's *current* state; the component has only a string,
and the notifications API does no such join. The alternatives are migrating
the rows or re-deriving at read time — both reopen `docs/118`'s write-time-vs-
read-time decision rather than patching a page.

### 10.3 What was NOT checked

- **`/notifications` with rows in it.** Its mark-as-read, page-size and
  per-row controls are unexercised; the fixture seeds no notifications.
- **`/profile` and `/settings` are the same screen**, so they are one
  measurement reported twice, not two.
- **No screen reader**, and no real device (`docs/163` §8's caveat applies
  unchanged).
- **`/campaigns/[slug]/congratulations` was read, not rendered** — nothing
  links to it (§9.1), so there is no door to walk through.
