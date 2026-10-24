# syntax=docker/dockerfile:1.7
# =============================================================================
#  LastDonor - production image for Fly.io
#  Implements docs/26 "Deployment Architecture" §10 step 1.
#
#  Four stages:
#    deps     - `npm ci` from the lockfile (dev deps included; `next build`
#               runs ESLint and tsc, which are devDependencies)
#    builder  - `npm run build` with `output: 'standalone'`
#    migrator - the `drizzle-kit migrate` toolchain for fly.toml's
#               release_command, assembled as its own small tree
#    runner   - minimal runtime: standalone server + static + public, non-root
#
#  Build it with BuildKit (required - this file uses `--mount=type=secret`):
#
#    fly deploy
#    # optionally, to pre-render real content from a seeded database:
#    fly deploy --build-secret database_url="postgresql://...:6543/postgres"
#    # or locally:
#    DOCKER_BUILDKIT=1 docker build \
#      --secret id=database_url,env=DATABASE_URL \
#      --build-arg NEXT_PUBLIC_APP_URL=https://lastdonor.org \
#      -t lastdonor .
#
#  DATABASE_URL at build time is OPTIONAL as of 2026-10-14 (previously this
#  note read "unavoidable"). `src/db/build-phase.ts` makes a failed database
#  read during `next build` resolve to zero rows, keyed on Next's own
#  `NEXT_PHASE=phase-production-build` and inert at runtime. VERIFIED: a build
#  with `DATABASE_URL` pointed at a dead address exits 0 and generates 118/118
#  static pages, zero prerender errors.
#
#  That matters most on a FIRST deploy, where requiring the secret was not
#  merely inconvenient but insufficient: the schema is created by fly.toml's
#  release_command, which runs only AFTER the image builds, so the secret could
#  be present and valid and the build would still die with
#  `relation "blog_posts" does not exist` (42P01). See `docs/34` §5a.
#
#  The 24 routes that combine `export const revalidate` with a `@/db` read
#  pre-render EMPTY without it and fill in on first request. Pass it once the
#  database is seeded so visitors do not pay for that first render. When passed
#  it is a BuildKit secret, not an ARG or ENV, so it is mounted only for the
#  duration of the build step and never written to a layer or to
#  `docker history`.
# =============================================================================

# -----------------------------------------------------------------------------
# Base image: Node 22 on Debian bookworm (glibc).
#
# Node 22 because `.nvmrc` pins 22. NOTE: `.github/workflows/ci.yml` still uses
# `node-version: 20` for its build job, so CI and this image are on different
# majors until one of them moves. Both satisfy Next 15's `>=18.18` floor.
#
# Debian/glibc, NOT Alpine/musl, and the same libc in every stage. `sharp`
# (used by `next/image`) resolves prebuilt native binaries at *install* time
# from the installing host's platform AND libc:
#   glibc -> @img/sharp-linux-x64     + @img/sharp-libvips-linux-x64
#   musl  -> @img/sharp-linuxmusl-x64 + @img/sharp-libvips-linuxmusl-x64
# Installing under one libc and running under the other is the classic failure
# ("Could not load the sharp module using the linux-x64 runtime"), because the
# bundled libvips is linked against the libc it was built for. Verified in this
# repo: `node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node` exists and
# the glibc libvips is self-contained, so no system libvips package is needed.
# The runner stage asserts this below rather than assuming it.
# -----------------------------------------------------------------------------
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
# Deliberately NOT setting NODE_ENV=production here: it would make `npm ci`
# in the deps stage skip devDependencies, which `next build` needs.
ENV NEXT_TELEMETRY_DISABLED=1

# -----------------------------------------------------------------------------
# deps - the lockfile is authoritative.
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
# `npm ci` fails outright on a lockfile that disagrees with package.json, which
# is the behaviour we want (CLAUDE.md: a desynced lockfile fails every job).
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# builder - produce .next/standalone
# -----------------------------------------------------------------------------
FROM deps AS builder

