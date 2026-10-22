# 99 — The E2E seed fixture, and what it revealed instead

**Date:** 2026-10-22
**Trigger:** owner asked for the E2E seed fixture `docs/98` §5 identified as
the blocker.
**Status:** fixture **built, tested and verified working**. It did **not**
make the suite green, and the reason is the finding: most E2E failures are
not missing data. ⛔ E2E stays out of CI.

---

## 1. What was built

| File | Role |
|---|---|
| `e2e/fixtures/seed-data.ts` | the rows, the fixed ids, and the safety guard |
| `e2e/global-setup.ts` | seeds once before the run |
| `e2e/global-teardown.ts` | deletes exactly those ids afterwards |
| `e2e/fixtures/seed-data.test.ts` | 14 unit tests, mostly on the guard |
| `playwright.config.ts` | wires setup and teardown |
| `vitest.config.ts` | narrowed `exclude` so the fixture's test actually runs |

It seeds four campaigns, two donations, a blog post and one organiser user:

- **The general fund, at the real `GENERAL_FUND_CAMPAIGN_ID`.** Not a fresh
  uuid: `/donate` looks that exact id up and hides the donation form unless
  it is `active` or `last_donor_zone` (`docs/42`). A different id renders the
  explanatory empty state, and nine donate-button tests then fail against a
  form that was never there.
- An `active` mid-progress campaign, the one most specs land on first.
- A `last_donor_zone` campaign near its goal, so the phase the product is
  named after gets rendered rather than only ever `active`.
- An `active` campaign with **no** donations, so the unfunded zero state is
  exercised.

Donations are `source: 'real'` deliberately. A `seed`-sourced row is gated
behind `SEED_DONATIONS_OPT_IN` and excluded from public totals (`docs/41`),
so it would not appear where the specs look. Their `stripePaymentId` uses an
`e2e_` namespace, because that column is the provider reference for every
gateway and the namespaces must not collide (CLAUDE.md).

### Verified

| Check | Result |
|---|---|
| Seed time | **43 ms** |
| Rows created | 4 campaigns, 2 donations, 1 post, 1 user |
| Idempotent (seed twice) | still 4 campaigns, no duplicate-key error |
| Teardown | 0 rows remaining |
| `/campaigns` renders the fixture | yes — fixture titles present in the HTML |
| `/donate` renders the form | yes — "Make a Donation", all six amount radios, custom amount, email, submit |

---

## 2. The guard is the most important part of the file

The fixture INSERTs and DELETEs. The only connection string this project
actually has is **production** (`docs/98` §1). So `assertDatabaseIsDisposable()`
refuses anything that is not plainly disposable, and it runs on both seed and
teardown.

Proven by test, with the real shapes this project's `DATABASE_URL` has taken:

| `DATABASE_URL` host | Verdict |
|---|---|
| `localhost`, `127.0.0.1` | allowed |
| `postgres` (the CI service container) | allowed |
| `aws-0-…pooler.supabase.com` | **refused** |
| `db.….supabase.co` | **refused** |
| `lastdonor-db.internal` (Fly) | **refused** |
| unset | **refused** |
| non-local + `E2E_ALLOW_NONLOCAL_DB=1` | allowed, with a loud warning |

Only the exact string `"1"` opens the escape hatch — `"true"`, `"yes"`,
`"0"` and `""` are all refused, because an override that triggers on
anything truthy is an override that triggers by accident.

**Teardown deletes by id and never truncates.** That is the whole difference
between this fixture and the hazard `docs/98` §6 refused: a `TRUNCATE` in
teardown is one misconfigured variable away from erasing the donation ledger.

### `vitest.config.ts` had to change, or the guard gated nothing

The unit config excluded `e2e/**` wholesale, so a test file beside the
fixture was collected by nothing and asserted nothing — a ratchet that has
quietly stopped ratcheting. The exclude is now `e2e/**/*.spec.ts` (Playwright
only) and the include gained `e2e/**/*.test.ts` (Vitest only). The split is
by extension and unambiguous.

A detail worth recording because it fails *loudly but confusingly*: those
globs contain `*/`, which closes a block comment. Explaining the change in a
`/* … */` above it made the config unparseable with
`Expected identifier but found "."` pointing at the comment. The explanation
is line comments now.

---

## 3. ⚠️ The finding, and a correction to `docs/98` §5

`docs/98` §5 said the E2E blocker was fixtures. **That was right about the
cause of the failure it inspected and wrong to generalise from it.** I had
read `e2e-02-guest-donate.spec.ts`, seen it click "the first campaign link"
against an empty `/campaigns`, and concluded the other 28 failures were the
same thing. They are not.

