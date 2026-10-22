#!/usr/bin/env bash
# Gets a fresh Claude Code cloud session ready to run the checks in tests/, so sessions don't spend
# time on setup. Chromium is already in the cloud image, so only the npm packages are installed.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}/tests" || exit 0
if [ ! -d node_modules/playwright ] || [ ! -d node_modules/axe-core ]; then
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1 \
    || echo "SoloPrint: 'npm install' in tests/ failed; run it by hand before the checks."
fi
exit 0
