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
