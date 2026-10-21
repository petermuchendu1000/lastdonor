# 94 — Plain language for every outgoing email

**Date:** 2026-10-21
**Trigger:** owner instruction — *"make the emails look professional and
sentences and word to be very clear to anybody even someone who dropped out
of highschool - you must consider ESL. Be clear, precise, and to the point."*

Supersedes the copy half of `docs/93`, which fixed one template by hand. This
does all 45, measures the result, and locks it.

---

## 1. The audience, stated once

A person who may have left school early. A person reading in a second
language. Someone deciding whether to trust us with money, or acting on a
deadline that costs them their funds if they miss it.

The cost of a sentence that has to be read twice is not evenly shared. The
reader least able to afford a mistake is the one most likely to make it.

---

## 2. Why a number, not a style guide

Every one of the 45 templates was written by somebody trying to be clear.
Measured, **20 of them exceeded the budget**, the worst at **grade 15.5** —
a postgraduate reading level — on an email telling someone we could not
check their ID. Good intentions produced that. Only a measurement catches
it, and only a ratchet keeps it caught.

### The budget

| Axis | Limit | Why |
|---|---|---|
| Flesch-Kincaid grade | **≤ 8** | Where plain-language guidance puts general-audience material, and where most second-language readers stop re-reading. |
| Longest sentence | **≤ 20 words** | The single biggest barrier, and the one an author controls directly. |
| Jargon | **zero** | From a house glossary that names the plain replacement. |

### Result

| | Before | After |
|---|---|---|
| Templates over budget | **20 of 45** | **0 of 45** |
| Average grade | 6.1 | **2.9** |
| Worst template | 15.5 | **7.7** |

Biggest individual drops, all **verified** by measurement:

| Template | Before | After |
|---|---|---|
| `identityApprovedEmail` | 15.5 | 3.8 |
| `identityDeclinedEmail` | 15.1 | 2.8 |
| `identityResubmissionEmail` | 14.3 | 4.1 |
| `verificationDocumentsAdminEmail` | 11.7 | 4.4 |
| `verificationApprovedCreatorEmail` | 10.6 | 2.9 |
| `verificationRejectedCreatorEmail` | 10.1 | 4.3 |

The pattern is not a coincidence: **the verification family was the worst
prose in the product**, and it is the family that talks to people about
their identity documents and their money. Grade 15 on *"the identity
verification for your campaign requires resubmission"*.

---

## 3. Measure the measuring harness — twice

Both bugs below produced confident, wrong numbers. Recording them because a
harness that under-reports is worse than no harness: it issues a clean bill
of health.

**Bug 1: headings ran into the paragraph below.** A heading carries no
terminal punctuation, so stripping tags naively joined it to the next
paragraph and reported one long sentence where a reader sees two short
ones. It flagged **32 templates that were fine**. Fixed by turning block
ends into full stops *before* stripping tags.

**Bug 2: template literals were read as source.** The extractor used
`getText()`, which returns `${...}` and everything in it, and a regex strip
cannot handle a nested interpolation such as `${ctaButton(`${BASE_URL}/x`,
'Go')}`. The leftovers (`'#D97706', '#fffbeb' )}`) were then counted as
prose, inventing 21-word "sentences" no reader will ever see. Fixed by
walking the AST's **text spans**.

Honest consequence: the first numbers reported for this work — "39 of 45
failing, average 9.2, worst 19.3" — were measured with the broken harness
and are **wrong**. The corrected baseline is the 20 / 6.1 / 15.5 above. Same
lesson as `docs/59`.

The harness is now itself under test
(`src/lib/email-plain-language.ratchet.test.ts`, second describe block):
headings must not merge, long sentences must score worse than short ones,
jargon must be detected, markup and colours must not be scored as words.

---

## 4. A security bug introduced and caught mid-change

Explicit preheaders were added so the inbox preview line could carry new
information instead of echoing the subject. The natural way to write one is:

```ts
wrap(body, `We got your gift to ${p.campaignTitle}.`)
```

That interpolates **raw, attacker-controlled text** into the markup. The
shell wrote `${preheader}` unescaped, so a campaign titled with an
`<img onerror=…>` tag reached the document as a real tag.

Caught by the donation receipt's existing escaping test the moment explicit
preheaders appeared — the test predates this work and earned its keep.

