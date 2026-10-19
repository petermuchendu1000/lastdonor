# 92 — Plain language across every public page, and a ratchet that can see the prose

**Date:** 2026-10-19
**Status:** Implemented and deployed
**Supersedes nothing. Amends:** docs/59 (the fee sentence is now scoped to US cards)

---

## The instruction

> "use a simple language anyone understands. do not complicate language. We
> need to have clarity throughout the whole system especially with the User
> facing pages. Simple english that clears any confusions, sparks debates, or
> opens up for different interpretations. Everything must be plain and crystal
> clear. headings, calculations, everything the user needs to know. Precision
> and total clarity using the least possible words wherever possible. Make sure
> every word, every sentence, every content is simple enough to be understood
> by anyone (ESL, EFL, etc)"

— owner, 2026-10-19

---

## What was measured, before anything was changed

**Verified**, by fetching the deployed pages from `https://lastdonor.org` and
scoring the visible prose (harness: `scratchpad/readability.mjs`, Flesch
Reading Ease and Flesch–Kincaid grade).

Mean reading ease across 18 public pages: **40** ("difficult"). Seventeen of
the eighteen scored below 60, which is the floor for "plain English" and the
target for an ESL/EFL audience.

The dominant cause was not vocabulary. It was keyword lists written as
sentences, for search engines rather than for people:

> "You can start a fundraiser for medical bills, surgery, emergency expenses,
> funeral costs, memorial support, disaster relief, family needs, vet bills,
> tuition, veteran support, first responder families, small businesses, events,
> or community…"

A donor deciding whether to trust us with money should not have to parse that.

### A measurement artifact, caught before it caused a rewrite

The first harness run scored `/campaigns` as a single 200-word sentence at
grade 80. That was not prose: card titles, nav labels and price chips do not
end in a full stop, so the sentence splitter had nothing to split on and
concatenated the whole grid.

Acting on that number would have meant rewriting a grid of campaign cards that
was not the problem. The splitter now requires a terminator (`.`, `!`, `?`),
rejects runs that are more than half Title Case, and bounds sentence length at
4–60 words. The agent that later rewrote `/campaigns` independently confirmed
the diagnosis: the card grid is 62% of the page's words and 1 of its 11
sentences.

**Lesson, the same one as docs/59:** measure the measuring harness.

---

## What was done

Twelve agents, one per page, rewrote the copy. Two corrections were made
centrally because they crossed every page.

### 1. The fee sentence was true in the United States only

Roughly twelve files asserted "Stripe charges 2.9% plus 30 cents" with no
scope. That is Stripe's **published US rate** (**verified**, cited in
`WhereYourMoneyGoes.tsx`, docs/59). It does not hold for a card issued
elsewhere.

Three agents independently pushed back on a draft of mine that would have made
this worse — it turned a "fees may apply" hedge into a flat assertion of the US
rate. They were right. Every occurrence now reads "on a US card", with "A card
from outside the US costs a little more." added where a full sentence fits.

This matters beyond style. Under the project's own rule — *never add a claim
the platform cannot substantiate* — an unscoped rate is a false statement to a
donor in Nairobi, and docs/82 records that `SMS_DEFAULT_REGION` defaults to KE.

**Assumed, not verified:** the exact non-US rate. We do not state one, because
we have not confirmed it and Stripe's non-US pricing varies by country and card
type. "A little more" is the strongest claim the evidence supports.

### 2. The ratchet could not see the prose it was guarding

`src/app/plain-language.ratchet.test.ts` was written alongside the rewrite.
Its first version read only the copy **fields** — `question:`, `answer:`,
`description:`, `title:` — as single-quoted literals.

Every `<p>` and `<li>` was invisible to it. The policy pages are almost
entirely `<p>` and `<li>`.

It therefore passed on the **old** `/editorial-standards` (reading ease 36)
exactly as happily as on the rewritten one (77). It was guarding nothing on the
pages that most needed guarding.

This is the second time in one day this codebase shipped a ratchet blind to its
own subject: the pool fan-out ratchet (docs/87) used `> 1` where it needed
`>= 1` and could not see helper-based fan-out. **A ratchet must be proven
against a known-bad input before it is trusted.** Both now are.

`JSX_TEXT` (`/>([^<>{}]{25,}?)</g`) now matches body text between two tags,
skipping any run containing `{`, `}` or `<` so JSX expressions and nested
elements are not scored as English. That under-reads a sentence split across an
inline `<Link>`, which is the accepted trade-off: better to miss some prose
than to score template syntax.

**Comments are stripped first.** Without that, the matcher paired a `>` inside
a JSDoc block with a `<` further down and reported **15 code comments** as
donor-facing copy on its first run. The comments in this repo are long on
purpose and must never be scored as prose shown to donors.

The JSX coverage immediately found a real violation the field matcher had
missed — "No campaigns have been rejected at this time." on
`/cancelled-campaigns` — which is the entire point of it.

### What the ratchet checks