# Public, build-time-inlined client config. `NEXT_PUBLIC_*` is substituted into
# the client bundle by the compiler, so these must exist at build time; setting
# them as Fly secrets later has no effect on already-compiled JS. Every one of
# them is public by definition (a publishable key, a DSN, two widget ids, the
# canonical origin), so they are ARGs rather than secrets. Verified by
# grepping `process.env.NEXT_PUBLIC_*` across `src/`.
ARG NEXT_PUBLIC_APP_URL=""
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_TAWK_PROPERTY_ID=""
ARG NEXT_PUBLIC_TAWK_WIDGET_ID=""
# Needed at BUILD time specifically, not just for the client bundle:
# `next.config.ts` derives the Supabase storage host for
# `images.remotePatterns` from it, and remotePatterns is serialised into the
# build output. Unset, it falls back to the hardcoded project constant in
# `src/lib/supabase-host.ts`, which is correct today but would rot silently if
# the project ever changes.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_TAWK_PROPERTY_ID=${NEXT_PUBLIC_TAWK_PROPERTY_ID} \
    NEXT_PUBLIC_TAWK_WIDGET_ID=${NEXT_PUBLIC_TAWK_WIDGET_ID}

# Build-time placeholders for server-side config that is only *constructed* at
# module load, never called, during `next build`.
#
# `src/lib/supabase-storage.ts` builds a Supabase client at import time and
# `createClient()` throws `supabaseUrl is required` on an empty string, which
# fails `Failed to collect page data for /api/v1/campaign-photos`. A
# syntactically valid URL and a non-empty key are enough; no real credential is
# needed, and none is baked in. VERIFIED 2026-10-14 by building with exactly
# these values.
ENV NODE_ENV=production \
    SUPABASE_URL="https://placeholder.invalid" \
    SUPABASE_SERVICE_ROLE_KEY="placeholder-not-a-real-key"

# The six secrets enforced by `src/lib/validate-secrets.ts` are NOT needed to
# build. VERIFIED 2026-10-14: `enforceSecrets()` is only reachable from
# `register()` in `src/instrumentation.ts`, and Next does not run the
# instrumentation hook during `next build` - a full build with
# NEXTAUTH_SECRET, CRON_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and
# PASSWORD_PEPPER all unset emitted no `[SECRET-VALIDATION]` output and exited
# 0. They are enforced on first boot of the server instead, from Fly secrets.
#
# Sentry likewise does not need credentials here: `next.config.ts` sets
# `sourcemaps.disable: true` and there is no SENTRY_AUTH_TOKEN, so
# `withSentryConfig` uploads nothing and the build is silent.

COPY . .