**Fixed in the shell, not at the call sites.** `renderEmail` now escapes an
explicit preheader and leaves a derived one alone. The distinction matters:
`derivePreheader` reads the body, which every template has already escaped,
and then decodes a few entities for readability — escaping that again would
print `&amp;amp;` in the preview. Escaping once, in the one place that knows
which is which, fixes the whole class instead of asking 20 call sites to
remember `esc()`.

---

## 5. Claims removed while rewriting

Rewriting every sentence meant reading every sentence. Five were not true.
`docs/67` removed five fabricated statistics from outgoing mail; these
survived it.

| Claim | Why it went |
|---|---|
| *"We've helped dozens of campaigners in the same situation."* | The platform has **zero** published user campaigns and two donations in its history. |
| *"Research shows that campaigns that reach 50% are far more likely to reach their full goal."* | No source, and none offered. "Research shows" is a citation or it is nothing. |
| *"This email was sent by a real person on our team, not an automated system."* | In an automated template. A direct falsehood to a donor, in the email thanking them for the largest gifts. |
| *"Our team reviews and approves within 48 hours."* | A turnaround time, which `docs/78` deliberately quotes nowhere, on a platform that has never reviewed a user campaign. |
| *"most people finish it in under 10 minutes"* | Nobody has finished it. |

Two more were wrong rather than invented:

- *"the full amount … less Stripe's processing fee"* on the donation
  receipt, and *"check your Stripe account"* on the failed withdrawal.
  Real money on this platform moves over **PayHero** (`docs/92`). Both are
  now gateway-neutral.
- *"Call us directly:"* followed by an instruction to send an email, which
  also promised a reply *"within 4 hours"*.

---

## 6. What "plain" meant in practice

Not shorter for its own sake — **professional, and unambiguous**.

| Before | After |
|---|---|
| `Dear Peter,` | `Hi Peter,` |
| `Identity Verification Unsuccessful` | `We could not check your ID` |
| `The identity verification … requires resubmission. This can happen when the submitted images were unclear or the document could not be fully read.` | `We need a new photo of your ID. This usually means the photo was blurred, too dark, or cut off at the edge. Nothing is wrong with your ID.` |
| `Your donation records have been anonymized for financial compliance` | `We kept a record of your past donations, but your name is no longer on them. The law says we must keep money records.` |
| `Funds will arrive … according to your Stripe payout schedule (typically 2 business days)` | `It should reach your bank in about 2 working days.` |
| `View Campaign` / `Start Verification Now` | `See the campaign` / `Start now` |

Three rules did most of the work:

1. **Say who does what.** "We refunded your donation", not "your donation
   has been refunded". A passive sentence hides whether the reader must act.
2. **One idea per sentence.** Split on the first "and" that joins two facts.
3. **Name the thing the reader would name.** "Your ID", "your papers",
   "payment number" — not "verification documents", "supporting
   documentation", "transaction ID".

**Rejected: writing shorter by dropping content.** The reading level came
down while the *information* stayed, and in places grew: the declined-ID
email now lists the three things to check before trying again, which the
grade-15 version never said. Clarity is not the same as brevity.

**Rejected: a tone that talks down.** Average grade 2.9 reads as direct, not
childish, because the sentences are short while the words stay adult. The
sample page rendered for the owner was the check on this, not the score.

---

## 7. Where this is enforced

- `src/lib/email-readability.ts` — budget, glossary, measurement. One module
  so the CLI and the test cannot disagree.
- `src/lib/email-plain-language.ratchet.test.ts` — 9 tests. Fails the build
  on any template over the budget, and tests the harness itself.
- `npx tsx scripts/email-readability.ts --verbose` — names the template, the
  long sentences, and the plain word for each piece of jargon. Exits non-zero
  when anything is over.

**Do not raise the budget to make a template pass.** The numbers are the
audience, not the target.

### Verified by injection

