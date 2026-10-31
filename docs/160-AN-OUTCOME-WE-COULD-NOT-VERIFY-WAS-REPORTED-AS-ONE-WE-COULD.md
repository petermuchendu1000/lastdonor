# 160 — An outcome we could not verify was reported as one we could

The FAILURE journey's second half, which `docs/158` §8 and `docs/159` §8 both
left open in the same words: *"what the `failed` phase says when PayHero
reports FAILED"*. The dominant path turned out to be correct. The branch beside
it was not.

---

## 1. The finding

`settlePayHeroRequest` answers **`unverifiable`** when it cannot establish what
happened, and the status route reported that to the browser as
**`state: 'failed'`**.

The client's `failed` screen (`MpesaDonationForm.tsx:479-513`) heads with
**"Your donation was not completed"** and then appends — unconditionally, and
**outside the `??`** that holds the server's message:

> That usually means the prompt was cancelled, it timed out before the PIN was
> entered, or there was not enough in the M-Pesa balance.

Three invented causes for an outcome the sentence directly above has just said
cannot be determined. Then a **Try again** button.

⛔ On the amount-mismatch path (`payhero-settlement.ts:198-224`) the platform's
own audit row — `severity: 'critical'` — reads *"Money moved but no donation row
was written. Needs manual reconciliation."* So that sentence about an
insufficient M-Pesa balance would be addressed to somebody whose balance had
just been debited, under a heading telling them nothing had happened, beside a
control inviting them to pay again.

⚠️ **The route was careful and the client undid it.** `status/route.ts` sent an
honest message; the screen it chose claims an outcome before the message is
read. The author's comment at `:488-495` reasons correctly — *"being told the
wrong reason is worse than being told none"* — for the genuine FAILED path it
was written for. `unverifiable` was routed through the same screen afterwards.
`docs/159`'s shape: a decision right when it was made, and a different case sent
through it later.

## 2. Severity, stated honestly — LOW

This is a latent copy defect, not an incident, and three measurements say so.

- [VERIFIED] **Never fired.** Production holds **0** `donation.payhero_amount_mismatch`
  audit rows, and all five `payhero_payment_requests` carry a PayHero
  reference.
- [VERIFIED] **PayHero reports the amount we asked for.** A read-only
  `transaction-status` GET for all five real transactions, through the
  project's own client: **5/5 MATCH, 0 mismatches, 0 nulls**, each with our
  `external_reference` echoed back and M-Pesa receipts present on the three
  successes. So `:222` guards against behaviour that has not been observed.
- [VERIFIED] **Half the branch is unreachable from a donor's poll at all** —
  §3.1.

An earlier draft of this finding described it as serious. It is not, and saying
so is part of the work.

### 2.1 ⚠️ The falsifier that halved the claim

`settlePayHeroRequest` has **two** `unverifiable` returns, not one, and they do
not share a blast radius:

| site | condition | reachable from the donor's poll? |
|---|---|---|
| `:106-111` | no PayHero reference on the row | **NO** |
| `:221-224` | PayHero reports SUCCESS with a different amount | yes |

[VERIFIED from `initiate/route.ts:257-275`] the route writes `payheroReference`
**before** it returns the reference the client polls with. So a donor can only
ever poll a row whose reference is already recorded, and `:106` is reachable
only by the **callback** route — which reports `outcome.kind` back to PayHero
and renders nothing to anybody.

My first write-up treated both sites as donor-facing. One is not, and I should
have traced the ordering before saying it.

## 3. The fix: report the row's actual state

```ts
case 'unverifiable':
  return settled('pending', '…could not match it to your donation.', false);
```

⛔ **`pending` is not a softer word for failed — it is true.** [VERIFIED] both
`unverifiable` returns happen **before** the claim (`settlement.ts:106` and
`:221`, against the `.set({status:'succeeded'})` at `:227`), so nothing has been
written and PayHero may still settle it. The route had been reporting a state
the row was not in.

And because `docs/159` shipped hours earlier, the client **already** renders
`pending` + `keepPolling: false` as the `unresolved` screen — which claims
nothing, warns that paying again pays twice, and offers **Check again**. So the
fix needs **no client change at all**; it stops sending a state that was never
accurate.

⛔ `settled()` derives `keepPolling` from the state, so `settled('pending', …)`
alone would send `keepPolling: true` and reinstate the endless poll `docs/159`
had just fixed. The flag is passed explicitly, and the rule in §5 checks it.

### 3.1 ⚠️ A duplication I nearly shipped

The first version reused the existing message, which opened *"We could not
confirm this payment…"* — the `unresolved` screen's own heading. Rendered, it
read *"We could not confirm this payment**We could not confirm this payment.**
If your phone says…"*: the donor reads the same sentence twice and the one slot
that could tell them something new tells them nothing. `docs/112` made exactly
this call about an `og:description` that began with its own title.

Caught by **looking at the render**, not by any assertion.

## 4. Verified by execution, paired

The same outcome driven through the real component, before and after:

| | BEFORE (`state:'failed'`) | AFTER (`pending` + `keepPolling:false`) |
|---|---|---|
| claims "was not completed" | **true** | false |
| invents three causes | **true** | false |
| warns paying twice | false | **true** |
| control offered | Try again | Check again |

