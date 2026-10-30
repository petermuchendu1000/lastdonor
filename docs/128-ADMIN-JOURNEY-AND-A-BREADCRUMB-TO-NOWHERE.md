# 128 — The admin journey, and a breadcrumb that pointed at a 404

**Date:** 2026-10-28
**Journey:** 10 of the end-to-end walk (admin), after `docs/127` sign-in
**Status:** one defect fixed and injection-proven; one symptom confirmed with
its **mechanism unresolved** and deliberately not patched (§5); nothing
deployed
**Read before touching** `src/components/layout/Breadcrumbs.tsx`,
`src/lib/navigable-routes.ts`, or adding a route whose parent has no page.

---

## 1. How the walk was done

`docs/88` audited **24** admin pages. There are now **35**. All of them were
walked signed in as a real admin, through the real login form, at 1440px and
390px — 70 screenshots, capturing HTTP status, the path after redirects,
console and page errors, 4xx subrequests, page height and horizontal overflow.

This is the first time every admin page's data query has been executed by
anything. `docs/107` §7 says so outright: *"No admin page's data query is run
by any test"* — the integration suite covers API routes, E2E has no signed-in
admin fixture, and a unit test cannot reach a server component's database
call.

`scripts/seed-admin-walk.ts` is what made it possible. The E2E fixture seeds
users, campaigns, donations, updates, collaborators, blog posts and settings;
**twelve admin screens read tables it never touches**, so without seeding them
the walk would have measured empty states and hidden every defect that lives
in a row.

⚠️ **Gate 5, applied and with a control.** Three stable reads before anything
was measured, and the control is the useful half: `/admin` answers **307** to
an unauthenticated caller. If the layout guard were broken it would be 200 —
and `docs/99` §8 records a test that asserted `toHaveURL(/\/(admin|login)/)`,
which passes whether a route is guarded or wide open.

---

## 2. ⛔ The finding: breadcrumbs linked to pages that do not exist

`Breadcrumbs.tsx:45-49` built an href for **every** path segment and rendered
each non-last one as a `<Link>` (`:101-106`), with nothing checking the target
resolved. Four of those hrefs were 404s.

### 2.1 Evidence — three methods, each challenging the last

**Method 1 — the browser walk.** Three distinct `?_rsc=` 404s, reproducible on
both device legs. The `?_rsc=` suffix is Next **prefetching a `<Link>`**, which
is how `docs/120` §11.3 found the same class in `src/components/admin/`.

**Method 2 — disk.** `/admin/blog/[id]/page.tsx`,
`/admin/campaigns/[id]/updates/page.tsx` and
`/admin/institutions/[institutionId]/page.tsx` are all **MISSING**.

**Method 3 — a plain authenticated GET, with controls.** The controls are what
make it discriminating; a broken auth guard would have hit them too:

```
MISSING  /admin/blog/<id>               HTTP 404   h1="Page Not Found"
MISSING  /admin/campaigns/<id>/updates  HTTP 404   h1="Page Not Found"
MISSING  /admin/institutions/<id>       HTTP 404   h1="Page Not Found"
CONTROL  /admin/blog/<id>/edit          HTTP 200   h1="Edit Blog Post"
CONTROL  /admin/campaigns/<id>          HTTP 200   h1="General Fund"
CONTROL  /admin/institutions            HTTP 200   h1="Trusted organisations"
```

**Method 4 — the rendered DOM.** Not merely a prefetch. The breadcrumb on
`/admin/campaigns/<id>/updates/new` literally contained
`<a href="/admin/campaigns/<id>/updates">Updates</a>` — a link a person can
click.

### 2.2 ⛔ Gate 3 — the falsifier FAILED, and that is the point

**"What would most likely falsify this?"** → *it is admin-only, those pages are
`noindex`, so it is cosmetic.*

Run: `<Breadcrumbs />` has **20 render sites**, including
`/campaigns/category/[category]`. Against **live production**:

```
/campaigns/category                     HTTP 404
/campaigns                              HTTP 200   (control)
/blog                                   HTTP 200   (control)

/campaigns/category/medical             HTTP 200
  contains href="/campaigns/category"   count: 1
  JSON-LD position 3: Category -> https://lastdonor.org/campaigns/category
  <meta name="robots" content="index, follow">
```

So a **public, indexable** page carried a clickable link to a 404 **and**
advertised that 404 in `BreadcrumbList` structured data as a navigable
ancestor. **23 category URLs are in the production sitemap**, each with the
same broken crumb.

⚠️ Whether Google penalises a `BreadcrumbList` item that 404s is **[UNKNOWN]**.
The claim here is only that the link is broken and the structured data asserts
something untrue.

### 2.3 Blast radius — derived, not guessed

A structural sweep of all 93 routes for ancestors with no `page.tsx`:

| missing ancestor | linked from | audience | indexable |
|---|---|---|---|
| `/campaigns/category` | `/campaigns/category/*` (23 live URLs) | **public** | **yes** |
| `/admin/blog/*` | `/admin/blog/*/edit` | admin | no |
| `/admin/campaigns/*/updates` | `/admin/campaigns/*/updates/new` | admin | no |
| `/admin/institutions/*` | `/admin/institutions/*/payout-accounts` | admin | no |
| `/collaborate` | `/collaborate/accept` | — | **latent**: that page renders no `Breadcrumbs` |

This is `docs/118`'s rule one level up — *a link is BUILT, never written by
hand* — and the same miss: `docs/118` swept the UI, then notifications; nobody
swept the component that assembles a link out of a pathname.

---

## 3. ⚠️ My first fix was wrong, and the ratchet caught it

The obvious predicate is *"does a route exist at this path"*. It returns
**true** for `/campaigns/category`, because `/campaigns/[slug]` yields the
pattern `/campaigns/*` and a wildcard matches the literal segment `category`.
A Next route really does resolve there; production 404s because
`getCampaign('category')` finds nothing and calls `notFound()`.

So the first version was right about routing and wrong about reality, on
**precisely the one case that is public and live**.

The distinction the fix rests on: `category` and `updates` are routing
**namespaces** — literal directories in `src/app/campaigns/category/[category]`
and `src/app/admin/campaigns/[id]/updates/new`. A wildcard matching one of them
is a coincidence of shape, not evidence anything is served.

⛔ `UNSERVED_PREFIXES` is therefore checked **before** `ROUTE_PATTERNS`, and
that order is load-bearing. Injection 2 below reproduces exactly the bug I
wrote.

---

## 4. The fix, and what each test would have to see to fail

A crumb whose target serves nothing renders as **plain text**, not a link. The
trail still shows the step — deleting it would hide where the reader is — it
simply stops pretending to be a destination. Same shape as `docs/118`, where
`publicCampaignPath` returns `null` and both renderers handle it.

It is also **omitted from the `BreadcrumbList` JSON-LD**, with positions
recomputed, because such an item is a claim the URL is a navigable ancestor.

⚠️ `Breadcrumbs` is a client component with nothing but `usePathname()`, so it
cannot ask the filesystem, and making it a server component would put a
dynamic API on pages that are currently static — `docs/106` §10a measured that
cost (181 dynamic / 32 static / 3 ISR would have become 216 dynamic). So the
list is carried, and `navigable-routes.ratchet.test.ts` **derives the same
list from `src/app/`** and fails the build on any drift.

⚠️ **The ratchet's own first version could not fail.** It computed the unserved
set by calling `isNavigablePath`, which reads the list — so the list validated
itself. It now derives that set from disk and compares the two ends
(`docs/109`), which is the only reason injections 1 and 2 bite.

### 4.1 Injection results — all five fire, every restore verified clean

