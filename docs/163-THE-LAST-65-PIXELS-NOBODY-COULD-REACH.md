# 163 — The last 65 pixels nobody could reach

The campaign DETAIL page at 390px, in Nairobi's timezone. `docs/151` §7 names
it outright as the page it did **not** walk:

> **Only five routes.** `/campaigns/[slug]`, the campaign donate page,
> `/blog`, `/search` and every signed-in screen were not walked at 390px.

It is the page where a donor decides, and the most-read public page carrying a
named real person's appeal.

---

## 1. The finding

`StickyMobileDonateBar.tsx:45` is `fixed inset-x-0 bottom-0 z-50 … lg:hidden`,
and **nothing reserved space for it**. A `fixed` box is out of flow, so
nothing below moves aside — and you cannot scroll past the end of a document.
So the last ~65px of every page carrying this bar were **permanently** behind
it, and because the bar is mobile-only, the phone was the only place it
mattered.

What was down there: the footer's bottom row — the copyright line, and the
**"Switch to dark mode" button**, an interactive control a donor could see and
never press.

## 2. Verified three ways, each able to give the other answer

1. **Geometry.** Scrolled to the bottom of `/campaigns/harold-jennings` on
   production: the bar at viewport y 779, height 65, `atBottom: true`,
   `bodyPaddingBottom: 0px`. Asking the browser `elementFromPoint` at each
   element's centre returned the bar for exactly two nodes — the copyright
   `<p>` and the toggle `<button>`.
2. **A real click, paired.** The same locator, same build:

   | page | fixed bar | click | theme changed |
   |---|---|---|---|
   | campaign detail (**subject**) | 65px | **BLOCKED (timeout)** | false → false |
   | `/campaigns` (control) | 0px | clicked | false → **true** |
   | `/about` (control) | 0px | clicked | true → **false** |

   No `force` — a donor's tap cannot bypass an overlay. The two controls are
   what make it discriminating: a probe that simply cannot click would have
   failed on all three.
3. **Source.** One fixed bottom overlay in the whole app
   (`StickyMobileDonateBar.tsx:45`), one render site
   (`campaigns/[slug]/client.tsx:61`), and zero `pb-*` reservations anywhere.

⚠️ **The falsifier partly held and narrowed the claim.** *Is a phone user
locked out of dark mode?* No — `Navbar.tsx:407-409` carries a second
`DarkModeToggle` inside the mobile Sheet under an "Appearance" row, which
mounts when the menu opens (`docs/143`'s trap, and why a closed-menu probe
counts one toggle, not two). So the honest statement is narrower: the footer's
control is dead on these pages, and the tail of the document is unreachable.

## 3. ⚠️ My first report was wrong, on one sample

