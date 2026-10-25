# 112 — The public share row, and why contact syncing is not built

**Date:** 2026-10-25
**Status:** Share row DONE. Contact sync / SMS invites **⛔ NOT BUILT — owner
decision required** (see §4).
**Follows:** `docs/57` (share tokens), `docs/58` (the impact dashboard),
`docs/82`/`docs/84`/`docs/85`/`docs/86` (phone, SMS provider, verification),
`docs/92` (the KES rail), `docs/41` (consent and CAN-SPAM).

---

## 1. What was asked

> Deep Social API Integration & Contact Syncing: […] one-click integrations
> that don't just share a link, but natively format the crisis story for
> WhatsApp groups, Facebook feeds, and TikTok bios. Features like "Sync
> Contacts to invite donors via SMS" drastically increase the velocity of a
> campaign's early hours.

Three separable things. One was a real, cheap gap and is now closed. One
needs nothing built. One cannot be built today and should not be built
without a policy decision.

---

## 2. The finding: four share surfaces, and the weakest one is the only one
## most visitors ever see

A correction first, because the obvious claim is wrong: **WhatsApp sharing
already existed.** It was on three surfaces. [VERIFIED 2026-10-25 by reading
each]

| Surface | WhatsApp | Attributed `/s/<token>` | Pre-filled copy |
|---|---|---|---|
| Post-donation panel (`DonationForm.tsx:301-325`) | yes | **yes** (`attributedShareUrl`, `:215`) | yes (`:222`) |
| Congratulations screen (`congratulations/client.tsx:29-45`) | yes | n/a (passed in) | yes |
| Sidebar Share (`SidebarShareButton.tsx`) | native sheet | **yes**, minted on click | n/a |
| **Public share row (`ShareButtons.tsx`, at `page.tsx:583`)** | **no** | **no** | **no** |

The three good surfaces are all **post-donation or organiser-only**. The one
weak surface is the row under the campaign story — the only share control a
visitor sees *before* giving, which is to say the only one the people who
have not yet converted will ever touch.

Two aggravating details, both verified:

- **On a non-donatable campaign it is the only share control on the page.**
  `CampaignSidebarClient` — which carries the attributed Share button —
  renders only when `isDonatable` (`page.tsx:600`). On a `completed`,
  `paused`, `suspended` or `cancelled` page there is no other.
- **The copy was thinner than it looked.** Facebook got no text at all, X got
  the bare title (`ShareButtons.tsx:50` as it stood), and the mail body was
  the URL with nothing around it (`:63`).

This is the `docs/83`/`docs/109` shape once more: nothing failed. `docs/58`
fixed the sidebar button, correctly, and the sibling component three hundred
lines away kept handing out an uncountable URL. **Neither share component had
a single test before this change**, which is how it stayed invisible.

### 2.1 What changed

- WhatsApp added to the row, first position. The platform's one working
  payment rail is M-Pesa in Kenya (`docs/92`), where WhatsApp is how a link
  actually travels — so the absent channel was the one that mattered most on
  the surface that mattered most.
- One share sentence, carried by every channel that accepts text (WhatsApp, X,
  mail). It asks rather than announces: a public post reaches everyone and
  asks no one.
- Copy-link is now **attributed** for a signed-in sharer, so a share from this
  row finally reaches `/dashboard/impact`.
- The mint moved to `src/lib/attributed-share.ts` and both components call it.
  Copying those twenty lines into a second component is how `docs/110` ended
  up with seven divergent ideas of one status map.

### 2.2 ⚠️ The social links are deliberately NOT attributed

This is a recorded trade-off, not an oversight, and it is the part most likely
to be "fixed" by someone later.

Closing the gap on the Facebook / X links needs one of exactly two things:

1. **Mint before the click**, so the `href` is already attributed at render.
   `docs/58` rejected precisely this: a mint is a write, so it would credit a
   share to every campaign a signed-in person merely scrolled past, and
   "Campaigns shared: 47" would be counting pages nobody shared.
2. **Open the intent from script after the await** — which requires holding a
   `window.open('', '_blank')` handle across the mint. **That handle is `null`
   when `noopener` is passed.** Keeping it means dropping `rel="noopener"` and
   handing facebook.com a `window.opener` onto the campaign page.

Attribution is a growth metric. Reverse-tabnabbing is a security property.
The links stay plain and safe, and the attributed path is the one that needs
no popup. A test asserts `noopener` on all three external links **because the
pressure to remove it comes from trying to improve this very file.**

### 2.3 TikTok needs nothing built

