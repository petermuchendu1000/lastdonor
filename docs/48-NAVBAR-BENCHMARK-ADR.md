# 48 — Navbar: measured against GoFundMe, section 1 of the landing-page pass

Decided 2026-10-15. First section of a section-by-section comparison of
`gofundme.com` against `lastdonor.org`, working top to bottom. Hero, and
everything below it, are separate documents.

**Method.** Both headers driven headless at 1440×900 and 390×844, cookie
banners dismissed, every interactive descendant enumerated with its geometry
and computed style, plus the scrolled state and the open mobile menu. Figures
below are read out of the DOM. GoFundMe figures are **VERIFIED, retrieved
2026-10-15**.

---

## 1. Measured, side by side

| Property | GoFundMe | LastDonor | Verdict |
|---|---|---|---|
| Header height, desktop | 80px | 65px | ours tighter, fine |
| Header height, mobile | 56px | 65px | theirs tighter |
| Position / z-index | `sticky`, 900 | `sticky`, 40 | equivalent |
| Background at scroll top | transparent | solid + 1px border | theirs more elegant, ours clearer |
| On scroll | turns white, `0 6px 14px rgba(35,35,35,.1)` | unchanged | theirs more polished |
| Content rail | 1152px | 1280px | taste |
| Logo | centred, SVG | left, text | ours fine |
| Skip-to-content | present | **present** | parity |
| Nav item height, desktop | 40px | **36px → 40px** | fixed |
| Mobile header controls | 4 (search, logo, bell, menu) | **2 (logo, menu) → 3** | fixed |
| Mobile menu button | 40×40 | **36×36 → 44×44** | fixed |
| Dropdowns | 3 mega-menus, 296px items with descriptions | 2 dropdowns, 420px, 2-col | comparable |

---

## 2. What was actually wrong

### 2.1 Search disappeared on mobile

Search is the **first** item in our desktop nav. On mobile it was not in the
header at all, only a row inside the hamburger. So the primary discovery
action on a donation marketplace cost two taps on the device most people
browse from, while being one tap on desktop.

GoFundMe keeps a persistent 40×40 search control in its 56px mobile header.

**Decided:** a persistent search link in the mobile header, 44×44, pointing at
`/campaigns` — the same destination as the desktop "Search" item, so the two
breakpoints cannot drift.

### 2.2 Controls below the comfortable touch minimum

The mobile hamburger was **36×36**, the smallest control in either product's
header, and desktop nav items were **36px** tall against GoFundMe's 40px.
44×44 is the Apple HIG minimum and WCAG 2.5.5 (AAA); 36px passes WCAG 2.5.8
(AA, 24px) but is mean on a phone.

**Decided:** hamburger to 44×44, desktop nav items to 40px via `py-2.5`.

---

## 3. Claims checked and found false

Recorded because they were in an earlier draft of this analysis and are
wrong.

- **"We have no skip-to-content link."** False. `SkipToContent.tsx` exists,
  renders as the first element in the body, and targets `#main-content`
  (`layout.tsx:231`, `:233`). The automated sweep missed it because `sr-only`
  elements have a zero bounding box and the probe filtered on visibility.
  **No WCAG 2.4.1 gap.**
- **"GoFundMe's header is better because it has 32 interactive items to our
  7."** Meaningless. 25 of their 32 are mega-dropdown children that are in the
  DOM but not visible until hover.

---

## 4. Deliberately not changed

- **Centred logo.** Theirs is centred, ours is left. Left-aligned suits
  left-to-right scanning and is the broader convention. No change.
- **Transparent-to-white on scroll.** Theirs is more polished. Ours is a solid
  bar with a hairline from the first pixel, which is simpler and never leaves
  nav text sitting on an unpredictable hero. Cosmetic, and a change here would
  need the hero settled first (section 2). Revisit with the hero.
- **1280px vs 1152px rail.** Taste, not a defect.
- **Mobile header height.** Ours is 65px to their 56px, but the extra room is
  what lets the controls be 44px. Keeping the height.
- **A Donate CTA in the mobile header.** Considered and rejected for now: a
  third control crowds a 390px bar, and campaign pages already carry a fixed
  bottom donate bar. Worth revisiting once the hero pass settles how the
  homepage drives to `/donate`.

---

## 5. Not verified

The scroll-elevation and dropdown-hover behaviours were captured at one
viewport each and not tested with a keyboard. **Keyboard traversal of the two
dropdowns and the mobile sheet has not been checked in this pass** and is
owed before the landing-page work is called finished.