The very first load of the page reported a **502** on one JS chunk, served as
`text/plain`, a `ChunkLoadError`, and **"Something went wrong"** — the error
boundary inside a 200 (`docs/88` F9's shape). I reported that as a live
defect. It was not.

- The chunk answers **200 `application/javascript`** on a direct probe, and
  all 12 sampled chunks are 200.
- **20/20** concurrent asset requests and **10/10** page requests: 200.
- **5/5** repeat browser loads: real `h1`, 0 bad responses, 0 console errors.
- The machine's `LAST UPDATED` was unchanged, so it had not restarted.

Cause **[UNKNOWN]**, recorded, not a finding. What I should have done is
repeat the load before reporting: one sample is Gate 3's "partial data", and I
broke that rule in the direction of alarm.

## 4. The fix

`StickyMobileDonateBar` reserves its own space, as a bottom padding on
`document.body`, measured from the bar's own box and removed on unmount.

⛔ **The height is measured, never written down.** A hardcoded `pb-20` is the
obvious fix and it is a number that drifts: the bar's height is
content-driven — the unfunded state is one line, the funded state a progress
bar plus a line — so any constant is wrong today or wrong after the next copy
change. The browser is the only thing that knows, so the browser is asked.

⛔ **It lives in the component, not on the page.** There is one render site
today; a second must not have to remember to reserve room (`docs/146`'s
one-decider rule). And the cleanup restores what it found, so a client-side
navigation to a page without the bar is untouched.

⚠️ The measurement **carries the breakpoint for free**: above `lg` the bar is
`display: none`, its height is 0, so the padding is 0. There is no second
place to keep `lg:hidden` in step — but that is a *premise*, and §5.2 records
the tripwire on it.

### 4.1 ⚠️ My first fix did not work, and the A/B is what proved it

v1 rendered an in-flow `aria-hidden` spacer **inside the component**, sized
from the same measurement. An A/B in one browser session reported:

```
spacer 65px -> coveredCount 2, toggle BLOCKED
spacer  0px -> coveredCount 2, toggle BLOCKED      <- identical
```

Identical arms mean the variable does nothing. The reason is **where the
component sits**: it renders inside the page's content column, and the
**footer is rendered after the page by the root layout**, so a spacer there
reserves room at the end of the *page* while the document still ends with the
footer. Space has to be reserved at the end of the **document**.

Had I only measured the fixed state, `coveredCount: 2` would have read as "the
defect is worse than I thought" rather than "my fix is in the wrong place".

## 5. Verified by execution, paired on one build in one session

| | AFTER (fix) | BEFORE (reservation removed) |
|---|---|---|
| `body` padding-bottom | **65px** | 0px |
| bar height | 65 | 65 |
| `scrollHeight` | 2,969 | 2,904 — **exactly 65 less** |
| elements covered | **0** | **2** |
| toggle click | **clicked** | **BLOCKED (timeout)** |

The `scrollHeight` delta equalling the bar's measured height is the arithmetic
check; the click flipping is the behavioural one. ⚠️ In the BEFORE arm the
toggle reads "Switch to **light** mode", because the AFTER arm's successful
click had already flipped the theme — itself further evidence that click
landed.

### 5.1 ⚠️ The anti-vacuity row caught my own sweep

`fixed-overlay-reserves-space.test.ts` **discovers** overlays from disk rather
than naming this file. Its first version matched
`(?:className|cn\()[^\n]*` and found **ZERO** — including the one the file is
about — because `className={cn(` and the class string sit on different
**lines** and `[^\n]*` stops at the first newline. `docs/153` §5's `[^>]*`
trap in a new costume.

The tell was not the rule: the two substantive rules **passed**, vacuously,
over an empty list. Only the anti-vacuity row failed. It now matches the class
string wherever it sits.

### 5.2 ⚠️ Two of my own rows were wrong, and the harness said so

- **Row 9 fired when it must pass.** My control asserted the literal copy
  `"Be the first to donate"`, so rewording that sentence failed the test —
  `docs/160` §5.2's trap, committed minutes after loosening a *different* rule
  for exactly that reason. The control now pins the **property**: the bar
  still links to the donate page and still states a figure.
- **Row 6 did not fire, and my EXPECTATION was wrong.** Removing `lg:hidden`
  makes the bar render on desktop, but the padding still matches it, so the
  overlap does not return — the *design* changes, not the defect. It is now a
  **premise tripwire** (`docs/148` §B.4's shape): it fails so that whoever
  changes the breakpoint re-reads the comment claiming the measurement carries
  it, rather than forbidding the change.

Also loosened before the harness ran: the measurement rule accepted only
`getBoundingClientRect().height`, which would reject an equally correct
`offsetHeight`. Row 7 is that reword, and it must pass.

**9 injections, all 9 behave**, sha-verified restore after each, every row
refusing to be scored unless its anchor matched exactly once and the file's
sha changed. Row 1 is the real production state; **row 2 is my own first,
mislocated fix**.

## 6. Gate

lint 1 pre-existing warning, typecheck clean, unit **8231 passed / 0 failed /
16 skipped** (295 files, +5 tests and +1 file), integration **329 passed / 0
failed** (35 files, unchanged).

## 7. Things checked and found NOT to be defects

Recorded so nobody re-investigates:

- **`client.tsx:38` hand-writes `` `/campaigns/${campaignSlug}/donate` ``**,
  which `docs/118` forbids in general. [VERIFIED] `page.tsx:757` gates the
  whole sidebar on `isDonatable`, which is exactly the two statuses
  `/campaigns/[slug]/donate` accepts — so it cannot render on a campaign the
  donate route would refuse. Refuted before it cost a browser pass.
- **A `__privateStripe` iframe on the M-Pesa `/donate` page.** [VERIFIED] it
  is `__privateStripeMetricsController`, `visibility: hidden`, 390×1 —
  Stripe's SDK metrics frame injected on import, not a card form. ⚠️ Worth
  knowing that Stripe's JS therefore loads on a page whose rail is M-Pesa;
  `/privacy` already discloses Stripe (`docs/152`), so it is an observation,
  not a defect.
- **`/donate`'s pay button reading "Enter an amount to continue".** My probe
  looked for "Send M-Pesa request" and reported `payBtn: false`. The label is
  amount-dependent and the copy is correct — and notably better than the
  campaign donate form `docs/151` found, which named the amount and refused.
- **No dangling "Goal is"** on the detail page: `docs/107` §8.2's fix holds,
  and the local-currency figure renders (`about Ksh 1,948,509`).
- **0px horizontal overflow** at 390px, so `docs/128` §5 / `docs/154`'s
  `.sr-only` class does not reach this page.

## 8. What was NOT checked

- **The other 7 live campaigns** were not walked individually; the bar is
  rendered from one component on one gated branch, so the finding is
  structural rather than per-campaign, but only `harold-jennings` was measured
  on production.
- **A real device.** Chromium at 390px is not a phone: no touch heuristics, no
  browser chrome, no address-bar collapse — and the last of those changes the
  visual viewport height, which is exactly the quantity this fix is about.
  Whether iOS Safari's dynamic toolbar interacts with the reservation is
  **[UNKNOWN]**.
- **No screen reader.** The spacer is gone in favour of body padding, so there
  is nothing new in the accessibility tree; that is [INFERRED] from the
  mechanism, not heard.
- **The remaining routes `docs/151` §7 named** — `/blog`, `/search` and every
  signed-in screen — are still unwalked at 390px.
- **`docs/162`'s own unchecked items** are untouched here: the dead Stripe
  credentials, and the `emailDonationReceipts === false` receipt line.
