# 30 — GoFundMe Benchmark and Positioning, 2026-10-14

Strategic synthesis. The full research — 90 VERIFIED claims, 22 REPORTED, 13
"could not establish", 74 cited URLs — is preserved at
`docs/audit-2026-10-14/08-gofundme-benchmark.md`. Read that for citations.

**Method note:** GoFundMe's help centre blocks fetchers, but its Zendesk content
API serves article text *with* `edited_at` timestamps, so most claims below carry
GoFundMe's own last-edited date rather than only a retrieval date. `robots.txt`,
sitemaps, JSON-LD and live HTTP headers were inspected directly.

**Supersedes nothing.** `docs/22`, `23` and `24` remain; §4 records three
corrections to them.

---

## 1. Parity gaps — what we must match to be credible

Ranked by how badly their absence reads to a donor or organizer.

| # | Gap | Why it is not optional |
|---|---|---|
| 1 | **Attributed share loop.** Every logged-in donor gets a unique share link with impact tracking, surfaced in a post-donation "now help spread the word" prompt; co-organizers see per-link donor counts. (art. 360001489648, ed. 2026-09-23) | This is their growth engine, not a feature. A plain share button is **not** parity. Donor-attributed sharing is how a campaign reaches the second ring of a network. |
| 2 | **Auto-generated share creative.** The platform generates videos, posters and per-destination copy from campaign media (YouTube/TikTok/Reels/Stories/LinkedIn/Nextdoor/X). (art. 38748476284955, ed. 2026-08-19) | Organizers are in crisis. They will not produce their own assets. Whoever removes that work wins the campaign. |
| 3 | **Checkout breadth.** No account required; amount + tip on one screen; Apple/Google Pay, PayPal, **Venmo**, ACH via Plaid (US), Klarna (DE/AT/BE/CH), iDEAL (NL). (art. 4402563115412, ed. 2026-07-08) | Every missing wallet is a measurable drop-off. Guest donation and one-screen checkout are table stakes. |
| 4 | **Beneficiary + co-organizer roles with direct payout.** The beneficiary withdraws to their own bank; ToS §6.1 states the organizer "relinquishes control." | Without it, every third-party campaign routes strangers' money through the organizer — the single biggest trust objection in the category. |
| 5 | **Edge-cached delivery.** Next.js SSR behind CloudFront with observed `s-maxage=300, stale-while-revalidate=600, stale-if-error=3600` (2026-10-14). | An empirical datapoint for `docs/26` §5: **they accept ~5 minutes of staleness on live totals** to buy edge scale. Our `revalidate = 60` plus per-donation `revalidatePath` (audit P1-8) is strictly more expensive for strictly less benefit. |

---

## 2. Attack surface — where a focused competitor wins

These are documented weaknesses, not wishful thinking.

### 2.1 No identity verification before a campaign goes live

Accounts require only a name — which "can be a nickname" — and an email. KYC is
deferred to transfer setup, run by Adyen/Stripe, and is risk-based:
"Documents won't be needed for every customer." **A campaign can be live, indexed
and taking money from an unverified pseudonym.**

The strategic insight: **verify-before-publish also unlocks faster payout.**
GoFundMe's 7+ day verification and 2–5 day deposit latency is a *consequence* of
back-loading KYC. Front-loading it turns our slowest-sounding requirement into
our fastest-paying feature. That is a rare case where the trustworthy choice is
also the faster one.

This is already LastDonor's stated USP (`docs/21`) — the benchmark confirms the
opening is real and currently unoccupied.

### 2.2 Zero fund-usage transparency

No withdrawal status, no spend ledger, no receipts, no organizer track record
anywhere donor-facing. GoFundMe instead instructs donors to vet campaigns
themselves (art. 115015913668, ed. 2026-10-07). They publish **no transparency
report at all**.

A public disbursement ledger is cheap for us and **unretrofittable across their
~1M existing pages** — they cannot add provenance to history they never recorded.
This is the most durable advantage available.

### 2.3 Consent-by-default, now legally exposed

1.4M unauthorized nonprofit pages → Alaska AG suit (2026-03-10), 22-state
regulator letter (2026-03-03), Oregon federal class action (~2026-03-11). Plus
"Communities" auto-enrolment whose only opt-out also removes you from search, and
unblockable donor DMs.

**Enforced beneficiary consent plus onboard-only charities sidesteps the entire
category of exposure** — and is a claim we can make truthfully today.

---

## 3. What this means for our own audit

The benchmark sharpens two audit findings into existential ones:

- **Audit P0-2 (simulated donations in public totals) is disqualifying in this
  market.** GoFundMe's weakness is *insufficient* trust infrastructure. A
  competitor positioning on trust that displays fabricated donation activity to
  real donors is not differentiated — it is worse, and the regulatory climate in
  §2.3 shows exactly how that gets prosecuted. Our entire wedge is §2.1 and §2.2;
  P0-2 contradicts both.
- **Audit P0-1 (public verification documents) attacks our own wedge.** We ask
  creators for ID and medical records *as the proof mechanism* for verify-before-
  publish. Exposing those documents publicly converts our differentiator into our
  largest liability.

In short: **the two P0 findings most in need of a decision are precisely the two
that determine whether the GoFundMe strategy is viable at all.**

---

## 4. Corrections to docs 22 / 23

Recorded here; those documents are not rewritten.

1. **The Giving Guarantee is narrower than `docs/23` states.** Effective only
   2025-09-24. Beneficiary claims require a **police report**. Unpayable countries
   excluded. Sole-discretion.
2. **Fee coverage in `docs/22` is incomplete** — it omits a **5% donor surcharge
   on recurring gifts** (≈7.9% + $0.30 US) and the 2.2% / 1.9% charity rates.
3. **Trustpilot is 3.3 across 24,312 reviews with a 56% 1-star / 38% 5-star
   barbell**, not a flat 3.2. The barbell matters more than the mean: it indicates
   polarised outcomes, i.e. a minority of catastrophic experiences rather than
   broad mediocrity — which is consistent with §2.1 and §2.2.

**Could not establish:** the individual named Trustpilot quotes in `docs/22`/`24`
could not be re-verified, and the **current default tip percentage** could not be
established from any GoFundMe source. Attack the tip *mechanism*, never a specific
number we cannot cite.
