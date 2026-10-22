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

1. ✅ **Done.** Re-measure the footer fix against a restarted server, and fix
   the three homepage structural violations. That clears the 10 accessibility
   failures — real defects, worth fixing on their own merits.
2. ✅ **Done**, see §8. Reconcile the drifted specs against the current UI,
   one file at a time, asserting what the page *should* do rather than what
   it currently does.
3. Only then give the job the same `postgres:16` service container
   `integration-tests` has (`docs/98` §2), plus the env baseline in §6.

### 5.1 Open, and deliberately not invented

Three gaps are left open rather than papered over. Each is recorded because
a spec was asserting it and the honest fix was to stop pretending.

**No sign-in fixture.** `playwright.config.ts` sets no `storageState`, and
the seed fixture gives its organiser no password. So every spec that needs
an authenticated session — the admin screens, posting a campaign message —
is **declared skipped with a named reason** instead of being guarded by an
`isVisible()` probe that silently skipped on every run while looking like
coverage. `e2e-17` and `e2e-18` carry those constants. Building the fixture
means deciding how to mint a session without weakening the real sign-in
path, which is its own piece of work.

**WebKit and Firefox are not covered at all.** `playwright.config.ts`
declared four projects, and nothing in this repository installs the browsers
two of them need: CI runs `npx playwright install --with-deps chromium` and
pins its matrix to the two Chromium projects. So a bare `npm run test:e2e`
collected **292 tests** of which roughly **146 could only fail** with
`browserType.launch: Executable doesn't exist` — a result about the
environment, not the product. It is also how `e2e-08` came to fail for a
reason unrelated to its subject, since `devices['iPhone 14']` carries
`defaultBrowserType: 'webkit'`.

Firefox and WebKit now sit behind `PW_ALL_BROWSERS=1` rather than being
deleted: iOS Safari is a large share of a donation site's traffic, and a gap
that is written down can be closed while a quietly deleted project cannot.

    npx playwright install firefox webkit
    PW_ALL_BROWSERS=1 npm run test:e2e

**A public "Last Donor Zone" indicator does not exist.** `e2e-03` asserted
one. Probed against a production build with an LDZ campaign seeded and
verifiably listed: the string appears **zero** times on `/campaigns` and
zero times on the campaign's own detail page. Both components that render
that label — `CampaignStatusBadge` and `PhaseBadge` — are imported only by
admin and dashboard screens.

The platform is named after this phase, so the absence is at least
interesting, but **whether a visitor should see a campaign's phase is a
product decision**, so nothing was built to make a stale assertion pass.
`e2e-03` now asserts the invariant that genuinely holds — `last_donor_zone`
is a fully active, donatable status that `/campaigns` lists — which three
files depend on and which would break silently if anyone narrowed a status
list to `'active'`.

---

## 6. The env baseline E2E needs

Found by running it: `src/lib/validate-secrets.ts` logs
`[SECRET-VALIDATION] FATAL` on startup unless these are present and
well-formed.

> **⚠️ AMENDED 2026-10-22 — this section originally said the FATAL is only
> noise.** It said the validator "only *throws* in production, so the app
> still serves in dev — but a FATAL in the logs of a passing run is a false
> lead". The first half is true and the conclusion was wrong, because **E2E
> now runs a production build** (that was the point of the `webServer`
> change). In a production build the throw is real: `instrumentation.ts`
> fails to load and **every route answers 500**.
>
> What that looks like from Playwright is the dangerous part. It polls
> `webServer.url` for a non-5xx, a 500 never satisfies it, and the only
> output is
>
>     Timed out waiting 300000ms from config.webServer
>
> with `"expected": 0, "unexpected": 0` in the JSON report — which reads
> like a clean pass. Measured here: one missing `PASSWORD_PEPPER` cost a
> full 300-second run and produced no test results and no useful error.
> **On a `webServer` timeout, read the server's own stdout before touching
> the timeout value.**

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | ≥20 chars, `^postgres(ql)?://` — **the only one the integration suite needs** |
| `NEXTAUTH_SECRET` | ≥32 chars |
| `CRON_SECRET` | ≥32 chars |
| `PASSWORD_PEPPER` | ≥32 chars — **missing this 500s every route in a production build** |
| `STRIPE_SECRET_KEY` | ≥20, `^sk_(test\|live)_` |
| `STRIPE_WEBHOOK_SECRET` | ≥20, `^whsec_` |
| `AUTH_TRUST_HOST` | `true`. **Added 2026-10-22, and it was missing from this table.** Not read by `validate-secrets.ts`, so nothing warns. Without it NextAuth v5 off Vercel refuses the `localhost` host and **every** `/api/auth/session` call fails with `UntrustedHost` (`docs/26` recorded this for production, where `fly.toml [env]` sets it). See below — it is not cosmetic. |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `NEWSLETTER_UNSUBSCRIBE_SECRET` | distinct from `NEXTAUTH_SECRET`, else a warning |
| `SETTINGS_ENCRYPTION_KEY` | distinct from `NEXTAUTH_SECRET`, else a warning |