A paragraph of deliberate jargon (*"Pursuant to the aforementioned
cancellation we will subsequently disburse the requisite remittance to the
organiser…"*) was inserted into a live template: it failed exactly the
sentence-length, jargon and summary assertions, and the file was restored
byte-identical. A ratchet that has not been seen to fail is not known to
ratchet.

---

## 8. Tests updated, and how

14 tests pinned the old wording. Each was re-anchored on **intent** rather
than on a literal string, so the next wording change does not break them:

- `toContain('Fully Funded')` → `toMatch(/reached its goal/i)`
- `toContain('Verify your identity')` … → the four steps, in order, in
  whatever words they now use
- `toContain('Dear Donor')` → `toContain('Hi Donor')`, beside the
  unchanged assertion that the donor's real name never appears

Two were **not** stale and caught real problems: the receipt's escaping test
found the preheader injection in §4, and a subject-line test found that a
rewrite had dropped the campaign title from the subject of
`firstDonationCelebrationEmail`, which a creator running several campaigns
needs. The title was restored.

No test was deleted, and none was weakened to pass.

---

## 9. Amendment, 2026-10-21 — the emails were unreadable in dark mode

Added after the owner asked for a screenshot of the deployed mail. Nothing
in §1–§8 is withdrawn; this is a second defect in the same files, invisible
to every check that existed at the time, **including all of §7**. A reading
level says nothing about whether the words can be seen.

### Measured

Rendered in Chromium and audited for WCAG 2.1 contrast across six
representative templates (`scripts/email-contrast.ts`). **Verified:**

| | Light | Dark |
|---|---|---|
| Elements below WCAG AA | **0** | **45** |
| Worst ratio | — | **1.31:1** (4.5:1 required) |

The worst of it: the numbered *"How to get your money"* steps, every row
label on a donation receipt, and both tax-note paragraphs. On the
declined-ID email the single call to action receded into the card.

### Cause

The shell's dark block recolours five **classes**. Templates write colour
**inline on the element** — `<h1 style="color: #0F766E">`,
`<p style="color: #666">`, `<ol style="color: #333">` — and inheritance
stops at a child that declares its own colour. So the container turned
dark and its contents did not.

An author rule marked `!important` does beat a normal inline declaration,
which is why the fix is a set of attribute selectors matching the inline
colour, in the shell, rather than an edit to 45 templates.

Each colour needs two selectors, anchored at `^` or `"; "`. A bare
`[style*="color: #EA580C"]` would also match `background-color: #EA580C`,
which the templates do use.

### The fix created a second defect, caught by re-measuring

First pass took 45 failures to **4** — and those 4 were new. Callout panels
set a pale tint as an inline `background`, backgrounds do not inherit, so
lightening the text left **light-on-light at 1.13:1**, worse than the
original fault. Fixed by darkening the five panel tints too. Final: **0 in
both schemes.**

This is the second time in this doc that measuring *after* a change caught
something reasoning did not (§3 is the first). It is cheap and it keeps
being worth it.

### The screenshot harness was also wrong

The first screenshots showed the whole card faded, which reads as a
contrast fault and is not one: the shell animates `.ld-rise` from
`opacity: 0` over 520ms and the capture happened mid-animation. It faded
the *before* and *after* equally, so it changed no conclusion, but it did
overstate the severity until it was found. `scripts/email-screenshot.ts`
now sets `reducedMotion: 'reduce'`, which the shell already honours.

**Correction:** the contrast failure was real and independently verified —
`getComputedStyle` reports colour, not opacity — but the first visual read
of "unreadable" was partly this artefact. Both facts belong on the record.

### Enforced

- `src/lib/email-dark-mode.ratchet.test.ts` — 5 tests in the normal unit
  suite. Every inline colour and panel background in both template files
  must have a dark-mode rule. **Verified by injection:** adding an
  uncovered `color: #7A7A7A` fails the test, naming that colour.
- `npx tsx scripts/email-contrast.ts` — the real measurement, in a real
  browser, light and dark. Exits non-zero on any AA failure.
- `npx tsx scripts/email-screenshot.ts <dir>` — renders each template at
  phone and desktop width in both schemes, to be looked at.

**Not covered:** Outlook on Windows renders through Word and takes the VML
path in `emailButton` (`docs/67`); Chromium cannot speak to that. Gmail's
apps often apply their own colour inversion and ignore
`prefers-color-scheme` entirely. This work makes the mail correct where the
media query is honoured — Apple Mail above all — and is not a substitute
for a real client matrix.

---

## 10. Still open

- **`docs/93` §3 stands unchanged.** A campaign refused at review still
  notifies nobody. Plain language does not fix a message that is never sent.
- **Spanish, Swahili and French are not addressed.** Everything here is
  English written to be easy; it is not translation. The site claims
  `areaServed: United States` while the live payment rail is Kenyan
  (`docs/82`, `docs/92`), and that tension now reaches outgoing mail too.
