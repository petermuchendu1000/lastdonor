# GoFundMe Competitive Benchmark — The Quality Bar for LastDonor

**Research date: 2026-10-14.** All retrieval dates are 2026-10-14 unless stated.
**Author's note on method:** GoFundMe's Help Centre runs on Zendesk. Its HTML is
Cloudflare-protected, but the Zendesk content API
(`support.gofundme.com/api/v2/help_center/en-us/articles/{id}.json`) serves the
same article text *with* an `edited_at` timestamp. Every "VERIFIED (help centre)"
claim below carries that article's own last-edited date, which is a far stronger
provenance signal than a page-fetch date. Article IDs are given so claims are
re-checkable.

**Marking convention**
- **VERIFIED** — GoFundMe's own documentation (help centre, ToS, pricing,
  privacy notice, robots/sitemaps, HTTP headers, status page) or a primary
  public record (a state AG press release, a court-reported filing).
- **REPORTED** — secondary source: press, third-party trackers, review sites,
  competitor blogs. May be stale or wrong.
- **COULD NOT ESTABLISH** — searched and failed; the search is named.

---

## 0. Relationship to docs 22 / 23 / 24 — corrections and gaps

Docs `22-GOFUNDME-VULNERABILITY-RESEARCH.md`,
`23-GOFUNDME-STRENGTHS-RESEARCH.md` and `24-GOFUNDME-THREATS-RESEARCH.md` are
built almost entirely on **Trustpilot reviews and Reddit threads**. They are
strong on sentiment and messaging angles and weak on verifiable mechanics: they
contain no primary citation for the charity fee, the recurring-donation fee,
payout timelines, holds, country availability, the Giving Guarantee's actual
exclusions, regulatory posture, SEO mechanics, or architecture. This document
adds those and corrects the following.

### Corrections to existing docs

| Doc | Existing claim | Correction (this research) |
|---|---|---|
| 22 §9 | "Trustpilot 3.2/5, 23,759 reviews" | **Now 3.3 / 24,312 reviews**, distribution 5★ 38% / 4★ 4% / 3★ 1% / 2★ 1% / **1★ 56%**. The *barbell* is the story, not the mean — a 56%/38% split means two populations, not one mediocre one. VERIFIED (Trustpilot page, retrieved 2026-10-14) — https://www.trustpilot.com/review/gofundme.com |
| 23 §5 | Giving Guarantee = "Yearlong coverage on donations of any amount… Worldwide protection regardless of donor location" | **Both overstated.** The current policy has an **effective date of 2025-09-24** and applies *only* to donations/beneficiary designations on or after that date; it **excludes people in countries where GoFundMe cannot send funds**; and **beneficiary** claims additionally require the claimant to have notified the organizer, attempted resolution, **and filed a police report**. Claims are decided in GoFundMe's "sole and absolute discretion." VERIFIED (GoFundMe Giving Guarantee policy page, retrieved 2026-10-14) — https://www.gofundme.com/c/safety/gofundme-guarantee |
| 23 §7 | "Transaction fee: 2.9% + $0.30 per donation" presented as the whole fee picture | **Incomplete.** (a) Certified charity fundraisers are **2.2% + $0.30 in the US** and as low as **1.9% + £0.20 in the UK**; (b) **donors pay an extra 5% on recurring donations**; (c) rates differ in 9+ listed currencies. VERIFIED — https://www.gofundme.com/c/pricing and help article 203604424 (edited 2026-09-30) |
| 22 §1 | Donors report 15%–17.5% pre-set tips | **Corroborated by a court filing, not just reviews:** *Donovan v. GoFundMe* (N.D. Ill., filed Aug 2026) pleads a $50 donation with an **$8.25** tip auto-added (16.5%) and a $10 donation with a **$1.00** tip (10%). VERIFIED as a filing REPORTED by press — https://www.shawlocal.com/northwest-herald/2026/08/20/mchenry-woman-sues-gofundme-claims-it-uses-deceptive-tips-to-pocket-money-from-donors/ (2026-08-20) |
| 22 §3 / 24 §5 | "Nonprofit betrayal scandal (October 2025)" | **Confirmed and now escalated far beyond what doc 22 records.** 1.4M auto-created pages; CEO apology 2025-10-23; **22 state charity regulators' demand letter dated 2026-03-03** (14-day deadline); **Alaska AG lawsuit filed 2026-03-10** against GoFundMe *and five other platforms*; **Oregon federal class action filed ~2026-03-11**. Docs 22/24 predate the litigation phase. See §2.8. |
| 22 §4 | "processing takes 2–7 days, then 2–5 days to transfer" | **Close but the worst case is worse and differently located.** GoFundMe's own text: transfer **setup and verification** "can take **up to 7 business days or longer**", then **2–5 business days** for deposit; a **hold review** adds "typically 2–5 business days" *after* all information is collected. VERIFIED (articles 204119238 edited 2026-09-23; 21281826060571 edited 2026-06-11) |
| 22 §4 | "zero reports available… only able to take screenshots" (Trustpilot) | **Partly wrong, partly confirmed by GoFundMe itself.** Organizers *do* get a fee **"Breakdown"** under Transfers (article 203604424). But GoFundMe states outright: *"To comply with data protection regulations, it's not possible for us to provide a complete list of your donors' information."* VERIFIED (article 205213077, edited 2026-09-17). The complaint is real; the cause is a policy choice, not an oversight. |
| 22 §11 (privacy) | general concern | **Sharper fact available:** GoFundMe's privacy notice states NPO beneficiaries can access the donor's **name, email, donation amount and transaction details — even for anonymous donations**. VERIFIED (Privacy Notice, last updated 2026-08-17) — https://www.gofundme.com/c/privacy |

### Could not verify / correct