# The build is HERMETIC as of 2026-10-14 (`src/db/build-phase.ts`,
# `docs/34` §5a): a database read that fails during `next build` resolves to
# zero rows, so `database_url` is OPTIONAL and its absence is a warning, not a
# failure.
#
# It used to `exit 1` here, with the message "a reachable database is
# required to build". That was true at the time and is now false twice over:
# the build no longer needs a database, and demanding one defeated the point of
# making it hermetic — it blocked exactly the CI builds the guard enables. On a
# FIRST deploy it was worse than useless: the schema does not exist yet, so the
# secret could be present, valid, and still not satisfy the build.
#
# Passing it is still worth doing once the schema and real rows exist, because
# then the 24 `revalidate` routes pre-render with real content instead of
# empty, and visitors do not pay for the first render. Either way it arrives as
# a BuildKit secret, so it never lands in a layer or in `docker history`.
# `.next/cache` is a BuildKit cache mount, not a layer: it holds Next's
# webpack/SWC compilation cache between builds.
#
# HONEST RESULT, measured 2026-10-16: the mount WORKS - a probe at the top of
# this step reported `1.1G, 11 files` on entry, so the cache genuinely
# survives - but it buys nothing. Webpack compile was 106s without it and
# 103s with it. Keep expectations accordingly; the dominant cost of this
# build is compiling the app, not re-reading a cache. Retained because it is
# the standard Next-in-Docker pattern, costs only builder disk, and may pay
# off after a Next upgrade. See docs/54 for the full phase breakdown.
#
# `sharing=locked` rather than the default `shared`: two concurrent builds
# writing one webpack cache corrupts it, and a corrupt cache fails closed by
# rebuilding, which is the slow path this exists to avoid.
#
# Safe to mount: only `.next/standalone` and `.next/static` are copied into
# the runner, and neither lives under `.next/cache`. See docs/54.
RUN --mount=type=secret,id=database_url \
    --mount=type=cache,target=/app/.next/cache,sharing=locked \
    set -eu; \
    if [ -s /run/secrets/database_url ]; then \
      DATABASE_URL="$(cat /run/secrets/database_url)" npm run build; \
    else \
      echo "" >&2; \
      echo "NOTE: no 'database_url' build secret; building hermetically." >&2; \
      echo "" >&2; \
      echo "  The 24 routes that combine 'export const revalidate' with a" >&2; \
      echo "  @/db read will pre-render EMPTY and fill in on first request." >&2; \
      echo "  Correct for a first deploy, where no schema exists yet." >&2; \
      echo "" >&2; \
      echo "  To pre-render real content once the database is seeded:" >&2; \
      echo "    fly deploy --build-secret database_url=\"postgresql://...\"" >&2; \
      echo "" >&2; \
      echo "  A read-only pooled (6543) URL is sufficient: the build only" >&2; \
      echo "  SELECTs. It is never persisted into the image." >&2; \
      echo "" >&2; \
      npm run build; \
    fi

# Fail the build here rather than at runtime if the standalone output is not
# where the runner stage expects it.
RUN test -f .next/standalone/server.js \
 && test -d .next/static \
 && test -d public

# -----------------------------------------------------------------------------
# migrator - the toolchain fly.toml's release_command runs.
#
# `drizzle-kit` is a devDependency and is NOT part of `.next/standalone`, so it
# has to be carried into the runtime image deliberately. Copying all of
# `node_modules` would add ~1.3 GB; this subtree measured 63 MB.
#
# The list below is drizzle-kit's + drizzle-orm's + postgres' complete
# transitive closure, computed from package-lock.json rather than guessed.
# Regenerate it after any dependency bump with:
#
#   node -e 'const l=require("./package-lock.json").packages;const s=new Set();
#   const res=(n,d)=>{for(;;){const c=(d?d+"/":"")+"node_modules/"+n;
#   if(l[c])return c;if(!d)return null;const i=d.lastIndexOf("/node_modules/");
#   d=i===-1?"":d.slice(0,i);}};
#   const w=k=>{if(!k||s.has(k))return;s.add(k);const p=l[k]||{};
#   for(const d of Object.keys({...p.dependencies,...p.optionalDependencies})){
#   const r=res(d,k);if(r)w(r);}};
#   ["drizzle-kit","drizzle-orm","postgres"].forEach(n=>w("node_modules/"+n));
#   console.log([...s].map(k=>k.split("/node_modules/")[1])
#     .filter(x=>!x.includes("/")||x.startsWith("@")).sort().join(" "));'
#
# A miss here surfaces as MODULE_NOT_FOUND from the release command, which
# aborts the deploy before any traffic shifts - loud, not silent.
# -----------------------------------------------------------------------------
FROM deps AS migrator
WORKDIR /migrate

RUN set -eu; mkdir -p node_modules; \
    for pkg in \
      drizzle-kit drizzle-orm postgres \
      esbuild esbuild-register \
      @esbuild @esbuild-kit @petamoriken \
      buffer-from debug env-paths gel get-tsconfig ms \
      resolve-pkg-maps semver shell-quote source-map source-map-support \
    ; do \
      cp -R "/app/node_modules/$pkg" "node_modules/$pkg"; \
    done

