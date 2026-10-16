# 54 — Deploy build performance: what was measured, and what did not work

Investigated 2026-10-16, after a deploy cycle felt slow. **The headline is a
negative result: build caching does not fix this build.**

---

## 1. Where the time actually goes

`fly deploy` wall time is ~325–340s. Of that, the Docker image build is ~190s
and the rest is image push, machine update, health checks and the release
migration.

Inside the image build, **one step is 95% of it**. Every other step was
already `CACHED`, including `npm ci`:

| Step | Time |
|---|---|
| `#12 npm run build` | **183.6s** |
| all 17 other steps combined | ~12s |
| of which `CACHED` | 9 steps |

Phase breakdown inside `npm run build`, read off the BuildKit timestamps:

| Phase | Time |
|---|---|
| **Webpack compile** | **106s** |
| Lint + type check | 31s |
| Collecting page data | 11s |
| Generating static pages | 32s |
| Build traces + finalize | 8s |

---

## 2. The negative result: `.next/cache` persists and buys nothing

A BuildKit cache mount was added at `/app/.next/cache` so Next's webpack/SWC
cache would survive between builds.

**It works, and it does not help.** A probe at the top of the build step
reported:

```
[cache-probe] .next/cache on entry: 1.1G, 11 files
```

So the cache genuinely persists across deploys on the same builder. Webpack
compile with it: **103s**. Without it: **106s**. That is noise.

Measured sequence, same builder (`fly-builder-frosty-snowflake-6405`) each
time, each with a real source change so `COPY . .` was invalidated:

| Deploy | `npm run build` |
|---|---|
| before the mount | 183.6s |
| with the mount, cold | 171.1s |
| with the mount, warm | **191.5s** |

The warm build was *slower* than the cold one. There is no caching win here.

**The mount is retained** — it is the standard Next-in-Docker pattern, costs
only builder disk, and may pay off after a Next upgrade — but nobody should
expect a speedup from it, and nobody should re-add it believing it is the
fix. That is why this document exists.

### Why it does not help (not established)

Next is reading a 1.1GB cache and still compiling for 103s. Plausible
explanations, none verified: the production build's optimize/minify pass is
not cached, or the cache is written but invalidated on read. **Not chased
further** — each experiment costs a ~5½ minute deploy, and the payoff was
uncertain. If someone wants the 100s, this is where it is.

---

## 3. What did work

### 3.1 Skipping the duplicate ESLint pass — ~3.5s

`eslint: { ignoreDuringBuilds: true }` in `next.config.ts`.

`next build` re-runs ESLint over the whole project, but by then lint has
already passed twice: `CLAUDE.md` requires it before any commit, and
`ci.yml` runs it as its own job. It is a duplicate, not a safety net.

Worth saying plainly: this was expected to be most of the 31s "Linting and
checking validity of types" phase and **was not** — the phase only fell to
27.6s. tsc is the bulk of it. **TypeScript checking is deliberately left on**:
a lint failure is a style regression, a type error is a runtime bug.

### 3.2 Passing the database URL as a build secret — content, not speed

`scripts/deploy.sh --prerender` passes `DATABASE_URL` as a BuildKit secret,
which the Dockerfile already supported.

| | Without | With |
|---|---|---|
| DB read failures during build | 7 | **2** |
| Generating static pages | 32s | **8s** |
| Pages pre-rendered | 118 | **130** |
| Build traces | 8s | 32s |
| **Net build time** | 191.5s | **186.0s** |

Static generation got 24s faster and build traces got 24s slower, because
there are now 130 pages of real content to trace instead of 118 mostly empty
ones. **So this is not a speed optimisation.** It is a content and SEO win
that happens to be time-neutral: those 24 `revalidate` routes now ship
pre-rendered with real data instead of empty, and the first visitor no longer
pays for the render.

The secret never lands in a layer or in `docker history`.

---

## 4. `scripts/deploy.sh`

Wraps the flags this project needs so they are not retyped:

- `--depot=false` — Fly's default Depot builder talks gRPC to its workers,
  and behind a TLS-inspecting proxy that handshake fails with
  `x509: certificate signed by unknown authority` after ~2 minutes of
  "Waiting for depot builder...". The classic remote builder works.
- `SSL_CERT_FILE` — set only when a proxy CA is present, so it is a no-op on
  a normal machine. flyctl is Go and reads its trust store from there.
- `--prerender` — optional, per §3.2.

---

## 5. Honest summary

Deploy went from ~191s of image build to ~186s. **That is a 3% improvement,
and the request was for caching to make deploys fast.** It did not deliver,
because the cost is compiling the application, not re-fetching or re-reading
anything.

The real options for a materially faster deploy, none taken here:

1. **Cut what is compiled.** 278 `.tsx` and 365 `.ts` files. The
   `optimizePackageImports` list in `next.config.ts` is the existing lever.
2. **Stop blocking on it.** Once GitHub Actions is enabled (`docs/50` — it
   has never run), deploys move off the developer's terminal and the wall
   time stops being felt, even if it is unchanged.
3. **Find the webpack cache invalidation** per §2, worth ~100s if it exists.
