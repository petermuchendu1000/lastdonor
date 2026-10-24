# 106 — AI document pre-screening

**Date:** 2026-10-24
**Status:** built and gated; **not deployed**
**Owner decision:** auto-approve clean documents (the alternative offered was
advisory-only), Didit name first, rasterise PDFs
**Read with:** `docs/81` (Didit, and the rule against unexercised provider
paths), `docs/101` (the raise cap), `docs/92` (one currency per campaign, and
the `success: true` trap), `docs/87` (the five-connection pool), `docs/88`
(admin conventions), `docs/102` (the 200-on-error trap)

---

## 1. What it does

A document uploaded for verification is read by a vision model within five
minutes, the fields are shown to the reviewer, and a document with **nothing
flagged** is approved without a person opening it. Everything else waits.

```
upload (fast, unchanged)
   └─ cron/screen-documents, every 5 min, batch of 5
        ├─ download private object  (bytes, never a signed URL)
        ├─ PDF? → rasterise page 1  (pdftocairo)
        ├─ read fields              (OpenRouter vision)
        ├─ decide                   (pure; no flags ⇒ approvable)
        ├─ insert document_screenings   (UNIQUE document_id = replay guard)
        └─ if approvable: verification_documents.status → 'approved'
                          reviewer_id stays NULL
```

## 2. The boundary that makes auto-approval tolerable

**[VERIFIED 2026-10-24]** Approving a *document* is not a money path, and this
was traced rather than assumed:

- `admin/verification-documents/[documentId]/route.ts:151-157` writes **only**
  `verificationDocuments` — status, reviewerId, reviewerNotes, reviewedAt.
- Every non-test writer of `campaigns.verification_status` was enumerated: the
  Didit session / status / webhook routes, the two info-request routes, and the
  admin `approve_t1` / `approve_t2` action. **No path advances a campaign's
  verification status from document approval.**

So screening cannot authorise a payout (`withdraw/route.ts:272` requires
`fully_verified`) and cannot lift the pre-verification raise cap (`docs/101`).
A person still makes the campaign-level decision.

⛔ **That separation is the whole safety argument.** Anything that later couples
document approval to campaign verification reopens this decision from scratch.

I had asserted the opposite in my own first analysis — that document approval
*was* a money path — before tracing the writers. It is recorded here because the
mistake pointed the wrong way: it made a safe change look dangerous, and the
reverse error is the one that ships.

## 3. Fail closed, and no auto-rejection

Two outcomes: `auto_approve` or `needs_human`. There is deliberately **no
`auto_reject`**. Refusing someone's hospital bill is an adverse decision about a
person mid-emergency, taken on an OCR read already observed mangling a name; a
false approval costs a review that should have happened. Those are not
symmetric, so the machine may say "fine" and may never say "no".

**A missing trusted name is "cannot judge", never "no mismatch found."** This is
the single most dangerous confusion available here: no campaign has a verified
name on file today (`didit_session_id` is NULL on all 20), so a rule that read
absence as agreement would auto-approve **every document on the platform** on
day one. A test asserts it, and a mutation proves the test bites.

`government_id` and `selfie` are absent from the screenable list on purpose:
judging whether identity evidence is genuine *is* the identity decision, which
belongs to the provider and a person.

One mechanism decides: **an empty flag list**. An earlier draft also kept an
`AUTO_APPROVABLE_MATCH_KINDS` set, and mutation testing showed it was dead —
adding `near` and `subset` to it changed nothing, because the switch already
flags both. Two guards where one does nothing is worse than one guard, because
the next reader deletes the live one trusting the dead one.

## 4. The OCR error that shaped the design

**[VERIFIED]** A synthetic bill reading `ASHA W. MUTISO` came back as
`ASHAW. MUTISO` — one lost space, every other field perfect, on a
machine-rendered high-contrast PNG. The easiest input this will ever see.

So names are compared with **all separators removed**: both sides normalise to
`ASHAWMUTISO` and the error costs nothing. Plus accent folding (`JOSÉ`/`JOSE`),
honorific dropping, token reordering (surname first), and a bounded Levenshtein
for near-misses.

