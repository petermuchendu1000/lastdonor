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
