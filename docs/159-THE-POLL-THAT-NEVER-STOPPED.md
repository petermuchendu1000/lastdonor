# 159 — The server said stop and the browser did not hear it

The WAITING journey on the money-in path: raise a prompt, then let it go
unanswered and read what the donor sees. `docs/158` §8 named this as the next
thing to walk, in its own words — *"What a donor sees when a prompt is raised
and then expires, or when the poll returns FAILED, is untouched — and that is
the path both production failures actually took."*

---

## 1. The finding

**The poll loop had no stop condition.**

The server already computes one. `status/route.ts:194` answers
`keepPolling: !expired`, derived from the row's real age, precisely so the
browser can stop. `MpesaDonationForm` read that field — and used it only to set
a message. The 5-second interval was never cleared: the effect's cleanup
depends on `phase`, `reference` and `poll`, none of which change when a message
is set, so the loop ran for as long as the tab stayed open.

What the donor saw, measured: **"Waiting for your confirmation · 28s"**, then
48s, then 847s, under a heading telling them to check their phone for a prompt
that could no longer be there. No outcome, no instruction, no way out.

And every one of those ticks is an outbound call. The row is still `pending`,
so `settlePayHeroRequest` claims it and calls `getTransactionStatus`
(`payhero-settlement.ts:105`) — **which has no age guard** — once per 5 seconds
per open tab, for a payment that is over.

### 1.1 Three ways, each able to give the other answer

| method | result |
|---|---|
| source | the `keepPolling` branch sets state and returns; nothing clears `poller` |
| jsdom, counted | **5 polls in 26s** *after* `keepPolling: false`; still on the waiting screen |
| a real browser at 390px | the same 5, screen reading `Waiting for your confirmation · 28s` |

The browser run is the one that matters, because the other two could both be
wrong about the real bundle. Its screenshot is `poll-expired.png`.

### 1.2 The falsifier that failed to falsify

*"Perhaps the server-side cost is bounded anyway — maybe settlement refuses a
stale row, so the extra polls are cheap."*

Read, not assumed: `settlePayHeroRequest` has **no age guard and no try/catch
anywhere in the file**. It claims any `pending` row and calls PayHero. So the
falsifier failed, and it also established the second half of the fix: because
there is no try/catch, an unreachable PayHero throws through to the route's
outer catch (`:219-229`) and answers **500** — and a 500 carries no
`keepPolling` field to obey. Obeying the server is therefore necessary and not
sufficient.

## 2. Severity, stated honestly

⚠️ **[VERIFIED from production, twice] it has never fired.**
`payhero_payment_requests` holds **3 succeeded and 2 failed and 0 pending**.
Both failures settled through the FAILED path, where PayHero answered — so no
donor has yet sat on a prompt that went unanswered. The path is armed, not
exercised. The same shape as `docs/158`: a defect on a live rail that has not
had the traffic to meet it.

⛔ It is not harmless while it waits. The platform has taken real money over
this exact form (`docs/147` §11), and the two production failures `docs/158`
records are *the adjacent branch*.

## 3. The fix, and why it is two things

**Obey the instruction, and bound the loop that cannot hear one.**

```ts
if (keepPolling === false) { setStatusMessage(message ?? null); setPhase('unresolved'); }
```

⛔ **`=== false`, not `!keepPolling`.** Stopping is an INSTRUCTION and must be
explicit. A payload that omits the field is an unexpected shape, not the server
saying the prompt is dead, and reading absence as "stop" would silently end
every donor's wait the day the response shape changes. This is `docs/158`'s
rule about not inferring from absence, pointed the other way.

⚠️ **Three pre-existing tests proved the distinction is real, not theoretical.**
Their mock answers the status poll with an *initiate* payload, so `keepPolling`
is `undefined` — and `!keepPolling` took the stop branch for them too. It only
ever looked harmless because the old branch set a message and kept going.

And the fallback:

```ts
export const MAX_POLL_ATTEMPTS = Math.ceil(PROMPT_LIFETIME_MS / POLL_INTERVAL_MS) + 12;
```

⛔ **DERIVED, never picked.** The invariant is that the client ceiling MUST
outlast the server's prompt lifetime: 36 polls cover a live prompt, so a
smaller cap abandons a donor who is still typing their PIN. The margin covers
the row's `created_at` predating the browser's first poll and the immediate
`void poll()` that spends one attempt before the interval starts.

`PROMPT_LIFETIME_MS` moved into **`src/lib/payhero-prompt.ts`**, a module that
imports nothing. It lived in `payhero-abuse-guard.ts`, which imports `@/db`, so
a client component could not reach it — `docs/139` §7's rule: a constant shared
across the server/client boundary lives in a module neither side owns.

⚠️ The counter is a `useRef`, not state. Bumping state would re-create `poll`,
re-run the effect and re-arm the interval — a counter that resets itself is
`docs/126`'s lost update in a different costume, and injection 9 proves it
(resetting it inside the tick makes the ceiling unreachable).

### 3.1 The screen claims nothing

`unresolved` is a fourth phase, **not** a failure. The row stays `pending`
server-side and PayHero may yet settle it, so the screen says exactly that:

> We could not confirm this payment. … We stopped waiting for an answer about
> this payment, so we cannot tell you whether it went through. **Check your
> M-Pesa messages. Please do not send it again until you have. If the first one
> went through, paying again pays twice.**

No "did not go through", no "nothing has been charged" — `docs/158`'s rule, on
the one screen where it bites hardest.

⛔ **It offers "Check again", not only an email address.** [VERIFIED] nothing
sweeps `payhero_payment_requests`: its only consumers are the settlement
service (driven by a callback or by this poll) and the abuse guard. **The
donor's own poll is the only path by which a late settlement is ever
discovered**, so leaving them with no way to re-ask would close it.

### 3.2 What was NOT done, and why

⛔ **No server-side age guard on settlement.** It is the obvious fix and it is
the wrong one, for the reason directly above: refusing to re-check an old
`pending` row would shut the only discovery path this platform has. The cost
being bounded is the client's job, because the client is what was looping.

⛔ **The row still carries `pending`, and `abandoned` stays unwritten.**
`payment_request_status` has an `abandoned` value that **nothing writes** —
`docs/129`'s class. Writing it here would be asserting an outcome, which is the
whole thing this screen refuses to do. Reported, not changed.

⛔ **`row.failureReason` is selected at `status/route.ts:72` and read zero
times**, while three sites hardcode *"The payment did not go through. Nothing
has been charged."* On the FAILED path PayHero has answered, so the claim is
substantiated — but the stored reason being fetched and discarded is debt, and
it is recorded rather than half-fixed.

## 4. Verified by execution, paired

Same lab, same stubs, same 390px viewport, before and after. Three arms,
**two of them controls**:

| arm | polls in window | screen | "Check again" |
|---|---|---|---|
| expired, **before** | **5 in 26s**, unbounded | `Waiting for your confirmation · 28s` | — |
| expired, **after** | **0** | unresolved | yes |
| **live control**, after | **5 in 26s** | still waiting | no |
| 500 (no stop signal), after | **47 in 275s**, then stopped | unresolved | yes |

⚠️ **The live control is what makes the zero mean anything.** "0 polls" is also
what a probe reports when it has gone blind (`docs/135` §5), and what a form
reports when it never reached the waiting screen at all. The same probe, same
window, counting 5 on a live prompt, is the discrimination.

47 ≤ 48 confirms the derived ceiling bites where no `keepPolling` exists. 0px
horizontal overflow on all three, measured with `isMobile: false` per
`docs/128` §5. No unsubstantiated claim on any screen.

⚠️ The post-fix expired arm reports `reached waiting screen: false`, and that
is the fix working rather than a failure: the immediate `void poll()` now moves
to `unresolved` inside the 2.5s the probe waits before looking. The live
control renders the waiting screen in the same code path.

## 5. The guard, and two holes the harness found in it

`src/components/campaign/MpesaDonationForm.test.tsx`, the
`the poll has a stop condition` block — 5 tests, including an anti-vacuity test
(a live prompt must still be polled, and an absent `keepPolling` must not be
read as a stop) and an honesty test over both unresolved paths.

**14 injections, all 14 behaved**, with a sha256-verified restore after each
and an anchor-match assertion before each (`docs/152`: an injection that does
not apply reports exactly like a rule with a hole in it). Rows 1 and 2 restore
the real production state and both fire. Rows 5, 6, 11 and 12 must PASS —
a ceiling that happens to equal today's number, a legitimately changed prompt
lifetime, a comment edit, and a reworded heading — so the rules check the
property and not today's arithmetic or today's copy.

### 5.1 ⚠️ My harness measured six rows against a polluted tree

Row 6 mutates `src/lib/payhero-prompt.ts`. The harness backed up **two** files
and restored **two**, and its restore check passed because it only hashed the
two it knew about — so rows 7 to 12 all ran with `PROMPT_LIFETIME_MS` left at
90 seconds, and rows 11 and 12 reported FIRE against changes that cannot
possibly break anything.

The tell was a comment-only edit failing with `expected 18 to be 36`.

`docs/120` §11.1 recorded exactly this and `docs/155` §5.2 met it again; this
is the third time, now in a harness I wrote after reading both. **The backup
set must be derived from the rows, not from the files you expect to touch.**

### 5.2 ⚠️ Two of my own rules were wrong, and the harness is what said so

- **The derivation test pinned `36`.** It asserted
  `Math.ceil(PROMPT_LIFETIME_MS / 5_000) === 36`, so row 6 — halving the prompt
  lifetime, with the ceiling correctly following it — failed. That is a test
  asserting today's number in the name of checking a derivation. Worse, its
  relational half (`ceil(x/y) + 12 > ceil(x/y)`) was arithmetically always
  true: **a check that cannot fail**, Gate 4 exactly. Fixed by exporting
  `MAX_POLL_ATTEMPTS` and asserting the component's own constant against a
  requirement derived from the shared one. Row 4 (a ceiling of 6) now fires.