# `drizzle.config.ts` is TypeScript and is loaded through esbuild-register, so
# every path it names has to resolve from this cwd: `schema` and, critically,
# `out`. `out` is NOT hard-coded anywhere in this image - it moved from
# `./src/db/migrations` to `./src/db/migrations-v2` during the journal repair
# on 2026-10-14 - so the whole of `src/db` (1.1 MB) is copied and the release
# script reads `out` back out of the config at run time.
COPY package.json drizzle.config.ts ./
COPY src/db ./src/db

# -----------------------------------------------------------------------------
# runner - minimal runtime
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# ca-certificates: outbound TLS to Stripe, Supabase, Upstash, Resend, OpenAI.
# dumb-init: a real PID 1 that forwards SIGTERM, so Fly's rolling deploys and
# `kill_signal` in fly.toml actually drain in-flight requests (the donation
# webhook is the path that must not be cut mid-transaction, docs/26 §7).
# poppler-utils: `pdftocairo` and `pdfinfo`, used by
# `src/lib/screening/rasterise.ts` to turn page 1 of an uploaded PDF into a
# PNG. The uploader accepts application/pdf and a vision model cannot read
# one, and `sharp` cannot help - this libvips is built WITHOUT poppler and
# answers `Input file contains unsupported image format`. Probed on the live
# machine 2026-10-24: pdftoppm, pdftocairo, convert and gs were ALL absent,
# so PDF screening was impossible in production while working in the sandbox.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates dumb-init poppler-utils \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# PORT/HOSTNAME are read by `.next/standalone/server.js` (verified: lines 8-9,
# `process.env.PORT || 3000` and `process.env.HOSTNAME || '0.0.0.0'`).
# 0.0.0.0 is required on Fly: binding to localhost makes the machine
# unreachable from the Fly proxy.
#
# No secret is set here, and none is COPYed in. Everything in
# `src/lib/validate-secrets.ts` plus the Stripe, Supabase, Upstash, Resend,
# OpenRouter and NextAuth values arrive from `fly secrets` at boot.

# Next's `output: 'standalone'` traces only server dependencies, so
# `.next/static` and `public` must be copied explicitly. VERIFIED 2026-10-14
# against this build: `.next/standalone/.next/static` does not exist, and
# `.next/standalone/public` contains only `public/fonts` (traced by the OG
# routes), not `public/images` or `public/llms.txt`. Copying the real `public`
# over it is therefore load-bearing, not boilerplate.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Migration toolchain for fly.toml's release_command.
COPY --from=migrator --chown=node:node /migrate ./migrate

# `isrFlushToDisk` is on, so the ISR writer needs a writable `.next`. Until
# docs/26 §5 step 3 lands a shared Redis cache handler this is also where ISR
# state lives, and it is per-machine.
RUN mkdir -p .next/cache && chown -R node:node .next

# ---- release command -------------------------------------------------------
# Written here instead of fly.toml so the shell quoting lives in a shell file
# and the preconditions are checked before anything touches the database.
#
# It REFUSES to run if the migration journal does not account for every `.sql`
# file in the configured `out` folder. drizzle-orm's migrator iterates ONLY
# `journal.entries` and never lists the directory, so an under-populated
# journal makes `drizzle-kit migrate` apply a subset and exit 0, reporting a
# successful deploy over a short schema. That is exactly the state CLAUDE.md
# records for `src/db/migrations` (9 journal entries against 33 `.sql` files).
#
# Checked against the live tree 2026-10-14, after the lead session's repair:
# `drizzle.config.ts` now points `out` at `./src/db/migrations-v2`, which holds
# 1 squashed baseline migration and 1 matching journal entry, so this guard
# passes. It stays in as a standing invariant, because the failure it catches
# is silent and this is a payments platform: a release command that lies about
# having migrated is worse than one that fails the deploy.
RUN cat > /usr/local/bin/release-migrate <<'SH'
#!/bin/sh
# Fly release_command. Runs once per deploy, before traffic shifts; a non-zero
# exit aborts the deploy with the old release still serving.
set -eu
cd /app/migrate

