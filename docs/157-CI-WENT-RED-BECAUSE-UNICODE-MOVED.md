# 157 — CI went red because Unicode moved, in a file nobody had touched

Found while verifying `docs/156` on a runner. **CI was red on `main`**, and the
failure looked like a money bug: five assertions in
`src/lib/money/world-currencies.test.ts`, the test whose own header says *"an
exponent that is wrong by one is a money figure wrong by a factor of ten."*

Nothing was wrong with the table. The test was comparing two independent data
vintages and calling their difference a defect.

---

## 1. What failed

Dispatched CI on the `docs/156` branch; `unit-tests` failed, which gated
`build`, `integration-tests` and `e2e-tests` off entirely.

```
FAIL src/lib/money/world-currencies.test.ts > every generated exponent agrees with ICU > COP
FAIL ... > HUF     AssertionError: expected 2 to be +0
FAIL ... > IDR
FAIL ... > PKR
FAIL ... > RSD     AssertionError: expected +0 to be 2
Tests  5 failed | 8160 passed | 16 skipped (8181)
```

## 2. Verified three ways that it was not the change under test

1. **Not in the diff, and green locally.** `git diff dd6f7ac..24ea63b`
   contains no money or currency file, and the suite passes locally **171/171**
   on Node 22.22.0 / **ICU 77.1**.
