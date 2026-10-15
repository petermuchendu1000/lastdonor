# 38 — Sentry Integration, 2026-10-15

Wiring error tracking after `docs/37` established that **nothing was watching the
database** when a wedged pool took the site down for 3h+ unnoticed. Sentry is the
first thing that watches anything.

---

## 1. Where each value lives, and why it is not interchangeable

| Variable | Location | Why it cannot go elsewhere |
|---|---|---|
| `SENTRY_DSN` | Fly secret | Read at boot by `src/instrumentation.ts:6,18` (node + edge runtimes). |
| `NEXT_PUBLIC_SENTRY_DSN` | **`fly.toml` `[build.args]`** | `NEXT_PUBLIC_*` is inlined by the compiler. A Fly secret for it is **inert** — the same trap as `NEXT_PUBLIC_APP_URL` (see `docs/35` §5a). Changing it requires a rebuild, not a restart. |
| `SENTRY_ORG` / `SENTRY_PROJECT` | deliberately unset | `next.config.ts` sets `sourcemaps.disable: true` and there is no `SENTRY_AUTH_TOKEN`, so `withSentryConfig` uploads nothing and does not need them. |

**The DSN is committed to the repository on purpose.** A Sentry DSN is public by
construction — it is embedded in the client bundle of every site that uses
Sentry. It identifies a project so events can be routed to it; it authorises
reading nothing. Treating it as a secret would be cargo-cult, and would have led
to putting it in Fly secrets, where it would not work at all.

Verified live 2026-10-15: the DSN is present in the served bundle
(`/_next/static/chunks/main-app-*.js`) and the Sentry SDK is bundled.

---

## 2. Fixed: production errors were going to be tagged `development`

Both init sites read `VERCEL_ENV` (`NEXT_PUBLIC_VERCEL_ENV` on the client), a
Vercel-only variable that is **unset on Fly** — one of the couplings `docs/26`
§1 lists. The failure mode is worse than it sounds: events would have **arrived**
and been filed under `environment: development`, so environment filters, alert
rules and release health would all have been quietly looking at an empty
bucket. A silent Sentry is noticed; a mis-bucketed one is not.

Resolution order is now `SENTRY_ENVIRONMENT` → `VERCEL_ENV` → `NODE_ENV`, and
the Dockerfile's runtime stage sets `NODE_ENV=production`. Verified in the
shipped bundle: `environment` resolves to `"production"`.

---

## 3. Disabled: `tunnelRoute`, because it was a silent error sink

`next.config.ts` set `tunnelRoute: "/monitoring"`. Verified live on 2026-10-15,
in this order:

1. The shipped bundle contained
   `globalThis._sentryRewritesTunnelPath="/monitoring"`, which is what makes the
   SDK POST every envelope to that path instead of the ingest host.
2. `https://lastdonor.org/monitoring` returned **404 on both GET and POST**.
3. The built image contained **no route** under `.next/server/app` for it and
   **no rewrite** carrying it.

So every client-side error was being POSTed to a 404 and discarded. That is
worse than having no Sentry, because the dashboard looks healthy — you would
conclude the client is error-free.

**Disabled rather than fixed.** Without it the SDK posts straight to
`ingest.de.sentry.io`, which works. The only thing lost is ad-blocker evasion:
a visitor running an ad-blocker that blocks Sentry's domain will not report
client errors. That is a real but bounded loss, and strictly better than losing
**all** client errors. Re-enable only after confirming a rewrite actually
appears in `routes-manifest.json` for the **standalone** build — note
`@sentry/nextjs` 9.47.1 with `output: 'standalone'` is the combination that
failed here.

**Not diagnosed:** why the rewrite was absent. `setUpTunnelRewriteRules`
(`withSentryConfig.js:331`) assigns `userNextConfig.rewrites`, and
`setUpBuildTimeVariables` (line ~408) sets the client-side path whenever
`tunnelRoute` is a string and `output !== 'export'`. The two are not gated on
the same condition, which is consistent with the observed state — client path
set, server rewrite missing — but that is a **hypothesis, not a verified root
cause**, and it is an upstream matter rather than ours.

---

## 4. Still open

- **No alerting is configured in Sentry itself.** Events will arrive; nobody is
  told. `docs/37` §5 item 1 remains open: an external uptime check on
  `/api/v1/health` is still the cheapest cover for the failure mode that
  actually bit us, and Sentry does not replace it — a wedged pool produced
  **no exception**, only hangs.
- **Client errors from ad-blocked visitors are not captured**, per §3.
- **No release tagging.** `SENTRY_RELEASE` is set by the SDK from the build, but
  the app reports `commit: "local"` at `/api/v1/health` because no commit SHA is
  injected at build time. Correlating a Sentry event to a deploy is therefore
  manual.
