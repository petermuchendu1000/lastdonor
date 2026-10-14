# 36 — Seed Content Sanitization, 2026-10-14

Records a trust-and-safety finding in `scripts/seed-news-items.ts` and what was
done about it. Companion to `docs/33`, which covers seed **donations**; this
covers seed **content**. Both were raised by the same instruction to "start
seeding".

---

## 1. The finding — verified by reading the script, not inferred

`docs/33` §6 closes with "**Seeding campaigns is not the issue.** Stories,
images, categories and campaign variety are legitimate and valuable". That
sentence was written **without having read the seed data**, and it was wrong
about this particular data. `scripts/seed-news-items.ts` does not contain
generic stories. Its 12 items attribute:

| Fabrication | Instances | Example |
|---|---|---|
| Articles attributed to **real newsrooms**, at URLs on their **own domains** | 12 | `url: https://www.wral.com/2025/marcus-delgado-raleigh-teacher-cancer/`, `source: WRAL` |
| Quotes attributed to **real, named, sitting officials** | 4 | "Prattville Mayor Bill Gillespie said…"; also the mayors of Prestonsburg KY and Cedar Rapids IA, and the Memphis fire chief |
| Actions attributed to **real organisations** | 4 | "The FDNY Foundation has established a fund for the Callahan family"; the American Red Cross; the Linn County Community Foundation |
| Named staff attributed to **real hospitals** | 2 | "her supervisor at Grady Memorial, charge nurse Tameka Johnson"; NYU Langone |
| Real institutions as settings for fabricated people | ~14 | Sanderson High School, Branham High School, Duke University Medical Center, Evans Army Community Hospital, Seattle Children's Hospital |

Newsrooms named: **WRAL, WSFA, Military Times, FDNY News, KOLD, Fox 13 Memphis,
KCRG, 11Alive, KGW, WYMT, KRON4, The Daily Beast.**

Stage 2 of the seeding pipeline (`run-publish-campaigns.ts`) turns these into
**published campaigns soliciting donations**, on a site that is now publicly
reachable at `lastdonor.org`.

**It contradicts the pipeline's own rules.**
`src/lib/ai/prompts/extract-entities.ts:72-76` instructs the model, under the
heading `ANTI-FABRICATION RULES (CRITICAL)`: *"NEVER construct or shorten
URLs"*, *"NEVER invent family members"*, *"NEVER estimate or guess an age"*. The
seed script does all three — it constructs 12 URLs, and invents relatives with
specific ages ("Adriana Delgado, 36… Sofia, 8, and Lucas, 5").

**It also contradicts the strategy.** `docs/30` positions LastDonor against a
competitor facing an Alaska AG suit, a 22-state regulator letter and an Oregon
class action over **misrepresentation**. Forged press attribution is the one
asset that argument cannot survive.

---

## 2. Decision

**Keep the 12 narratives. Remove every real-entity reference. Do not seed
donations.** Owner decision, 2026-10-14, chosen over the alternatives in §4.

Implemented as:

- `scripts/seed-data/news-items-sanitized.json` — the 12 stories, sanitized.
  Narratives, categories, images, relevance scores (90-96) and publish dates are
  **unchanged**. Only entity references differ.
- `scripts/seed-news-items-clean.ts` — inserts them. Idempotent on `url`, reads
  `DATABASE_URL` from the environment rather than `.env.local`, so it runs in CI
  and in a container.
- `scripts/seed-news-items.ts` — kept, **unrun**, with a ⛔ banner, as the
  provenance of the data.

`source` is `LastDonor Example (seeded)` on every row. Every `url` is on
`example.invalid` — RFC 2606 reserved, so it can never resolve and can never be
mistaken for a citation.

