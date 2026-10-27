#!/usr/bin/env bash
#
# Deploy to Fly with the flags this project actually needs.
#
# Why a script rather than `fly deploy`:
#
#   --depot=false    Fly's default builder is Depot, which talks gRPC to its
#                    workers. Behind a TLS-inspecting proxy that handshake
#                    fails with `x509: certificate signed by unknown
#                    authority` and the deploy dies after ~2 minutes of
#                    "Waiting for depot builder...". The classic remote
#                    builder is a plain Fly machine and works.
#
#   SSL_CERT_FILE    flyctl is Go, so it reads the CA bundle from here. Set
#                    only when a proxy CA is present, so this is a no-op on
#                    a normal machine.
#
#   --build-secret   Optional. With it, the 24 routes that combine
#                    `export const revalidate` with a database read
#                    pre-render real content instead of empty. Arrives as a
#                    BuildKit secret, so it never lands in a layer or in
#                    `docker history`. See the long note in the Dockerfile.
#
# Build caching lives in the Dockerfile (npm cache + Next's .next/cache as
# BuildKit cache mounts), not here. See docs/54.
#
# Usage:
#   scripts/deploy.sh                 # normal deploy
#   scripts/deploy.sh --prerender     # also pass DATABASE_URL as a build secret
#   scripts/deploy.sh --app staging   # target another app
set -euo pipefail

APP="lastdonor"
PRERENDER=0
EXTRA=()

while [ $# -gt 0 ]; do
  case "$1" in
    --prerender) PRERENDER=1; shift ;;
    --app) APP="$2"; shift 2 ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

# Go reads its trust store from SSL_CERT_FILE. Only set it if a proxy CA is
# actually installed, so this does nothing on a developer machine.
if [ -z "${SSL_CERT_FILE:-}" ] && [ -r /root/.ccr/ca-bundle.crt ]; then
  export SSL_CERT_FILE=/root/.ccr/ca-bundle.crt
  echo "note: using the agent-proxy CA bundle for flyctl TLS"
fi

if [ -z "${FLY_API_TOKEN:-}" ]; then
  echo "error: FLY_API_TOKEN is not set." >&2
  echo "       Use the org-scoped token; a builder-scoped one cannot see the app." >&2
  exit 1
fi

ARGS=(deploy --remote-only --depot=false --app "$APP" --yes)

if [ "$PRERENDER" = "1" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "error: --prerender needs DATABASE_URL in the environment." >&2
    exit 1
  fi
  # A read-only pooled (6543) URL is sufficient: the build only SELECTs.
  ARGS+=(--build-secret "database_url=${DATABASE_URL}")
  echo "note: pre-rendering with live data via a BuildKit build secret"
fi

echo "deploying ${APP}..."
start=$(date +%s)
flyctl "${ARGS[@]}" "${EXTRA[@]+"${EXTRA[@]}"}"
echo "deploy finished in $(( $(date +%s) - start ))s"

# ---------------------------------------------------------------------------
# Say what this deploy just published to crawlers.
#
# A hermetic build (no `database_url` secret) pre-renders every route that
# combines `export const revalidate` with a database read as EMPTY. The build
# says so - `[build] database read failed, pre-rendering as empty`, eight
# times - about 200 lines above where the operator is looking by the time it
# finishes, so in practice nobody sees it.
#
# [VERIFIED 2026-10-27 against v111, docs/119 §2] it is bounded and it does
# repair itself: seven routes are baked with a revalidate window, and five of
# them (`/donate`, `/transparency`, `/last-donor-wall`,
# `/cancelled-campaigns`, `/campaigns/category/[category]`) carry 5m. Only
# `/sitemap.xml` and `/blog/sitemap.xml` carry 1h - so a sitemap that
# advertises no campaigns is the one consequence that outlives the deploy by
# long enough to matter to a crawler.
#
# The campaign count is the right probe because the static floor is served
# either way: 42 URLs with zero `/campaigns/<slug>` entries looks like a
# perfectly healthy sitemap unless you count what is missing.
# ---------------------------------------------------------------------------
sitemap_report() {
  local url body n
  url="https://${APP}.fly.dev/sitemap.xml"
  [ "$APP" != "lastdonor" ] || url="https://lastdonor.org/sitemap.xml"

  if ! body=$(curl -sS --max-time 30 "$url" 2>/dev/null); then
    echo "note: could not read ${url}; skipping the sitemap report"
    return 0
  fi

  # `/campaigns/category/<slug>` cannot match: `[a-z0-9-]+` stops at the
  # second slash, so the pattern never reaches `</loc>`. The second grep is
  # belt and braces.
  n=$(printf '%s' "$body" | grep -oE '/campaigns/[a-z0-9-]+</loc>' | grep -vc '/category/' || true)
  echo "sitemap: ${n} campaign URL(s) at ${url}"
  [ "${n:-0}" -eq 0 ] || return 0

  if [ "$PRERENDER" = "1" ]; then
    echo "warn: --prerender was passed and the sitemap is STILL empty, so this is not" >&2
    echo "      the hermetic-build window. src/app/sitemap.ts degrades to the static" >&2
    echo "      floor on a read failure and only console.errors, so check the Fly logs" >&2
    echo "      for '[sitemap] campaigns could not be read'." >&2
  else
    echo "note: expected - this build was hermetic, so /sitemap.xml and"
    echo "      /blog/sitemap.xml were pre-rendered empty. They refill on their own"
    echo "      within the hour, with no deploy. To publish them populated instead,"
    echo "      re-run with --prerender and DATABASE_URL set."
  fi
}

sitemap_report
