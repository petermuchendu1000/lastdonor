# 75 — The create-campaign wizard, screen by screen

**Date:** 2026-10-16
**Status:** Screen 1 and the shared chrome implemented. Screens 2–6 pending.
**Extends:** `docs/72` (the focus-flow chrome rule, built for the donate page
and generalised here).
**Follows:** `docs/61` (collapsed FAQ, same reasoning).

---

## Measurement

Live, 390×844, 2026-10-16. Ours at `/share-your-story`, theirs at
`/create/fundraiser` (which redirects to `/create/fundraiser/types`).

| Screen 1 | LastDonor | GoFundMe |
|---|---|---|
| Document height | **2,715px** | **844px** |
| Words | 310 | 95 |
| Headings before the answer | **3** | **1** |
| Sitewide footer | yes | none |
| Scrolling needed to reach the choice | yes | **none — one viewport** |

GoFundMe's first create screen fits a phone exactly and does not scroll.
Ours was 3.2× taller for the same two-option question.

### Every screen, before

| Step | Height | Words |
|---|---|---|
| 1 Who | 2,715px | 310 |
| 2 Goal | 2,784px | 310 |
| 3 Media | 2,770px | 321 |
| 4 Category | 3,092px | 325 |
| 5 Story | 3,298px | 361 |
| 6 Review | 3,963px | 520 |

The word count barely moves across screens because most of it was the same
text on every one.

---

## The repetition, named

Screen 1 asked its question **three times** before the two buttons that
answer it:

1. the step heading — *"Tell us who you're raising funds for"*
2. a marketing `h1` — *"Start a fundraiser on LastDonor"*, plus a 30-word
   sentence listing nine categories, **rendered on all six screens**
3. an `h2` — *"Who are you fundraising for?"*

And a fourth naming of the six screens existed in code:

```ts
const STEPS = ['Fundraiser Type', 'Set Your Goal', 'Add Media',
               'Category', 'Tell Their Story', 'Review & Submit'];
```

**Nothing rendered a single one of those strings.** Every use of the array
was `STEPS.length`. It was dead copy that had already drifted from the two
live namings — `'Category'` against the hero's *"Help us categorize your
campaign"* against whatever `h2` the step showed. Replaced with
`STEP_COUNT`.

### The heading was not a heading

The step title was a `<p>` styled at `text-4xl`. The page's actual `h1` was
the marketing line. So the largest text on the screen was not a heading, and
the heading was not what the screen was about. The step title is now the
`h1`.

It appears twice in the DOM — once in the desktop aside, once in the mobile
bar — with `hidden lg:flex` / `lg:hidden` guaranteeing exactly one renders.
That predates this change (it was two `<p>`s) and only one is ever announced.
Unifying them means restructuring a sticky 25% column and an in-flow bar into
one element; not worth it, and recorded so the duplicate is a known
trade-off rather than an oversight. The test counts **distinct** headings for
the same reason: jsdom applies no CSS, so counting elements would count a
duplicate no viewport can see.

---

## What changed

### 1. No sitewide chrome

`data-checkout` from `docs/72` is renamed **`data-focus-flow`**, since it now
covers two pages whose job is to carry one task to completion. The wizard
root carries it; the navbar and footer disappear.

A phone then has no header at all, so the wizard supplies a slim bar with
what GoFundMe's create header carries: the wordmark, and a way out. Every
field is written to `localStorage` on change, so **"Save & exit" is a plain
link** — no confirm dialog, because there is nothing to lose.

### 2. One heading per screen, and it is the question

| Before | After |
|---|---|
| "Tell us who you're raising funds for" + *"This information helps us understand the beneficiary and fundraising need."* | **"Who are you fundraising for?"** (no subtitle) |
| "Tell us how much you'd like to raise" + "You can always change your goal as your campaign progresses." | **"How much do you want to raise?"** + "You can change this later." |
| "Add media" + "Using a bright and clear photo helps people connect to your fundraiser instantly." | **"Add photos"** + "The cover photo is the first thing a donor sees." |
| "Help us categorize your campaign" + "This ensures donors who care about your cause can find you." | **"What is this fundraiser for?"** + "Donors browse by category and by place." |
| "Every story deserves to be heard" + "A compelling story helps donors connect with your cause and give generously." | **"Tell the story"** + "What happened, and what the money will do." |
| "You're almost there" + "Review your campaign and submit it for editorial review before publication." | **"Review and submit"** + "A person reads every campaign before it goes live." |

Two patterns were removed deliberately:

- **Headings about us, not the visitor.** *"Help us categorize your
  campaign"* asks the person to do the platform a favour. *"What is this
  fundraiser for?"* asks them a question about their own situation.
- **Slogans in the heading slot.** *"Every story deserves to be heard"* and
  *"You're almost there"* are encouragement, not instruction, and they
  occupy the one line that should say what to do.

**Subtitles earn their place or they are gone.** The screen-1 subtitle told
the visitor nothing they could act on; the type is now `subtitle?: string`
and `undefined` renders nothing.

### 3. The marketing header, deleted

Its job was SEO. The page's `<title>`, meta description and `FAQPage`
JSON-LD already do that job, and the `h1` it was holding has moved to the
step heading, which is a better `h1` for the page: it describes the screen.
GoFundMe's equivalent `h1` is *"Let's get started, who are you fundraising
for?"* — the question, not a product name.

### 4. The FAQ, collapsed

Four answers, 170 words, roughly 500px, expanded under an unfinished form on
every screen. Collapsed into the same `<details>` shape `docs/61` settled on
for the homepage. The JSON-LD is what earns the rich result and a closed
`<details>` keeps its answer in the DOM, so this changes what a person
scrolls past, not what a crawler reads.

**None opens by default**, unlike the homepage. There the FAQ is the section
the reader arrived at and one open answer makes the pattern legible; here it
sits below a task in progress, and an open answer is one more thing between
the visitor and Continue.

### 5. A sticky bar that was not sticking to anything

The Continue bar is `sticky bottom-0` inside the form panel. With ~1,500px
of FAQ, newsletter strip and footer below that panel, it had nowhere to
stick, so it floated **over the second option card** for the whole time the
visitor scrolled past the form — the screenshot shows "Someone else" half
covered by it. Removing the page below the panel fixes it; no change to the
bar itself.

---

## Still to do, screens 2–6

Recorded now so the pass is not declared finished early. The chrome changes
above apply to all six, but each screen's own content has not been read
against GoFundMe yet:

- **2 Goal** — compare against their goal step, which suggests a figure.
- **3 Photos** — upload copy, and the fact that an unauthenticated visitor
  defers the upload to after sign-in (deliberate, `docs/68`).
- **4 Category** — 23 categories in one flat list.
- **5 Story** — the longest screen before review; prompts and length guidance.
- **6 Review** — 520 words, the heaviest screen, and the legal checkboxes.
