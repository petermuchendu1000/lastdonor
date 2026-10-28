# 141 — The public surface, and a fix that would do nothing

**Date:** 2026-10-28
**Status:** **NO CODE CHANGE.** Four sweeps, all clean, each with a working
control. Three suspected defects refuted by measurement. One owner question
raised and deliberately not acted on.

The anonymous visitor's surface — every public route, the sitemap, the
indexability contract and the images — walked against **production (v124)**.
This doc exists for the same reason `docs/129`, `docs/135` and `docs/136` do:
to record what was *refuted*, so nobody re-investigates it, and to record the
two traps that made the first attempt void.

---

## 1. What was swept, and what the controls proved

| Sweep | Scope | Result | Control |
|---|---|---|---|
| Route health | 34 routes (32 real + 2 fabricated) | 0 soft 404s, 0 error boundaries | both fabricated routes reported `IS_404 true` |
| Sitemap integrity | 56 advertised URLs | 56/56 HTTP 200 and `index, follow` | 7 of 14 probed non-sitemap routes read `noindex` |
| Image delivery | 19 optimiser-served images on `/` and `/campaigns` | 0 broken (`naturalWidth` 0) | a refused host reads `naturalWidth=0`, an allowed one `640` |
| `docs/128` breadcrumbs | `/campaigns/category/medical` | fix is live | `/campaigns/category` still answers 404 |

Every one of those controls is load-bearing. Without the fabricated routes,
"0 soft 404s" is satisfied by a detector that cannot see one; without the
`noindex` control, "0 noindex in the sitemap" is satisfied by a grep that
matches nothing; without the paired image control, "0 broken" is satisfied by
a probe that cannot report a break.

### 1.1 Indexability, measured

Private routes `307`. Every token-bearing or account page is `noindex`:
`/login`, `/register`, `/settings`, `/login/forgot-password`,
`/login/reset-password`, `/collaborate/accept` are `noindex, nofollow`;
`/unsubscribe` is `noindex`; `/cancelled-campaigns` is `noindex, follow` —
served but not advertised, which is `docs/118`'s "serving a status is not
indexing it" holding in production. `/blog/sitemap.xml` advertises **0** URLs,
consistent with `docs/123` (0 blog posts ever).

---

## 2. ⚠️ The first sweep was VOID, and the reason generalises

A `curl` + `grep` sweep for the 404 body text reported **every** page as a soft
404, healthy ones included.

**Next serialises the not-found boundary into the RSC flight payload of every
page**, so `This page does not exist or has been moved` is present in the HTML
of a perfectly healthy route. The marker matched everywhere, which meant the
detector could not discriminate and the whole run said nothing. This is
`docs/106` §10a's recorded trap met in person.

Redone in a browser against `document.body.innerText`, which excludes the
payload, the controls discriminated immediately. **A curl sweep cannot see a
soft 404 or an error boundary in this application.** Use a browser.

---

## 3. REFUTED: the console 400s are a designed, recovered failure

`/` and `/campaigns` log `400 (Bad Request)` for `/_next/image`. This looked
like broken hero images on the product's shop window. It is not.

**Three methods, all agreeing:**

1. **Source.** `next.config.ts` states the trade-off outright — images outside
   the 43-domain allowlist "get a 400 from `/_next/image` and render broken
   rather than unoptimised. That is a visible, bounded, cosmetic failure; an
   anonymous server-side fetcher is not." The allowlist exists because
   `remotePatterns: ["**"]` made `/_next/image` an unauthenticated,
   unrate-limited server-side fetcher pointable at any HTTPS host.
   `CampaignHeroImage.tsx` implements a three-tier `onError` chain (original →
   curated stock → local category webp), and **every** campaign-hero surface
   uses it: `CampaignCard`, `MediaGallery` (the detail page) and
   `CampaignsListClient`. The two bare `<Image>` call sites are a category
   hero and blog cover images — and there are 0 blog posts.
2. **The response itself.** The 400 body is literally `"url" parameter is not
   allowed`. So the refusal is the allowlist, before any upstream fetch — not
   a dead publisher image.
3. **A browser.** `/` served 7 optimiser-backed images, `/campaigns` 12, and
   **0 of 19 were broken**. Two campaigns were observed falling all the way to
   the local category webp (`harold-jennings`, `david-l-jones`); the rest
   recovered to stock.

**The falsifier held.** The visitor sees an image on every card. The 400s are
the designed tier-0 failure and the chain recovers each one.

⚠️ Two honest residuals, neither a defect: the recovery is **client-side**, so
the server-rendered HTML carries the refused URL and the swap happens after
hydration (a reader with JS disabled sees no hero image), and the tier-0/tier-1
distinction is invisible in the browser because both are `images.unsplash.com`
— only the database identifies which campaigns are showing a substitute.

### 3.1 ⛔ The fix that looks right and would do nothing

[VERIFIED from the database] the 14 live, published campaigns split by hero host:

| Host | Campaigns | Optimiser |
|---|---|---|
| `images.unsplash.com` | 7 | allowed (first-party pattern) |
| `taskandpurpose.com` | 3 | **refused** |
| *(no hero URL)* | 2 | n/a |
| `cloudfront-us-east-1.images.arcpublishing.com` | 1 | **refused** |
| `vavxdjqufxrsbyohcwdh.supabase.co` | 1 | allowed (our own bucket) |