None of these needs a real value for E2E. They are format and entropy
checks, and obvious throwaways satisfy them. `.github/workflows/ci.yml`
carries the non-secret ones as literals, on the same reasoning as the
integration job's literal `DATABASE_URL` (`docs/98` §2).

### 6.1 Why `AUTH_TRUST_HOST` matters more than it looks

Its absence does not merely log an error. `src/middleware.ts` wraps
`auth()`, so when that throws `UntrustedHost` **the middleware's entire auth
layer goes inert** and requests fall through to whatever the page or layout
does. Measured on 2026-10-22 against a production build:

| Request | Without `AUTH_TRUST_HOST` | With it |
|---|---|---|
| `GET /api/auth/session` | `UntrustedHost` error | `null`, HTTP 200 |
| `GET /admin/simulation` | 307 → `/login?callbackUrl=/admin` | 307 → `/login?callbackUrl=%2Fadmin%2Fsimulation` |
| `GET /dashboard/campaigns` | 307 → `/login?callbackUrl=/dashboard` | 307 → `/login?callbackUrl=%2Fdashboard%2Fcampaigns` |

The wrong `callbackUrl` is the *visible* symptom — an operator signs in and
lands somewhere other than the page they asked for — and it comes from the
hardcoded string in `src/app/admin/layout.tsx:31`, which is only ever
reached because the middleware stopped answering. The middleware itself
builds the callback from the full pathname and query, and carries a comment
explaining why.

The consequence for this suite is larger: anything that branches on being
signed in — `useAuthState()`, `MessageForm`'s auth gate, every `/dashboard`
and `/admin` spec — was being measured against a broken session endpoint.
`e2e-18-admin-simulation.spec.ts` now asserts the exact `callbackUrl`, which
makes it a canary for this whole layer being alive.

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

---

## 8. The spec reconciliation, and what it found in the product

Worked 2026-10-22, after §1–§7. Fourteen spec files rewritten.

**Result: 128 passed, 0 failed, 24 skipped** across both Chromium projects
(`Desktop Chrome` and `Mobile Chrome`), in 241s. Every skip is declared in a
spec with a named reason — no runtime `isVisible()` guard decides any of them
any more. Verified on a run driven by Playwright's own `webServer`, so the
sequence a contributor gets is the sequence that was measured.

The headline is not the pass count, though. It is that **five product
defects** came out of specs that could finally reach a rendered page, and
that several specs which had been passing all along were asserting nothing at
all.

The 24 skips, so they are not mistaken for coverage:

| Skips | File | Why |
|---|---|---|
| 8 | `stripe-payment-e2e.spec.ts` | 4 tests × 2 legs. No card rail at all — §8.5 |
| 6 | `donate-button-e2e.spec.ts` | 3 × 2. The card-rail tests specifically; the rest of that file runs |
| 6 | `e2e-18-admin-simulation.spec.ts` | 3 × 2. Need an admin session — §5.1 |
| 4 | `e2e-17-messaging.spec.ts` | 2 × 2. Need a signed-in user — §5.1 |

So 14 of the 24 are the dead Stripe card rail (`docs/72`) and 10 are the
missing sign-in fixture. Both are named in the specs, not decided at runtime.

### 8.1 ⚠️ Corrections to this document's own numbers

| Claim made earlier | What is true |
|---|---|
| "the suite is still 32 failed / 25 passed" | Withdrawn. That session had concurrent axe probes crashing browsers (`browserType.launch: ... browser has been closed`), so it measured contention. |
| "57 tests per project" / "72 tests" | **292 tests across the four configured projects.** Every figure in §3 was the **Desktop Chrome project alone** (73 tests), because the runs passed `--project`. |
| "`globalSetup` runs BEFORE `webServer` (verified from run output)" | **Not verified** — the seed line was on stderr and the build's output on stdout, which had been redirected away. Two streams say nothing about each other's ordering. The dependency is now removed rather than asserted: `webServer` seeds before it builds. |
| §6: the secret FATAL is "a false lead" | Wrong once E2E runs a production build. See the amendment in §6. |