⚠️ **The `near` band is sampled from one observation** and is stated as such in
the code. The one error actually measured is handled exactly, at distance 0;
the allowance covers errors nobody here has seen, as a *ratio* so it does not
grow more permissive on short names. `subset` and `near` do **not**
auto-approve — both are benign most of the time and both are what a forgery
looks like when a detail is slightly wrong.

## 5. Providers: probed, not read about

### 5.1 The model list

My first list was assembled from OpenRouter's `input_modalities` field and **two
of its three entries could never have worked** — `docs/81`'s own rule failing on
its first outing. Every entry is now one I ran against a real document:

| Model | Result |
|---|---|
| `nvidia/nemotron-3.5-super-vl:free` | 3.4–29.5s, correct |
| `dots-studio/dots-3-note-preview:free` | 6.0s, correct |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 7.9s, correct |
| `thinkingmachines/inkling{,-small}:free` | **403** "only available on agentic harnesses" — not callable by us at all |
| `google/gemma-4-{31b,26b-a4b}-it:free` | **429** on every attempt across two probe runs |

The call order and the approval allowlist are the **same list**, asserted by a
test: if a model may be called it may approve, and two lists that can drift is
how a model gains authority nobody granted it. The model checked is the one the
**provider reported**, not the one requested — OpenRouter can meta-route.

### 5.2 Four traps, all probed

1. **A failure arrives as HTTP 200** carrying `{"error":…}` with **no `choices`
   key**, so `choices[0]` throws a TypeError instead of reporting a provider
   failure. Checked before `res.ok`. Third member of a family: PayHero's
   `success: true` beside `status: "FAILED"` (`docs/92`), the FX primary's
   200-on-error (`docs/102`).
2. **Reasoning eats the budget** — 500 of 500 completion tokens were reasoning
   tokens, content `null`. Each model gets a second attempt with headroom; a
   429 or 5xx skips to the next model rather than burning it.
3. **`image_tokens: 0` is not a "did it see the image" signal.** It read a bill
   perfectly and still reported 0. Nothing branches on it.
4. **An unknown currency becomes null, not a guess.** A model will answer
   `KSH`; `getCurrency` throws rather than defaulting to USD (`docs/92`), and a
   wrong currency beside a right number still looks like money.

### 5.3 What it does not hallucinate

**[VERIFIED]** A blank page and a shopping list both returned five nulls. The
model declines to invent a bill — which is necessary but not sufficient:
"nothing read" still reaches a person (`low_text_yield`, `no_issuer_found`).

## 6. PDF rasterisation

`poppler-utils` added to the Dockerfile runtime stage. **[VERIFIED]** the live
machine had **none** of `pdftoppm`, `pdftocairo`, `convert`, `gs` — the runner
installed only `ca-certificates` and `dumb-init` — so PDF screening was
impossible in production while working in the sandbox. `sharp` cannot
substitute: this libvips has no poppler and answers `Input file contains
unsupported image format`.

⚠️ **THE TRAP: exit 0 is not success.** `pdftoppm` exited **0, with empty
stderr, and wrote 0 bytes** on a malformed PDF. A check on the exit code alone
calls that a successful rasterisation and hands an empty buffer to the model,
which then fails for an unrelated-looking reason layers away. Success here means
exit 0 **and** non-empty output **and** the PNG magic bytes.

⚠️ **And `pdftoppm -` writes a file called `-`.** Its last argument is a
filename *prefix*, not a destination: passing `-` wrote `-.png` into the
process's current working directory, which on a server is the application root.
`pdftocairo` honours `-` as stdout, so this module uses it and nothing touches
disk. A test asserts the working directory is unchanged.

Only page 1 is rendered. A multi-page document is therefore **not** fully read,
so an otherwise-clean multi-page document is downgraded to `needs_human` with
`pages_not_read` — "approved on the strength of page 1 of 9" is not the claim
being made. Extracted as `downgradeForUnreadPages` specifically so it could be
tested; a mutation that lets multi-page documents through fails 2 tests.

## 7. The Didit name — built, and honestly incomplete