**Names were removed, not replaced.** An invented officeholder name may itself
belong to a real officeholder; an unnamed role ("a city official", "the fire
chief") cannot impersonate anyone. Cities and neighbourhoods were **kept**: a
story set in Raleigh makes no claim about Raleigh.

---

## 3. How it was verified, and what verification missed

Worth recording, because the regex audit returned **CLEAN while the content was
not clean** — twice.

| Pass | Result |
|---|---|
| Regex entity sweep | Said CLEAN. Missed `FDNY` inside a body on the first run. |
| Second regex sweep, apostrophes included | Said CLEAN. Missed `a department captain O'Brien` (lowercased replacement + surviving surname), `New York City Fire Department` spelled out, `Ladder 101`, and two broken sentences. |
| **Reading the output** | Found all five. |
| Bare-name sweep **against the seeded rows** | Found `Grady Memorial` — the earlier regex required a trailing `Hospital`. |
| Final: 47 bare-name checks against live rows | Zero matches. |

**Lesson, and it is the same one `CLAUDE.md` already records:** a pattern that
asserts absence is only as good as the pattern. Three of the six defects were
invisible to every regex written for the job and surfaced only on reading the
prose, and the last surfaced only on querying the database rather than the
local file. The sanitizer therefore asserts that **every mapping fires** — a
mapping that silently matches nothing is the failure mode that hid `Grady
Memorial`.

---

## 4. Rejected alternatives

**Run `seed-news-items.ts` as written.** Refused. Publishing forged WRAL and
Military Times articles, and quotes invented for four sitting officials, on a
live donation platform is forgery regardless of whether payments work.
Placeholder Stripe keys do not mitigate it: the forgery is published either way.

**Invent replacement names for the officials.** Rejected: any plausible name may
belong to the actual officeholder, which reintroduces the defect in a form that
is harder to detect. An unnamed role cannot.

**Run the real news pipeline instead** (GNews → real articles → campaigns). The
honest long-run answer and the product's actual design, and it remains the
recommendation. Rejected *for now* only because `GNEWS_API_KEY`,
`OPENROUTER_API_KEY`, `PEXELS_API_KEY` and `UNSPLASH_ACCESS_KEY` are unset, so
the pipeline is inert.

**Seed non-appeal content only** (blog, category pages). Rejected: leaves the
campaign grid empty, so the cold-start problem it was meant to solve persists.

**Generate 12 fresh, fictional-by-construction stories.** Reasonable, and
cleaner than repairing these. Rejected because the owner chose to keep these
narratives, and the entity layer is separable from them.

---

## 5. Status and what is NOT done

**Stage 1 (news items): DONE.** 12 rows in `news_items`, `campaign_created =
false`, verified against the live database.

**Stage 2 (news items → campaigns): BLOCKED, not skipped.** Two independent
blockers, both verified by calling the live endpoint:

1. `GET /api/v1/cron/publish-campaigns` returns
   `{"skipped":true,"reason":"Lock backend unavailable and publish-campaigns
   fails closed; exiting without running."}` — no `UPSTASH_REDIS_REST_URL` /
   `_TOKEN`. This is `docs/32` §9 working as designed, not a fault.
2. `campaign-publisher.ts:14` calls `callAI`, so even with the lock backend it
   needs `OPENROUTER_API_KEY`, which is unset.

So **there are still zero campaigns** and the site's campaign grid is still
empty. Supplying those three keys unblocks it with no further code change.

**Stage 3 (seed donations): NOT RUN, by owner decision 2026-10-14.** Campaigns
will show real `$0` raised. This supersedes nothing in `docs/33` — the §2
decision there remains the owner's and the §3 objection remains engineering's;
this is simply the choice taken on this occasion. `docs/33` §6 options 2, 3 and
4 remain available and option 4 ("be the first to donate" framing) is the
recommendation for a trust-positioned platform.

**Not addressed:** the stories remain fabricated appeals for people who do not
exist, which is inherent to seed data. They are marked only by
`source = 'LastDonor Example (seeded)'` on the `news_items` row.
`campaigns.simulationFlag` exists and is indexed
(`idx_campaigns_simulation_flag`) but is rendered **only in admin pages** — no
public page labels a seeded campaign. If these are ever published while the site
is publicly reachable, a visible label on the campaign page is the honest next
step, and it is not built.
