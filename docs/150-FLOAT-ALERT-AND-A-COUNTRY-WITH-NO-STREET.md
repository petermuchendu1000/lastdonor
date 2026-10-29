# 150 — The fee float finally tells somebody, and a country stops standing in for an address

Two owner decisions taken 2026-10-29, both closing items that had been carried
as "still open and untouched" across several docs.

---

## PART A — the PayHero fee float

### A.1 ⚠️ FIRST, A CORRECTION TO `docs/147` §11.3 AND TO MY OWN REPORT

`docs/147` §11.3 says *"Nothing in the codebase reads `getWalletBalance`"*, and
I repeated that claim twice this session — once in a report and once in the
question I put to the owner — before checking it.

It is **false**. [VERIFIED] `src/app/api/v1/health/route.ts:111` calls it, and
has for weeks:

```ts
const wallet = await getWalletBalance();
const collectionsRemaining = Math.floor(wallet.availableBalance / PAYHERO_FEE_PER_COLLECTION);
checks.payhero = collectionsRemaining >= LOW_FLOAT_COLLECTIONS ? {…ok} : {…error}
```

So the **check already existed**, with a threshold of `LOW_FLOAT_COLLECTIONS =
25` which at the measured flat fee of KES 8.9 is **KES 222.50**. One grep
would have established this, and I should have run it before asserting the
opposite. It also changes the shape of the work: this was never "build
monitoring", it was "the monitoring cannot reach anybody".

### A.2 What was actually missing

The verdict reached:

- whoever happened to fetch `/api/v1/health`, and
- a `console.error` into Fly's log buffer.

And nothing else. [VERIFIED] `fly.toml:289` points Fly's own probe at
**`/api/v1/live`**, not at `/api/v1/health` — which is correct (the health
route's own header forbids pointing a restart-capable probe at it, and
`docs/119`-era work established why) and also means **nothing escalates on a
low float**. The endpoint returns 503 when degraded, and that 503 is read by
nobody.

**Gate 3 falsification attempt**: *what would most likely falsify "nobody is
told"?* — some probe or alerting path already consuming `/api/v1/health`. Run:
the only HTTP check in `fly.toml` is `/api/v1/live`, and no cron, route or
script in `src/` fetches the health endpoint. The conclusion held.

⛔ **Why it matters**: the float pays PayHero's flat fee per collection, so at
zero this platform cannot take an M-Pesa donation — the only rail that has
ever worked (`docs/72`, `docs/92`). And [VERIFIED by execution, `docs/147`
§11.2] PayHero returns **no failure reason**: a failed collection carries no
reason, description or result-code field, so an empty float is
indistinguishable from the two unexplained failures of 2026-10-29. The wallet
is shared with BETWOIN LTD, whose collections drain it with nothing happening
on this platform at all — observed going from **2,239** (2026-10-21) to
**182.9** (morning of 2026-10-29) to **2,027.6** (that afternoon, after a
top-up).

### A.3 ⛔ ONE PREDICATE, NOT A SECOND THRESHOLD

Owner decision: alert below **KES 500**. The obvious implementation — a cron
with its own threshold — is the shape this codebase keeps getting burned by:
`docs/146`'s *"the predicate that COUNTS a group is the predicate that LISTS
it"*, and `docs/138`'s third hand-written cron list on a settings screen.

So the fee, the threshold and the verdict moved into
**`src/lib/payhero-float.ts`**, read by the health route AND the new job. The
owner's figure is stored in the unit the decision was made in and the
collection count is **derived**:

```
PAYHERO_FEE_PER_COLLECTION_KES = 8.9      measured, docs/92
LOW_FLOAT_WARN_KES             = 500      owner, 2026-10-29
lowFloatCollections()          = 56       derived, floor(500 / 8.9)
```

This **raises** the line from KES 222.50 to KES 500. Both were always in the
same units; what changed is the number, and that the number is now stated in
KES with the count derived rather than the reverse.

### A.4 ⛔ THE UNIT IS THE THING THAT CAN BE 100x WRONG

`getWalletBalance()` returns PayHero's raw `available_balance`, and that is a
**MAJOR-unit decimal**: the live wallet read `2027.6`, meaning KES 2,027.60.

Every amount **column** in this codebase is minor units (CLAUDE.md,
`docs/92`), so the reflex when writing money code here is to multiply by 100 —
which is the `docs/114` defect (`Math.round(dollars * 100)` in both withdraw
handlers, right by coincidence for USD and KES, 100x wrong for a zero-decimal
currency). A `* 100` anywhere in this path would move the alert to a hundredth
of the intended balance, i.e. it would never fire.