- **Doc 22's and 24's individual Trustpilot quotations.** Trustpilot paginates
  and reorders; I could not re-locate specific named reviews (e.g. "Zane
  Gutierrez", "Ophir Averbuch") on 2026-10-14. The aggregate score and
  distribution are verified; treat the individual quotes as unre-verified.
- **Doc 22 §9's "competitor scores on Trustpilot"** — not re-checked.
- **Doc 23's claim that the Giving Guarantee is "buried on a separate page"** —
  a subjective UX claim; not tested.

---

## 1. FEES AND PAYOUTS

### 1.1 Platform fee and transaction fee

**VERIFIED** — "It's always free to start and manage a fundraiser on GoFundMe."
Platform fee for creating/managing a fundraiser: **$0.00** in every supported
country. Source: help article 203604424 "Learn about GoFundMe fees", **edited
2026-09-30** — https://support.gofundme.com/hc/en-us/articles/203604424 ; and
https://www.gofundme.com/c/pricing (retrieved 2026-10-14).

**VERIFIED — per-donation transaction fee by country and fundraiser type**
(pricing page, retrieved 2026-10-14, https://www.gofundme.com/c/pricing):

| Country / currency | Personal / business | Certified nonprofit |
|---|---|---|
| United States (USD) | 2.9% + $0.30 | 2.2% + $0.30 |
| Canada (CAD) | 2.9% + $0.30 | 2.2% + $0.30 |
| United Kingdom (GBP) | 2.9% + £0.25 | 1.9% + £0.20 |
| Ireland (EUR) | 2.9% + €0.25 | 1.9% + €0.35 |
| Australia (AUD) | 2.2% + $0.30 | 1.9% + $0.30 |
| Most of Western Europe (EUR) | 2.9% + €0.25 | not listed |
| Denmark / Norway / Sweden | 2.9% + 3 kr. | not listed |
| Switzerland (CHF) | 2.9% + CHF 0.30 | not listed |
| Mexico (MXN) | 2.9% + MXN 5 | not listed |

Note the **Australian personal rate (2.2%) is lower than the US personal rate
(2.9%)** — region matters more than most comparison sites admit. The pricing
page also notes international transaction and currency-conversion fees may apply
depending on the donor's payment method.

**VERIFIED — worked example, GoFundMe's own:** "If a donor makes a $50 donation
to a US fundraiser, the individual receiving funds will receive **$48.25**"
(article 203604424, edited 2026-09-30).

### 1.2 The recurring-donation fee — the fee most comparisons miss

**VERIFIED** — "If donors choose recurring donations, they pay a fee of **5% per
donation**" — *in addition to* the transaction fee, and charged to the **donor**,
not the organizer. Sources: article 203604424 (edited 2026-09-30) and article
26707416172059 "Provide ongoing support with recurring monthly donations"
(**edited 2026-10-07**) —
https://support.gofundme.com/hc/en-us/articles/26707416172059 .

So a US recurring donation carries **~7.9% + $0.30 before any tip**. This is a
materially harder number to defend than 2.9% and is absent from docs 22–24.

**VERIFIED** — recurring donations are **not available in Italy or Canada**, and
can only be made by card, PayPal or bank transfer (same article).

### 1.3 Tipping / contribution model

**VERIFIED (mechanics)** — the tip is a **slider** ("Click on the green dot and
slide left or right"), with an "Enter custom tip" text option; it "can be changed
to any amount, including 0"; **organizers cannot see whether a donor tipped**;
and GoFundMe will "refund any unintentional tips" via a refund-request form.
Source: article 360051144952 "Choosing a tip amount", edited 2026-06-17 —
https://support.gofundme.com/hc/en-us/articles/360051144952 . Tip revenue is
described as what keeps the platform free for organizers.

**COULD NOT ESTABLISH — the current default tip percentage.** GoFundMe does not
publish it. I searched its pricing page, the fees blog post
(https://www.gofundme.com/c/blog/gofundme-fees, published 2026-04-20 — says only
"never required", no percentage), articles 203604424 / 360051144952 / 360001992827,
and inspected the live donate page HTML
(`/f/{slug}/donate`, 2026-10-14) — the default is computed client-side and is not
in the server-rendered payload. Conflicting third-party figures:
- **REPORTED** 16.5% and 10% on specific transactions — *Donovan v. GoFundMe*
  pleadings (N.D. Ill., Aug 2026), per https://www.shawlocal.com/northwest-herald/2026/08/20/mchenry-woman-sues-gofundme-claims-it-uses-deceptive-tips-to-pocket-money-from-donors/
- **REPORTED** 15%, with an unverified comment claiming a reduction to 11% — a
  *competitor's* blog, https://gogetfunding.com/blog/the-gofundme-tip-a-sneaky-charge-or-fair-practice/ (undated)
- **REPORTED** 15%–17.5% — Trustpilot reviews quoted in doc 22
The honest statement for LastDonor marketing: *the default is non-zero and
percentage-scaled, and GoFundMe does not publish it.* Do not assert a specific
percentage.

### 1.4 Payout timelines, transfer deadlines and holds

**VERIFIED** — "The process of setting up and verifying transfers can take **up
to 7 business days or longer** to complete. Then, once a transfer is sent, it
will take **2–5 business days** for the funds to safely be deposited."
(article 204119238 "Bank transfer deadlines", edited 2026-09-23) —
https://support.gofundme.com/hc/en-us/articles/204119238

**VERIFIED — the auto-refund deadline (a genuinely under-reported mechanic).**
"Once the first donation is made to your fundraiser, your bank transfer
information **must be fully verified by the date noted within your transfer
notification emails** … or your donations **could be automatically refunded**."
Rationale given: "our payment partners are online payment processors only and,
unlike a bank, are not able to hold your funds for long periods of time."
(article 204119238). Also: "If a fundraiser is created by an organizer who
doesn't meet supported country requirements, it's likely that **all money raised
will be refunded** and the account will be removed." (article 360001972748,
edited 2026-06-24).

**VERIFIED — transfer frequency.** Automatic transfers can be **daily, weekly or
monthly**; in Canada only daily for certain accounts. Nonprofits on PayPal Giving
Fund are paid **at the end of each month for funds donated before the 15th of
that month** (i.e. up to ~6 weeks' lag); US nonprofits enrolled in **GoFundMe
Pay** may choose daily/weekly/monthly. Source: article 203603984 "Choosing a
fundraiser type", edited 2026-08-28 —
https://support.gofundme.com/hc/en-us/articles/203603984

**VERIFIED — holds.** GoFundMe may pause transfers when it needs information
about (a) how funds will be used, (b) how funds reach the intended recipient, (c)
possible violation of state/federal/global law, or (d) possible ToS violation.
Communication is **by email only** — "the review must be completed by responding
to the email you received." Once all information is collected, "reviews typically
take between **2–5 business days**." Source: article 21281826060571
"Understanding holds set by GoFundMe teams", edited 2026-06-11 —
https://support.gofundme.com/hc/en-us/articles/21281826060571

**VERIFIED — mid-campaign re-verification.** "your outgoing transfers may be
paused while we review your personal and bank details … **it may happen after
some funds have already been transferred.**" After upload: 1–2 business days to
verify, then "2 or more business days" to transfer. Source: article 360042879132,
edited 2026-01-14 — https://support.gofundme.com/hc/en-us/articles/360042879132

**Realistic worst case for a first-time US organizer, from GoFundMe's own text:**
up to 7+ business days (verification) + 2–5 business days (deposit), plus 2–5
business days if a hold fires. **Roughly 2–3+ weeks is a documented, not
anecdotal, outcome.**

### 1.5 Chargebacks and refunds

**VERIFIED — chargebacks.** A donor dispute removes funds from the organizer's
payment account and "can sometimes result in a **negative balance**… **Future
donations will first be used to cover the negative balance.**" The organizer's
remedies are: ask the donor to withdraw it, ask GoFundMe to challenge it, or
concede. Source: article 204531798 "Handling chargebacks", edited 2026-08-18 —
https://support.gofundme.com/hc/en-us/articles/204531798

**VERIFIED — organizer-initiated refunds.** Personal fundraisers: refunds "can be
processed **if the funds have not been transferred** and the donations were made
**in the last year**." Nonprofit donations are "typically non-refundable."
Source: article 203603984 (edited 2026-08-28).

**VERIFIED — ToS discretion.** "We may, **in our sole discretion**, offer or
issue a refund of Donation(s)"; and GoFundMe "may, in its sole discretion, offer
refunds to donors **or redirect funds to a verified NPO**" where a beneficiary
does not want the funds. ToS §7.1(b), **Effective Date 2026-06-23** —
https://www.gofundme.com/c/terms

**VERIFIED — appeals.** A user may appeal content removal, fundraiser removal or
account closure **within six months** via a form. Source: article 23866683344411
"Request an appeal of a decision", edited 2026-09-15 —
https://support.gofundme.com/hc/en-us/articles/23866683344411

### 1.6 Country availability

**VERIFIED — 20 countries** where GoFundMe can send funds (article 360001972748,
edited **2026-06-24**): Australia, Austria, Belgium, Canada, Denmark, Finland,
France, Germany, Ireland, Italy, Luxembourg, **Mexico**, Netherlands, Norway,
Portugal, Spain, Sweden, Switzerland, United Kingdom, United States — *excluding*
American Samoa, Guam, Northern Mariana Islands and the U.S. Virgin Islands.
A fundraiser's country is fixed at creation and **cannot be changed after
publishing**. Many third-party lists still say 19 and omit Mexico.

**VERIFIED — withdrawal requirements are jurisdictional and strict** (article
360001977868, edited **2026-07-27**). Examples: US requires an **SSN or ITIN**, a
US driver's licence / state ID / any country's unexpired passport, a **residential
address in one of the 50 states (no PO box)**, a US phone number, and a **US bank
account in your name** — with an explicit warning that PayPal/Venmo/CashApp
"often don't meet document requirements." UK requires a **National Insurance
Number**; Canada a **Canadian Tax ID**; Mexico an **RFC**; Italy a **codice
fiscale**. This is the structural reason behind doc 22 §5's "verification
nightmare" complaints: it is a tax-ID-gated payout rail, not a UI bug.

### 1.7 What happens to funds on an unverified or disputed campaign

**VERIFIED**, assembled from the above:
1. Donations are collected immediately regardless of organizer verification
   status (verification is triggered at *transfer setup*, not at campaign
   creation).
2. If verification is not completed by the emailed deadline → **donations may be
   automatically refunded** (article 204119238).
3. If the organizer is in an unsupported country → **all money raised is likely
   refunded and the account removed** (article 360001972748).
4. If a hold fires → transfers paused, email-only review, typically 2–5 business
   days after information is complete (article 21281826060571).
5. On a Giving Guarantee finding of misuse → donor refunds, processed in **3–10
   business days** (Giving Guarantee policy, effective 2025-09-24).
6. If a beneficiary refuses funds → GoFundMe may refund donors **or redirect the
   funds to a verified NPO** at its discretion (ToS §7.1(b), 2026-06-23).

### 1.8 Donation minimums and maximums

**VERIFIED** (article 360001992827 "How to make a donation", **edited
2026-10-07**): minimum **USD/CAD/EUR/AUD/GBP/CHF 5**, **MXN 25**,
**DKK/NOK/SEK 50**. Maximum **USD 250,000 via ACH (US only); otherwise
100,000** in all listed currencies.

---

## 2. TRUST AND SAFETY — the decisive section

### 2.1 What actually establishes trust: *the payout rail, not the campaign page*

This is the single most important structural finding, and docs 22–24 miss it.

**VERIFIED** — GoFundMe performs **no identity verification at campaign
creation**. Account creation requires only a name, email and password (or Google/
Apple sign-in), and "The name you enter will be displayed publicly" and "can be a
nickname" (article 360001992627 "Creating a GoFundMe from start to finish",
edited 2026-07-31; article 203604574 "Your name on GoFundMe", edited
2026-09-25). KYC happens **later**, at transfer setup, and is performed by the
**payment processor (Adyen or Stripe)**, not GoFundMe: "click 'Continue to Adyen'
or 'Continue to Stripe', depending on your payment partner" (article 360028386391
"Uploading documents for bank transfers", edited 2026-09-23 —
https://support.gofundme.com/hc/en-us/articles/360028386391).

**VERIFIED — KYC is risk-based, not universal:** "**Documents won't be needed for
every customer**, but our payment partners may request them" (article 360028386391).

**Consequence:** a GoFundMe campaign page can be live, publicly indexed and
accepting money from a completely unverified pseudonymous account. Trust is
asserted by brand and enforced only at the exit. **That gap — live fundraising
before any identity check — is the central competitive opening for a
verification-first platform**, and it is verifiable from GoFundMe's own docs
rather than inferred from reviews.

**VERIFIED — ID document requirements** (article 7011467708443 "Uploading an ID",
edited 2026-04-30): unexpired, non-temporary, **full legal name matching bank
statement**, colour, front and back as separate images, all four corners, file
100 KB–10 MB. No expired passports, no temporary IDs — which is exactly the
rejection set doc 22 §5 documents anecdotally.

### 2.2 The GoFundMe Giving Guarantee — scope, limits, claim window

**VERIFIED** — https://www.gofundme.com/c/safety/gofundme-guarantee (retrieved
2026-10-14); policy PDF at
https://www.gofundme.com/c/wp-content/uploads/2025/08/GoFundMe-Giving-Guarantee-01_31_2024.pdf
(text is in compressed streams and was **not machine-readable** — the HTML page
is the citable source).

- **Promise:** "full refund in the rare case something isn't right"; covers
  misuse of funds relative to the stated purpose; guarantees charity donations
  reach the intended charity; guarantees named beneficiaries receive funds
  directed to them.
- **Effective date: 2025-09-24.** Applies only to donations or beneficiary
  designations made on or after that date. (This supersedes the earlier
  2024-01-31 version; doc 23 reflects the older framing.)
- **Claim window:** donors — **within one year of the donation**; beneficiaries —
  **within one year of being named**.
- **Refund timeline:** "Refunds will be processed in **3–10 business days**."
- **Donor eligibility:** must still own and control the original payment
  instrument; donation must have been made through the Platform.
- **Beneficiary eligibility — the hard gate:** must have notified the organizer,
  attempted to resolve it with them, **and filed a police report**.
- **Exclusions:** donations to your own fundraiser; donations with an initiated
  chargeback; frivolous, duplicative or **excessive (more than three in a month)**
  claims; claims where the claimant violated the ToS; claimants who contributed to
  the misuse; and **people living in countries where GoFundMe cannot send funds**.
- **Discretion:** claims decided in GoFundMe's "**sole and absolute discretion**",
  determinations final. "It is not insurance… and is not a warranty against
  fraud." GoFundMe "may modify or end the policy at any time without prior
  notice."

**Separate Beneficiary Guarantee** exists for people money was raised *for*
(article 5385413722139, edited 2026-01-27 —
https://support.gofundme.com/hc/en-us/articles/5385413722139).

**Assessment:** the guarantee is marketed as unconditional and is in fact a
discretionary, time-bounded, police-report-gated goodwill policy. **"No police
report required" and "a published, non-discretionary adjudication standard" are
both credible, defensible differentiators.**

### 2.3 Beneficiary verification and third-party campaigns — the key abuse vector

**VERIFIED — beneficiary consent is requested, never enforced.** GoFundMe's own
guidance: "If you aren't in touch with the person you're raising funds for, **we
ask that you reach out to them prior** to raising funds and receive their
authorization." That is a request in a help article, not a product control.
Source: article 115015836967 "Guidelines for a trustworthy GoFundMe", edited
2026-08-25 — https://support.gofundme.com/hc/en-us/articles/115015836967

**VERIFIED — the three third-party patterns GoFundMe permits:**
1. Add the person as a **beneficiary**, who then withdraws to their own bank
   account. "By adding a Beneficiary, **you relinquish control of the donations**
   for your Fundraiser to the Beneficiary." (ToS §6.1, 2026-06-23)
2. **Withdraw on their behalf** and deliver the money **outside GoFundMe** —
   explicitly sanctioned, with only a request to "be clear" in the story about
   the relationship and the transfer method (article 115015836967).
3. Raise for someone in an **unsupported country**: "The organizer is personally
   responsible for receiving the funds and then delivering them outside GoFundMe"
   (article 115010242608, edited 2026-06-11).

Patterns 2 and 3 mean **GoFundMe knowingly supports flows where it has no
visibility into whether the beneficiary ever receives a cent.** Enforcement is
retrospective only.

**VERIFIED — the remedy is a report, after the fact.** A person who finds a
fundraiser in their name clicks "Report fundraiser" at the bottom of the page and
describes their relationship to the organizer (article 115015913628 "Reporting a
fundraiser created in your name", edited 2025-12-11 —
https://support.gofundme.com/hc/en-us/articles/115015913628). No ex-ante consent
handshake exists.

**VERIFIED — beneficiary names are not hideable.** "If a beneficiary has been
added, their name on the fundraiser **can't be hidden**", though it may be edited
to a nickname (article 203604574, edited 2026-09-25). A safety problem for
domestic-violence and medical-privacy cases.

### 2.4 Withdrawal controls

**VERIFIED** — controls are: (a) processor-run KYC at transfer setup with
legal-name/bank-name matching; (b) an emailed transfer deadline with auto-refund
on expiry; (c) transfer-frequency settings (daily/weekly/monthly); (d) holds that
pause transfers pending email review; (e) mid-campaign re-verification that can
pause transfers after money has already moved. Sources: articles 204119238,
360001992767 (edited 2026-09-23), 21281826060571, 360042879132.

**VERIFIED — organizer-only control surface.** "Only an organizer can close a
fundraiser"; "Only the organizer can edit the fundraiser"; "Only a GoFundMe
organizer can record offline donations." Beneficiaries and co-organizers cannot.
Sources: articles 203604074 (edited 2026-08-05), 360001992687 (edited
2026-09-25), 203604304 (en-gb, edited 2026-05-04).

### 2.5 Fraud detection and content moderation

**VERIFIED (claims, not mechanisms).** "Misuse of funds is extremely rare thanks
to our **advanced fraud prevention technologies** and global team of dedicated
Trust & Safety specialists" (article 203604704, edited 2026-01-27). GoFundMe
publishes **no** detail on signals, models, review volumes, action rates or
appeal-overturn rates.

**COULD NOT ESTABLISH:** any published GoFundMe transparency report with
moderation volumes, takedown counts, refund counts or Giving Guarantee claim
statistics. Searched: gofundme.com newsroom, transparency.gofundme.com (returns
HTTP 403 to automated fetch), the help centre, and web search for "GoFundMe
transparency report". **The absence is itself a competitive opening** — publishing
real numbers is cheap for a small platform and impossible for GoFundMe to match
without inviting comparison.

**VERIFIED — prohibited conduct is in the ToS, not a standalone policy page.**
ToS (Effective 2026-06-23) §8.2 prohibits "Fundraisers that are fraudulent,
misleading, inaccurate, dishonest or impossible"; §8.17 prohibits "the promotion,
advertisement, sale or resale of goods or services"; §9.5 prohibits harvesting or
publishing others' PII; **§9.23 prohibits converting funds raised into
cryptocurrency for delivery to recipients**. §16: GoFundMe may suspend or
terminate an account "**with or without providing you notice**." §1.3 imposes
**binding arbitration and a class-action waiver**. §6.1: compliance with
fundraising and solicitation laws is "**solely your responsibility**."
https://www.gofundme.com/c/terms

### 2.6 Dispute and report flows

**VERIFIED** — five distinct report entry points plus a regulated-market one
(article 203604694 "Report a fundraiser", edited 2026-05-26 —
https://support.gofundme.com/hc/en-us/articles/203604694):
1. Donors: request a refund and report a fundraiser you donated to
2. Beneficiaries: report a fundraiser you are owed funds from
3. Report a fundraiser only
4. Report an image on a fundraiser
5. **"For customers in the UK/EU: Report Illegal Content — (DSA/OSA)"** — a
   dedicated EU Digital Services Act / UK Online Safety Act channel.

**VERIFIED — reporter anonymity:** "we won't share the name of the person making
the report with the organizer or beneficiary, unless compelled by law or a
concern for the safety of our users."

**VERIFIED — the stated enforcement threshold is high:** "**only fundraisers that
violate our Terms of Service or have a proven misuse of funds will be removed.**
Personal disputes such as custody or disagreements that don't violate our Terms
of Service will not have action taken." This is the documented basis for the
"GoFundMe did nothing" complaints in docs 22/24.

**VERIFIED — donor-facing due diligence is outsourced to the donor.** GoFundMe
tells donors to read the story and ask themselves whether the organizer's
relationship to the recipient is stated, whether the recipient controls the
withdrawals, and whether family and friends are donating — and to message the
organizer if not (article 115015913668 "Determining if a GoFundMe is
trustworthy", **edited 2026-10-07** —
https://support.gofundme.com/hc/en-us/articles/115015913668). **There is no
platform-computed trust signal on the page.** That is a product vacuum.

### 2.7 Organizer↔donor messaging (and a notable consent gap)

**VERIFIED** — donors can DM or email the organizer from the fundraiser page.
Donors **cannot** message the beneficiary. Organizers **cannot** turn messages
off: "You aren't able to turn off messages. To ensure transparency…" (article
44158089402395, edited 2026-07-22 —
https://support.gofundme.com/hc/en-us/articles/44158089402395). For a grieving or
at-risk organizer this is a forced-exposure surface.

### 2.8 Documented failures and live litigation (as of 2026-10-14)

**The 1.4M unauthorized nonprofit pages affair — the most important competitive
fact about GoFundMe right now.**

- **VERIFIED (state primary source).** Alaska Attorney General sued **GoFundMe,
  PayPal Inc., Charity Navigator, JustGiving, Pledge, and Network for Good** on
  **2026-03-10** under the Alaska **Charitable Solicitations Act** and the
  **Unfair Trade Practices and Consumer Protection Act**. The release states
  GoFundMe "created **1.4 million functional pages**" for charities in **fall
  2025**, and "may have created unauthorized pages for as many as **5,000
  Alaska-based charities**, in most cases without their knowledge." Relief sought:
  removal orders plus **civil penalties per violation**. Quote: "Alaska law is
  clear: if you're going to raise money in a charity's name, you must first get
  the charity's consent."
  https://law.alaska.gov/press/releases/2026/031026-FinTech.html
- **VERIFIED (dated legal analysis of a primary letter).** A multistate demand
  letter dated **2026-03-03** to GoFundMe's General Counsel, led by **Pennsylvania
  AG David W. Sunday, Jr.**, described as from **22 state regulators** (17 named:
  CA, DE, KY, IL, MD, MA, MI, MN, NH, NJ, NM, NY, OK, OR, PA, SC, TN). Demands
  included proof all unauthorized pages were removed, takedown procedures that
  work without charity action, an explanation of **SEO changes so charities' own
  campaigns are not disadvantaged**, prominent disclosure of the legal recipient
  and the DAF sponsor's role and any fees or tips, no implied affiliation, and a
  review of **whether "tips" collected by GoFundMe should be redirected to the
  charities**. Response due ~**2026-03-17**; "Investigative requests from
  interested States are also forthcoming."
  https://www.fplglaw.com/insights/update-on-gofundme-controversy-state-charity-regulators-demand-answers-and-action/ (2026-03-06)
- **REPORTED.** Federal class action by three Oregon nonprofits (Commute Options
  for Central Oregon; McKenzie Valley Long Term Recovery; Outdoor Education
  Adventures) in the **U.S. District Court for the District of Oregon (Eugene)**,
  filed ~**2026-03-11**, alleging GoFundMe "unilaterally established" donation
  pages and retained "fees, interest, or other value derived from the donations."
  Reported still in discovery as of mid-2026.
  https://lookouteugene-springfield.com/story/latest-news/2026/03/25/lawsuit-by-oregon-nonprofits-targets-unauthorized-webpages-posted-by-gofundme/
- **REPORTED.** Company response: CEO Tim Cadogan apology email **2025-10-23**;
  Nonprofit Pages made **fully opt-in**; unclaimed pages removed and de-indexed;
  **SEO turned off by default**; claim that no donations were processed from
  unclaimed pages and no transaction fees charged.
  https://www.utahnonprofits.org/2025/10/23/gofundme-created-1-4m-donation-pages-without-your-consent/ ;
  https://bloomerang.com/blog/gofundme-autogenerated-donation-page
- **REPORTED.** Specific documented harm: unclaimed pages held donor data inside
  GoFundMe, so nonprofits could not acknowledge donors, issue tax receipts, or
  follow up. https://www.truesense.com/blog/what-nonprofits-need-to-know-about-gofundmes-unauthorized-nonprofit-pages

**The tip-default class action.**
- **REPORTED (press account of a filing).** *Donovan (and Baker) v. GoFundMe*,
  U.S. District Court for the **Northern District of Illinois**, filed **August
  2026**. Claims under the **Illinois Consumer Fraud and Deceptive Business
  Practices Act** and the **Georgia Fair Business Practices Act**. Alleges a tip
  is "automatically and surreptitiously added… without her affirmative consent"
  ($50 → $8.25; $10 → $1.00) and that the checkout "does not disclose that the tip
  is optional or that it can be removed." GoFundMe's ToS (updated 2026-06-23)
  compel arbitration and waive class actions — so the likely outcome is procedural,
  not a merits ruling. The complaint asserts **$55M 2024 revenue, +90% YoY**;
  treat that number as a pleading, not a fact.
  https://www.shawlocal.com/northwest-herald/2026/08/20/mchenry-woman-sues-gofundme-claims-it-uses-deceptive-tips-to-pocket-money-from-donors/

**Reputation signals.**
- **VERIFIED.** Trustpilot (retrieved 2026-10-14): **3.3**, **24,312** reviews,
  **56% 1-star / 38% 5-star**. https://www.trustpilot.com/review/gofundme.com
- **REPORTED.** BBB customer reviews averaging **~1.05/5 from 41 reviews**, while
  a secondary source claims an A+ BBB accreditation grade — these conflict and I
  did not resolve them. https://www.bbb.org/us/ca/redwood-city/profile/crowdfunding/gofundme-1116-876254/customer-reviews
- **COULD NOT ESTABLISH:** any 2025–2026 multi-million-dollar criminal GoFundMe
  fraud conviction. Searched DOJ/AG-style queries; the large cases (the ~$400K
  New Jersey "Paying It Forward" case) are 2019–2022. Do **not** claim a current
  fraud-conviction wave.

---

## 3. PRODUCT SURFACE — the feature set a new entrant is measured against

All items **VERIFIED** from GoFundMe's own documentation unless marked.

### 3.1 Campaign creation
- **Two paths:** a step-by-step flow, or an **AI "smart fundraising coach"**
  (US only) that "will ask you a few questions… and create a GoFundMe for you in
  about **10 minutes**" (article 360001992627, edited 2026-07-31; article
  33680613658011 "Using GoFundMe's Smart Fundraising Coaching", edited
  2026-09-28 — https://support.gofundme.com/hc/en-us/articles/33680613658011).
- Creation order: payout country/currency (fixed thereafter) → who you are
  fundraising for (**Yourself / Someone else / Charity**) → account → story and
  title → goal → cover media → publish.
- **Two fundraiser types:** personal/organization, and nonprofit — the latter only
  for registered charities in the **US, UK, Ireland, Australia, Canada**, with
  funds going directly to the charity via **PayPal Giving Fund** or **GoFundMe
  Pay** (article 203603984, edited 2026-08-28).
- Editable after launch: title, goal, main image, story, **fundraiser URL**,
  category, location (article 360001992687, edited 2026-09-25; article
  14232621866267 "Choosing a title and customizing your link", edited 2026-10-08).

### 3.2 Media
- Photos: **JPEG/PNG/BMP, <20 MB**, recommended ≥720×405, landscape; multiple
  photos encouraged because they feed auto-generated share assets (article
  203604584, edited 2026-09-22).
- **Video is YouTube-only — there is no native video upload.** "To share a video
  on your GoFundMe, you'll need to use a video that's been posted publicly to
  YouTube", and **YouTube Shorts links are not supported** without a URL rewrite
  (article 4405106210843, edited 2026-04-29). **A clear, cheap parity-plus
  opportunity: native video upload.**

### 3.3 Updates, comments, donor engagement
- **Updates** with photos, emailed to all subscribed supporters; guidance is "an
  update (or more) a week" (article 12553895153563, **edited 2026-10-07**).
- **"Words of support"** = the comment layer; publicly visible unless the donor
  gave anonymously; postable from the receipt or the account; **toggleable off**
  by the organizer (articles 360001992827, 360001992687).
- **Thank-yous**, including **automatic thank-yous (US, on by default)** with an
  editable default message, plus a manual queue that auto-advances to the next
  unthanked donor (article 205213077, edited 2026-09-17).
- **Anonymous donation** via a checkbox at checkout; organizers can also
  retroactively anonymise a donation (articles 360001992827, 205213077).

### 3.4 Roles
- **Organizer** — sole edit/close/offline-donation authority.
- **Beneficiary** — invited, withdraws to their own bank account, name shown
  publicly (editable to a nickname, not hideable) (articles 204993267 edited
  2026-10-08; 4404558310683 edited 2026-07-24; 203604574).
- **Co-organizer** — can send thank-yous and post updates, and sees "Your impact"
  (donor count and amounts attributed via their **unique share link**).
  **Changed recently:** manual donation attribution at checkout and public
  per-co-organizer donation display were **removed**; attribution is now automatic
  via unique share links (article 360001489648, edited 2026-09-23 —
  https://support.gofundme.com/hc/en-us/articles/360001489648).

### 3.5 Sharing and share incentives — their strongest product moat
- **Unique share links with impact attribution**, generated for anyone logged in
  "after donating, on the fundraiser page, or from within the Manage page"
  (article 360001489648). This makes every donor a tracked, gamified
  distributor — not just the organizer.
- **Auto-generated share assets**: GoFundMe generates **videos, posters and
  messages** from the campaign's media, title and story. Videos → YouTube, TikTok,
  Snapchat, Facebook Reel/Story, Instagram Reels. Posters → LinkedIn, WhatsApp,
  Instagram Post/Story, Nextdoor, Facebook Post, X, Messenger. Videos are
  English-only in US/CA/AU/IE/UK. Opt-out available, with reduced sharing if you
  do. (article 38748476284955, edited 2026-08-19 —
  https://support.gofundme.com/hc/en-us/articles/38748476284955)
- **Live/streaming fundraising tools (Beta)**: OBS-embeddable **live progress
  bar, donation alerts, and QR code**, usable on **anyone's** fundraiser, for
  YouTube/Twitch/TikTok/Instagram Live (article 30297868605595, **edited
  2026-10-01** — https://support.gofundme.com/hc/en-us/articles/30297868605595).
- **Contact import** with recommended first-outreach contacts, plus **SMS and
  email sharing reminders** (articles 43284610426779 edited 2026-09-24;
  33680613658011).
- Per-platform share guides for Facebook, Instagram, X, Nextdoor.

### 3.6 Goal mechanics
- **Keep-what-you-raise; no requirement to hit the goal.** Goal editable up or
  down at any time. **"Suggested goals"** computed from "fundraisers with similar
  locations, categories, etc. that found success… in the past 12 months", and
  **"automated goals"** that can be opted out of (article 4405145410331, edited
  2026-08-06 — https://support.gofundme.com/hc/en-us/articles/4405145410331).
- GoFundMe explicitly tells donors that **exceeding a goal is not a misuse
  signal** (article 115015913668).

### 3.7 Discovery and search
- Homepage search by **organizer name, beneficiary name, or title**, with filters
  for **purpose, "near you", and "close to reaching its goal"** (article
  4402638822420, edited 2026-03-27).
- **Communities** — automatic, **opt-out** cause/crisis/location clusters;
  fundraisers are added with "**No action… required on your part**", and GoFundMe
  "may automatically cross-post certain updates you share." Opting out means
  toggling off "Allow my fundraiser to be found in search and discovery" — i.e.
  **you cannot leave a Community without also leaving search** (article
  44565772971931, edited 2026-08-13 —
  https://support.gofundme.com/hc/en-us/articles/44565772971931). Note the
  consent pattern: this is the same auto-enrol-then-offer-opt-out shape that
  produced the 1.4M-pages scandal.
- **81 marketing category pages** in the content hub's category sitemap.
- **Private fundraisers** are removed from the public directory and made
  Communities-ineligible (article 360001992707, edited 2026-09-24).

### 3.8 Recurring, matching, offline, DAF
- **Recurring monthly** giving: donor-side **5% fee**; card/PayPal/bank only; not
  available in **Italy or Canada**; monthly email receipts plus in-account
  receipt history; cancellable any time; covered by the Giving Guarantee (article
  26707416172059, edited 2026-10-07).
- **Matching / employer gifts: NOT in the consumer product.** Donation matching
  exists only in **GoFundMe Pro**, supports online donations only (not tickets,
  registrations or offline donations), and **"GoFundMe Pro tracks matched funds
  but doesn't collect or distribute them"** — the nonprofit must coordinate with
  the sponsor (prosupport article 37288720588571, **edited 2026-10-13**).
  **COULD NOT ESTABLISH** any employer-matching integration (Benevity/Double the
  Donation-style) on personal fundraisers; searched the help centre for
  "matching donation employer" and the web.
- **Offline donations: supported on the consumer product.** Cash/cheque/Venmo can
  be recorded by the **organizer only**; they count toward the goal, carry **no
  transaction fee**, and are **not included in transfers** (article 203604304,
  en-gb, edited 2026-05-04).
- **DAF giving**: donors can give from a donor-advised fund (article
  24174014869915, edited 2026-07-07), and GoFundMe now operates its **own DAF —
  "GoFundMe Giving Fund", an independent 501(c)(3)** that receives, holds,
  **invests** and distributes contributions, issues a tax receipt at contribution
  time and a single year-end summary receipt. Contributions are **irrevocable**
  and **cannot fund personal fundraisers** (article 38786094281627, edited
  2026-09-29 — https://support.gofundme.com/hc/en-us/articles/38786094281627).

### 3.9 Receipts
- Every donation gets an emailed confirmation receipt; a copy can be re-requested
  by email via a form (article 360001977948, edited 2026-09-11).
- **Tax receipts only for nonprofit fundraisers**, issued by **PayPal Giving
  Fund** or **GoFundMe Pro** (for GoFundMe Pay enrollees), guaranteed deductible
  only in **US, UK, Canada, Ireland, Australia**. Nonprofit fundraisers carry a
  "Tax deductible" tag (US) or a blue check (elsewhere) (articles 360001977948,
  360039267752 edited 2026-08-31).

### 3.10 Apps, widgets, integrations
- **Mobile apps** for iOS and Android, with app-specific flows documented
  (edit pencil, bottom-nav Donations tab, "Me" icon) and mobile-only share
  destinations (Instagram, TikTok) — VERIFIED from help articles 360001992687,
  203604304, 38748476284955. **REPORTED** store metrics: iOS ~4.7★ / ~45K
  reviews; Google Play **5M+ installs**; latest version ~12.11.0 — third-party
  trackers only, dates ranging Nov 2025–mid 2026
  (https://appgoblin.info/apps/734130700 , https://www.appbrain.com/dev/GoFundMe+Inc/).
- **Embeddable widget: VERIFIED to exist.** `robots.txt` disallows
  `/f/*/widget/*`, and `https://www.gofundme.com/f/{slug}/widget/large` returns
  **HTTP 200 text/html** (tested 2026-10-14). https://www.gofundme.com/robots.txt
- **Integration surface, VERIFIED from the live CSP header** on a campaign page
  (`content-security-policy-report-only: frame-ancestors …`, observed
  2026-10-14): gofundme.com, **hopin.com, pillar.io, takethemameal.com,
  kudoboard.com, weremember.com, forevermissed.com, giftwhale.com, chirp.me,
  giveinkind.com, myregistry.com, caringbridge.org, linktr.ee**. This is a
  memorial/registry/care-coordination partner ecosystem — GoFundMe embeds
  *inside* the sites where grief and illness logistics already happen. Docs 22–24
  do not mention it, and it is a far better distribution lesson than their SEO
  advice. A **Pillar link-in-bio** integration is separately documented (article
  38743319807387, edited 2026-05-11).
- **GoFundMe Pro** (the former Classy; classy.org now redirects to
  pro.gofundme.com — REPORTED): CRM integrations including **Salesforce NPSP and
  Agentforce Nonprofit Cloud**, Live Events with paddle-raise and
  text-to-donate, peer-to-peer campaigns, offline-donation records with CRM sync,
  reporting, donation matching, and a public **status page with a Fundraising /
  Payments / Authorization / Search / Currency / Billing API surface** (VERIFIED
  from https://status.gofundme.com/ , retrieved 2026-10-14; prosupport articles
  above). **COULD NOT ESTABLISH** GoFundMe Pro's price: the pricing page is a
  quote-request form; Capterra lists "$299/month usage-based" while another source
  describes annual subscription + per-transaction, and a competitor (Zeffy) claims
  2.4% + $0.30 — all REPORTED and mutually inconsistent.
- **COULD NOT ESTABLISH:** a public developer API for the *consumer* GoFundMe
  product. The documented API belongs to GoFundMe Pro.

### 3.11 AI features shipped
- **Smart Fundraising Coach** — creation plus ongoing "personalized tasks and
  insights", a daily share plan, contact recommendations, and SMS/email coaching
  (VERIFIED, article 33680613658011, edited 2026-09-28). Announced **2026-03-12**;
  GoFundMe's own projection is that the AI features will help users raise an
  additional **$125M** in the year (REPORTED —
  https://www.businesswire.com/news/home/20260312265664/en/ and
  https://www.fastcompany.com/91507558/gofundme-launches-ai-fundraising-coach-to-help-people-raise-more-money).
- **AI-generated share videos/posters/messages** (VERIFIED, article 38748476284955).
- **AI-suggested goals** from similar-campaign data (VERIFIED, article 4405145410331).
- **GoFundMe Pro**: "more than 40 updates in H1 2026 spanning AI-powered giving,
  faster checkout, and peer-to-peer" (REPORTED —
  https://pro.gofundme.com/c/blog/new-on-gofundme-pro-h1-2026/).

---

## 4. UX AND CONVERSION

**VERIFIED — the donation funnel is five steps with no account requirement**
(article 360001992827, edited 2026-10-07):
1. "Donate now"
2. Choose one-time or monthly (if the organizer enabled monthly)
3. Enter amount **and adjust the optional tip** (same screen)
4. Enter payment details; optional "Don't display my name publicly" checkbox
5. Confirm donation + tip → "Donate now" → emailed receipt

- **Guest donation: VERIFIED.** "You don't need to sign up for an account to make
  a donation."
- **Post-donation share prompt: VERIFIED.** Immediately after donating the donor
  sees "**Now help spread the word**" with share options, plus a prompt to leave
  "words of support". Critically, the share link generated here is the donor's
  **own attributed unique share link** (article 360001489648) — the share prompt
  is a measurable viral loop, not a courtesy.
- **Wallets: VERIFIED and extensive.** US: **Apple Pay, Google Pay, PayPal,
  Venmo, ACH via Plaid** (some fundraisers). Germany/Austria/Belgium and
  Switzerland add **Klarna**. Netherlands adds **iDEAL**. Cards: Visa,
  Mastercard, Amex (**excluded on nonprofit/charity fundraisers**), Discover.
  Nonprofit fundraisers accept **only PayPal and DAF** as digital payments in all
  countries. (article 4402563115412, edited 2026-07-08 —
  https://support.gofundme.com/hc/en-us/articles/4402563115412)
- **Tip control: VERIFIED mechanics** — a draggable slider plus "Enter custom
  tip", changeable to 0; GoFundMe refunds unintentional tips on request (article
  360051144952).
- **Tip default: COULD NOT ESTABLISH** from GoFundMe's own documentation (see
  §1.3). The *allegation*, from a court filing, is that it is pre-selected and
  percentage-scaled at roughly 10–16.5% with no on-screen statement that it is
  optional or removable. **Write LastDonor's comparison copy against the
  mechanism ("pre-selected, percentage-scaled, undisclosed default"), not against
  a number you cannot cite.**
- **Amount presets: COULD NOT ESTABLISH.** Not documented in the help centre, and
  the donate page's preset array is not in the server-rendered payload (inspected
  `/f/{slug}/donate` HTML, 2026-10-14). Only the hard floors/ceilings are
  published (§1.8).
- **Minimum $5** (USD and most currencies) is a real conversion constraint — a
  lower floor is a differentiator for micro-giving.

**What is measurably good and should be copied outright:** no-account donation;
tip and amount on one screen; wallet breadth including Venmo and ACH; an
attributed share prompt at the moment of peak donor goodwill; words-of-support
authorable later from the receipt (recovers the commenters who bounce at
checkout); and automatic thank-yous on by default.

---

## 5. TRANSPARENCY AND REPORTING

**What a donor can see on a campaign page (VERIFIED):** organizer display name
(may be a nickname), beneficiary display name if one is added, location,
category, goal and amount raised, donor list with words of support (anonymous
donors hidden), updates, a "Tax deductible" tag or blue check on nonprofit
fundraisers, and a Report button. Plus a Message/Contact button to the organizer.

**What a donor cannot see (VERIFIED by absence in GoFundMe's own docs):**
- **No withdrawal or transfer status.** Nothing on the page tells a donor whether
  funds have been transferred, to whom, or when. The only transfer visibility
  ("Transfers" section, scheduled and sent transfers, fee "Breakdown") is in the
  **organizer's** dashboard (articles 204119238, 203604424).
- **No fund-usage reporting.** There is no itemised spend, receipt upload or
  disbursement ledger anywhere in the product. Use-of-funds exists only as
  **prose in the story** and whatever the organizer volunteers in updates
  (articles 115015836967, 12553895153563).
- **No verification badge or identity signal.** Nonprofit certification is
  badged; **individual organizer identity is not.** GoFundMe instead instructs
  donors to assess legitimacy themselves (article 115015913668, edited
  2026-10-07).
- **No campaign history or organizer track record.** There is a public profile
  (article 30773013247643, edited 2026-09-10) but **COULD NOT ESTABLISH** that it
  exposes prior-campaign outcomes, payout history or a reputation score.
- **Organizers cannot get a full donor list** — by GoFundMe's own statement, for
  data-protection reasons (article 205213077, edited 2026-09-17).
- Asymmetry worth noting: **NPO beneficiaries** *can* see donor name, email,
  amount and transaction details **even for anonymous donors** (Privacy Notice,
  2026-08-17), while a personal organizer cannot get a donor list at all.

**This is the largest product vacuum in the entire benchmark.** The platform that
handles the money publishes nothing about where it went. Every trust claim
GoFundMe makes is about *process* ("our team investigates"); none is about
*evidence*.

---

## 6. SEO AND DISTRIBUTION

All **VERIFIED** by direct inspection on 2026-10-14.

### 6.1 Scale of the indexable footprint
- `https://www.gofundme.com/robots.txt` declares **39 sitemaps**: the root index,
  an i18n sitemap, **24 locale sitemaps** (de-at, de-ch, de-de, en-au, en-ca,
  en-dk, en-fi, en-gb, en-ie, en-no, en-se, es-es, es-us, fr-be, fr-ca, fr-ch,
  fr-fr, fr-lu, it-it, nl-be, nl-nl, pt-pt …) and **13 `/c/` content-hub sitemap
  indexes**.
- The root sitemap index lists **51 shards** (`sitemaps/www/sitemap1..41+.xml.gz`);
  shard 1 alone contains **20,000 `<loc>` entries**, all `/f/{slug}` campaign
  URLs. Order of magnitude: **~1 million individually indexable campaign pages.**
- The `/c/` content hub is **WordPress with Yoast SEO** (the sitemap index
  references `wordpress-seo/css/main-sitemap.xsl`), with **24 child sitemaps**
  including `post` (288 URLs), `page` (143), **`category` (81)**,
  `fundraising-ideas` (54), `start` (22), `cause` (7), `safety` (5), plus
  `heroes`, `supporter-space`, `webinar`, `crowdfunding-lessons` and author/tag
  archives. Content-hub `lastmod` values were **2026-10-13 and 2026-10-14** —
  they publish continuously.

### 6.2 Page structure
- Campaign pages are **Next.js SSR** behind **nginx** and **AWS CloudFront**,
  with `cache-control: max-age=300, s-maxage=300, stale-while-revalidate=600,
  stale-if-error=3600` (observed headers, 2026-10-14). Media served from
  `d2g8igdw686xgo.cloudfront.net`.
- Self-referencing `rel="canonical"`.
- Title/description/OG built from the story: `og:title` = "Donate to {title},
  organized by {name}"; description = story excerpt + "{name} needs your support
  for {title}!".
- **`og:locale:alternate`** for en_GB, nl_NL, fr_FR, de_DE, es_LA.
- `robots.txt` **disallows the thin/duplicate surfaces** — `/f/*/donate`,
  `/f/*/donations`, `/f/*/share`, `/f/*/leaderboard`, `/f/*/widget/*`,
  `/s?*`, `/auth`, `/track` — concentrating crawl budget on the one canonical
  campaign URL. Share-poster image paths (`/f/*/fb/*`, `/x/*`, `/ig/*`, …) are
  disallowed to general crawlers but **explicitly allowed to LinkedInBot,
  Twitterbot, facebookexternalhit and Facebot** so share cards still unfurl. That
  is a sophisticated, deliberate crawl/unfurl split.

### 6.3 Where GoFundMe is actually weak — two contestable gaps
1. **Structured data is minimal.** The only JSON-LD on a campaign page is a
   three-node `@graph`: `WebPage` + `WebSite` + `Organization`. **No
   `DonateAction`, no `Offer`, no `MonetaryGrant`, no `AggregateRating`, no
   `FAQPage`, no `BreadcrumbList`.** (Inspected
   https://www.gofundme.com/f/amyloidosis-warrior , 2026-10-14.)
2. **No `hreflang` link tags on campaign pages** — zero `hreflang` occurrences in
   the page HTML; internationalisation is signalled only by `og:locale:alternate`,
   which search engines do not use for hreflang clustering.

### 6.4 What a small competitor can realistically contest — and what it cannot
- **Cannot contest:** head terms ("gofundme", "fundraising", "crowdfunding"),
  branded navigational search, and the ~1M-page long tail of individual campaign
  names. **REPORTED** traffic: ~50–60M visits/month, with **direct traffic the
  largest channel at ~47%** and google.com ~13.7% (Semrush, Aug 2026,
  https://www.semrush.com/website/gofundme.com/overview/ ; Similarweb Nov 2025
  shows direct at 62% of desktop). Organic search is a *minority* of their
  traffic — their moat is brand recall, not SEO.
- **Can contest, with evidence:**
  (a) **Problem-intent long tail** — their help centre dominates "how do I…"
  queries but there is no GoFundMe content for "GoFundMe took a tip I didn't
  authorise", "GoFundMe transfer deadline auto refund", "GoFundMe hold how long",
  "GoFundMe won't accept my ID". Docs 22/24 already identified these; this
  research supplies the *verifiable mechanics* to answer them accurately, which
  is what earns the ranking.
  (b) **Rich-result surfaces GoFundMe has left empty** — correct `DonateAction`,
  `FAQPage` and `BreadcrumbList` markup, and real `hreflang`.
  (c) **The regulatory story** — "which fundraising platforms created donation
  pages for your charity without consent" is a live 2026 query with 22 state
  regulators, an Alaska AG suit and a federal class action behind it, and
  GoFundMe cannot write that page.
  (d) **The partner-embed channel, not search.** The CSP `frame-ancestors` list
  (§3.10) shows GoFundMe's real distribution is embedding into memorial, registry
  and caregiving sites. A small platform can win individual partners there far
  more cheaply than it can win SERPs.

---

## 7. SCALE AND RELIABILITY

- **VERIFIED (GoFundMe's own current wording):** "With over **$40 billion raised
  from more than 200 million donations**" — article 115015913668, **edited
  2026-10-07** — https://support.gofundme.com/hc/en-us/articles/115015913668 .
  (Note: this is GoFundMe's own help-centre text, which is a stronger citation
  than the secondary roundups; a prior Chronicle of Philanthropy report put the
  figure at $30B including Classy.)
- **VERIFIED architecture signals** (observed 2026-10-14): Next.js SSR; `server:
  nginx`; **AWS CloudFront** edge (`x-cache: Hit from cloudfront`, POP IAD61-P4);
  **5-minute edge TTL with `stale-while-revalidate=600` and
  `stale-if-error=3600`**; HSTS `max-age=31536000; includeSubDomains; preload`;
  `content-security-policy-report-only` for frame-ancestors; locale and visitor-id
  cookies set at the edge (`visitor={"locale":…}`, `gdid`).
  **Directly relevant to LastDonor's `docs/26` §5:** GoFundMe serves campaign
  pages from a shared CDN cache with a 5-minute TTL and explicit SWR/SIE, i.e.
  they accept up to ~5 minutes of staleness on a live donation total in exchange
  for edge scale. That is the empirical benchmark for the ISR/shared-cache
  decision in `docs/26`.
- **VERIFIED — processors:** donations processed through **Adyen or Stripe**
  (personal) and **PayPal / GoFundMe Pro–GoFundMe Pay** (nonprofit); payouts by
  ACH (article 203603984, edited 2026-08-28). Dual-processor on the consumer side
  is a real resilience advantage over a single-processor competitor.
- **VERIFIED — public status page exists but covers GoFundMe Pro, not the
  consumer platform's internals.** https://status.gofundme.com/ (retrieved
  2026-10-14) lists GoFundMe Pro Manager, Campaign & Fundraising Pages, Supporter
  Pages, Customer Domains, Login & Authentication, Live Events, Transactions,
  **Stripe, Braintree, Braintree PayPal Processing, Plaid, PayPal**, CRM
  integrations (Salesforce NPSP, Agentforce Nonprofit Cloud), Cloud Hosting,
  Recursive/Authoritative DNS, **US West and US East regions**, and an API group
  (Fundraising, Payments, Authorization, Search, Currency, Billing & Usage). All
  "Operational"; **no incidents** recorded 2026-09-29 → 2026-10-13.
- **COULD NOT ESTABLISH:** published uptime percentages (the status page links
  `/uptime` but surfaces no figures to automated fetch), any GoFundMe engineering
  blog, any public postmortem, or any 2025–2026 incident report. Searched the
  status page, `/uptime`, and web queries for outage/postmortem/architecture. The
  only incident I located was a **2023** AWS-related GoFundMe Pro (Classy) login
  degradation (REPORTED, https://statusfield.com/services/gofundme-pro/incidents).
- **REPORTED and mutually inconsistent — company scale:** revenue ~$55M (2024,
  Latka/ElectroIQ and echoed in the Donovan pleading) vs ~$100M (Prospeo,
  Bitscale); headcount ~1,440 (Revelio Labs, 2025) vs 643 (Latka) vs 578
  (Bitscale). **Do not cite any of these as fact.** GoFundMe is private and
  publishes no financials.

---

## 8. REGULATORY — the compliance load a serious competitor inherits

### 8.1 Custody and money transmission
**VERIFIED — GoFundMe's own position, ToS Effective 2026-06-23**
(https://www.gofundme.com/c/terms):
- "**GoFundMe itself does not hold any funds** raised on our Platform, nor does it
  handle the actual processing of payments." "Instead, we use third party payment
  processors to manage and process all donations."
- §3.2: GoFundMe "does not hold custody or control over contributed funds" and is
  "**not a bank, payment processor, broker, charity, or financial advisor**", and
  "does not act in any capacity requiring registration or licensure as a
  professional or commercial fundraiser."
- §6.1: compliance with fundraising and solicitation laws is "**solely your
  responsibility**" (the organizer's).

**The architectural lesson for LastDonor:** GoFundMe's entire money-transmission
posture rests on *never touching the money*. Funds move processor→payee. Its own
help centre confirms the operational consequence: "our payment partners are
online payment processors only and, unlike a bank, **are not able to hold your
funds for long periods of time**" (article 204119238) — which is why the transfer
deadline and auto-refund exist. **Any LastDonor design that escrows, pools, holds
pending verification, or delays disbursement risks converting the platform into a
money transmitter.** Doc 22's recommended "proactive fund release" and
"verification-first holding" features must be designed against this constraint,
with Stripe Connect's liability model (and, for genuine escrow, licensed-partner
structures) examined explicitly before build.

**REPORTED / partially verified:** GoFundMe.org's payouts page states money
transmission is handled by **PayPal, Inc.** under PayPal's own state licences —
https://gofundmeorg.payouts.hyperwallet.com/hw2web/compliance/money-transmitter-license/licenses.xhtml
**COULD NOT ESTABLISH** whether GoFundMe Inc. holds any state money-transmitter
licences of its own; I did not query NMLS Consumer Access, which is where that
answer lives.

### 8.2 Charitable solicitation registration — the live compliance front
- **California AB 488** (effective **2023-01-01**, final regulations approved
  **March 2024**) regulates online charitable fundraising platforms and "applies
  to **any nonprofit that solicits or receives donations from California-based
  donors—regardless of where the nonprofit is located**." Platforms must confirm
  recipient nonprofits are in good standing with the **California AG, the
  Franchise Tax Board and the IRS** before allowing them to fundraise; if a
  nonprofit is not in good standing, "GoFundMe Pro can't process donations on
  your behalf." VERIFIED — article 35772206616859, edited 2026-09-21 —
  https://support.gofundme.com/hc/en-us/articles/35772206616859
- **Hawaii** has a new fundraising-consent law with its own GoFundMe guidance
  article — VERIFIED that it exists (article 50867349552667, edited 2026-06-09);
  contents not read.
- **Alaska Charitable Solicitations Act**: "requires solicitors to obtain consent
  before fundraising on behalf of a charity" — the basis of the 2026-03-10 AG
  suit (VERIFIED, https://law.alaska.gov/press/releases/2026/031026-FinTech.html).
- **22 state charity regulators** demanded, among other things, prominent
  disclosure of the legal recipient, the DAF sponsor's role, and any fees or tips
  (2026-03-03 letter, per
  https://www.fplglaw.com/insights/update-on-gofundme-controversy-state-charity-regulators-demand-answers-and-action/).

**Inherited obligation for LastDonor:** if LastDonor ever lists charities it does
not have a signed relationship with, it inherits AB 488's good-standing checks,
Alaska/Hawaii-style consent requirements, and the disclosure demands in the
2026-03-03 letter. **A platform that only lists charities which have affirmatively
onboarded avoids the entire category of exposure that is currently costing
GoFundMe six regulators and two class actions.** That is the strongest
regulatory-arbitrage argument available, and it costs nothing to adopt.

### 8.3 Tax-receipt treatment
**VERIFIED** (articles 204295498 edited 2026-01-16; 360039267752 edited
2026-08-31):
- Personal fundraiser donations are "generally considered to be '**personal
  gifts**'", generally **not taxed as income** to the US recipient and **not
  tax-deductible** for donors.
- "GoFundMe **will not provide you with any tax documentation** for money raised
  on your fundraiser, nor will GoFundMe report the funds you collected as earned
  income" — predicated on the organizer's ToS representation that **no goods or
  services** were provided in exchange. (That representation is also what keeps
  it out of 1099-K territory; the ToS §8.17 ban on selling goods or services is
  the enforcement mechanism.)
- Deductible receipts flow only on nonprofit fundraisers, from **PayPal Giving
  Fund** or **GoFundMe Pro**, guaranteed only in US/UK/CA/IE/AU.
- **GoFundMe Giving Fund** (their DAF) issues a receipt at contribution time plus
  a single year-end summary (article 38786094281627, edited 2026-09-29).

### 8.4 GDPR / UK GDPR / CCPA and US state privacy
**VERIFIED** — Privacy Notice, **last updated 2026-08-17** —
https://www.gofundme.com/c/privacy :
- **Controllers:** **GoFundMe Ireland Limited** for EEA and Swiss users;
  **GoFundMe International Services UK Ltd** for UK users; GoFundMe Ireland also
  serves as **EU representative** for GoFundMe Inc. where GDPR requires it.
- **Legal bases:** consent, contract, legal obligation, legitimate interest —
  mapped to identity verification, donation collection and (consent-based)
  analytics cookies.
- **Transfers:** EEA/UK/Swiss→US on **Standard Contractual Clauses**.
- **CCPA/CPRA:** a separate CCPA Notice; "Do Not Sell or Do Not Share" rights
  with an opt-out form for non-cookie sales; cookie-preference tooling for
  targeted-advertising opt-outs.
- **~20 US state privacy laws** acknowledged (incl. CA, CO, VA, UT, TX, MN); a
  **Nevada**-specific email opt-out; MN and OR residents may request a list of
  third parties.
- **Global Privacy Control: not mentioned** — a concrete, cheap differentiator
  (honour GPC signals and say so).
- **Retention:** as long as GoFundMe "deems necessary for the purpose for which
  that information was collected" — **no stated retention periods**.
- **Under-18:** services "not designed for use by individuals under the age of 18."
- **Donor data to organizers/NPOs:** organizers may receive donor contact
  information; NPO beneficiaries can access donor **name, email, amount and
  transaction details — including for anonymous donations**; GoFundMe Pro clients
  become controllers of that data.
- **DSA/OSA:** a dedicated UK/EU illegal-content reporting route exists (article
  203604694, edited 2026-05-26) — evidence that intermediary-liability regimes
  now require a distinct moderation channel, which LastDonor will need from day
  one if it serves EU/UK users.

---

## (a) PARITY GAPS — what LastDonor must match to be credible

Ranked by how fast absence becomes disqualifying. Every row's evidence is cited
in the section named.

| # | Capability | What GoFundMe does | Evidence (§) | Why it's table stakes |
|---|---|---|---|---|
| 1 | **Guest donation in ≤5 steps, no account** | "You don't need to sign up… to make a donation"; amount + tip on one screen | §4, art. 360001992827 (2026-10-07) | Account walls are the single largest donation drop-off; non-negotiable |
| 2 | **Wallet breadth** | Apple Pay, Google Pay, PayPal, **Venmo**, ACH via Plaid (US); Klarna (DE/AT/BE/CH); iDEAL (NL); Visa/MC/Amex/Discover | §4, art. 4402563115412 (2026-07-08) | A donor without their preferred wallet does not come back |
| 3 | **Keep-what-you-raise + editable goal + suggested goal** | No goal requirement; goal editable up/down; data-derived suggested and automated goals | §3.6, art. 4405145410331 (2026-08-06) | All-or-nothing is disqualifying for emergency use cases |
| 4 | **Post-donation attributed share prompt** | "Now help spread the word" immediately post-donation, generating the **donor's own unique share link** with impact tracking | §3.5, §4, art. 360001489648 (2026-09-23) | This is their growth engine; a plain share button is not parity |
| 5 | **Auto-generated share assets** | Platform-generated **videos, posters and messages** per social destination, from campaign media | §3.5, art. 38748476284955 (2026-08-19) | Organizers in crisis will not make their own creative |
| 6 | **Updates + comments + thank-yous, incl. automatic thank-yous on by default** | Emailed updates to subscribers; "words of support"; auto-thank-you with editable template; auto-advancing manual queue | §3.3, arts. 12553895153563 (2026-10-07), 205213077 (2026-09-17) | Retention and second-donation mechanics |
| 7 | **Beneficiary role with direct payout** | Beneficiary invited, withdraws to their own bank; organizer "relinquishes control" | §3.4, §2.3, ToS §6.1 (2026-06-23) | Without it, every third-party campaign routes cash through a stranger |
| 8 | **Co-organizer role with attributed share links** | Co-organizers post updates, send thank-yous, see "Your impact" per share link | §3.4, art. 360001489648 | Team fundraising is how large campaigns actually scale |
| 9 | **Recurring monthly giving** | Donor-side, cancellable any time, monthly receipts, in-account receipt history | §3.8, art. 26707416172059 (2026-10-07) | And LastDonor can beat the **5% donor surcharge** outright |
| 10 | **Mobile apps (iOS + Android)** | Full organizer dashboard, donation management, offline donations, mobile-only share destinations (IG/TikTok) | §3.10 | Share-to-Instagram/TikTok is mobile-only; no app = no TikTok distribution |
| 11 | **Search + filters + category pages** | Search by organizer/beneficiary/title; filters for purpose, near-me, near-goal; 81 category pages | §3.7, §6.1, art. 4402638822420 | Discovery is also the SEO surface |
| 12 | **Embeddable widget** | `/f/{slug}/widget/large` returns 200 | §3.10, robots.txt | How campaigns live on blogs, obituaries and club sites |
| 13 | **Offline donation recording** | Organizer records cash/cheque/Venmo toward the goal; no fee; excluded from transfers | §3.8, art. 203604304 (2026-05-04) | Church/school/funeral campaigns are hybrid by nature |
| 14 | **Nonprofit fundraisers with automatic tax receipts** | PayPal Giving Fund / GoFundMe Pay; "Tax deductible" tag or blue check on-page | §3.9, art. 360039267752 (2026-08-31) | Required to serve charities at all — and triggers AB 488 (§8.2) |
| 15 | **Processor-run KYC at payout with jurisdictional requirements** | Adyen/Stripe hosted verification; SSN/ITIN, NI number, Canadian Tax ID, RFC, codice fiscale | §1.6, §2.1, arts. 360001977868 (2026-07-27), 360028386391 (2026-09-23) | This is the floor, not a feature. **Being faster and kinder here is the opening (see b-2)** |
| 16 | **A donor-protection guarantee, published as policy with an effective date** | Giving Guarantee (eff. 2025-09-24) + Beneficiary Guarantee | §2.2 | Donors now expect one; absence reads as a red flag |
| 17 | **Multiple report entry points incl. a DSA/OSA illegal-content route** | Five report flows plus a dedicated UK/EU channel | §2.6, art. 203604694 (2026-05-26) | Legally required in the EU/UK, and expected everywhere |
| 18 | **Appeals process with a stated window** | Appeal content/fundraiser/account action **within six months** | §1.5, art. 23866683344411 (2026-09-15) | Default-deny enforcement without appeal destroys trust |
| 19 | **Edge-cached pages that survive a traffic spike** | Next.js SSR behind CloudFront, 5-min TTL, SWR 600s, SIE 3600s | §7 | A viral campaign is the whole business model; matches `docs/26` §5 |
| 20 | **AI creation assist** | Smart Fundraising Coach: campaign in ~10 min, then daily share plan, contact recommendations, SMS/email coaching | §3.11, art. 33680613658011 (2026-09-28) | A blank story field in a crisis is a conversion cliff |

---

## (b) ATTACK SURFACE — documented weaknesses a focused competitor can beat

| # | Weakness | Evidence (dated, cited) | The beat |
|---|---|---|---|
| **b-1** | **No identity verification before a campaign goes live.** Account needs only a name (which "can be a nickname") + email; KYC happens at *transfer setup*, is performed by Adyen/Stripe, and is **risk-based** — "Documents won't be needed for every customer." | VERIFIED: arts. 360001992627 (2026-07-31), 203604574 (2026-09-25), 360028386391 (2026-09-23) | Verify identity **before publish**, display a dated, scoped verification state on the page. This is the one structural claim GoFundMe cannot answer without rebuilding its funnel. |
| **b-2** | **Beneficiary consent is a request in a help article, not a control.** "we **ask** that you reach out to them prior"; GoFundMe explicitly supports withdrawing and delivering funds "outside GoFundMe", including to unsupported countries. Remedy is a retrospective report. | VERIFIED: arts. 115015836967 (2026-08-25), 115010242608 (2026-06-11), 115015913628 (2025-12-11) | Enforced **named-beneficiary consent handshake** before publish or before payout; "no campaign in your name without your say-so" is provably differentiated. |
| **b-3** | **Zero fund-usage and withdrawal transparency for donors.** No transfer status, no spend ledger, no receipts, no organizer track record anywhere on the page. GoFundMe instead instructs donors to vet campaigns themselves. | VERIFIED by absence: §5; art. 115015913668 (2026-10-07) | A public disbursement ledger: what was withdrawn, when, by whom, against what stated purpose. Costs little; impossible for GoFundMe to retrofit across ~1M pages. |
| **b-4** | **The tip default is pre-selected, percentage-scaled, and undisclosed** — now pleaded in federal court ($50 → $8.25; $10 → $1.00), with ToS arbitration/class-waiver blocking the merits. | REPORTED (court filing via press): https://www.shawlocal.com/northwest-herald/2026/08/20/mchenry-woman-sues-gofundme-claims-it-uses-deceptive-tips-to-pocket-money-from-donors/ ; VERIFIED mechanics: art. 360051144952 (2026-06-17) | Default $0, typed not slid, with a pre-checkout line-item breakdown. Attack the **mechanism**, never a percentage you can't cite. |
| **b-5** | **The undisclosed 5% recurring-donation surcharge.** Donors pay 5% *on top of* the transaction fee on every monthly gift — ~7.9% + $0.30 in the US. Absent from almost every comparison. | VERIFIED: arts. 203604424 (2026-09-30), 26707416172059 (2026-10-07) | Charge processing only on recurring gifts and say so in a table. The cleanest, most checkable fee win available. |
| **b-6** | **Payout latency is structural, and the transfer deadline can auto-refund a campaign.** Up to 7+ business days to verify, then 2–5 to deposit, plus 2–5 for a hold review; unverified transfers "could be automatically refunded"; unsupported-country organizers lose everything. | VERIFIED: arts. 204119238 (2026-09-23), 21281826060571 (2026-06-11), 360042879132 (2026-01-14), 360001972748 (2026-06-24) | Verify-first means payout can be same/next-day because KYC is already done. **But design within §8.1's money-transmission constraint** — do not build escrow casually. |
| **b-7** | **Holds are email-only, reasons are not disclosed, and no timeline is given up front.** Review "must be completed by responding to the email"; the four hold triggers are generic; 2–5 business days only *after* all information is collected. | VERIFIED: art. 21281826060571 (2026-06-11) | In-product review centre: named reason, exact documents needed, a countdown, and a human contact. Doc 22 §4 proposed this on sentiment; it is now evidenced. |
| **b-8** | **The Giving Guarantee is narrower than its marketing.** Effective only from 2025-09-24; one-year window; **beneficiary claims require a police report**; excludes countries GoFundMe can't pay; >3 claims/month is "excessive"; decided in "sole and absolute discretion"; modifiable without notice; "not insurance." | VERIFIED: https://www.gofundme.com/c/safety/gofundme-guarantee (2026-10-14) | Published, non-discretionary adjudication criteria; no police report; a stated SLA; and a published claim/outcome count. |
| **b-9** | **The 1.4M unauthorized nonprofit pages affair is live legal exposure.** Alaska AG suit 2026-03-10 (Charitable Solicitations Act + UTPA, up to ~5,000 Alaska charities); 22-state regulator letter 2026-03-03 with a 14-day deadline and a demand to review whether "tips" should be redirected to charities; Oregon federal class action ~2026-03-11. | VERIFIED: https://law.alaska.gov/press/releases/2026/031026-FinTech.html ; https://www.fplglaw.com/insights/update-on-gofundme-controversy-state-charity-regulators-demand-answers-and-action/ (2026-03-06); REPORTED: https://lookouteugene-springfield.com/story/latest-news/2026/03/25/lawsuit-by-oregon-nonprofits-targets-unauthorized-webpages-posted-by-gofundme/ | Charities appear **only after affirmative onboarding**, with the legal recipient, fee and tip disclosed on-page. Sidesteps the whole exposure category (§8.2) and is a credible nonprofit-acquisition pitch *today*. |
| **b-10** | **Consent-by-default is a pattern, not an incident.** "Communities" auto-enrols fundraisers with "No action… required on your part", may auto-cross-post updates, and the only opt-out **also removes you from search**. Auto-thank-yous are on by default. Organizers **cannot turn off donor DMs** ("You aren't able to turn off messages"). | VERIFIED: arts. 44565772971931 (2026-08-13), 205213077 (2026-09-17), 44158089402395 (2026-07-22) | Granular, separable consent — discovery, clustering, cross-posting and messaging as independent toggles. Especially load-bearing for DV, medical-privacy and bereaved organizers. |
| **b-11** | **Organizers cannot get their own donor list** ("To comply with data protection regulations, it's not possible…"), while **NPO beneficiaries can see donor name, email and amount even for anonymous donors.** | VERIFIED: art. 205213077 (2026-09-17); Privacy Notice (2026-08-17) | Give organizers a real exportable ledger with explicit, donor-controlled consent at checkout — and never expose an anonymous donor's identity to anyone. |
| **b-12** | **No published transparency reporting of any kind** — no moderation volumes, takedown counts, guarantee-claim statistics or appeal-overturn rates; `transparency.gofundme.com` returns 403 to automated fetch. | COULD NOT ESTABLISH after searching the newsroom, help centre and web | Publish a quarterly trust report with real numbers. Cheap at small scale; a comparison GoFundMe cannot win. |
| **b-13** | **No native video upload** — campaign video requires a public YouTube URL, and Shorts links don't work without a rewrite. | VERIFIED: art. 4405106210843 (2026-04-29) | Native upload with mobile capture. Low cost, immediately visible quality signal. |
| **b-14** | **Structured data and hreflang are left on the table.** Campaign pages carry only `WebPage`/`WebSite`/`Organization` JSON-LD — no `DonateAction`, `Offer`, `FAQPage` or `BreadcrumbList` — and **zero `hreflang` tags**, with i18n signalled only by `og:locale:alternate`. | VERIFIED by inspection, 2026-10-14: https://www.gofundme.com/f/amyloidosis-warrior | Full `DonateAction`/`FAQPage`/`BreadcrumbList` markup and correct `hreflang`. Contests rich results, not head terms. |
| **b-15** | **Minimum donation is $5** (MXN 25, DKK/NOK/SEK 50). | VERIFIED: art. 360001992827 (2026-10-07) | A $1–2 floor opens micro-giving and social-share-driven giving GoFundMe structurally cannot accept. |
| **b-16** | **Matching gifts are Pro-only and tracking-only** — "GoFundMe Pro **tracks** matched funds but doesn't collect or distribute them", and matching is absent from personal fundraisers entirely. | VERIFIED: prosupport art. 37288720588571 (2026-10-13) | Real match escrow/settlement on personal campaigns — or at minimum sponsor-funded matching that actually moves money. |
| **b-17** | **Reputation is bimodal and publicly visible: 56% 1-star against 38% 5-star on 24,312 Trustpilot reviews.** | VERIFIED 2026-10-14: https://www.trustpilot.com/review/gofundme.com | The 56% are concentrated in fees, holds, verification and support — exactly b-4 through b-7. Target that cohort with mechanism-specific content, not generic "we're nicer" copy. |

### Honest caveats on the attack surface
- **b-6 is constrained by §8.1.** GoFundMe's speed problem is partly a deliberate
  non-custodial design. Faster payouts are winnable via front-loaded KYC, **not**
  by holding funds — holding converts LastDonor into a money transmitter.
- **b-9 is a window, not a permanent moat.** GoFundMe has already made Nonprofit
  Pages opt-in and de-indexed unclaimed pages (REPORTED, Oct 2025). The
  *litigation* is live; the *conduct* is largely remediated. Use it in nonprofit
  sales now; do not build a 2027 strategy on it.
- **b-4's specific percentage is unproven.** Attack the mechanism.
- **GoFundMe's genuine, unassailable strengths** (brand recall driving ~47–62% of
  traffic as *direct*; dual-processor resilience; the unique-share-link growth
  loop; the memorial/registry/caregiving embed ecosystem in §3.10) are not on
  this list because they are not beatable by a small entrant. Do not plan against
  them; plan around them.
