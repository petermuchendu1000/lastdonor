# 104 — The reader that threw away 150 rates, and the browser that found it

**Date:** 2026-10-24
**Status:** Fixed, tested, not deployed (deployment is manual; the owner runs it).
**Amends:** `docs/102` (the reader/writer invariant), `docs/103` §12 (which
recorded the browser verification as an open gap).

---

## 1. The defect, stated plainly

**Shipped in `2ac929a`.** `docs/103` widened the FX snapshot **writer** to
persist a rate for every known currency, and left the **reader** iterating
`SUPPORTED_CURRENCY_CODES`. So the refresh wrote 152 rates and every read
discarded 150 of them.

```
fx-providers.ts  narrowToSupported()  required(2) ∪ best-effort(152)   -> writes 152
fx-store.server.ts parseFxSnapshot()  for (SUPPORTED_CURRENCY_CODES)   -> keeps 2
```

Consequence: **country detection could only ever display KES.** 150 of 152
currencies were unreachable — the feature was **98.7% inert**, and silently,
because `convertMinor` returns null for a missing rate and `ApproxMoney`
renders nothing by design. A visitor in Kampala saw no shillings and no error.
Same shape as `docs/83`, where a working Didit flow had no reachable door.

**[VERIFIED]** from the running system: the row stored
`KES NGN TZS UGX USD`; the page received `KES USD`.

### 1.1 Why nothing caught it

- Unit tests exercised `convertMinor` arithmetic, never the store.
- The store's integration round-trip used **USD and KES exclusively**, so it
  was structurally incapable of failing on a third currency.
- The display-only ratchet checks *who may import FX*, not what survives a read.
- `typecheck` is blind to it: both sets are `string[]`.

It was found by putting a real browser at `Africa/Kampala` and looking.

### 1.2 The invariant, now written down and tested

> **The snapshot reader's accepted currency set MUST be a superset of the
> writer's.** If you narrow one, narrow both.

`parseFxSnapshot` now mirrors `narrowToSupported`: collectable currencies
**required**, known currencies **best effort**, filtered to
`KNOWN_CURRENCY_CODES` so a provider's crypto or metals keys still cannot
reach a money store.

Five tests in `fx-store.integration.test.ts` enforce it, including
`the reader accepts EVERY currency the writer can store`, which asserts the
superset property directly rather than by example. **Mutation: removing the
best-effort loop (restoring the shipped bug) fails 4; making the reader
permissive fails 1.**

## 2. The real-browser verification, which was the open gap

`docs/103` §12 said: *"nobody has loaded the page from Kampala."*
`e2e/local-currency-e2e.spec.ts` now does, in Chromium with a real
`timezoneId` and `locale`, on both the desktop and mobile projects.

The fixture campaign is **USD** and a USD campaign passes
`fallbackCurrency={null}`, so the server renders **no** approximate figure.
Everything asserted arrives from browser-side detection.

| timezone | locale | expected | why it matters |
|---|---|---|---|
| `Africa/Kampala` | `en-US` | `UGX 37,000,000` | timezone beats the language tag |
| `Africa/Nairobi` | `en-US` | `Ksh 1,298,479` | the collectable path |
| `UTC` | `sw` | **nothing** | the refusal to guess |
| `UTC` | `en-NG` | `NGN 16,000,000` | explicit-region fallback |

**10 passed** (5 × 2 projects). The figures are computed from fixture rates,
not live ones — a spec that asserts a rendered amount cannot depend on
today's market.

**The spec bites.** Run against the pre-fix build it gave **3 failures** —
Kampala/UGX, the attribution, and en-NG/NGN — while Nairobi/KES passed. That
split *is* the bug's signature: collectable survived the read, known did not.

### 2.1 The `sw` case is the one to keep

`UTC` + `sw` asserts that **no** figure appears. If
`countryFromLanguageTags` ever reinstates `Intl.Locale(tag).maximize()`, a
Swahili speaker on a UTC clock is placed in Tanzania and the page renders
`TZS 25,000,000` — a confident money figure derived from nothing about the
visitor. The spec names that exact string so the regression is unmissable.