`campaigns.didit_verified_name` holds the organiser's name as read off their ID.
It is the **only** trustworthy name the platform has: `users.name` is
self-declared, so comparing an uploaded bill against it proves nothing —
whoever uploaded the document also typed the name.

**[VERIFIED]** The decision endpoint's top-level shape, probed with a real
session:

```
session_id, session_number, session_url, status, vendor_data, callback,
features, kyc, aml, face, location, poa, phone, email, kyb, warnings,
user_href, reviews, extra_images, questionnaire, document_ai_documents,
environment, sandbox_scenario, created_at, expires_at
```

`features` was `["ID_VERIFICATION","LIVENESS","FACE_MATCH","IP_ANALYSIS"]` and
the create response described the workflow as
`"OCR + LIVENESS + FACE_MATCH + IP_ANALYSIS"` — **so Didit already reads the
ID**, and the result belongs under `kyc`.

⛔ **`kyc` was `null`, so the keys inside it are UNVERIFIED.** Populating it
needs a real person completing the hosted flow, which cannot be done from here.
`readVerifiedName` therefore tries the conventional shapes (`full_name`,
`name`, `legal_name`, then `first_name`+`last_name` and their variants) **and
reports what it actually found** — logging the key it matched, or the list of
keys that were present when it matched none. The first completed session puts
the real field names in the log, which turns a guess into a fact without
guessing again.

It reports **key names only, never values**: these are the fields of someone's
identity document, and a test asserts no name reaches the diagnostic.

A later payload that omits the name never **clears** one an earlier payload
established, or screening would silently stop being able to check anything.

⚠️ **The key supplied is a LIVE key** (`environment: "live"`), not sandbox. The
probe consumed a real session, number 10.

### 7.1 A vendor question left open on purpose

`poa` (proof of address) and `document_ai_documents` exist in the response shape
and are **absent from the enabled feature set**. **[INFERRED]** Didit therefore
sells roughly this feature as a provider capability — anchored to the real ID
rather than to our OCR of a bill. v1 exposes no workflow listing (`/workflows/`,
`/workflow/`, `/features/` all 404), so availability and price are a console
question. The owner chose to build the bespoke path knowing this; it is recorded
so the choice is not re-made by accident.

## 8. Why screening is not in the upload request

**[VERIFIED]** 3.4s–29.5s per read, and 27.5s for a PDF end to end. Holding an
organiser's upload open for half a minute during the emergency that brought them
here is not a trade worth making, and a provider outage would turn their upload
into an error.

Batch of five, **sequentially**. Concurrently would be faster and is
deliberately not done: each document holds a database connection across a
half-minute third-party call, and the pool is `max: 5` shared by every request
on the machine (`docs/87`, after seven wedges in one day). That clears 60
documents an hour, which is faster than this platform has ever received them.

Idempotency has two layers: the job selects only documents with no screening
row, and `document_screenings.document_id` is **UNIQUE** — so two overlapping
runs cannot screen or approve the same document twice. The approval is
additionally keyed on the document still being `pending`, so a late job cannot
overwrite a decision a person already made.

## 9. The admin surface

`/admin/screening`, linked from the sidebar — `docs/83` is this codebase's
record of a verification route that silently stopped being reachable, so the
link is part of the work, not a follow-up.

Conventions followed deliberately: no `revalidate` export (the admin layout's
`force-dynamic` governs — `docs/88` F14); tiles from `GROUP BY` rather than
tallied in JS over an uncapped fetch (F8); `ListCount` stating the page range,
loaded count and true total (F16); two sequential queries, never more than three
concurrent (`docs/87`).

The amount is shown as **the text that was read**, not through `Money`. `Money`
renders a platform figure in minor units (`docs/92`); this is a string a model
read off a photograph, and formatting it like a ledger entry would dress a guess
up as an amount the platform holds.

## 10. What is NOT built

- **Alteration detection.** The original proposal asked for it. I have no
  evidence a vision LLM detects document tampering and did not test it, because
  a negative from me would prove little and a positive less. Establishing it
  needs a labelled set of genuine and altered documents and a measured
  false-positive rate. Until then it is a claim the platform cannot
  substantiate, and `CLAUDE.md` forbids shipping those.
