# 162 — The thank-you screen that could thank you for nothing

The SUCCESS journey on money-in. `MpesaDonationForm` has five phases and four
had been read: `form` by `docs/151`, `waiting` by `docs/159`, `failed` and
`unresolved` by `docs/158`/`docs/160`. The fifth — the screen a donor sees
when it **works** — had never been looked at, and `docs/147` §11.5 says why:

> every outcome in §11 is read from the database and from PayHero and **never
> from the page**.

---

## 1. The finding

`settlePayHeroRequest` claims the collection request `succeeded`
(`payhero-settlement.ts:228-241`), calls `recordGatewayCharge`, then **looks
up whether a donation row resulted** (`:281-285`) and links it if so
(`:287-292`) — and returned `{ kind: 'recorded' }` **unconditionally** at
`:294`. The answer it had just fetched was thrown away: `docs/119`'s
`_hasCampaigns` shape, on a money path.

`recordGatewayCharge` has early returns that book nothing. The live one is a
campaign that **completed while the donor was entering a PIN**
(`payment-service.ts:835`, whose own comment names that window: *"the window
is real — it is as long as the donor takes to enter a PIN"*). On that path it
writes `donation.manual_refund_required` at **`critical`** severity
(`:866-879`) and returns at `:881` — **above** `processPaymentTransaction`
(`:889`) and `handlePostPaymentEffects` (`:893`).

So on that path: no donation row, the campaign total unchanged, and **no
receipt**, because `sendDonationReceipt` has exactly one production call site
and it is inside the block that return skips (`:400`).

What the donor was told, verbatim:

> **Thank you - your donation is in**
> You gave **Ksh 50.00** to … Your M-Pesa confirmation message is your
> receipt, **and we are sending one by email too.**

Every clause of that is false there, while the platform's own record says a
person must return the money by hand on a rail with no refund API
(`docs/122`).

## 2. ⚠️ The falsifier narrowed three paths to one

Gate 3, written before concluding: *if the schema and the initiate route make
those early returns unreachable, there is no finding.* It partly held, and
that is what sets the scope.

| early return | reachable from this path? |
|---|---|
| currency mismatch | **NO** — the composite FK `payhero_requests_campaign_currency_fk` on `(campaign_id, currency)` makes `request.currency === campaign.currency` a database guarantee |
| campaign not found | **NO** — `campaign_id` is a foreign key, and both delete routes archive rather than delete (`docs/146`) |
| campaign `completed` | **YES** — `initiate/route.ts:117` admits only `active`/`last_donor_zone`, so the only window is PIN entry, and `payment-service.ts:259-273`'s single-shot completion is what closes it mid-flight |

## 3. Severity, stated plainly: latent

⚠️ **[VERIFIED from production] it has never fired.**

- `donation.manual_refund_required`: **0 rows ever** (`donation.payhero_failed`
  is the only `donation.%` event present, n=2).
- All **3** succeeded payment requests carry a donation row
  (`count(donation_id) = 3`).
- **0** campaigns with `status = 'completed'`, and the nearest active campaign
  to its goal is the general fund at **0.05%**.

So this is an armed false claim about somebody's money, not an incident — the
same standing as `docs/158` (*"never fired"*) and `docs/160` (*"a guard
against behaviour never observed"*).

## 4. Verified four ways, each able to give the other answer

1. **Source.** `:294` returns `recorded` regardless of `:281`'s answer; the
   route maps `recorded` → `settled('succeeded', null)` (`:141`), and the
   client maps that to the thank-you screen (`MpesaDonationForm.tsx:188`).
2. **Production data.** §3.
3. **Execution, integration, real Postgres.** A campaign flipped to
   `completed` after the request was written: outcome `recorded`, **0**
   donation rows, request `succeeded` with `donationId` null, and the
   `critical` audit row present. The CONTROL (campaign still active) writes
   its row and links it.
4. **Execution against the real route, no money.** The terminal-row branch
   (`status/route.ts:130`) answers purely from our own row with **no gateway
   call**, so the whole thing runs with nothing to pay. Two rows, one
   `succeeded`+linked and one `succeeded`+`donation_id NULL`:

```
finding's row : {"state":"succeeded","amount":5000,"currency":"KES","keepPolling":false,"message":null}
CONTROL       : {"state":"succeeded","amount":5000,"currency":"KES","keepPolling":false,"message":null}
not-our-ref   : 404 NOT_FOUND          <- the discriminating control
```

**Byte-identical.** A donation that exists and one that does not were the same
answer. In a browser at 390px the finding's row rendered
`role="status"`, *"Thank you - your donation is in"*, and the receipt promise.

⛔ **THREE branches claimed success, not one** — the terminal-row early return
(`:130`), `case 'recorded'` (`:141`) and `case 'already_settled'` (`:143`) —
and all three read `status` alone. A rule pinning any one of them would have
passed against the other two.

## 5. The fix

`settlePayHeroRequest` uses the lookup it already performs: no donation row
means a new outcome `collected_unrecorded`, the reason is written onto the
request's `failureReason` so the durable record is honest too, and the kind is
reported at `error` severity.

⛔ **It is not `recorded`** — that is the false claim. ⛔ **And not
`unverifiable`**, which means we cannot establish what happened: here we can,
and the one thing we know is that the money moved.

⛔ **The request row stays `succeeded`.** The *collection* did succeed, and a
new `payhero_request_status` value means a migration on a live money table for
a path that has never fired — `docs/129`'s reasoning. The discriminator is
`donation_id` being null beside it, which the row already carries.

**ONE decider** (`docs/146`): `claimForSettledCollection(donationId)` in
`src/lib/payhero-prompt.ts` — the module that imports nothing, because the
message crosses the server/client boundary (`docs/139` §7). All three branches
route through it, `case 'recorded'` included: `recorded` now carries its
`donationId`, so there is literally one place that can answer a thank-you and
it always answers from a donation link.

The client gains a matching phase and its own screen — *"A response type must
describe the responder"*, `docs/159`'s rule — which claims only what is
established:

- ⛔ no thanks and no "your donation is in": there is no donation;
- ⛔ no receipt promise: `:881` returns above the send;
- ⛔ no *"nothing has been charged"*: that is `docs/158` with its sign
  flipped — here we know it was;
- ⛔ no refund and no date: nothing returns money on a clock (`docs/140`) and
  PayHero has no refund API (`docs/122`);
- ⛔ no **"Check again"**, unlike `unresolved`: the row is terminal and the
  answer derived from it, so re-polling returns the same screen by
  construction. `unresolved` keeps its button because there a later settlement
  really is possible and the donor's own poll is the only path that finds it
  (`docs/159`).

It offers a human, which is the only recourse that exists.

### 5.1 ⚠️ A hole in my own rule: text cannot see which way a branch points

The guard shipped as structural rules — exactly one site may answer the
thank-you state, it must consult `donationId`, every branch must route through
the decider. Injection 6 **inverted the decider** (claim success when nothing
was booked, refuse when it was) and **passed every one of them.**

That is Gate 4's definition of a check that cannot fail, and it has a known
cure: `docs/157` §4.1 made its judgement **pure** precisely so a test could
execute it. So the decision is now
`claimForSettledCollection(donationId: string | null | undefined)`, and the
test runs it on all three inputs.

The route then drops the branch entirely: the answer is a `Record` keyed by
the claim, so there is no condition left to invert. What remains possible is
**swapping** the two entries — and that makes a key disagree with the state it
answers, which, unlike a ternary's direction, a test can see. Injections 6, 6b
and 6c cover the three ways to misdirect it and all three fire.

### 5.2 ⚠️ And then my own rule failed on CORRECT code

The "decides from the donation link" rule sliced a **fixed 400 characters**
before the answer and required `donationId` in them. That fitted the ternary
it was written against; the moment the ternary became a lookup table the
window no longer reached the decider and the rule failed against a correct
tree. `docs/153`'s fixed-slice trap, and `docs/116`'s 2,600-char one.

The tell was not the rule itself: **every injection's failure count rose by
exactly one, and both MUST-PASS rows fired.** A uniform +1 across the board is
a dirty baseline, not twelve new defects.

Replaced with the structural fact and no distance: the single thank-you answer
must be the table entry *keyed by that same state*.

## 6. ⚠️ Probe failures that each read as a result

- **`pgrep -f "next build"` matched its own shells.** Every match was `bash` —
  including the shell running the check — so my `until ! pgrep …` loops waited
  on themselves and reported *"STILL BUILDING (621s)"* for a build that had
  finished minutes earlier. `docs/139` §11 and `docs/156` §6, met in person
  after reading both. Builds are now waited on with a **marker file**.
- **A failed server held the port and answered the 500s.** The first
  `next start` died on `validate-secrets` and kept 3210; the next start got
  `EADDRINUSE` while the port went on answering, so my 500s came from the dead
  process. `docs/144` §5.2: a server you did not actually stop answers exactly
  like a change that did nothing. ⚠️ And `ss -lntp` reports **no pid** in this
  sandbox (`docs/144` §5.2 again), so the holder was found by scanning
  `/proc/*/comm` for `next-server`.
- **Invented fixture columns passed vitest and failed `tsc`.** `description`
  and `story` are not columns on `campaigns`; the integration test went green
  with them because **vitest does not typecheck**, and `next build` is what
  rejected them — from two stray `lab-*.ts` files I had left in the
  typechecked project root. `docs/128` §6's lesson with the layers swapped.
- ⚠️ The integration suite truncates, so it cannot be run between seeding the
  browser fixture and walking it (`docs/146` §4.0b).

## 7. Gate

lint 1 pre-existing warning, typecheck clean, unit **8226 passed / 0 failed /
16 skipped** (294 files + 3 skipped, +11 tests and +1 file), integration
**329 passed / 0 failed** (35 files, +3 tests and +1 file).

**14 injections, all 14 behave**, sha-verified clean restore after each, every
row refusing to be scored unless its anchor matched exactly once and the file's
sha changed. Rows 1 and 2 restore the real production state at each layer and
both fire; row 10 is the vacuity control (deleting the genuine success screen's
thanks must fail); rows 11 and 12 must pass.

Paired browser verification on one build, 390px, `isMobile: false`:

| | before | after |
|---|---|---|
| server state | `succeeded` | **`collected_unrecorded`** |
| heading | "Thank you - your donation is in" | "Your payment went through, but we could not record it" |
| container role | `status` | **`alert`** |
| says thank you | yes | **no** |
| promises a receipt | yes | **no** |
| says "nothing has been charged" | no | **no** |
| **CONTROL** linked donation | thank-you screen | **thank-you screen, untouched** |
| horizontal overflow | 0px | 0px |

## 8. Reported, not fixed

- **The card rail carries the same shape, and is left alone.**
  `recordGatewayCharge` is shared, so `DonationForm`'s success step makes the
  same two claims. Three reasons not to touch it here: that branch
  **auto-refunds** through `stripe.refunds.create`, so the donor's money comes
  back; the screen is reached from the client's own flow rather than from a
  polled server state, so the fix would be a different one; and the rail
  answers 503 to everybody (`docs/161`), so nobody can reach it. Widening this
  change into dead code is not the smallest fix.
- **`emailDonationReceipts === false` still makes the receipt line false for
  one donor.** A signed-in donor who turned receipts off gets none, and both
  success screens say one is coming. `DonationForm.tsx:311-318` records that
  trade-off deliberately (*"the copy promises a send and not an arrival"*) —
  but if the send never happens, even the send is not promised truthfully.
  Narrow, pre-existing, documented on both rails, and changing it edits the
  main success copy of the whole product: a copy decision, not an audit's.
- **`abandoned` is still written by nothing** (`docs/129`, `docs/159`).

## 9. What was NOT checked

- **No real payment was made.** The money-moving half is established by the
  integration test against Postgres and by the fact that the route's terminal
  branch answers from our own row; whether PayHero behaves this way at the
  moment a campaign completes is **[UNKNOWN]** and not provable without
  charging somebody.
- **The callback's rendering of the new kind** — it echoes `outcome.kind` in
  JSON and renders nothing, so there is nothing for a donor to read, but it
  was not exercised.
- **No screen reader.** The new screen carries `role="alert"`; its
  announcement was not heard.
- **Nothing was deployed.** The owner's standing instruction is that deploys
  are theirs (`docs/96`). All verification here is against a lab build and a
  throwaway Postgres, plus read-only queries against production for §3.