- **The screen was identified by its prose.** Rewording the heading failed
  three tests. It is now found by its **control** — `Check again`, which is a
  functional requirement (§3.1), and which the `failed` screen cannot be
  confused with because that one says `Try again`. The copy's *honesty* is
  asserted separately, as a property.

### 5.3 ⚠️ And the honesty test only covered half the screen

Injection 14 planted *"nothing has been charged"* in the fallback message and
**did not fire**. The screen renders the server's own message when there is one
and its own fallback when there is not; the test only ever drove the expiry
path, which supplies a message. The ceiling path passes `null`. The test now
drives **both**, and the injection fires.

A rule that exercises one of two branches reports the same thing as a rule that
works.

## 5.4 A type that described the wrong end

The poll cast its response as `state: Phase | 'abandoned'`. That happened to
cover the three states the route sends — and the moment `Phase` grew
`unresolved`, it began claiming the server could send a state that exists only
inside this component. Retyped from the route's own union. **A response type
must describe the responder**, and reusing the local one is how it silently
stops doing so.

## 6. ⚠️ A correction to `docs/158`'s own file

`payhero-settlement.ts:92-102` said a reference-less row means *"there is
nothing to confirm and **nothing was charged**"*. `docs/158` had shipped the
day before establishing that a reference-less row is **exactly** what a lost
response leaves behind, and that the push reaches Safaricom synchronously. The
comment is the superseded belief, left in the file by the change that
superseded it. Corrected in place.

## 7. Gate

lint 1 pre-existing warning, typecheck clean, unit **8204 passed / 0 failed /
16 skipped** (291 files, +5 tests).

## 7.1 ✅ Live on production as v165

Merged fast-forward to `main` (`d53c39f..3a3d631`) after CI went green on all
eight jobs, because this is money code. `release v165 complete`, machine on
165, `1 total, 1 passing`, 0 orphaned release machines. `/`, `/campaigns` and
`/donate` all 200 against their pre-deploy baseline, and the sitemap carried
**8** campaign URLs on both sides of the deploy, so `--prerender` did its job
(`docs/119`).

The fix was then confirmed **in the deployed bundle**, not merely inferred from
a successful deploy: `/donate` references 28 chunks, and
`chunks/9574-…js` carries `could not confirm this payment`, `paying again pays
twice` and `Check again`. ⚠️ With a **fabricated control string** absent from
the same chunk, so the grep is a check that can fail. `The payment did not go
through` is still present and should be — the `failed` screen still exists.

### 7.2 ⚠️ Two probes that reported cleanly and could not see

- **`flyctl machine list --app lastdonor` answered "No machines are available
  on this app"** while `flyctl status` showed machine `d8d1116b5161d8` on
  version 165, `started`, 1/1 checks passing. That is the command CLAUDE.md
  prescribes for clearing orphaned `fly_app_release_command` machines — so a
  pre-deploy orphan check run that way can report "none" when it simply cannot
  see anything. **Use `flyctl status`, whose PROCESS column names every
  machine.** `docs/135` §5 on the deploy path.
- **Reading the failing job's log returned GitHub's own
  `ServerBusy — Egress is over the account limit`** as an XML body where the
  log should have been. Mistaken for an empty log, it reads as "no error
  information"; the MCP log tool returned the real content.

### 7.3 ⛔ Do not use "re-run failed jobs" on this workflow

`ci.yml:34-36` declares `concurrency: group: ci-${{ github.ref }}` with
`cancel-in-progress: true`. Re-running a failed job on a run that already owns
its group **deadlocks**: the re-run waits for a slot held by itself. [VERIFIED
three ways] the run sat `queued` with **zero jobs created** for 35 minutes with
`updated_at` frozen; a cancel was refused with `409 Cannot cancel a workflow
re-run that has not yet queued`, i.e. GitHub reported it as not queued while
the run read `queued`; and a fresh `workflow_dispatch` on the same sha started
immediately and went green on all eight jobs.

**Dispatch a fresh run instead.** The stuck run stays `queued` forever and is
harmless.

⚠️ The failure that prompted the re-run was itself not the change: `next/font`
fetches Google Fonts at build time and its parser hit a null match
(`TypeError: Cannot read properties of null (reading '1')` at
`@next/font/.../google/loader.js:122`). The diff touches neither `layout.tsx`
nor any font file, the previous run was green on the identical file, and the
fresh run built clean — so it was a transient fetch, spent as the one re-run
CLAUDE.md allows for "a service the diff doesn't touch".

## 8. What was NOT checked

- **The FAILED screen's copy.** This walk made the poll stop; it did not read
  what the `failed` phase says when PayHero reports FAILED, which is the path
  both real production failures took.
- **A real expiring prompt.** Every measurement here stubs the status endpoint.
  Proving the real one end to end means raising a real STK push and letting it
  lapse, which moves money — the `docs/158` §2 boundary.
- **The `abandoned` status and `failureReason`** — §3.2, reported not changed.
- **The card rail's waiting screen**, which does not exist: that rail answers
  503 to everybody (`docs/125`).
- No screen reader. The unresolved screen carries `role="alert"`; its
  announcement was not heard.
