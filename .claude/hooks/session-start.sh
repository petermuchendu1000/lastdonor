#!/bin/bash
set -euo pipefail

# Provisions the toolchain for Claude Code cloud sessions so that lint,
# typecheck, unit tests and the Playwright e2e suite are runnable immediately.
# Local machines manage their own environment, so this is a no-op there.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

npm install --no-audit --no-fund

# The cloud image ships a pre-built Chromium whose revision may not match the
# one @playwright/test expects, which makes `chromium.launch()` fail even though
# a perfectly usable browser is present. Point Playwright at what is actually
# installed instead of downloading a second copy.
if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  chrome=""
  for candidate in "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux/chrome; do
    [ -x "$candidate" ] && chrome="$candidate"
  done
  if [ -n "$chrome" ]; then
    echo "export PW_CHROMIUM_EXECUTABLE=\"$chrome\"" >> "$CLAUDE_ENV_FILE"
  fi
fi
