# 91 — Social placeholders in the footer, without reopening docs/76

**Date:** 2026-10-19
**Status:** Decided and deployed. Seven placeholders live; awaiting real URLs.
**Amends:** `docs/76`, which emptied `src/lib/social-links.ts` and said the
list "is not a placeholder waiting to be filled". It now holds placeholders.
This document is why that is not a reversal of the decision docs/76 made.

---

## What was asked, and the tension in it

The owner asked for social links in the footer as placeholders, with the real
URLs to follow the same day.

`docs/76` had deliberately emptied this list. The Organization JSON-LD used to
assert two profiles:

```
https://www.linkedin.com/company/lastdonor   → HTTP 404
https://x.com/lastdonororg                   → HTTP 404
```

Checked 2026-10-16, calibrated against GoFundMe's equivalents on the same
request shape, which return 200 — so the 404s were the absence of an account,
not a bot wall.

So the request, read naively, is the defect docs/76 removed.

It is not, though, if "placeholder" is given a precise meaning. The thing
docs/76 was protecting is **not** the footer. It is `sameAs`.

---

## The distinction the fix rests on

A footer link is a link. If it is dead, a visitor is mildly inconvenienced.

`sameAs` is **a machine-readable assertion that the organisation described by
this page owns the account at that URL.** A `sameAs` entry pointing at a handle
we do not control is a false ownership claim about someone else's account, made
to a search engine, by a site that asks strangers for money. That is a
different category of wrong, and it is the one docs/76 was about.

Those two can therefore be separated, and the decision here is to separate them
rather than to keep the footer empty:

| | footer | `sameAs` |
|---|---|---|
| real entry (`href: "https://…"`) | renders as a link | published |
| placeholder (`href: null`) | renders as **inert text** | **absent** |

---

## How it is enforced

`href` is typed `string | null`. A second export does the filtering once:

```ts
export const PUBLISHED_SOCIAL_LINKS: readonly (SocialLink & { href: string })[] =
  SOCIAL_LINKS.filter((link): link is SocialLink & { href: string } => link.href !== null);
```

`src/app/layout.tsx` reads `PUBLISHED_SOCIAL_LINKS`. The footer reads
`SOCIAL_LINKS` and branches on `href === null`.

Four tests in `src/lib/social-links.test.ts` pin it, two of which read the call
sites as text rather than trusting the types — because the type system stops
complaining the moment someone writes `l.href!`:

- `layout.tsx` contains `PUBLISHED_SOCIAL_LINKS.map((link) => link.href)` and
  does **not** contain any `SOCIAL_LINKS.map(`;
- `Footer.tsx` contains the `link.href === null` branch;
- a placeholder's href is `null`, never `''` or `'#'` (either would render as a
  link, and `'#'` would publish as a relative URL in `sameAs`);
- `PUBLISHED_SOCIAL_LINKS` is exactly the entries that have a URL.

The two 404 URLs from docs/76 keep their existing "cannot come back by
accident" assertions.

---

## Decisions taken, and what was rejected

### Visible and inert, rather than hidden until real

**Rejected:** build it all and render nothing in production until a URL exists.
That was the recommendation — it has zero trust cost — and the owner chose
visible instead, so the row is live now.

The cost is real and is accepted knowingly: for as long as the URLs are
missing, a donor sees a social row that does nothing, on a page asking for
money. The mitigation is that it is obviously inert rather than broken — dim
text, no hover, not focusable, and "coming soon" in the accessible name.

**Rejected outright:** links to the handles we *intend* to claim. That is
docs/76 verbatim, with the additional hazard that the handle may belong to
someone else by the time anyone checks.

### Text, not brand icons

The icon system (`docs/70`) is stroke-only: `stroke="currentColor"`,
`fill="none"`, one stroke width of 1.75, enforced by
`src/components/ui/icon/icon.test.tsx`. X, Instagram, Facebook, LinkedIn,
TikTok, YouTube and WhatsApp all publish their marks as **filled** shapes.
Pushing them through `createIcon` would mean redrawing seven trademarks as
outlines that none of their owners use.

The footer already rendered this list as text, so text is also the smaller
diff. Real brand SVGs can arrive with the real URLs as a **documented
exception** to the stroke system — a new file, not a silent `<svg>` in the
footer. The inline-SVG ratchet caps the codebase at 16 such files and only
ever ratchets down, so that exception has to be deliberate.

### Accessibility of an inert item

A placeholder is a `<span>`, not an `<a href="#">` or a disabled link:

- nothing focusable, so a keyboard user tabbing the footer does not land on
  seven items that do nothing;
- no `href`, so a crawler sees no link and there is nothing to index;
- the state is not conveyed by colour alone — the visible text is the platform
  name, and the screen-reader name is "<Platform> - coming soon" (WCAG 1.4.1).

---

## The platforms, and one that is not conventional

Chosen by the owner: X, Instagram, Facebook, LinkedIn, TikTok, YouTube,
WhatsApp.

The first four are what GoFundMe's own footer carries. **WhatsApp is the odd
one.** It is there because `SMS_DEFAULT_REGION` is `KE` (`docs/82`) and
WhatsApp is the dominant channel in that market — while the site's
`areaServed` still says `United States`. That is the same unresolved tension
docs/82 parked at one constant, now visible in a second place. Worth resolving
deliberately rather than letting the footer settle it.

---

## Filling them in

Replace `href: null` with the canonical URL. The footer link and the `sameAs`
entry both appear from that one edit.

**Load the URL in a browser first.** No test here can check that a profile
exists or that we own it — that needs the network, and a CI job that fails when
X rate-limits is a job people switch off. A nearly-right handle is exactly the
failure this file exists to prevent, and it will pass every test in the repo.

To drop a platform, delete its entry rather than leaving it `null` forever.