| Check | Baseline | Rationale |
|---|---|---|
| Sentences over 25 words | **0** | Roughly where a sentence stops being one idea |
| Sentences with 5+ commas | **0** | A keyword list wearing a sentence |
| Formal word where a common one exists | **0** | "utilize"/"use" are one word to a fluent reader and two to a learner |
| Mentions the fee without stating the number | **0** | "Standard processing fees apply" is a way of not answering "how much of my $50 arrives" |

Both numeric baselines are **0** and may only shrink. The formal-word map is in
the test; each entry appeared in the measured copy.

---

## Results

**Verified** by re-measuring the deployed site after this commit.

| | Before | After |
|---|---|---|
| Mean reading ease, 18 pages | 40 | **72.9** |
| Pages below 60 | 17 | **1** |

Per page, measured after deploy:

| Page | Before | After |
|---|---|---|
| `/compare` | 53 | 85 |
| `/how-it-works` | 82 | 83 |
| `/donate` | 56 | 82 |
| `/transparency` | 43 | 82 |
| `/completed-campaigns` | 58 | 81 |
| `/about` | 41 | 80 |
| `/donor-faq` | 78 | 80 |
| `/fund-release-policy` | 38 | 77 |
| `/share-your-story` | 75 | 77 |
| `/campaign-verification-policy` | 24 | 76 |
| `/editorial-standards` | 36 | 75 |
| `/last-donor-wall` | 70 | 70 |
| `/refund-policy` | 42 | 68 |
| `/` | 65 | 65 |
| `/terms` | 47 | 65 |
| `/privacy` | 38 | 61 |
| `/campaign-rules` | 28 | 61 |
| `/campaigns` | 40 | 46 |

`/privacy` is the result worth noting: it rose from 38 to 61 **while growing
from 520 to 973 words**, because this pass added the phone, identity-document
and data-processor disclosures it had been missing. Plainer and longer, not
plainer by cutting.

### The skip list that hid the worst pages

`/privacy` and `/terms` were excluded from the ratchet by `SKIP`, on the
reasoning that legal pages need exact wording more than short sentences. When
the deployed site was measured after the first pass, they came out as the two
worst pages on it.

The exclusion was hiding four real violations, the worst a 51-word sentence
with 7 commas listing the GDPR rights. It is removed. The statutory rights are
a *list*; each right is still stated and the complaint route (ICO / national
authority) is kept, but as sentences a person can read.

This is the **third** guard in two days found blind to its own subject: the
pool fan-out ratchet (docs/87), the copy-fields-only matcher above, and now
this file's own skip list. **A guard's exclusions deserve the same scrutiny as
its checks.**

### The one still below 60

**`/campaigns` (46).** Largely the measurement artifact described above: the
card grid is 62% of the page's words and 1 of its 11 sentences, so the prose is
a small minority of what is scored. Not chased further, because the remedy
would be rewriting campaign cards that are not the problem.

---

## What was rejected

**Rewriting to hit a target score.** Flesch rewards short words and short
sentences. A refund policy optimised for it would be a list of fragments, and
a legal page that is easy to read and ambiguous is worse than one that is hard
to read and exact. The score located the problem; it did not write the
replacement. Every page was rewritten for a human reader and measured
afterwards.

**Dropping the fee arithmetic to shorten sentences.** "We take 0%. Stripe
charges 2.9% plus 30 cents on a US card. On a $50 donation that is $1.75, so
the campaign gets $48.25." is four sentences and three numbers where "fees
apply" is two words. The owner's instruction says *calculations* explicitly,
and the ratchet now fails any copy that raises fees without doing the
arithmetic.

**A single shared fee constant imported everywhere.** Tempting, and rejected:
the sentences differ by audience (a donor reads "the campaign gets", an
organiser reads "you receive"), so a shared constant would have produced one
awkward sentence used in both places. The arithmetic *is* derived from
constants on `/transparency`, where three figures appear together and could
drift against each other.

**Scoring the shared chrome.** The harness strips `<nav>` and `<footer>`, or
every page would be scored partly on the same footer and the per-page numbers
would converge on each other and mean nothing.

---

## Trade-off accepted

The ratchet is mechanical. It cannot tell good writing from bad, and it reads
only what it can match: copy fields and tag-to-tag JSX text. A sentence broken
across an inline `<Link>` is invisible to it, and so is anything built by
string concatenation at runtime.

It catches the three faults that actually made the measured pages hard. The
readability of the **rendered** pages is the real measure, and that needs the
network. This is the offline half of it, and it runs on every commit.

---

## Files

- `src/app/plain-language.ratchet.test.ts` — the guard
- `scratchpad/readability.mjs` — the live measurement harness (not committed; it
  needs the deployed site)
- 24 page and component files rewritten

## Read this before

- Changing any fee sentence (scope it, and state the number)
- Adding user-facing copy to a page under `src/app/`
- Lowering either ratchet baseline — lower it in the commit that earns it
