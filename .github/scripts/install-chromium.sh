#!/usr/bin/env bash
# Install Playwright's Chromium on a GitHub runner.
# Usage: install-chromium.sh <playwright|playwright-core>
# 1. The browser itself (no apt; downloads from Playwright's CDN).
# 2. Its apt dependencies, bounded to 4 minutes: when the runner's apt mirror
#    can't be resolved, apt waits about 10 minutes before failing, longer than
#    some jobs may run. The ubuntu-24.04 image already ships these libraries,
#    so on timeout we warn and go on; a missing library makes the browser test
#    fail, and no test is skipped.
set -euo pipefail
cli=${1:?usage: install-chromium.sh <playwright|playwright-core>}
npx "$cli" install chromium
if ! timeout 240 npx "$cli" install-deps chromium; then
  echo "::warning::apt dependencies for Chromium unreachable within 4 minutes; using the runner image's libraries"
fi