### 8.2 Five product defects

**1. The homepage tabs were invalid ARIA.** `HowItWorks` rendered
`<ol role="tablist">` with each `role="tab"` button wrapped in an `<li>`. An
ARIA role **replaces** native semantics rather than adding to it, so one
mistake produced three violations over 7 nodes:
`aria-required-children` (the tablist owned `listitem`s),
`aria-required-parent` (each tab's parent was an `<li>`) and `listitem` (the
`<li>`s were no longer in a list). The tabs pattern the component's own
comment promised was therefore not exposed at all. Now a `div` holding the
tabs directly.

**2. `/campaigns` had the same class of mistake, and nothing could have
flagged it.** `role="tab"` sat on a non-focusable `<span>` and on a `<Link>`
that navigates to another page, with no tabpanel, no `aria-controls` and no
arrow keys. A screen-reader user was told "tab" for a control that loses
their place in the document. It is a two-item nav and is marked up as one
now, with `aria-current="page"`. It renders only when a completed campaign
exists, which the review gate (`docs/79`) left at zero — so it was
unreachable on the live site and in every probe.

**3. The two dark-mode toggles each held their own copy of the theme.**
`DarkModeToggle` (navigation sheet) and `FooterDarkModeToggle` (footer strip)
are both mounted on a phone, and each computed `!dark` from a `useState`
seeded once on mount. So: switch to dark in the menu, then press the footer
button — it still believed the page was light, re-applied `dark`, and
**nothing happened**. The second press worked, which is the worst version:
it reads as a dropped tap, not a bug.

Two copies of one global cannot be kept in agreement by initialising them,
only by subscribing them. `src/hooks/useDarkMode.ts` now reads the class at
click time and syncs every mounted toggle through a `MutationObserver`.
Proven by injection: restoring the old component fails **3 of 5** new tests
while `DarkModeToggle.test.tsx` stays green — a per-component test could
never have seen this, which is why it survived.

**4. The donation amount group claimed radio semantics it did not
implement.** `DonationForm` builds `role="radiogroup"` from
`<button role="radio">` tiles. There was no `tabIndex` management and no key
handler anywhere, so a screen reader announced a radio group whose **arrow
keys did nothing** — the one interaction it tells its user to use — and a
keyboard donor had to press Tab **nine times** to cross the amounts, plus
twice more for the frequency toggle. Fixed in `src/lib/radio-group-keys.ts`:
arrow keys in both axes, Home/End, and a roving `tabIndex` making the group
one tab stop. Arrow selection goes through each tile's existing `onClick`, so
there is still exactly one place that selects.

Removing the roles was the alternative and was rejected: they carry real
information (these nine buttons are one choice) that a row of plain buttons
cannot convey. Better to make the promise true.

⛔ **`ShareYourStoryForm` has five more `role="radiogroup"`s with the same
defect** and is not fixed here — a 2,000-line wizard touched in the same pass
as the money path, with no test covering it, is how a regression ships. The
helper is reusable; this is the next piece of work.

**5. The skip link, and the footer contrast.** Both in §4, both still fixed.

### 8.3 The specs that were passing while asserting nothing

This is the part worth internalising. Ten tests across seven files were
wrapped in `if (await locator.isVisible()) { ... }`, and
**`locator.isVisible()` does not wait** — the `timeout` option does not make
it poll. So every one of those bodies was skipped whenever the page had not
finished rendering, and the test reported a pass. Several were tautologies
even when they did run:

    const ldzBadge = page.locator('text=Last Donor Zone').first();
    if (await ldzBadge.isVisible()) {
      await expect(ldzBadge).toBeVisible();   // e2e-03, in full
    }

