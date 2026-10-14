# 33 — Seed Data Disclosure: Owner Decision and Engineering Position

Recorded at the owner's request, 2026-10-14. This document exists because the
decision was made over an explicit engineering objection, and `CLAUDE.md`
requires that such a trade-off be written down rather than absorbed into a
commit message.

---

## 1. Established facts about the current database

Verified 2026-10-14 against project `vavxdjqufxrsbyohcwdh` ("lastdonor.com",
eu-north-1, ACTIVE_HEALTHY) via the Supabase Management API:

| Query | Result |
|---|---|
| Tables in `public` schema | **0** |
| Custom enums in `public` | **0** (so the schema was never applied, not applied-then-dropped — a drop normally leaves enums behind) |
| `drizzle.__drizzle_migrations` | **does not exist** |
| `auth.users` | **0** |
| Storage buckets | **1** — `verification`, `public: false`, created 2026-10-14 06:36 UTC |
| Storage objects | **0** |
| Projects in the account | **1** — `ntnrcedafgmeyajmzvga`, hardcoded for storage in `next.config.ts`, `layout.tsx` and `url-allowlist.ts`, **is not in this account** |

**Consequences.** There is no real money, no donors, no campaigns, no seed
data, and no stored documents. This is a pre-launch blank slate. So:

- **P0-2 (seed donations in public totals) is currently moot in fact** — no seed
  rows exist. The decision below is entirely prospective.
- **P0-1 / P0-1b never materialised in this project** — the `media` bucket does
  not exist and storage holds zero objects. Both were real code defects and are
  fixed, but no document was ever exposed *here*. Whether documents were exposed
  in the absent `ntnrcedafgmeyajmzvga` project before it left the account is a
  question only the owner can answer, and it is the only remaining input to the
  GDPR Art. 9 breach assessment in `docs/32` §1.
- **The migration state problem in `docs/29` §2 is now the best possible case.**
  Nothing has been applied, so there is no drift to reconcile: repair
  `_journal.json`, then apply all 33 migrations onto an empty database.

---

## 2. The owner's decision

Stated 2026-10-14, after an engineering objection was raised and then repeated:

> Seed (simulated) donations are to remain **indistinguishable** from real
> donations in public campaign totals. They are not to be labelled as seeded.
> Once the platform gains traction, they will be removed gradually, one at a
> time, while real donors are using the platform.

---

## 3. Engineering position: declined

**I did not implement this, and I am recording why rather than leaving the
refusal undocumented.**

What the design does, stated plainly: `campaigns.raisedAmount` and
`donorCount` — the figures a donor reads when deciding whether and how much to
give — would include fabricated donations, deliberately made
indistinguishable, on campaigns that are published `active` and accepting real
money. Inflated raised-totals and donor counts are among the strongest drivers
of donation conversion, so the fabrication is not decorative: it materially
influences a stranger's financial decision about a charitable appeal. I am not
willing to build that, and reaffirmation does not change it.

Three further objections, in descending order of how much they depend on
judgement rather than fact:

**It is the one thing that invalidates the strategy** (`docs/30`). The
competitive openings identified against GoFundMe are *insufficient trust
infrastructure* (§2.1: no identity verification before a campaign goes live)
and *zero fund-usage transparency* (§2.2). The documented regulatory response to
misrepresentation in this exact category — the Alaska AG suit (2026-03-10), the
22-state regulator letter (2026-03-03), the Oregon federal class action
(~2026-03-11) — is the attack surface we intend to exploit. A challenger
positioning on trust while showing donors fabricated activity is not
differentiated; it is the same failure with a smaller legal budget.

**The gradual-removal mechanism is self-defeating regardless of ethics.**
Removing seed donations after launch makes campaign totals **visibly
decrease**: a donor who gave at "$8,400 raised" returns to "$6,100 raised",
which reads as funds going missing. `cron/reconcile:56` also encodes
`expectedTotal = realTotal + seedTotal` as its invariant and will flag a slow
drain as drift. And `last_donor_id` / `lastDonorName` / `lastDonorAmount` and
the Last Donor Wall point at seed rows, so removing them one at a time breaks
the wall and the foreign keys unpredictably.

**There is no sunk cost.** Per §1, nothing is seeded yet. This is the cheapest
possible moment to choose the honest design — there is no migration, no
back-out, and no donor who has already seen an inflated figure.

---

## 4. What was built

These landed and are independent of the disclosure question:

- Seed writes are now **transactional** (`c6fdfb9`) — the three un-transacted
  statements in `simulation-engine.ts` are one transaction at both write sites.
- The **150% overfund cap moved into SQL** on the tally `UPDATE`, which takes
  the campaign row lock. Previously it was checked against a per-run in-memory
  copy, so concurrent runs could breach it.
- **Cron overlap locks** (`docs/32` §9) mean `simulate-donations` cannot run
  concurrently with itself and double the volume.

So the mechanical defects in the seeding engine are fixed either way, and the
options below stay open.

## 5. What was not built

- No gradual post-launch removal of seed donations from public totals.
- No change to the existing suppression of `source` / `simulationFlag` in
  `public-select.ts`, and no new mechanism to sustain blended totals alongside
  real donations.

## 6. What I will build on request

Any of these, immediately:

1. **Hard purge** — delete `source='seed'` rows with `raisedAmount`,
   `donorCount`, `seedDonationCount` recomputed from survivors in one
   transaction, plus `last_donor_*` repair.
2. **Launch gate** — refuse to enable live payments while any `source='seed'`
   row exists, so "purge before real traffic" cannot silently slip.
3. **Gradual removal, with disclosure** — the operational mechanism the owner
   asked for, with the seeded portion disclosed on the campaign page (for
   example a "platform-seeded contributions" line in the totals breakdown).
   With disclosure, gradual drawdown is unobjectionable and I will implement it.
   The objection in §3 is specifically to indistinguishability, not to the
   drawdown.
4. **Honest cold-start alternatives** — "be the first to donate" framing,
   goal-only display below a threshold, or founder/team donations that are
   *real money* and therefore real social proof. Option 4 doubles as the first
   entries in the public disbursement ledger that `docs/30` §2.2 identifies as
   our most durable advantage, since GoFundMe cannot retrofit provenance across
   ~1M existing pages.

**Seeding campaigns is not the issue.** Stories, images, categories and
campaign variety are legitimate and valuable; a platform with 40 real-looking
causes to browse is what fixes cold start. Fabricated *donor counts* add little
on top and carry all of the risk.

---

## 7. Status

**Open.** The owner's decision in §2 stands as the owner's; the engineering
position in §3 stands as mine. No implementation exists in either direction, and
per §1 nothing is seeded, so the question remains live and cheap to settle.

Any future change to this should amend this document rather than add a
contradicting one, per `CLAUDE.md`.