2. **The cause, established without CI at all.**
   `scripts/generate-world-currencies.py` pins its source at **cldr-core@46**.
   I fetched `supplemental/currencyData.json` from both cldr-core@46 and
   cldr-core@48 off jsDelivr and diffed `_digits`:

   | code | @46 (our table) | @48 (CI's ICU) |
   |---|---|---|
   | COP, HUF, IDR, PKR | 2 | **0** |
   | RSD | 0 | **2** |

   Across all 152 codes in the table **these five are the only ones that
   changed**, in exactly the directions CI reported. So CI's runner ships a
   Node whose ICU carries CLDR 48, and `NODE_VERSION: '22'` floats to the
   latest 22.x.
3. **Red on the base branch too.** Dispatched CI on `main` at `dd6f7ac`:
   `5 failed | 8160 passed`, the **identical five codes in the identical single
   file**. The branch run was `5 failed | 8173 passed` — the +13 being exactly
   `docs/156`'s new tests, and no new failure.

⚠️ So this reached production. `dd6f7ac` is live as v161. See §5 for why that
is a display question and not an incident.

## 3. The actual defect, which is in the test

```ts
expect(WORLD_CURRENCY_EXPONENTS[code]).toBe(icu);   // the old assertion
```

The left side is a **snapshot pinned at cldr-core@46, committed to the repo**.
The right side is **whatever CLDR the ambient runtime's ICU happens to carry**.
Those are two independent release trains coupled by nothing, so they were
always going to drift — and when they did, the assertion could not distinguish:

- *our table disagrees with reality* — a defect, and the factor-of-ten risk
  the test exists for; from
- *this runtime ships a newer CLDR than the table was generated from* — a fact
  about the runtime, and not a defect at all.

It reported the second as the first, in a money file, six days after anyone had
touched it. That is worse than no check for the time it costs whoever meets it.

This is `docs/97` §5.1 one layer down. That one was CI pinned to a Node nobody
else used; this is CI carrying **data** nobody else has, with no version
anywhere in the repo recording which vintage the assertion assumes.

## 4. The fix

`exponentVerdict(ours, icu, revision)` — a **pure function**, plus
`CLDR_REVISIONS_AFTER_PINNED_VINTAGE`, a dated record of changes *Unicode
itself* made, carrying **both** values and the release.

The sweep accepts `agree` or `known-cldr-revision` and fails on everything
else, so all the original protection survives:

| situation | verdict | result |
|---|---|---|
| table == runtime | `agree` | pass |
| differs, recorded, both values match | `known-cldr-revision` | pass |
| differs, **no record** | `unexplained-divergence` | **fail** |
| differs, but our value isn't the recorded `pinned` | `table-moved-under-the-record` | **fail** |
| differs, and runtime isn't the recorded `later` | `third-vintage` | **fail** |
| ICU does not know the code | `icu-unknown-code` | **fail** |

⛔ The record is **not an allowlist** and must not be widened to silence a
failure. A genuine generator bug still has no record and still fails.

### 4.1 ⛔ Why the judgement had to be a pure function

**The branch that matters is unreachable on this machine.** Local ICU is CLDR
46, so nothing diverges, so a test driven only by the ambient ICU exercises
`agree` and nothing else — and would pass with the whole record deleted. A rule
whose interesting half never runs where it is developed is the shape `docs/76`,
`docs/77` and `docs/81` are all about. Same move as `docs/107` and `docs/130`:
put the decision somewhere a test can execute it.

So the fix also carries a **CLDR-48 simulation** — the real @48 `_digits`
values, fed through the same judgement — which is what proves the fix works
*where it broke* before pushing.

### 4.2 Mutation proof, and the row that must pass

11 rows, **all 11 behaved**, restore verified independently.

⚠️ **Row 1 expects a PASS, and that is the finding, not a weak rule.** It
restores the original assertion verbatim; locally it **does not fire**, because
this runtime cannot produce the divergence. Row 2 then deletes one record entry
— also still green via the `agree` short-circuit — and fires **only** through
the CLDR-48 simulation. Those two rows together are the argument for the
simulation existing.

Rows 3–10 each fire: the anti-rot check, every verdict branch, a collectable
currency being put in the record, a record whose two values are equal, and
gutting the simulation itself. Row 11 must pass (a comment quoting the old
assertion).

## 5. Blast radius: display only, and verified so

⛔ **None of the five is collectable.** `CURRENCIES` holds `USD` and `KES`, and
neither appears in CLDR's `fractions` table at all — both take the default of
2, so neither moved between @46 and @48. `WORLD_CURRENCY_EXPONENTS` is
display-only by `docs/103`'s central decision (*known is not collectable*), so
no money path can reach these numbers: no charge, cap, payout or refund is
computed from them. What they do feed is the approximate converted figure of
`docs/102`/`docs/104`/`docs/149`.

A new test pins that, mirroring the rule `docs/103` already has for the 13
ISO/CLDR disagreements: **no code in the record may be collectable**, with a
control that the record is non-empty and that neither collectable currency is
in it — otherwise an empty record would satisfy the rule.

## 6. NOT fixed, and left to the owner

**Should the table be regenerated at cldr-core@48?** That would make
HUF/IDR/PKR/COP display with **0** decimals and RSD with **2**, which is what
Unicode now says local usage is. It is defensible and it is a product decision
about what users see, so it is not an audit's to make. Note it would also
invert where the test breaks: green on a CLDR-48 runtime, and the anti-rot
assertion would then (correctly) demand the record be updated.

**Should `NODE_VERSION` be pinned to an exact patch?** It would make CI
deterministic, but `ci-node-version.ratchet.test.ts` requires `.nvmrc` (`22`),
`package.json` `engines` (`>=22`), the Dockerfile and the workflow to agree, so
it is a four-file change with its own trade-off — and it would not stop dev
machines drifting.

Neither is needed to make CI green, and the fix above is correct under either.

## 7. Also found, reported not fixed

⚠️ **The E2E seed cannot delete a user who verified an institution.** Running
the suite with a `trusted_institutions` row present dies before any test:

```
[e2e-seed] FAILED: update or delete on table "users" violates foreign key
constraint "trusted_institutions_verified_by_users_id_fk"
```

The row was mine (a lab fixture for `docs/156`), so this is not a product
defect — but it is the **fourth** instance of the fixture-cleanup omission
recorded in `docs/121`, `docs/123` and `docs/139` §8, and it fails *before* the
first test rather than during one, so the symptom is a webServer start failure.
`docs/136` §8 exercised institutions and vouches, so a row is not hypothetical.
Left alone because it is the E2E fixture's cleanup list, not this change's.

## 8. ✅ Verified on the runner that broke it

Dispatched after pushing (run 41055329834, `claude/adoring-bell-7aka3l`):
**all eight jobs green**, which is the first fully green pipeline since the
runner image moved.

| job | result |
|---|---|
| lint-and-typecheck, security-audit | success |
| unit-tests | **8189 passed / 16 skipped**, 290 files — **0** `world-currencies` failures |
| build | success |
| integration-tests | 326 passed (34 files) |
| e2e-tests (Desktop Chrome) | 83 passed / 12 skipped |
| e2e-tests (Mobile Chrome) | 83 passed / 12 skipped, **0 flaky** |
| ci-complete | success |

The unit count is **identical to the local run**, so the five codes are
passing rather than skipped, and the divergence branch really did execute on a
CLDR-48 ICU. That settles §4's one open claim: the fix is [VERIFIED] on the
runtime it was written for, not only by simulation.

⚠️ `docs/156`'s change is also verified on a runner by this run — its
`build`, `integration-tests` and `e2e-tests` had all been gated off by this
very failure, so the E2E axe legs had never seen it. 166 passed / 0 failed is
the check `docs/145` §4 exists for (two accessibility regressions that only
the E2E axe run caught).

## 9. What was NOT checked
- Which ICU version CI actually carries is **[INFERRED] from the five codes
  matching @48 exactly**; the runner log does not print `process.versions.icu`.
  A newer release that happens to agree with @48 on these five would read the
  same.
- Whether any other generated table (`country-currency.generated.ts`,
  `timezone-country.generated.ts`) has the same vintage coupling was **not
  swept**. They are compared against pinned snapshots rather than against ICU,
  so the hazard looks absent, but I did not verify it.
