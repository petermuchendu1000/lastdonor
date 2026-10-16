# 76 — The goal screen, and social links the site did not have

**Date:** 2026-10-16
**Status:** Implemented
**Continues:** `docs/75` (screen-by-screen pass on the create wizard).
**Relevant rule:** CLAUDE.md, *"Never add a claim the platform cannot
substantiate."*

---

## Screen 2 of the create wizard made two promises it did not keep

The brief was to trim text. The text was the smaller problem.

### 1. A toggle that did nothing, defaulted on, badged "Recommended"

```
  [Recommended]
  Automated goal setting
  To help build momentum, we'll gradually adjust your goal as donations
  come in.                                                    [ ●——]  ON

  ✓ Your starting goal would be: $600
```

Enter $25,000 and the screen stated the campaign would open at **$600** and
climb. Traced end to end:

| | |
|---|---|
| `autoGoal` in the `POST /api/v1/user-campaigns` body | **absent** |
| What is sent | `goalAmount: <the full typed figure>` |
| Column storing a starting goal | **none** in `schema.ts` |
| Job that raises a goal over time | **none** — all 9 in `cron-schedule.ts` checked |
| Uses of `computeStartingGoal` outside this UI and its own tests | **none** |

So the organiser was told their page would open at $600 and ramp. It opened
at $25,000 and never ramped. The toggle was theatre, and it was **on by
default** with a green "Recommended" badge, on a page about other people's
money.

**Removed, not reworded.** Softening the sentence would leave a control that
still does nothing. Building the feature instead is a real piece of work —
a published goal distinct from the target, a job that raises it, and a
decision about what donors see while it ramps, which is `docs/33` territory
— and it is an owner's call, not a side effect of a copy pass.

`src/lib/compute-starting-goal.ts` survives, because its anchor table (log10
interpolation, $100 → $100 up to a $2,600 cap, matched to GoFundMe's) is
researched work worth keeping. It now opens with a **⛔ NOT WIRED** banner
naming what has to exist before it is rendered again.

### 2. A statistic the platform cannot compute

> <u>Fundraisers like yours</u> typically aim to raise **$5,000**

`$5,000` was a hardcoded string. It was not derived from the category, the
location, or anything else — and it could not have been: **zero real
fundraisers and zero donations** exist (`docs/72`), so there is no
"fundraisers like yours" to average. This is the same class of defect
`docs/67` removed five of from outgoing email.

"Fundraisers like yours" was also underlined with `cursor-pointer` and was
not a link — one of two fake links on the screen; "More details" on the
toggle was the other. Both gone with the copy they sat in.

Replaced with something true and more useful than a fake average:

> Ask for what the need actually costs. A reviewer checks the goal against
> your story and documents before the campaign goes live.

Substantiated by the campaign-verification policy, which lists a *"realistic
fundraising goal"* among what reviewers check.

### Result

Screen 2 keeps the amount input and one line of guidance. Everything removed
was either inert or false.

---

## Social links: the two the site already claimed do not exist

The brief was to add social links to the footer, with handles to follow. The
first thing to check was what the site already asserted.

`src/app/layout.tsx` published, in the Organization JSON-LD:

```json
"sameAs": [
  "https://www.linkedin.com/company/lastdonor",
  "https://x.com/lastdonororg"
]
```

Both **404**, checked 2026-10-16.

**The check was calibrated before being believed**, because a 404 from a
social host can mean "bot wall" as easily as "no account". Same request
shape, same user agent, same moment:

| URL | Status |
|---|---|
| `linkedin.com/company/gofundme` | **200** |
| `x.com/gofundme` | **200** |
| `linkedin.com/company/lastdonor` | **404** |
| `x.com/lastdonororg` | **404** |

The method distinguishes an existing account from a missing one, so the
404s mean the accounts do not exist.

The comment immediately above that array reads:

> *Keep the entity graph factual and conservative. Donation/YMYL pages lose
> trust quickly when schema asserts authority that the visible site cannot
> prove.*

It was right, and the array under it did the opposite. `sameAs` is not
decoration: it is how a search engine resolves *this account is this
organisation*, so a wrong entry is a claim about a handle that may belong to
somebody else.

### What was built

One list, `src/lib/social-links.ts`, with **two consumers**:

- `Footer` renders a row of links, and renders **nothing** while the list is
  empty;
- the Organization JSON-LD maps it to `sameAs`, and **omits the key
  entirely** while the list is empty — `sameAs: []` is a claim about
  nothing, and absent is the honest encoding of "none yet".

Adding a profile tomorrow is one entry in one file and both places update.
The module says, where whoever adds it will read it, that an `href` is a
public claim of ownership and the URL should be loaded before it is added.

Icons were deliberately not drawn yet: which platforms exist is not known,
and six brand glyphs for accounts that may never be created is the same
mistake in a different medium. Text links are honest and work; icons can
follow `docs/70`'s process once the networks are named.

### Tests

Offline properties only — a CI job that fails when X rate-limits is a job
people switch off. Each entry must be an `https` URL that parses, with a
visible name, one per host and one per URL; and the two 404 profiles are
asserted **absent by exact URL**, so they cannot return by copy-paste.
