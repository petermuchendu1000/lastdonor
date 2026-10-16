# 49 — Hero: measured against GoFundMe, section 2 of the landing-page pass

Decided 2026-10-16. Section 2 of the top-to-bottom comparison begun in
`docs/48` (navbar). Everything below the hero is a later document.

**Method.** Both heroes driven headless at 1440×900 and 390×844, cookie
banners dismissed, with font size, line height, weight, letter-spacing
normalised to `em`, character count, and measure in `ch` read out of the DOM.
After the change, the new markup was re-rendered against the real compiled
Tailwind bundle and re-measured the same way. GoFundMe figures are
**VERIFIED, retrieved 2026-10-15/16**.

---

## 1. Measured, before and after

| Metric | GoFundMe | Before | After |
|---|---|---|---|
| H1, desktop | 82px | 56px | **64px** |
| H1, mobile | 40.3px | 36px | **40px** |
| H1 characters | 34 | 73 | **63** |
| H1 letter-spacing | −0.02em | −0.025em | −0.025em |
| H1 top, mobile | y=56 | y=332 | **y=113** |
| Subhead size | 24px desktop / 20px mobile | 18px | **20px** |
| Subhead characters | 60 | 196 | **117** |
| CTA count | 1 | 2 | 2 |
| CTA heights | 56px | **48px and 52px** | **56px and 56px** |
| CTA type size | 16px | 14px | **16px** |
| Both CTAs above fold, mobile | n/a (1 CTA) | **no** | **yes** |
| Mobile image position | after the CTA | **first, y=0** | **after the text, y=683** |

---

## 2. What was wrong

### 2.1 The brand name occupied the first line of the H1

The heading read `LastDonor / Reviewed crowdfunding with 0% platform fees and
visible impact.` The logo sits 8px above it saying the same word. That line
bought nothing and cost a line of the largest type on the site.

GoFundMe spends all 34 of its heading characters on a promise — "Where
successful fundraisers start" — and none on its own name.

**Decided:** drop `LastDonor` from the H1. 73 characters to 63, and the freed
line is what pays for the size increase to 64px desktop / 40px mobile. Mobile
is now at exact parity with their 40px.

### 2.2 The mobile hero opened on an image, not on words

The image was stacked **above** the text, taking the first 215px of an 844px
viewport. The headline did not start until y=332, and the second CTA fell
below the fold entirely. GoFundMe opens on its headline at y=56 and places
imagery after the CTA.

**Decided:** `order-2` on the mobile image, `order-1` on the text. Measured
after: headline at y=113, **both** CTAs above the fold, image at y=683.

`order` rather than moving the JSX, deliberately: the image stays early in
the DOM, so it remains the LCP candidate and its `priority` hint keeps
paying. Our LCP is currently 656ms mobile against their 1300ms (docs/47 §0)
and this change must not spend that lead.

### 2.3 The two CTAs sat on different baselines

Both used `py-3.5`, but only the outlined one had `border-2`, so it measured
52px against the filled button's 48px. Two buttons side by side, 4px apart in
height.

**Decided:** `border-2 border-transparent` on the filled button. Both are now
56px, which is also exactly GoFundMe's CTA height. Type raised 14px → 16px:
these are the page's primary actions and were the smallest button text in
either hero.

### 2.4 The subhead ran to six lines on a phone

196 characters, two sentences. The second ("Follow campaign progress, fund
releases, and impact updates from donation to outcome") is a real set of
features and is **not removed from the site** — only from the hero, where it
was pushing the CTAs past the fold.

---

## 3. Open, and deliberately not decided here

### 3.1 The hero photograph

**This is the loudest unresolved problem on the homepage and it is not a
code change.** The hero image is a close crop of a visibly distressed woman
with her hand over her mouth, occupying the right 55% of the desktop viewport.
GoFundMe's homepage imagery, measured the same day, is a person cuddling a
dog, a smiling man, a baby — its `alt` text reads "A person cuddling their
dog".

The two products are making opposite appeals: theirs that giving here works,
ours that someone here is suffering. I have **not** changed it. Choosing
photography for a real brand is an owner decision, there is no licensed
replacement asset in the repo, and the current file is referenced as
`/images/hero-bg.webp` in two places.

**Recommended:** replace with an image of relief or recovery rather than
distress. Flagging, not deciding.

### 3.2 Two CTAs versus one

GoFundMe ships exactly one hero CTA. We ship two, pointing at the two sides of
the marketplace (donate / start a campaign), which is a defensible difference
for a platform that must recruit both. Left alone, but if hero conversion is
ever measured, collapsing to one is the first thing to test.

### 3.3 One claim I could not check

GoFundMe's H1 renders at weight 175 in a variable font. Whether their
headline face is optically sized at display sizes was not established, so
our `-0.025em` tracking against their `-0.02em` is **not** evidence that
either is wrong.

---

## 4. Verification

Local pages could not be driven end to end: the app boots but every
DB-backed route times out from this sandbox (Postgres wire protocol is
blocked on 5432 and 6543 for both the pooler and the direct host; measured,
not assumed), and the homepage error boundary therefore renders a 500. The
hero is static markup, so it was verified by rendering it against the real
compiled CSS bundle and re-measuring every figure in the table above.

**Not verified:** the hero as served by production, and the trust strip's
wrapping at intermediate widths between 390px and 1024px.