Guarded two ways. By arithmetic, which a reading of the constant could not do:

```ts
expect(assessFloat(450).isLow).toBe(true);      // major units
expect(assessFloat(45_000).isLow).toBe(false);  // the same figure in minor units
```

and by a text rule over the two files that hold the balance. ⚠️ The email
template DOES convert — `formatMoney` takes minor units — and it does it
through **`majorToMinor`**, because CLAUDE.md (`docs/118` §10) forbids the
literal outright.

### A.5 The cadence, derived from the arithmetic rather than chosen

```
threshold                 KES 500
observed drain            ~55 KES/hour   (159.6 in 2h53m, docs/147 §11.3)
time from threshold to 0  ~9 hours
check cadence             hourly
email cooldown            6 hours
```

⛔ **THE INVARIANT**: `cooldown < threshold / drain rate`. A cooldown longer
than the drain window would make the first alert potentially the only one — it
would arrive, then go quiet while the float ran out. 6 < 9 holds, and a test
recomputes it from the published measurement rather than pinning today's
numbers.

⚠️ **The drain rate is ONE measurement**, on a wallet shared with another
company, so it can be much faster. That is an argument for a shorter cooldown,
never a longer one — which is why the relationship is a test and not a comment.

And the check runs hourly, which is **shorter** than the cooldown on purpose:
otherwise the cadence silently becomes the real alert interval. A daily job
could sleep through the entire nine-hour window.

### A.6 ⚠️ EMAIL ONLY, which is a decision and not an omission

`createAndEmail` always inserts an in-app notification, and **every value in
`NotificationType` is campaign, donor or verification shaped**. There is no
honest type for an operational alert, and minting a new pgEnum value means a
migration against a live money database for a cron's convenience. `docs/139`
reached for `campaign_milestone` in a comparable spot and had to explain
itself; this has nothing to reach for.

So `notifyAdminsPayHeroFloatLow` uses the existing `sendEmailOnly`, which

- keeps `FROM_ADDRESS` and the retry policy in one place, and
- puts the send site in `notifications.ts`, a file the mail-senders sweep
  already covers, so the route needed **no allowlist entry** (`docs/123` §4).

⚠️ `sendEmailOnly` now **returns whether Resend accepted it**. Every existing
caller ignores the value and is unaffected. It exists because the audit row
records a count, and `emailed: 2` when both sends failed would be a false
statement in the one place somebody would later go to find out whether they
were warned. The row therefore carries `recipients` AND `emailed`, and
distinguishes *"no administrator accounts exist"* from *"every send was
rejected"*.

⛔ It applies no suppression, which `docs/140` PART A names as the hazard — and
there the hazard is the COPY. This is an operational alert to an administrator
about the platform's own wallet: transactional by any reading.

### A.7 It writes a row EVERY run, including healthy ones

Two reasons, and the second is specific to this job.

`docs/123` requires a scheduled job that decides to do nothing to say so,
because the Worker logs only the HTTP status and never reads the body. And
`docs/136` §10 measured what the opposite costs: `update-phases` audits only
when it changed something, which wrote **22 rows against 288 dispatches** and
made `/admin/simulation` report *"nothing is driving any schedule"* 40.1% of
the time.

The second reason: **nobody has ever had the float's history**. All three
figures above exist only because somebody probed the wallet by hand. An hourly
row makes the drain rate — currently one measurement — a thing that can be
queried.

⚠️ `severity` is load-bearing, because the cooldown reads it back: a healthy
run writes `info` and therefore cannot suppress a later alert. If it counted,
one healthy hourly run would mute the alert for six hours — i.e. forever.

### A.8 The checks, and the three defects the ratchets caught in my own work

13 unit tests (`payhero-float.test.ts`) plus **11 integration tests executed
against a real Postgres** (`route.integration.test.ts`).

⛔ The integration tests are not optional here: **the cooldown is a SQL
query**, and `docs/124` §5.1 is the lesson — its route test mocked drizzle, and
*"a mock cannot raise a foreign-key or NOT NULL violation"*, so two branches
that had never once worked sat under a green suite. A mocked `db` would confirm
my expectations about the query rather than the query. Only PayHero is mocked,
because calling it would read a real balance and spend a real request.

**14 of 14 injections fire**, sha256-verified restore after each. Rows 1 and 6
are the pre-change state; rows 11 and 12 break the cooldown in the two ways
that would be invisible (severity ignored, expiry removed).

Three things the existing ratchets caught that I had got wrong:

1. ⛔ **The lock was never released.** `locks.test.ts` requires
   `finally { await lock.lock.release(); }` — I had no `finally` at all.