| injection | fails |
|---|---|
| drop `/campaigns/category` from `UNSERVED_PREFIXES` | 3 |
| check `ROUTE_PATTERNS` first (**reproduces my own bug**) | 3 |
| delete a real route from `ROUTE_PATTERNS` | 2 |
| wildcard matches more than one segment | 1 |
| `isNavigablePath` always true | 2 |

### 4.2 Verified by direct observation, with controls

| | before | after |
|---|---|---|
| `/campaigns/category/medical` | `href="/campaigns/category"` present | **`present: false`**, crumb is `TEXT Category` |
| its JSON-LD | `3. Category -> …/campaigns/category` | `3. Medical -> …/campaigns/category/medical` |
| the three admin pages | one 404 each | **0 4xx/5xx** |
| **control** `Campaigns -> /campaigns` | link | **still a link** |
| **control** `Details -> /admin/campaigns/<id>` | link | **still a link** — that page exists |

Gate: lint clean (0 errors, 1 pre-existing warning), typecheck clean,
**7,711 unit passed / 16 skipped (264 files)**, **291 integration passed
(30 files)**.

---

## 5. ✅ RESOLVED 2026-10-30 by `docs/154` — four admin tables overflow at 390px

> **✅ The root cause below is no longer [UNKNOWN]. See `docs/154` §3.**
>
> A `.sr-only` span (`position: absolute`, **1×1px**) is rendered as the last
> `<th>` of each table — the "Actions" header — and the scroll wrapper was
> `position: static`, so that span's **containing block was the initial
> containing block, not the wrapper**. An absolutely positioned box whose
> containing block lies outside a scroll container is not clipped by it, and it
> extends the scroll area of **its own** containing block, which is `html` and
> never `body`.
>
> That is why every observation in this section looked irreconcilable:
> `body.scrollWidth` 390 vs `html` 514 (only `html`'s area grows); *"a scan
> finds **zero** unclipped elements"* (**the span is 1×1 and the scan skipped
> sub-2px boxes**); *"`table-layout: fixed` takes it to 0"* (it narrows the
> columns so the span lands on screen); *"a minimal reproduction produces 0px,
> so the browser is not at fault"* (the reproduction had no `.sr-only` — the
> browser never was at fault); and the *"blank right gutter"*, which is
> literally correct.
>
> ⛔ **The control named below was never structurally different.**
> `/admin/campaigns` has the same span with the same containing block; its
> table is merely narrow enough that it lands **32px** inside the viewport.
> `/admin/blog`'s margin was **1px**. The four pages here are not a class, they
> are the ones that crossed zero.
>
> Fixed by `relative` on all 40 hand-rolled scroll wrappers, which changes no
> geometry; `src/components/ui/table.tsx` had always had it. Guarded by
> `src/components/ui/scroll-containment.ratchet.test.ts`. The original
> measurements below are kept as the record.

### The original report (root cause [UNKNOWN] at the time)

`/admin/blog/topics` (+124px), `/admin/governance` (+90), `/admin/donations`
(+73) and `/admin/users` (+46) report `documentElement.scrollWidth` exceeding
`clientWidth` at a 390px viewport. `/admin/campaigns` reports **0** and is the
control. These are among the *"12 of 24 pages unmeasured at 390px"* that
`docs/88` pass-2 left open.

**Two hypotheses were formed and both were REFUTED by measurement:**