if [ "${SKIP_MIGRATIONS:-}" = "1" ]; then
  echo "release-migrate: SKIP_MIGRATIONS=1 set, applying nothing." >&2
  exit 0
fi

if [ -z "${MIGRATION_DATABASE_URL:-}" ]; then
  echo "release-migrate: FATAL - MIGRATION_DATABASE_URL is not set." >&2
  echo "  It must be the Supabase SESSION-mode URL on port 5432, not the" >&2
  echo "  pooled application URL on 6543: transaction mode cannot hold the" >&2
  echo "  session state DDL and advisory locks need (docs/26 §6)." >&2
  echo "  fly secrets set MIGRATION_DATABASE_URL='postgresql://...:5432/postgres'" >&2
  exit 1
fi

case "$MIGRATION_DATABASE_URL" in
  *:6543*)
    echo "release-migrate: FATAL - MIGRATION_DATABASE_URL points at port 6543." >&2
    echo "  6543 is Supavisor transaction mode. Use 5432 (docs/26 §6)." >&2
    exit 1
    ;;
  *:5432*) ;;
  *)
    echo "release-migrate: WARNING - no explicit :5432 in MIGRATION_DATABASE_URL." >&2
    echo "  Proceeding, but confirm this is a session-mode connection." >&2
    ;;
esac

# Read `out` back out of drizzle.config.ts through the same TS loader
# drizzle-kit itself uses, so this check can never drift from the folder
# drizzle-kit will actually read.
out=$(node -e 'require("esbuild-register/dist/node").register();
const c = require("./drizzle.config.ts");
process.stdout.write(String((c.default ?? c).out || ""));')

if [ -z "$out" ] || [ ! -f "$out/meta/_journal.json" ]; then
  echo "release-migrate: FATAL - no meta/_journal.json under drizzle.config.ts's" >&2
  echo "  out directory ('${out:-<unset>}'). Either the config moved or the" >&2
  echo "  Dockerfile's migrator stage did not copy that path." >&2
  exit 1
fi

journalled=$(node -e 'process.stdout.write(String(require(process.argv[1]).entries.length))' "$PWD/$out/meta/_journal.json")
onDisk=$(find "$out" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')

if [ "$journalled" != "$onDisk" ]; then
  echo "release-migrate: FATAL - migration journal is out of sync in '$out'." >&2
  echo "  meta/_journal.json entries: $journalled" >&2
  echo "  .sql files on disk:         $onDisk" >&2
  echo "" >&2
  echo "  drizzle-orm's migrator iterates ONLY journal.entries, so running" >&2
  echo "  migrate now would apply $journalled of $onDisk migrations and exit 0," >&2
  echo "  reporting success while leaving the schema short. Repair the" >&2
  echo "  journal and snapshots first (CLAUDE.md, docs/29)." >&2
  echo "" >&2
  echo "  To deploy the app without migrating: fly secrets set SKIP_MIGRATIONS=1" >&2
  exit 1
fi

echo "release-migrate: applying $onDisk migration(s) from '$out' over session mode..."
DATABASE_URL="$MIGRATION_DATABASE_URL"
export DATABASE_URL
exec node node_modules/drizzle-kit/bin.cjs migrate
SH

RUN chmod 0755 /usr/local/bin/release-migrate

# ---- assert sharp actually loads -------------------------------------------
# A build-time proof that the native module resolved against this image's libc,
# so a libc mismatch fails here rather than as a 500 from `/_next/image`.
RUN node -e "const s=require('sharp'); \
  if(!s.versions||!s.versions.vips) throw new Error('sharp loaded without libvips'); \
  console.log('sharp ok: sharp '+s.versions.sharp+', libvips '+s.versions.vips);"

USER node
EXPOSE 3000

# server.js is `.next/standalone/server.js`, copied to the WORKDIR root above.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