With the fixture in place and verifiably rendering, the suite still failed:
**32 failed, 25 passed** (Desktop Chrome, 5.7 min).

By spec, counted from the per-failure artifact directories — which undercount,
since a test that fails before producing artifacts leaves no directory, hence
28 here against the reporter's 32:

| Spec group | Before fixture | After |
|---|---|---|
| `accessibility` | 10 | **10** |
| `donate-button-e2e` | 9 | **7** |
| `e2e-01-donation-flow` | 2 | 2 |
| `e2e-02-guest-donate` | 2 | 2 |
| `e2e-04-register-profile` | 2 | 2 |
| `e2e-05`, `09`, `10`, `12`, `15` | 1 each | 1 each |

⚠️ **That run is not a clean measurement and should not be quoted as one.**
Three failures are `browserType.launch: Target page, context or browser has
been closed` and one is a 120s `locator.fill` timeout — resource contention,
because axe probes were being run against the same dev server at the same
time. The honest figure is "roughly 30 of 57, dominated by the causes in
§3.1 and §4"; a clean re-run is listed in §5 as the first step before
anything else is concluded from the number.

What is not in doubt: the fixture fixed **two** tests (donate-button 9 → 7)
and made `/campaigns` non-empty. It was **necessary but nowhere near
sufficient**, and saying otherwise would have been the third time in this
project that one fixed cause was mistaken for the only cause (`docs/97`
§1a).

### 3.0 One thing the run did settle: the ordering is right

`globalSetup` runs **before** `webServer`, verified by the run's own output —
`[e2e-seed] fixture ready in 36ms` is the first line, ahead of the dev
server starting. That matters: had the order been reversed, the server would
boot against an empty database and could cache an empty `/campaigns` for the
whole run, so the fixture would appear not to work. No extra machinery
(seeding from the `webServer` command, say) is needed.

### 3.1 The real dominant cause: the specs describe a UI that no longer exists

`donate-button-e2e.spec.ts` is the clearest case. Its "message character
counter updates" test is:

```ts
await goToDonate(page);
await expect(page.getByText('0/500')).toBeVisible();
await page.getByLabel(/message/i).fill('Hello world');
```

But the rendered form puts the message behind a disclosure:

```
button "Add a message or dedicate your gift"
```

so `0/500` is not on the page until something opens it. The same spec's
header comments promise to "fill donor details (name, email, location,
message)" — and the current form has **no name field at all**, only
`textbox "Email address"`.

The donate page was redesigned (`docs/72` benchmarked it and cut page
length; `docs/42` reworked its states). The specs were written against the
older layout and **never ran**, so nothing ever told anyone they had drifted.
This is the inverse of the usual rule in CLAUDE.md: when a test and the code
disagree, work out which drifted — here it is overwhelmingly the test.

**This is not a fixture problem and cannot be fixed by one.** It is a
spec-by-spec reconciliation against the current UI, and it needs care:
rewriting each assertion to match whatever the page currently does produces
tests that can never fail, which is worse than no tests.

### 3.2 And ten of them are a real product defect

See §4. Those are not drift — the pages genuinely fail WCAG.

---

## 4. A real accessibility defect, found and fixed

The `accessibility` spec visits ten mostly-static pages (`/about`,
`/privacy`, `/terms`, `/login`, …) and runs axe. It needs no campaign data,
which is why the fixture changed nothing for it.

**First, a correction to my own reading.** I initially reported "hundreds of
colour-contrast violations" from the failure output. That was wrong: I was
counting **diff lines**, not violations. Properly counted with axe:

| Page | Violations | Nodes |
|---|---|---|
| `/privacy`, `/terms`, `/login`, `/about`, `/how-it-works`, `/campaigns` | 1 | 9 |
| `/` (homepage) | 4 | 16 |

Exactly 9 nodes on every page, because they are the same elements every
time: **the footer**.

Dark mode is also not involved, which the diff made it look like. Measured
with Playwright's `colorScheme` forced both ways, `body` background is
`rgb(255,255,255)` and `data-theme` is unset in **both** — the site does not
follow `prefers-color-scheme`. The `#0f1a19` background in the violation
messages is the footer's own dark `--surface-ink` surface (`docs/59`).

### The defect

Light-mode greys on that dark surface:

| Element | Class | Ratio on `#0f1a19` | AA needs |
|---|---|---|---|
| Six social placeholders | `text-gray-600` (#4a5565) | **2.35:1** | 4.5:1 |
| Address block, © line, trust badges | `text-gray-500` (#6a7282) | **3.67:1** | 4.5:1 |

Fixed by moving all four to `text-gray-400` (#99a1af, **6.83:1**) — measured
as the smallest Tailwind step that passes, and consistent with `docs/59`'s
`white/65` footnote at 7.30:1. Most of the footer was already `gray-400`;
these four were the stragglers.

The social placeholders are the interesting one. `docs/91` made them
deliberately dim to read as inert, and dimming is the obvious way to signal
"not a link" — but 2.35:1 is below legibility, so the signal was being paid
for in readability. It did not need to be: the component's own comment
already lists the real signals (no `href`, not focusable, an `sr-only`
"coming soon" so state is not conveyed by colour alone, WCAG 1.4.1). Raising
the contrast costs nothing semantically. **A placeholder nobody can read is
not a placeholder.**

⚠️ **Verified by computation, not yet in a browser.** Next's dev server
served the old classes after the edit — `curl` still showed
`text-gray-600` — so the re-measurement after the fix is pending a server
restart. The three homepage-only violations
(`aria-required-children`, `aria-required-parent`, `listitem`) are **not
fixed** and are structural, not colour.

---

## 5. ⛔ Still not in CI, and why

`e2e-tests` stays gated and skipping. A job that fails 28 times is worse
than one that skips: a permanently red required check trains people to
ignore CI, which is how this pipeline got to five days of green local
checks and zero runs in the first place (`docs/50`).

The order of work to turn it on:

1. Re-measure the footer fix against a restarted server, and fix the three
   homepage structural violations. That clears the 10 accessibility
   failures — real defects, worth fixing on their own merits.
2. Reconcile the drifted specs against the current UI, one file at a time,
   asserting what the page *should* do rather than what it currently does.
3. Only then give the job the same `postgres:16` service container
   `integration-tests` has (`docs/98` §2), plus the env baseline in §6.

---

## 6. The env baseline E2E needs

Found by running it: `src/lib/validate-secrets.ts` logs
`[SECRET-VALIDATION] FATAL` on startup unless these are present and
well-formed. It only *throws* in production, so the app still serves in dev
— but a FATAL in the logs of a passing run is a false lead, the same
category as the `pg_isready` noise in `docs/98` §2.

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | ≥20 chars, `^postgres(ql)?://` — **the only one the integration suite needs** |
| `NEXTAUTH_SECRET` | ≥32 chars |
| `CRON_SECRET` | ≥32 chars |
| `PASSWORD_PEPPER` | ≥32 chars |
| `STRIPE_SECRET_KEY` | ≥20, `^sk_(test\|live)_` |
| `STRIPE_WEBHOOK_SECRET` | ≥20, `^whsec_` |
| `NEWSLETTER_UNSUBSCRIBE_SECRET` | distinct from `NEXTAUTH_SECRET`, else a warning |
| `SETTINGS_ENCRYPTION_KEY` | distinct from `NEXTAUTH_SECRET`, else a warning |

None of these needs a real value for E2E. They are format and entropy
checks, and obvious throwaways satisfy them.

---

## 7. Rejected

**Rewriting the drifted specs in the same pass as the fixture.** Tempting,
and it is the work that actually turns the suite green. Rejected here
because the two changes answer different questions and must be reviewable
apart: the fixture is "does the suite have the data it assumes", the specs
are "does the suite assert the right things". Bundling them would also mean
writing 18 assertions against a UI I had just measured, which is how a suite
ends up asserting its own screenshot.

**Having the fixture seed through `POST /api/v1/user-campaigns`.** It would
respect the review gate honestly instead of inserting rows directly — and it
would park every campaign in `under_review` (`docs/78`, `docs/79`), which is
exactly the state that makes `/campaigns` empty and the suite fail. The gate
is a product rule about what the public sees, not a constraint on fixtures,
and `test/helpers.ts` already seeds directly for the integration suite. The
gate keeps its own tests, which assert both insert paths write
`under_review`; nothing here weakens them.

**Truncating in teardown.** Simpler and total. Refused for the reason in §2.

**Giving E2E the service container now.** See §5.

**Making the specs tolerant of an empty database** (wrapping each in
`test.skip` when no campaign exists, which two specs already do). It would
turn the suite green immediately and assert nothing — the failure mode
`docs/98` §3 just finished removing from the integration suite, where a
whole run could pass while proving nothing.