The obvious repair is to add the two refused domains to `NEWS_IMAGE_DOMAINS`.
**Both halves of that are closed, for different reasons**, and this is the part
worth recording:

- `taskandpurpose.com` is an **apex** host, and the config maps each entry to
  `**.${domain}`. [VERIFIED by running the installed
  `next/dist/compiled/picomatch`] `**.taskandpurpose.com` does **not** match
  `taskandpurpose.com`, though it does match `www.taskandpurpose.com`. So
  adding the domain is a **no-op** for all three campaigns — a change that
  reads as a fix, passes review, and changes nothing a visitor sees.
- `**.arcpublishing.com` *would* match that host [VERIFIED the same way] — and
  adding it is refused on security grounds, not cosmetic ones: Arc XP is a
  multi-tenant publishing CDN, exactly the "host namespace any attacker can
  obtain a subdomain in" the config declines to allow, which would restore the
  open-fetcher primitive under a longer name.

So for these four campaigns the allowlist route is shut in both directions, and
the config's own stated "real fix" — first-party ingestion at publish time
through `safe-fetch.ts`, re-uploaded to our bucket — is the only one available.
⛔ **Do not "fix" these images by extending the allowlist.**

---

## 4. REFUTED: two other suspicions

- **The donate page rendering 173 words.** Suspected a client-side render
  failure against a full server-rendered form. It is not: 173 words *is* the
  page. The rendered body carries the whole flow — amount ladder with all seven
  presets, Give Once / Monthly, custom amount, email field, message field, the
  0% fee ledger, the CTA and the terms line. Nothing missing.
- **`REQFAIL net::ERR_ABORTED https://lastdonor.org/?_rsc=…` on `/campaigns`.**
  An aborted RSC prefetch when navigation leaves the page. Normal Next
  behaviour, not an error the visitor experiences.

---

## 5. ⚠️ One owner question, raised and NOT acted on

[VERIFIED] **6 of the 14 live campaigns can display an image that is not
theirs** — the 4 on refused hosts plus the 2 with no hero URL at all. The
substitute is a curated stock photograph ("emotionally matched to category",
chosen deterministically from the campaign title) or a generic category webp.
**Nothing labels it as a stock image.**

These are public, indexable appeals naming real people, asking strangers for
money. A donor reasonably reads a hero photograph as depicting the person or
the situation.

This is flagged rather than changed, for three reasons:

1. The three-tier chain is **deliberate and documented**, and `next.config.ts`
   classifies the failure it recovers as "cosmetic". Reversing a recorded
   decision is not an audit's side effect.
2. It is a trade-off with no right answer — a generic photo, a labelled generic
   photo, or no photo at all are three defensible products, and which one is
   right is a trust-and-brand call.
3. It is the owner's call under CLAUDE.md's own division of labour.

It is raised at all because of `docs/36`: this project's recorded history is a
seeding script that attached **forged press attribution and invented quotes to
real named officials**. An unlabelled photograph of a stranger at the top of a
named person's appeal is the visual form of that same class, and CLAUDE.md
holds that "trust copy is a factual assertion, not microcopy" — an image is a
stronger assertion than copy.

⚠️ What is **not** claimed: that `alt={title}` makes this worse for screen
reader users. `alt={title}` is a pre-existing pattern on a card thumbnail and
was never an accurate description of a photograph, on any tier. The fallback
did not introduce it, and it is not reported as a defect here.

### 5.1 Debt, not a defect: a stored attribution nothing reads

Every one of the 115 pool images carries an `attribution` string ("Photo by
… on Unsplash"). [VERIFIED] `getCampaignFallback` returns it, there is exactly
one production call site (`CampaignHeroImage.tsx:57`), and it uses `.url`
only — `attribution` is read by nothing in the product.

⚠️ This is **not** asserted to be a licence violation: the Unsplash and Pexels
licences request attribution rather than requiring it, and that was **not
verified against their published terms this session** — marked [UNKNOWN].
Recorded because `ApproxMoney.tsx:12` shows the opposite case decided the other
way for the FX providers, where attribution *is* a licence requirement and is
pinned by a test precisely so it "cannot be dropped without a test failing"
(`docs/102`). If anybody concludes these pools need attribution, there is a
populated field ready and a precedent for how to pin it.

---

## 6. What was NOT checked

- The campaign **detail** page's gallery beyond the first image, and its
  images at a mobile viewport.
- `/completed-campaigns` and `/last-donor-wall` images (both routes answer 200
  and are indexable; their image delivery was not measured).
- How long the pre-hydration broken-image state is visible, and what the page
  looks like with JavaScript disabled.
- Whether the Unsplash/Pexels licences require attribution (§5.1).
- Anything requiring a POST. This walk was read-only GETs throughout; no form
  was submitted, no account created, no production row touched.
- The five never-reviewed news-pipeline campaigns and the editor-PUT one
  (`docs/116` §8, `docs/120` §2) are live and indexable on this surface. The
  owner has already reviewed that finding and elected to leave them; it is not
  reopened here.