1. *"The table has no scroll wrapper"* (`docs/88` F18's defect). **Refuted:**
   every admin table has `overflow-x-auto` — all 25 components sweep clean, the
   control included.
2. *"The flex `min-width: auto` bug."* **Refuted:** applying `min-width: 0` to
   **every** ancestor from the table to `<body>`, individually and all at once,
   leaves the overflow at 124px.

What is established:

- Hiding the `<table>` takes the overflow to **0**. `table-layout: fixed` takes
  it to **0**.
- The wrapper **is** clipping correctly: `overflowX=auto, w=342, scrollW=501,
  clientW=340`, and no ancestor exceeds the viewport.
- A scan for elements extending past the viewport that are **not** inside a
  clipping ancestor finds **zero** on all four pages. (A naive scan blames the
  table, because `getBoundingClientRect()` ignores clipping — that first
  reading was wrong.)
- `body.scrollWidth` is **390** while `documentElement.scrollWidth` is **514**.
- A **minimal reproduction** — a 651-669px table in a 342px `overflow-x-auto`
  box, nested flex layout, `body { display:flex }`, 390px viewport — produces
  **0px** overflow in both emulation modes. **So the pattern is sound and the
  browser is not at fault.**

⚠️ **A measurement trap worth keeping.** Under Playwright's `isMobile: true`,
`window.scrollTo(9999, 0)` lands at `scrollX=0` and the page does **not**
scroll sideways — Chromium widens the layout viewport to 514 instead. Under
`isMobile: false` at the same 390px, `scrollX` reaches 124 and the page visibly
slides, cutting off the left edge and leaving a blank right gutter. The
`scrollWidth > clientWidth` metric caught it in both modes; the scroll test
only caught it in one.

⛔ **No CSS was changed.** Gate 6 asks for the smallest change that fixes the
**root cause**, and the root cause is **[UNKNOWN]**. `table-layout: fixed`
would fix the symptom and redistribute every column on four admin tables
without anyone understanding why it was needed. What would settle it: a
non-headless browser or a real handset, and bisecting the live DOM by removing
sibling subtrees rather than ancestors.

---

## 6. ⚠️ A correction: the `/admin/screening` 500 was mine

The walk reported `/admin/screening` answering **HTTP 500** with the error
boundary rendered — *"Objects are not valid as a React child (found: object
with keys {code, detail})"*, twice, once per device leg. It read exactly like a
defect, and it was my fixture.

I seeded three invented values: `action: 'hold'`,
`nameMatchKind: 'cannot_judge'`, and `flags` as `[{code, detail}]` objects. The
real domains are `decide.ts:108` (`auto_approve | needs_human`),
`decide.ts:66-82` (`ScreeningFlag`, a union of string literals) and
`name-match.ts:92-104` (`NameMatchKind`). Corrected, the page answers **200**
and renders the row.

⛔ **This was a Gate 1 violation by me.** `action` is `text` and `flags` is
`jsonb`, neither carries a CHECK constraint, so `information_schema` said
nothing about their domains and Postgres accepted all three guesses silently —
the *"`amount` vs `amount_cents` is a guess that fails silently"* case exactly.
**A column whose domain lives in TypeScript can only be read from the code that
writes it.**

It did expose an unchecked `as string[]` cast at `screening/page.tsx:183`. Every
writer of that table was enumerated: `src/lib/screening/run.ts:193` is the
**only** one, typed `ScreeningFlag[]`. So the cast is **not reachable in
production** — an observation, not a finding, and nothing was changed for it.

---

## 7. What was NOT checked

- **Nothing is deployed.** The owner deploys (CLAUDE.md), so the broken
  breadcrumb is still live on all 23 production category URLs.
- **The 390px overflow mechanism**, as above — the symptom is confirmed, the
  cause is not.
- **No admin WRITE action was exercised.** The walk is read-only: it loaded 35
  pages and pressed nothing. `docs/88` pass-2 lists non-campaign write actions
  as open and they remain open.
- **`next start` warns that it "does not work with `output: standalone`".** The
  server served real seeded rows throughout, and every conclusion above is
  independently confirmed against live production rather than resting on this
  harness — but the warning was not chased down.
- **Per-screen copy** was not reviewed. This pass looked at status, errors,
  links and geometry, not at wording.
- **axe/WCAG was not run** on any admin page. `docs/100` is explicit that axe
  cannot see keyboard behaviour anyway, and no admin screen has ever been
  checked for either.