Every indicator flips on the same lab condition — the `docs/158` A/B shape. The
final screen reads:

> **We could not confirm this payment** · We heard back about this payment but
> could not match it to your donation. · Check your M-Pesa messages. Please do
> not send it again until you have. If the first one went through, paying again
> pays twice. · If money left your account, email support@lastdonor.org and we
> will sort it out. · **Check again**

## 5. The guard

`src/app/api/v1/donations/payhero/status/unverifiable-claims.test.ts`, 6 tests.

⚠️ **Derived at both ends.** It reads the **client** to learn which server
states render the claiming screen (`state === 'failed' || state === 'abandoned'`),
then reads the **route's** `case 'unverifiable'` branch and forbids those.
Pinning the literal `'failed'` would have caught none of the ways this can come
back.

Anti-vacuity in both directions: the client must actually *have* a claiming
screen (an empty derived set would make the rule pass against anything), and
the genuine `case 'failed'` branch must still make its claim — otherwise the
rule is satisfied by telling every donor nothing.

**8 injections, all 8 behaved**, restore sha-verified. Row 1 restores the real
production state and fires. ⚠️ **Row 6 is the one that proves the derivation**:
making the *client* claim with `'pending'` too fires the rule **without any
literal in the rule changing**. Rows 7 and 8 must pass — a comment edit, and a
reworded-but-still-honest message — so the rule checks the property, not today's
copy.

⚠️ My own harness had row 8 labelled "MUST PASS" with `expect=fire`. Caught
before running; a row whose expectation is wrong reports nothing useful either
way.

## 6. Three things checked and found NOT to be defects

Recorded so nobody re-investigates them (`docs/129`'s habit):

- **The dominant FAILED path is correct.** PayHero answered, so *"Nothing has
  been charged"* is substantiated, and the three appended causes are precisely
  the three real things PayHero collapses into `FAILED`
  (`settlement.ts:138-160` also maps an unrecognised status to `still_pending`,
  never to failed). Left exactly as it is, and a control test pins it.
- **The `docs/158` latch surviving a retry.** `retry()` (`:309-316`) clears
  phase, reference, messages and seconds but not `outcomeUnknown` /
  `checkedMessages`. Traced: the box is already ticked, so it never blocks, and
  a *second* unknown re-latches via `setCheckedMessages(false)` at `:284`.
  Slightly stale UI, and the safer direction.
- **One donation has no `donation.recorded` audit row.** [VERIFIED] all three
  donations exist and the money is right; the gap is the **first** payment this
  platform ever took (2026-10-21 03:39:19), and the 04:52 and 10-29 ones both
  have rows. `docs/92` dates that morning to when the rail was being built.
  ⚠️ I first phrased this as "3 succeeded requests, 2 recorded rows", which
  reads as a missing donation. It is not.

## 7. Gate

lint 1 pre-existing warning, typecheck clean, unit **8210 passed / 0 failed /
16 skipped** (292 files, +6 tests).

## 7.1 ✅ Live on production as v166

Merged fast-forward to `main` (`8829882..4dba5ce`) after CI went green on all
eight jobs, with the runner's own counts read rather than assumed: **292 files
passed / 3 skipped, 8210 tests passed / 16 skipped** — identical to local.

`release v166 complete`, machine on 166, `1 total, 1 passing`. `/`,
`/campaigns` and `/donate` all 200 against their pre-deploy baseline, and the
sitemap carried 8 campaign URLs on both sides (`docs/119`). ⚠️ The baseline and
the check were both taken with `flyctl status`, not `flyctl machine list`,
which `docs/159` §7.2 caught answering *"No machines are available on this
app"* while a machine was running.

The changed route was then probed live, with two discriminating controls:

| probe | result |
|---|---|
| a real `LD-` reference | **200** `{"state":"succeeded","keepPolling":false,…}` |
| a well-formed but unknown `LD-` reference | **404** `NOT_FOUND` |
| a reference outside the `LD-` namespace | **404** — the isolation check |

⚠️ That `keepPolling: false` beside `succeeded` is worth more than it looks:
it is the **refactored `settled` helper's default parameter**
(`state === 'pending'`) evaluating on the deployed image, which is the one
piece of this change a live probe can reach.

⛔ **The `unverifiable` branch itself cannot be exercised live** without a real
amount mismatch, which would mean a payment PayHero settles for the wrong
figure. It is covered by the derived rule and the paired A/B, not by a
production observation, and that gap is deliberate.

## 8. What was NOT checked

- **Whether `:221` can fire at all.** 5/5 real transactions matched, which is
  evidence and not proof; PayHero's documented behaviour on partial or
  adjusted settlement is [UNKNOWN]. What would establish it: PayHero's own
  specification, or a mismatch observed in the wild.
- **The screen in a real browser.** The A/B above is jsdom. The `unresolved`
  screen itself was measured in Chromium at 390px by `docs/159` (0px
  horizontal overflow); only this new entry path into it has not been.
- **The callback route's handling of `unverifiable`** beyond reading that it
  returns `outcome.kind` and writes nothing further.
- No screen reader. The screen carries `role="alert"`; its announcement was not
  heard.
