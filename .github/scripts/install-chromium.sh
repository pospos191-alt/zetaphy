#!/usr/bin/env bash
# Install Playwright's Chromium on a GitHub runner.
# Usage: install-chromium.sh <playwright|playwright-core>
# Tries the full install (browser + apt dependencies) 3 times with backoff. If the
# runner's apt mirror stays unreachable, it installs only the browser: the
# ubuntu-24.04 image already ships the libraries, and a missing one makes the
# browser test fail, so no test is skipped.
set -uo pipefail
cli=${1:?usage: install-chromium.sh <playwright|playwright-core>}
for wait in 0 20 60; do
  sleep "$wait"
  if npx "$cli" install --with-deps chromium; then exit 0; fi
  echo "::warning::'$cli install --with-deps chromium' failed; retrying"
done
echo "::warning::apt dependencies unreachable after 3 tries; installing the browser only (runner image libraries)"
npx "$cli" install chromium
