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

⚠️ **§9 below produces a tempting explanation for this, and it does not
fit.** §9 is a chunk failing across a split deployment — but that is a **404**,
and this was a **502 served as `text/plain`**; and at 09:15 production had a
single machine on v167, so there was no split to land in. Two symptoms of the
same shape are not the same cause. It stays [UNKNOWN].

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

---

## 9. ⛔ The deploy landed as a partial rollout, and a split deployment BREAKS loads

Shipped as **v169**. `flyctl releases` read `v169 complete`, the deploy script
reported `deploy finished in 390s`, the sitemap report read 8 campaign URLs,
and the machine it created was 1/1 passing. All of that was true and the
rollout was still wrong.

### 9.1 Three `app` machines, one on the old version

[VERIFIED three ways, each able to give the other answer]

| method | result |
|---|---|
| `flyctl status` machine table, read twice | `83779ef7797d48` **v168**, `84705df2700598` v169, `918577533c24d8` v169 — all `started`, all 1/1 passing |
| 20 HTML loads of `/campaigns/harold-jennings`, page-chunk hash | **two** distinct hashes: `ce060f4d…` ×11, `6b447671…` ×9 |
| fetch each chunk and read its contents | `6b447671…` contains `paddingBottom` **and** `getBoundingClientRect` (this doc's fix, +479 bytes); `ce060f4d…` contains **neither** |

The third method is what makes the second one evidence rather than a
coincidence of two builds: it identifies which hash is which version from the
code itself.

### 9.2 The cause is in the deploy's own log

```
This deployment will:
 * create 2 "app" machines
> Launching new machine
No machines in group app, launching a new machine
> Machine 84705df2700598 [app] was created
Creating a second machine for high availability and zero downtime deployments.
✔ Machine 918577533c24d8 [app] was created
```

**`No machines in group app`** — against an app with a healthy, passing
machine. This is CLAUDE.md's existing warning (`docs/159` §7.2: *"`flyctl
machine list` can answer 'No machines are available on this app' while a
machine is running and healthy"*) escalating from a confusing readout to the
**cause of an outage**: flyctl could not see the v168 machine, so it created
new ones instead of updating it, and nothing then destroyed the one it had
missed. ⚠️ Not configuration: deploy v168 an hour earlier, same `fly.toml`,
read `Updating machine config for 83779ef7797d48`.

Fly then added a second machine on its own ("for high availability"), which is
why there were three rather than two.

### 9.3 ⛔ The consequence is a broken page, not stale HTML

`docs/161` §7.2 described a split as traffic *"load-balanced across two
versions"*, which reads as a version skew. It is worse than that. A Next chunk
filename is **content-addressed**, so each version's assets do not exist on the
other version's machines. Measured, 24 requests each:

```
page-ce060f4dd483615c.js  (v168)   200=7   404=17
page-6b4476712b0d2bd9.js  (v169)   200=17  404=7
```

So whenever a browser's HTML and its chunks land on different versions, the
chunk 404s and hydration dies. In the browser at 390px: **5 of 9 loads found
no fixed bar at all** — the client component never mounted. Two consecutive
loads of one URL, screenshotted, showed the donate bar present and then absent.

**The cheap check needs no Fly access**: fetch one page ~20 times, count
distinct `page-<hash>.js` values. One is clean; two is a split.

### 9.4 Resolved, and verified with controls

⛔ **Gate 8.** Destroying a live `app` machine is the action CLAUDE.md names as
owner-only. Put to the owner with the measurements and the options; the owner
chose **back to one machine** — the stale v168 *and* the duplicate v169 — over
keeping Fly's HA pair, because [per CLAUDE.md's own convention list and
`docs/26` §5] **ISR here has no shared cache handler** (26 pages export
`revalidate`, 36 files call `revalidatePath`/`revalidateTag`), so two instances
serve stale HTML silently, and two machines reopen this chunk-404 window on
every future rolling deploy. The id and VERSION table was re-read immediately
before each `destroy`.

After: **one `app` machine, `84705df2700598`, v169, 1/1 passing, 0 orphaned
release machines.**

| check | result | control |
|---|---|---|
| distinct page-chunk hashes over 20 HTML loads | **1** (`6b447671…`, the fix) | was 2 |
| v169 chunk availability | **200 × 12** | v168 chunk **0 × 12** — the probe can still give the other answer |
| `body` padding-bottom / covered elements, 6 browser loads | **65px / 0**, six times, no `noBar` | v168 baseline was `0px` / **2** |
| real click on the footer's dark-mode toggle | **clicked**, bar still 65px | `/campaigns` and `/about` (no bar) still `clicked` |
| `/`, `/campaigns`, `/donate`, `/api/v1/live`, the campaign page | all **200** | — |
| sitemap campaign URLs, two consecutive reads | **8 / 8** | — |

⚠️ One detail worth keeping: the bar is still 65px tall and still present on
the subject page. The click succeeding is the overlap going away, not the bar
going away — a fix that had merely hidden the bar would score the same on the
click and fail that column.

### 9.5 What §9 did NOT check

- **Whether the two v169 machines ever disagreed with each other.** They ran
  the same image, so the chunk hashes matched and no measurement could separate
  them; the ISR-cache risk `docs/26` §5 names is [INFERRED] from that doc, not
  observed here.
- **Why flyctl went blind.** The failure is now seen twice in one day with two
  different consequences, and the mechanism is **[UNKNOWN]** — no API error was
  surfaced in either log.
- **Whether earlier deploys left the same split.** Nothing recorded the machine
  count for v163-v166, and `docs/161` §7.2 already says the same about v164-v166.