### 2.2 An assertion that passed for the wrong reason

The first version asserted `getByText('about', { exact: false })`. That
**also matches the "About" navigation link**, which on a phone sits inside the
collapsed menu and is not visible — so it failed on Mobile Chrome and had been
passing on Desktop only because `.first()` happened to land on the right node.

Replaced with `/at the \d{4}-\d{2}-\d{2} rate/`, a phrase nothing else on the
page renders. Body-level string checks use `toContainText` rather than
`getByText(...).first()`, which picks an arbitrary node when several match.

### 2.3 The fixture seeds the snapshot now

The spec needs a rate snapshot, and nothing seeded one — committed as-is it
would have failed in CI. `seedE2EData` now writes it and `clearE2EData`
removes it by its own key, since `site_settings` is shared.

It must be seeded **before `next build`**: `campaigns/[slug]` is
`revalidate = 60` with `generateStaticParams`, so a null snapshot gets
prerendered into the HTML — the trap `docs/99` recorded for campaigns.

The settings key is a **literal** in the fixture, because `FX_SNAPSHOT_KEY`
lives behind `import 'server-only'` and throws under `tsx`.
`seed-data.test.ts` asserts the literal equals the real constant, so it cannot
drift; Vitest aliases `server-only` (`docs/89`), so the real constant is
importable there.

### 2.4 Running E2E in this sandbox

`PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` is **required**. The image
ships Chromium revision 1243; the pinned `@playwright/test` looks for 1208 and
fails with `Executable doesn't exist at .../chromium_headless_shell-1208/...`.
The config has supported this override since it was written; it is recorded
here because the error names a download, not a mismatch.

### 2.5 A measurement that was void, not a failure

Midway, the spec went from 3 failures to 4 with **nothing** rendering. The
cause was not the code: running `fx-store.integration.test.ts` against the
same `DATABASE_URL` had executed its `afterAll(clearFx)` and the integration
suite's `clearDatabase()`, deleting both the snapshot and the four fixture
campaigns. Gate 5 — an anomalous sample voids the measurement; diagnose the
anomaly first. **Do not run the integration suite against the database an
E2E run is using.**

## 3. ⛔ Cloudflare is not in the request path — OWNER DECISION

**[VERIFIED 2026-10-24]**, and this corrects a worry from the first pass: the
zone's `original_name_servers` reads Namecheap's, which suggested Cloudflare
might not be authoritative. It is. Two independent resolvers agree:

```
NS  lastdonor.org -> lauryn.ns.cloudflare.com, maciej.ns.cloudflare.com   (Cloudflare DoH + Google DoH)
A   lastdonor.org -> 66.241.124.43
PTR 66.241.124.43 -> ip-66-241-124-43.shared.customer.flyio.net
66.241.124.43 in Cloudflare's published IPv4 ranges? NO
```

`original_name_servers` is the historical record from zone setup, not current
state. So: **Cloudflare DNS is authoritative, every record is grey-cloud, and
traffic goes browser → Fly directly.** All 5 A/AAAA/CNAME records report
`proxied: false`; responses carry no `cf-ray`.

Enabling the proxy is therefore a per-record toggle, not a migration.

### 3.1 What enabling it would and would not buy

**Would**: WAF (the Managed Free Ruleset is already provisioned), DDoS
absorption, TLS termination at the edge, and caching of **static assets**
(`/_next/static/...` already answers `public, max-age=31536000, immutable`).

**Would NOT**: cache the HTML that matters. Measured on all ten
`revalidate` routes plus the homepage:

| route | reads `searchParams` | `cache-control` from production |
|---|---|---|
| `/` (`force-dynamic`) | n/a | `private, no-cache, no-store, max-age=0` |
| `/campaigns`, `/blog`, `/completed-campaigns` | yes | `private, no-cache, no-store, max-age=0` |
| `/cancelled-campaigns`, `/transparency`, `/last-donor-wall`, `/donate`, `/campaigns/[slug]` | no | `s-maxage=300, stale-while-revalidate=…` |
| `/about` | no, static | `s-maxage=31536000` |