Others asserted something true of every page on the site (`e2e-07` clicked
the navbar's Donate link and checked for an `h1`), or something that passes
whether a security boundary holds or not:

    await expect(page).toHaveURL(/\/(admin|login)/);   // e2e-18, ×3

That last one matches `/admin/simulation` AND `/login?callbackUrl=/admin`.
For a protected route it cannot distinguish the safe outcome from the
dangerous one. `e2e-18` now asserts the exact `callbackUrl`, which also makes
it a canary for middleware auth being alive (§6.1).

`e2e-17` is the inverse case and the clearest lesson: it asserted
`formVisible || promptVisible` and got `false` **from a page that was
correct**. `MessageForm` renders `null` while `useAuthState()` is `unknown`
(deliberately, per `docs/44`), and the non-waiting probes ran before the
session read resolved. The page was right; the test was measuring a moment
that does not matter.

### 8.4 Two mistakes of my own, from the previous pass

Adding the Mobile Chrome project immediately failed two tests I had written:
`e2e-01` addressed `getByRole('navigation', { name: 'Main navigation' })`
unconditionally, and that nav is `hidden md:flex` — `display: none` at 412px,
so absent from the accessibility tree. One test waited out its full 30s
budget trying to click a link inside it.

That is **the same mistake `e2e-08` documents**, made in the fix for a
different one, in the same session. Two conclusions, both acted on:
viewport-dependent locators belong in one helper (`e2e/helpers/nav.ts`), and
a suite measured on one project tells you about one project.

### 8.5 The suite RAN IN CI, for the first time ever

Run 8 (`39798555991`, dispatched by hand on `3b42d8d`) is the **first
execution of this E2E suite on a runner in the project's history**. Whole
pipeline green: lint-and-typecheck, unit-tests, security-audit,
integration-tests, build, both e2e legs, ci-complete.

| Leg | Result | Test step | Job wall clock |
|---|---|---|---|
| Desktop Chrome | 64 passed, 12 skipped | 2.0m | 191s |
| Mobile Chrome | 63 passed, 12 skipped, **1 flaky** | 2.3m | 223s |

64 + 12 per leg is 76, and 76 × 2 = 152 — the same total as the local run,
with the same split. The fixture's teardown is visible in both logs
(`[e2e-seed] fixture rows removed`).

Two log lines worth knowing are expected, not faults. The throwaway Stripe
key is correctly *detected* as non-working rather than used
(`STRIPE_SECRET_KEY is not a working key. No donation can complete on this
deployment`), and the newsletter route degrades instead of failing when
Resend has no key (`Failed to send welcome email: Missing API key`) — a test
exercises that path and passes.

Also recorded, not acted on: the runner now warns that
`actions/checkout@v4` and `actions/setup-node@v4` target Node 20 and are
being forced onto Node 24. Informational today; a reason to bump those
actions eventually.

### 8.6 ⛔ One flaky test, unexplained — and "green with a flaky" is not green

The Mobile Chrome leg reported **1 flaky**: `e2e-03`'s "a last-donor-zone
campaign is listed alongside active ones" failed its first attempt and
passed on retry, so the job concluded success because
`playwright.config.ts` sets `retries: 2` in CI. The pipeline is green on a
retry, which is worth saying out loud rather than rounding to "green".

The raw error, kept because I could not explain it:

    strict mode violation:
      locator('article:has(a[href="/campaigns/e2e-fixture-veteran-housing"])')
      resolved to 2 elements:
        1) <article ...> aka ...filter({ hasText: 'veteransDallas, TexasE2E' })
        2) <article ...> aka locator('article').nth(4)

`nth(4)` means the page held at least **five** `<article>` elements, two of
them containing a link to that campaign — while the fixture seeds **four**
campaigns. What was checked, and what it rules out:

| Probe | Result |
|---|---|
| 6 consecutive loads at `devices['Pixel 7']`, sampled at `domcontentloaded` and at `networkidle` | 4 articles, exactly 1 match, every time |
| Server-rendered `/campaigns` HTML | exactly 4 `<article>` tags; one link per fixture campaign |
| `CampaignGrid.loadMore` | dedupes by id (`seen = new Set(prev.map(c => c.id))`) before appending, so "Load More" cannot re-add a visible campaign |

So the obvious cause — a duplicated card from pagination — is ruled out, and
the state did not reproduce locally. Note also that a strict-mode violation
is not a one-frame race here: `toBeVisible` retried for its full 5s and kept
seeing two elements, so whatever it was persisted for seconds.

The test now asserts the link and takes `.first()`, which is what its name
claims and does not depend on how many wrappers the listing renders. That is
deliberately NOT a scope narrowed to hide a defect: whether a campaign can
appear twice in the listing belongs to `e2e-16`, which is about card
rendering. **If this recurs, the evidence above is the starting point** — and
the next step would be to capture `page.content()` on failure rather than
reason about it.

### 8.7 Cost

`stripe-payment-e2e.spec.ts` is skipped at file level. There is no card rail
to drive (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is empty, `docs/72`), and its
`setTimeout(120_000)` meant the first test burned two full minutes before
failing, while `mode: 'serial'` skipped the other three — so one dead rail
showed up as "1 failed, 3 skipped" plus two minutes of wall clock on every
run. Removing that alone took the suite from 336s to 137s.