2. ⛔ **And a SECOND release path the ratchet could not see.** My
   `isPayHeroConfigured()` early return sat *after* acquiring the lock and
   *outside* the try, so it returned holding the lock. That text rule checks
   for the `finally` shape, not for which branches reach it. The check moved
   inside the try.
3. The job needed registering in **three** places —
   `CRON_JOBS`, `CronJobName`/`CRON_LOCKS` (a `Record` over the union, so tsc
   demands it — the `docs/144` pattern) and two inventories
   (`cron-schedule.test.ts`'s per-week table and
   `middleware.public-routes.test.ts`'s public-route list). Each one failed
   until it was named.

⚠️ And two of my own test expectations were wrong rather than the code:
`row.severity` for a KES 10 balance is `warning`, not `error`, because 10 is
above the 8.9 fee and buys one more collection; and a bare `\b500\b` rule fired
on `{ status: 500 }` in the route's error response.

---

## PART B — a country with no street

### B.1 What was published

`Footer.tsx:125` and `privacy/page.tsx:187`, identically:

```
LastDonor.org
United States
contact@lastdonor.org        (privacy@ on the privacy page)
```

[VERIFIED] exactly two sites; `about/page.tsx:95` is a glossary term with no
country, and every other `United States` in `src/` is a code comment or the
unrelated proper noun in `authority-links.ts:185`.

A country with no street is not an address. It is a claim about where the
platform operates, and after `docs/148` removed `areaServed` from the
Organization graph it was the **last `United States` assertion left in
user-facing copy**.

⚠️ It also carried no information: `/privacy` tells the reader, one sentence
above it, to *"contact us by email so we can provide the current mailing
details"* — an admission that there is nothing to publish.

### B.2 Owner decision: remove the line

Same principle as `docs/148` and as `docs/76`'s `sameAs`: **absent asserts
nothing**, while a bare country asserts a jurisdiction `/terms` does not
establish — and `company-claims.test.ts` already proves `/terms` establishes
none.

⛔ **THIS IS NOT THE CAN-SPAM ADDRESS.** That is `MAILING_POSTAL_ADDRESS`,
[VERIFIED] read only by `src/lib/email-shell.ts:222` from the environment,
nothing to do with these two blocks, and still unset — which is why the
newsletter cron refuses to send (`docs/123`, `docs/135`) and why a bulk email
goes out with no postal line today. A real address belongs **there**, and
putting a country **here** never made one exist. That remains open.

### B.3 The guard DERIVES its country list, and relaxes on its own

A hand-written list of countries is the shape `docs/119`, `docs/124`,
`docs/144`, `docs/146` and `docs/147` were all about: only as good as whoever
remembered to extend it, and it would catch "United States" while missing
"Kenya". So the names come from the **254 ISO codes `docs/103` generated**,
resolved through `Intl.DisplayNames` — the same ICU data a human typing a
country name is reproducing. The few abbreviations ICU will not emit (`USA`,
`UK`, `England`…) are added explicitly and labelled as a supplement.

⚠️ **It auto-relaxes**: a contact block that also carries a street line —
anything containing a digit, which a street number or a postcode has and a
bare country name does not — is a real address, and naming the country in it is
then correct. So supplying a real address makes the rule stop applying rather
than having to be edited.

**8 of 8 injection rows behave as required**, including:

- row 1, the production state (footer republishes the bare country) → fails
- row 3, **a different country** (`Kenya`) → fails, so the rule is not pinned
  to the string that was removed
- row 4, an abbreviation ICU does not emit (`USA`) → fails
- row 5, **a real address with the country** → **passes**, proving the relax
- row 6, the control: remove the email and the block names no human → fails
- rows 7-8, vacuity: an empty country list, and a contact block that cannot be
  found → both fail

---

## What is NOT verified

- **Not deployed at the time of writing.** A new cron needs TWO deploys in
  order (CLAUDE.md): the app, confirm the route answers **401** rather than
  404 unauthenticated, then the Worker — because
  `workers/cron/src/index.ts` bundles `dueJobs` at `wrangler deploy` time.
- **No real low-float email has ever been sent.** The production float reads
  KES 2,027.60, which is above the threshold, so the live path will take the
  healthy branch until the float actually falls. The alert branch is proven by
  execution against a real database, not against a real inbox.
- **The drain rate is one measurement.** Everything in §A.5 rests on 159.6 KES
  over 2h53m on a single afternoon.
- **Nothing was done about the CAN-SPAM postal address** (§B.2), which is a
  real address only the owner holds.