`private, no-store` forbids shared caching outright, so `docs/26` §5's
"Layer 1 — Cloudflare edge (HTML + assets)" would deliver assets only for
the four busiest entry points.

### 3.2 Settings that must change FIRST if it is enabled

| setting | current | required |
|---|---|---|
| `ssl` | **`full`** | `strict` — `docs/26` §3 says Full (strict); `full` does not validate the origin chain |
| `min_tls_version` | **`1.0`** | 1.2 — moot today because Fly terminates TLS and sets its own policy; it becomes live the moment the edge terminates instead |

Already safe: `rocket_loader = off`, `minify` all off (the body-rewriting
hazards `docs/26` §9 warns about), `development_mode = off`.

The cron hostname is unaffected: the Worker calls `lastdonor.fly.dev`
(`docs/66`), which is not in this zone, so Cloudflare's 100s proxy ceiling
still does not apply to the 11 long-running routes.

### 3.3 Why this is not mine to flip

It changes how every request for the site is routed, for all users at once.
The rollback (toggle back) is simple, but the window between is not something
I can bound, and the SSL-mode change must land first or the edge may fail to
validate the origin. **Presented, not done.** `docs/26` carries an amendment
pointing here.

## 4. Three inert `revalidate` exports, removed

Found while establishing §3.1. `/campaigns`, `/blog` and
`/completed-campaigns` each declared `export const revalidate = 300` while
reading `searchParams`, which makes a Next 15 page dynamic — so the directive
was inert, and production proves it (`no-store`, table above).

The correlation across all ten routes was **exact**, which is what promoted
the Next.js rule from documentation to a verified fact about this deployment.

Same class as the sixteen inert `revalidate` exports `docs/88` removed from
the admin tree. Removed here, with the reason written in place, and
`src/app/revalidate-honesty.ratchet.test.ts` fails the build if the two are
combined again. **Mutation: re-adding one fails 2 tests.**

No runtime change: production already serves these as dynamic.

## 5. Verification record

| Check | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | **6727 passed / 12 skipped**, 207 files (was 6720 / 206) |
| `npm run test:integration` | **113 passed**, 13 files (was 108) |
| `npm run test:e2e` (both Chromium) | **138 passed / 24 skipped / 0 failed** (was 128) |
| Mutation, FX reader | 2 mutants, **2 killed** (4 and 1 failures) |
| Mutation, revalidate ratchet | 1 mutant, **1 killed** (2 failures) |
| Mutation, detection | 4 mutants, **4 killed** |
| Generator sanity gates | 4 faults injected, **4 refused to emit** |
| ISO/CLDR divergence guards | 2 mutants, **2 killed** (3 and 2 failures) |
| Exponents vs ICU | 152 / 152 |
| Timezones vs ICU | 418 / 418 |

## 6. Not checked / still open

- **Nothing is deployed.** Production runs v95, pinned machine
  `d8d1116b5161d8`, settled since 2026-10-24T07:50:11Z. The FX reader fix,
  the country tables and the detection are all unverified **against
  production** for the simple reason that production does not have them yet.
- **No production FX snapshot exists**, so even after a deploy the first
  figures appear only after `cron/refresh-fx-rates` runs at 02:00 UTC. Until
  then `ApproxMoney` correctly renders nothing.
- **The Cloudflare decision is open** (§3), as is whether `ssl` should move to
  `strict` regardless — it costs nothing today and is required later.
- **The browser verification covers Chromium only.** Firefox and WebKit sit
  behind `PW_ALL_BROWSERS=1` and nothing in the repo installs them
  (`docs/99`); `Intl.DateTimeFormat().resolvedOptions().timeZone` and
  `navigator.languages` are standard, but that is **[INFERRED]** for those
  engines, not measured.
- **Detection still cannot know a traveller's home country**, by design. A
  Kenyan in London sees pounds.
- **13 currencies remain blocked from being collectable** by test, pending
  someone checking which minor-unit convention a gateway expects (`docs/103` §4).
