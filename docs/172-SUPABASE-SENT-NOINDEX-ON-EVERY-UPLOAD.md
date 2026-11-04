# 172 — Supabase sent `noindex` on every upload

**Date:** 2026-11-04
**Status:** BUILT — see §7 for what is and is not verified
**Owner decision:** first-party path, chosen from four options, 2026-11-04

---

## 1. The question that found it

The owner asked: *"how do you ensure every image uploading in the campaign has
URL with lastdonor and which will be indexed?"*

The honest answer at the time was **we did not**. Establishing why turned up a
defect neither half of the question had predicted.

---

## 2. ⛔ The finding

**Supabase Storage stamps `X-Robots-Tag: none` on every public object**, and
`sitemap.ts` advertised organiser photos by their raw Supabase URL. So every
campaign photograph an organiser uploads was announced to Google at an address
Google is explicitly instructed not to index.

Google's own documentation defines `none` as *"Equivalent to `noindex,
nofollow`"*, names `X-Robots-Tag` as the mechanism for **image files**, and
scopes `noindex` to *"this page, media, or resource in search results"*.

### 2.1 Verified three ways, each able to give the other answer

| Method | Evidence |
|---|---|
| Live HTTP | `x-robots-tag: none` on both real uploads |
| Source | `sitemap.ts:388` advertises `resolveCampaignHero().src`; `campaign-hero.ts` returned the stored Supabase URL for an organiser photo |
| Google's spec | `none` ≡ `noindex, nofollow`, documented for image files |

With two controls proving the probe can report absence: our own
`/images/categories/*.webp` panel and `/images/explainers/*.webp` return **no**
such header.

### 2.2 ⚠️ The falsifier HELD, and it narrowed the claim

The check most likely to overturn this was *does our own image optimizer
forward the header?* If it did, the finding would be far worse — the page's
image would be `noindex` too.

It does not:

| subject | `X-Robots-Tag` |
|---|---|
| the Supabase object (what the sitemap advertised) | **`none`** |
| our panel (control) | absent |
| our explainer (control) | absent |
| **`/_next/image` proxying the same Supabase object** | **absent** |

So the **page was always fine**: `next/image` renders
`lastdonor.org/_next/image?url=…`, our domain, no noindex. Only the **sitemap**
pointed at the forbidden URL. The finding is narrower than it first looked and
is recorded that way rather than inflated.

⚠️ This is `docs/142`'s shape again — a rule on another surface silently
negating something we publish. There, robots.txt forbade the share card we
emit on 26 pages; here, the storage host forbids the image we advertise.

---

## 3. Blast radius

- **2 of 10 live campaigns** today — the only two with real organiser photos.
- **Every future campaign photo**, since the create wizard uploads through
  `/api/v1/campaign-photos` → Supabase.
- **Not** affected: share cards (`ogCardModel` renders its own JPEG from our
  domain), the 8 brand panels, the 8 explainers.

---

## 4. The fix, and why this shape

A route handler at **`/media/[...path]`** serves the object from our domain,
and `resolveCampaignHero` returns that first-party path. The sitemap needed
**no change**: it already runs the result through `absoluteImage`, so a
relative path becomes `https://lastdonor.org/media/…` on its own.

⛔ **A route handler, not a `rewrite`.** A rewrite proxies the upstream
response, and whether Next forwards an upstream `X-Robots-Tag` is not something
this fix should have to assume — **the entire defect is a header**. Here every
response header is written explicitly, so the question cannot arise.

⛔ **Outside `/api/`, deliberately.** `robots.ts` disallows `/api/` for every
agent group bar the single `/api/v1/og/` allowance (`docs/142`), so an image
served from there would be unfetchable by the crawler this exists for.

⛔ **The mapping is TOTAL over what `isOrganiserPhoto` accepts.** Heroes are
written to `campaign-photos/`, but `/api/v1/upload` takes a caller-supplied
folder and the predicate accepts any object under the public media prefix. Had
the mapping known only one folder, such a hero would pass the predicate with no
first-party path and **quietly keep the Supabase URL** — the third case that is
ruled out by construction, and pinned by a test.

⛔ **It fails toward the panel.** A key the route will not serve — traversal,
`verification-documents/`, `info-request-responses/`, no extension — resolves
to a brand panel, never to the stored URL. That preserves `docs/170`'s
direction: a real photograph may be replaced by a panel, never a stranger's
face, and now never an unservable path turned into a public URL.

⛔ **The route and the resolver share one predicate** (`isServableMediaKey`),
so a key the renderer would never mint is a key the route will not serve —
`docs/146`'s rule applied to serving.

⚠️ **No new bandwidth.** The optimizer already proxied these bytes through us;
that is precisely why row 4 of §2.2 reads *absent*.

⚠️ `NEVER_PUBLIC_KEY_PREFIXES` is **duplicated** from `supabase-storage.ts`
rather than imported, because `campaign-hero.ts` is reachable from a client
component and that module pulls in the Supabase SDK. A test asserts the two
lists are equal, the same treatment `PUBLIC_MEDIA_PREFIX` already gets against
`BUCKET_NAME`.

### 4.1 Rejected

- **Sitemap-only** (advertise the optimizer URL): smallest change, but ties the
  published URL to Next's internal `?url=&w=&q=` format.
- **Drop photos from the image sitemap**: honest, but gives up the entry for
  exactly the campaigns that have real photographs.
- **Supabase custom domain** (`cdn.lastdonor.org`): a paid add-on; whether it
  is available on this plan and whether it removes the header are both
  **[UNKNOWN]** and were not assumed.

---

## 5. ⚠️ Two tests were holding the old URL in place

`campaign-hero.test.ts`'s control asserted `hero.src === PRODUCTION_UPLOAD`,
and `CampaignHeroImage.test.tsx` asserted the same in two places. All three
were **repointed, not deleted** — the property each guards (a real photograph
is kept, not replaced by a panel) is unchanged; only the address is. This is
`docs/109`'s shape, and the third time in this codebase a test has pinned a URL
that later became wrong.

⛔ And the sitemap fixture had **no `heroImageUrl` field at all**, so no sitemap
test had ever exercised a campaign with a real photograph — which is how the
sitemap came to advertise Supabase URLs with nothing noticing. The field is now
in the fixture and one row carries a real upload.

---

## 6. Injections

| # | Mutation | Expected | Result |
|---|---|---|---|
| 1 | return the Supabase URL (**the real production state**) | FIRE | 2 failed ✅ |
| 2 | drop the private-prefix refusal | FIRE | 1 failed ✅ |
| 3 | map only `campaign-photos/` (the totality hole) | FIRE | 1 failed ✅ |
| 4 | **MUST PASS** — comment-only edit | pass | 16 passed ✅ |
| A | row 1 measured by the **sitemap** rule | FIRE | named the exact off-domain URL ✅ |

Every restore sha256-verified clean.

⚠️ The route's own guarantee cannot be read from source — it is a response
header — so `media-route.test.ts` **executes the handler** against an upstream
fixture that really does send `x-robots-tag: none`, with a control asserting
the fixture carries it (without which a route that strips nothing would pass).

---

## 7. ⚠️ The live probe found a defect the mocks could not

The unit tests passed and the route was wrong. Against the real bucket, a
**missing** object came back as:

```
HTTP/2 400
content-type: application/json
{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}
```

**HTTP 400 carrying `"statusCode":"404"`** — the status line does not mean what
it says. This is `docs/92`'s family (`success: true` observed beside
`status: "FAILED"`), and `docs/102`'s (`open.er-api.com` reporting its own
errors with HTTP 200).

My branch read `upstream.status === 404 ? 404 : 502`, written against a mock
that returned a tidy 404 — so **every deleted photo would have answered 502**.
Measured live: `502 Bad` where 404 was expected.

⛔ Fixed to `upstream.status < 500 ? 404 : 502`, and the test fixture replaced
with the **real** shape, plus a control asserting a genuine 5xx is still 502 —
without which "return 404 for anything not ok" would pass and a storage outage
would be hidden as a missing image. **A fixture the real system could never
produce is not evidence** (`docs/128` §6).

### 7.1 Verified live, after a local production build

| Probe | Result |
|---|---|
| `/media/<real key>` | **200 `image/jpeg`**, `cache-control: …immutable`, **no `X-Robots-Tag`** |
| **`/_next/image?url=%2Fmedia%2F…`** (the optimizer loopback) | **200** |
| `/media/verification-documents/passport.jpg` | **404**, never fetched |
| `/media/<missing object>` | 404 *(was 502 — §7)* |

The loopback was the one genuine design risk: `next/image` points at a
relative path, so the optimizer fetches our own route handler. It works.

## 8. UNCHECKED

- **Not deployed.** Everything above is a local production build; nothing is
  verified against lastdonor.org yet.
- Whether Google **re-crawls and indexes** the new URLs is **[UNKNOWN]** — zero
  pages are indexed today (`docs/169`), and `submitted` never meant indexed.
- The two existing Supabase URLs stay in `hero_image_url`; the mapping is
  applied at render and sitemap time, so **no backfill and no production write
  was needed**. The column is still the stored truth.
- Blog cover images, campaign-update images and avatars are also served from
  Supabase and also carry `X-Robots-Tag: none`. **Reported, not fixed**: none
  is in any sitemap today (`blog_posts` holds 0 rows, `docs/123`), so none is
  advertised anywhere. If the blog is ever enabled, its covers need the same
  treatment.
- No screen reader, and no browser render of a campaign page against a seeded
  database — the resolver output is proven by unit execution, not by sight.
