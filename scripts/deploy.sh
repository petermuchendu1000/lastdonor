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