- **A completed Didit session**, so §7's key names stay unverified.
- **Deployment.** Needs the app deployed (for `poppler-utils` and the route)
  and then the cron Worker redeployed, in that order (`docs/104` §5.1).

## 10a. The public footer on admin pages

The screening screen shipped under a newsletter signup and a four-column
marketing footer taking roughly half its height. That is not this page's
doing: `src/app/layout.tsx:254,275` renders `<Navbar />` and `<Footer />`
unconditionally, and it is the only root layout, so they wrap all 24 admin
pages.

**The approach NOT taken, because it is the obvious one.** Forward the
pathname from middleware and branch on `headers()` in the root layout. A
dynamic API in the ROOT layout opts every route out of static rendering.
**[VERIFIED]** by capturing the build's route table first: 216 routes, **181
dynamic / 32 static / 3 ISR**. All 35 static and ISR routes would have gone
dynamic to hide a footer. Multiple root layouts via route groups was also
rejected: moving ~40 route directories and duplicating fonts, metadata,
Providers and JSON-LD, which is a much larger version of the layout change
`docs/80` records going wrong.

**What was done.** A pure predicate (`src/lib/public-chrome.ts`) and a small
client gate (`PublicFooterGate`) that receives the server-rendered `<Footer />`
as children and returns null under `/admin`. The root layout gains no dynamic
API. **[VERIFIED]** rebuilding gives **181 / 32 / 3 again, zero routes changed
mode.**

⛔ **The NAVBAR is deliberately not gated.** The admin sidebar has no sign-out
- checked, there is no signout/logout anywhere in `AdminSidebar.tsx` or the
admin layout - so the navbar is an administrator's only way out of the tool.

⚠️ **The predicate is anchored**, because `startsWith('/admin')` also matches
`/administrator`. Same prefix-dragging bug `middleware.public-routes.test.ts`
guards against on the public API list. It also fails toward SHOWING the footer
on an unreadable pathname: showing one where it is unwanted is cosmetic, while
hiding it everywhere strips the site's navigation, legal links and unsubscribe
route on every page at once.

### 10a.1 A check of mine that could not fail, and did not

The first verification grepped `page.content()` for footer strings with
JavaScript disabled, found them on `/admin/screening`, and I reported that the
gate did not work server-side. **That was wrong.** `page.content()` includes
the RSC flight payload Next embeds in `<script>` tags, so the check matched
both the working and the broken version - exactly the failure mode of a check
that cannot fail.

Separating the rendered DOM from the payload:

```
/admin/screening   <footer> in DOM: false | markers in DOM: NONE | only in RSC payload: 4
/ (control)        <footer> in DOM: true  | markers in DOM: all 4 | only in RSC payload: 0
```

Instrumenting the gate confirmed the mechanism directly: `usePathname()`
resolves during server rendering, returning `"/admin/screening"` with
`shows=false`, and `"/"` with `shows=true`.

The footer's serialized output does still travel in the flight payload on
admin pages - a few KB, invisible, and the accepted price of keeping `Footer`
a server component rather than turning 35 routes dynamic.

## 11. Verification record

| Check | Result |
|---|---|
| Five cases through the real provider | match → AUTO_APPROVE; someone else's bill → `name_mismatch` (score 0.18, distance 14); 4° skew → read correctly; shopping list → all nulls; total provider failure → `needs_human` |
| PDF → rasterise → read → decide | AUTO_APPROVE, exact name, 27.5s |
| `/admin/screening` signed in as a real admin | renders all five rows; unauthenticated → 307 |
| Mutations, all killed | absence-as-agreement (5), `government_id` screenable (4), drop model check (3), compare with separators (4), approve despite flags (12), drop the 200-with-error guard (2), widen the allowlist (2), multi-page auto-approve (2) |
| Lint / typecheck | 0 errors / clean |
| Unit | 6833 passed / 16 skipped |
| Integration | 113 passed, freshly migrated throwaway Postgres |

Two ratchets caught my own work and are worth naming: the cron schedule test
refused a job with no hand-derived cadence assertion, and
`middleware.public-routes.test.ts` refused a newly unauthenticated-reachable
route until it was **declared** in the public inventory.