TikTok has no web share intent — a "TikTok bio" link is a URL a person pastes
into their profile by hand. The affordance that serves it is copy-link, which
exists and is now attributed. There is no integration to write.

---

## 3. Verified, and how

- 12 new tests in `src/components/campaign/ShareButtons.test.tsx`, covering
  reach (every channel, and what each carries), the `noopener` property, and
  the full attribution matrix: signed-in, anonymous, no campaign (the blog),
  mint refused, mint timed out, second copy, clipboard failure.
- **Mutation-proven, 6 mutants, 6 killed, 0 survivors:** removing the
  WhatsApp link, reverting copy-link to the plain URL, dropping `noopener`,
  deleting the minted cache, minting for anonymous viewers, and sending X a
  bare title. Each was injected, the suite run, and the original restored.
- Full gate: lint 0 errors, typecheck clean, **unit 7173 passed / 16 skipped,
  231 files** (was 7161 / 230).
- **Browser, production build, both widths** (`docs/63`: our CSP blocks
  `unsafe-eval` in `next dev`, so a dev-server check proves nothing about
  hydration). All five controls visible, WhatsApp carrying both the sentence
  and the link, `rel="noopener noreferrer"` intact, `scrollWidth ===
  clientWidth` at **393px** (the row measures **260.6 x 36**), copy-link
  wrote the clipboard - which is the hydration proof, since an unhydrated
  button writes nothing - and **zero console errors** on both legs.

---

## 4. ⛔ Contact syncing and SMS invites — NOT BUILT, and why

This is the half that cannot be delivered, and the reasons are of two kinds.
The first is mechanical and settles it on its own.

### 4.1 There is no SMS app to send from [VERIFIED]

`docs/86` records it: the Africa's Talking app this platform has is
**`elopis` — another product's**. Its delivery-report callback points at
`elopis.com`. Callbacks, the sender ID and the opt-out list are all **one per
app**, so there is no configuration in which both products work. The live key
generated to escape this answers `401` to every probe. Production runs on
**sandbox credentials**, and `docs/85` says the UI tells the user so.

And `sendSms` has exactly **one caller** in the whole codebase —
`src/lib/phone-verification.ts:171`, the six-digit verification code.
[VERIFIED by search] Nothing else has ever sent an SMS from this platform.

So "invite donors via SMS" would be built on a provider path that cannot
send, which is the thing `docs/76`, `docs/77` and `docs/81` are each about.

### 4.2 The consent question is not ours to answer

Even with our own app, this feature sends messages to **people who are not
users and have never heard of this platform**. That runs straight into
decisions this codebase has already made deliberately:

- `docs/85`: **verifying a number is not consent to message it.** That
  distinction was built into the schema as two separate timestamps
  (`phone_verified_at`, `sms_consent_at`). Contact-sync invites would be
  messaging numbers with *neither*.
- `docs/92`: per-**phone** abuse limiting exists in the database because an
  attacker spamming a stranger's number gets **that bystander** blocked by
  PayHero for 24 hours, and an IP limit cannot stop it. A contact-sync feature
  is that same mechanism with a friendly name.
- `docs/41`: mail consent and CAN-SPAM were handled with care. Silently
  coupling two products' consent states was refused in `docs/86` as "not a
  trade this codebase makes"; messaging a third party who never opted in is a
  larger version of the same refusal.

Uploading an address book is also a **bulk transfer of other people's
personal data** to this platform. Whether that is acceptable, under Kenya's
Data Protection Act 2019 and GDPR, and on what legal basis, is a policy and
legal call — **not an engineering one.** Per Gate 8 it is reported, not
decided.

### 4.3 One more constraint worth knowing before anyone says yes

The browser Contact Picker API is, to my knowledge, **Chrome-on-Android
only**, with no Safari/iOS support. [INFERRED — from training, NOT verified
in this session. Check `caniuse.com/contact-picker` and MDN before
committing.] If that holds, "sync contacts" is unavailable to every iPhone
organiser, and the alternative — asking people to upload a contacts export —
is both worse and a larger data transfer.

### 4.4 What could be built instead, with no new consent surface

Recorded, not taken, because it is still the owner's call which direction to
go:

- The organiser sends the invitations **from their own phone**, via the
  existing `wa.me` and `sms:` URL schemes, with our copy pre-filled. The
  message comes from someone the recipient knows, no address book reaches our
  servers, and no consent question arises — because we never send anything.
  This is also the advice the product already gives in email
  (`email-adaptive.ts:587`: "A personal text or WhatsApp message is more
  effective than any social media post").
- `docs/111`'s collaborators already multiply reach without any of this: each
  helper gets their own attributed link, and `/dashboard/impact` shows what
  each one brought in.

---

## 5. Also found: a latent money-rendering defect in the share preview

The OG and Twitter descriptions — the text WhatsApp and Facebook actually
show — build their money figures with `centsToDollars`
(`page.tsx:161`, `:196`, `:330`), which **hardcodes `'USD'`**
(`src/lib/utils/currency.ts:24`), while `raisedAmount` is in the minor units
of its own row's currency (`docs/92`). `publicCampaignSelect` already carries
`currency` (`src/db/public-select.ts:38`), so the information is there and
ignored.

**Severity, with the falsification run.** My first query counted only the
three *indexable* statuses and would have let me call this harmless;
`getCampaign` also serves `paused`, `suspended` and `cancelled`, so I asked
for every non-USD campaign instead:

```
[{"slug":"zz-payments-test-mpesa-gateway","status":"archived","currency":"KES",
  "raised_amount":10000,"goal_amount":100000,"donor_count":2}]
```

`archived` is **not** in `getCampaign`'s served list. So this is **latent**:
21 USD campaigns, one KES row that cannot render. It becomes a shilling figure
behind a dollar sign in every share preview the first time a KES campaign goes
live. **Not fixed here** — it is a separate change across three call sites
(and `donate/page.tsx:61` has the same shape), and widening this one would
have buried it.

---

## 6. UNCHECKED

- **The attributed path was not exercised in a browser while signed in.**
  `docs/99` records that there is no signed-in E2E fixture. The mint is
  covered by unit tests and six killed mutants, and the code path is the same
  one `docs/58` verified for `SidebarShareButton`. The browser run below
  covers the anonymous path only.
- The Contact Picker browser-support claim in §4.3 is `[INFERRED]`.
- Whether a WhatsApp or Facebook crawler renders our OG card well was not
  measured; only that the markup is produced.
- Nothing in §5 was fixed, by choice.

---

## 7. The card itself: what a shared link looks like

Added 2026-10-25, after the share row. The request was for "a complete well
designed card that has as much relevant info as possible", and measuring the
current one first turned up defects rather than taste questions.

Everything here was **observed against production**, not reasoned about. The
live `og:` tags were read from `/campaigns/mila-ostrowski` and the card images
fetched from `/api/v1/og/campaign/<slug>`.

### 7.1 ⛔ The card was an HTTP 502 for 2 of 14 live campaigns

| Campaign | hero | card |
|---|---|---|
| `harold-jennings` | `/images/categories/veterans-default.svg` | **502** |
| `david-l-jones` | `/images/categories/veterans-default.svg` | **502** |
| `mila-ostrowski` | absolute `.jpg` | 200 |
| `tuan-nguyen` | absolute unsplash | 200 |
| `help-john-recover-...` | absolute | 200 |

An exact correlation: both relative-SVG heroes fail, all three absolute
controls pass. Satori needs an absolute URL and cannot decode SVG, and
`ImageResponse` does not fail gracefully - it throws mid-stream (`failed to
pipe response`). Those two campaigns had **no share image at all**; every
platform fell back to a text-only card.

### 7.2 ⚠️ The fix for that was itself a half-fix, and rendering it found out

The first version blocked `.svg` alone - the format that happened to break.
Rendering the card locally immediately produced
`Unsupported image type: image/webp` from a fixture hero, and
`src/lib/supabase-storage.ts:149` **accepts `image/webp` and `image/avif` on
upload**, so an organiser's own photograph could have restored the 502.

A blocklist can only ever hold the formats somebody has already been burned
by. The extension cannot settle it either: production stores Unsplash URLs
with **no extension at all**. So `probeHeroSrc` makes one HEAD request and
accepts only `image/jpeg`, `image/png`, `image/gif`. Anything else - wrong
type, 404, timeout, unreachable - returns null and renders a designed panel.
**A card without a photograph is a small loss; a card that is a 502 is no
card.**

The lesson is the Gate 4 one: my mutation tests all passed because they
encoded my own blocklist assumption. The webp case could not have failed
them, because I never asked about webp. Rendering the thing is what asked.

### 7.3 The other five defects

1. **"$0.00 raised · 0 donors"** printed on every card. Every live campaign
   has raised nothing (`docs/72`), so the most discouraging fact about a
   campaign was the headline of every share of it. Now the product's own
   zero state, "Be the first to donate" (`docs/71`), and the goal.
2. **USD hardcoded.** `centsToDollars` formats as dollars whatever the row's
   currency is (`docs/92`). Latent - the one KES campaign is `archived` -
   and it would have become shillings behind a dollar sign the day a KES
   campaign went live.
3. **Cents on round goals**: "$0.00 of $35,000.00".
4. **The title printed twice.** `og:description` began with the title
   verbatim, and every platform renders `og:title` as a heading with the
   description directly beneath, clamped to one or two lines - so WhatsApp
   and Facebook showed the headline, then the headline again in grey,
   truncated before it said anything new.
5. **`twitter:description` was "0% funded. $0.00 raised."** - two zeros, and
   X does not display a description on `summary_large_image` at all.

Also absent entirely: `og:site_name`, `og:url`, the category, the location,
and the review guarantee - the one claim `docs/78`/`docs/79` support without
qualification and the platform's actual differentiator.

### 7.4 The design, and why the photo is on the left

X draws its own copy of `og:title` in a black badge over the **bottom left**
of the image. The old card put its title there too, so on X the title was
printed on top of itself. The photo now occupies the left 456px and the text
the right 744px, so X's badge lands on the photograph.

The right panel carries, in order: the wordmark, `Category · Location`, the
title (clamped to three lines), the amount raised or the zero-state ask, the
goal and donor count, a progress bar coloured by phase, and the review
guarantee. Urgency is named **only** for `closing_in` and `last_donor_zone` -
"First Believers" tells a cold reader nothing.

Type sizes were raised once after looking at the result shrunk into a
WhatsApp bubble, where the smallest line had been sub-pixel.

### 7.5 ⚠️ Two Satori traps, both found by rendering

- **A glyph outside the supplied fonts makes Satori hit the network.** The
  check character is not in DM Sans and the render logged
  `Failed to load dynamic font for ✓ ... Status: 400`. `docs/95` already says
  Satori has no system fonts; this is the same rule for a single character.
  The emphasis is now a **border**, which needs no font.
- **Drawing it as inline SVG instead is blocked by our own ratchet.**
  `src/components/ui/icon/icon.test.tsx` ratchets the count of files that
  hand-roll SVG downward (`docs/70`) and this would have been the 17th. The
  icon components cannot be used either - they size by `className` and rely
  on `vectorEffect`, neither of which Satori honours. ⚠️ That ratchet matches
  **raw text**, so even naming the tag inside a comment trips it.
- Line clamping needs `display: '-webkit-box'`; with `display: 'flex'`,
  `WebkitLineClamp` is silently ignored and a long title overflows the card.

### 7.6 Verified

- 19 tests in `og-card-model.test.ts`, 10 in `campaign-share-copy.test.ts`.
- **10 mutants injected, 10 killed**: SVG guard removed, relative paths
  rejected, zero state printing zero again, USD hardcoded, progress cap
  removed, zero-goal divide reinstated, urgency on every phase, description
  leading with the title, zero state reporting 0%, donor clause claiming zero.
- Rendered in a local production build across four states - photo + funded,
  long title + 95% + Last Donor Zone, zero-raised with an unusable hero, and
  a webp hero. **All four HTTP 200, no server errors**, where two of those
  shapes are 502 in production today.
- Full gate: lint 0 errors, typecheck clean, unit **7202 passed / 16 skipped,
  233 files**.

### 7.6a ⚠️ A measurement error worth recording

Three renders in a row were taken from a **stale server process**. `next
start` had failed with `EADDRINUSE` because the previous instance was still
bound to the port - the `pkill` meant to stop it kept matching and killing
its own shell instead (exit 144), which looked like success. The new process
died instantly, the old one kept serving, and every "after" screenshot was
the build from twenty minutes earlier.

What exposed it was not suspicion but arithmetic: the PNG came back
**byte-identical** across a change that removed an inline graphic. Source,
built chunk and response headers were all checked before the running process
was - the last place looked at, and the only one that was wrong.

The Gate 5 rule says measure only a quiescent system; the gap is that a
*stale* system looks perfectly quiescent. **Confirm the thing under test is
the thing running** - check the listening PID's start time, or that the
output changed at all.

### 7.7 UNCHECKED

- Not deployed. The production cards still show the old design and the two
  502s until this ships.
- The card was not submitted to Facebook's Sharing Debugger, X's Card
  Validator or LinkedIn's Post Inspector - the platform previews in this work
  are **reconstructions** built from the real tags and the real image, not
  captures from the platforms themselves.
- `donate/page.tsx:61` still builds its own description with
  `centsToDollars`; it was left alone rather than widening this change.
- The HEAD probe adds one request per uncached card render. The card is
  cached 24h (`s-maxage=86400`), so this was accepted without measurement.
