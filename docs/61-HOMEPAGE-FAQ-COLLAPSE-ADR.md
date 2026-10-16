# 61 — Homepage FAQ: seven answers nobody asked to see yet

**Date:** 2026-10-16
**Status:** Implemented
**Section pass:** homepage, section 7. Follows `docs/59` (fee band) and
`docs/60` (category grid).

---

## The measurement

After docs/59 and docs/60 shipped, the FAQ was the tallest section left:

| Section | Mobile height | Words |
|---|---|---|
| **Common Questions** | **1,598px** | **244** |
| Campaigns grid | 1,379px | 136 |
| Steps | 871px | 76 |
| Category grid | 790px | 36 |
| Fee band | 769px | 87 |

GoFundMe has **no FAQ on their homepage at all** — it lives in their help
centre. We keep ours, because the `FAQPage` schema is worth real search
surface for a young domain. The question was only how much scroll it should
cost.

---

## Cause

```jsx
<details key={faq.question} open className="group py-5">
```

Every one of the seven carried a hardcoded `open`. All answers rendered
expanded, which is where the 244 visible words and 1,598px came from.

The attribute looks like an SEO precaution. It is not one:

- **The JSON-LD is what earns the rich result.** The component already emits
  a complete `FAQPage` graph with every question and answer; that is the
  canonical source Google reads for FAQ rich results, and it is unaffected
  by the `open` attribute.
- **A closed `<details>` keeps its answer in the DOM.** Collapsing hides
  content from a person scrolling, not from a crawler parsing the markup.

So `open` cost 1,100+px of phone scroll and bought nothing.

**Marked as reasoning, not as a vendor claim:** I did not re-verify Google's
current weighting of accordion-hidden text against their documentation in
this pass. The argument above does not depend on it — the JSON-LD carries the
Q&A independently, and the answers remain in the served HTML either way.

---

## A second, unrelated defect: the markup was invalid

```jsx
<dl>
  <details>                        {/* not a permitted child of <dl> */}
    <summary><dt>…</dt></summary>  {/* <dt> is not permitted here either */}
    <dd>…</dd>
  </details>
</dl>
```

`<dl>` permits `<dt>`, `<dd>`, `<div>`, and script-supporting elements. A
`<details>` child is invalid, and a `<dt>` inside `<summary>` is invalid.
Browsers recover, but the description-list semantics a screen reader would
announce were never actually formed — the markup promised a definition list
and delivered a pile of disclosure widgets.

Replaced with a plain `<div>` wrapper, `<h3>` for the question (which also
puts the questions in the document outline) and `<p>` for the answer. The
machine-readable structure was always the JSON-LD, and it is untouched.

---

## What was decided

- **`open={i === 0}`.** The first answer stays visible so the pattern is
  legible. *Rejected: collapsing all seven* — a column of identical closed
  rows does not read as expandable to every visitor, and the first question
  ("Does LastDonor charge platform fees?") is the one most worth answering
  unprompted.
- **Kept all seven questions.** *Rejected: trimming to four and linking out.*
  The scroll cost is now in the summaries, not the answers, and each question
  is one line of schema that earns search surface.
- **Left the copy alone.** The answers are already tight; the problem was
  display, not prose.

---

## Result

| | before | after |
|---|---|---|
| Mobile height | 1,598px | **870px** (−46%) |
| Visible words | 244 | ~60 |
| Invalid HTML | `<details>` in `<dl>`, `<dt>` in `<summary>` | none |
| JSON-LD | 7 Q&A | **7 Q&A, unchanged** |

### Homepage total, across docs/59–61

| | start of pass | now | GoFundMe |
|---|---|---|---|
| Mobile | 10,631px | **~8,130px** | 7,745px |
| Desktop | 6,946px | **~5,700px** | 7,774px |

Desktop is now comfortably shorter than theirs. Mobile is within ~5% of
parity while carrying a fee ledger, a reviewed-campaign grid and a seven-item
FAQ that their homepage does not have.

The remaining mobile outlier is the **campaigns grid at 1,379px for 136
words**, which is next.

---

## Harness note: the third silent measuring failure

The first attempt to measure this section reported **3,428px** — worse than
before the change. It was not: the dev server's CSS chunk was 404ing, so the
page rendered in Times New Roman at browser defaults with an unconstrained
chevron SVG.

`docs/56` recorded two earlier instances of a comparison harness silently
measuring the wrong thing, and `docs/59` added a viewport assertion after a
third. The harness now also **asserts Tailwind is applied** before reporting
any number: it injects a `.h-5` probe and aborts with a loud message unless
it computes to exactly 20px. It caught this failure on the very next run.

Any pixel measurement in these docs that is not accompanied by a passing
viewport and CSS assertion should be distrusted.
