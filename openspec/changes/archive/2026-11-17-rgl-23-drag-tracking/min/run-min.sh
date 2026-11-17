#!/usr/bin/env bash
# usage: run-min.sh <outdir> [query]   (from the worktree root; dev server up on 7160). Copies the page in, runs, removes it.
OUT=$1; Q=${2:-}
cp openspec/changes/rgl-23-drag-tracking/min/hel1728-min.html frontend/hel1728-min.html
cp openspec/changes/rgl-23-drag-tracking/min/hel1728-min.tsx frontend/hel1728-min.tsx
cp openspec/changes/rgl-23-drag-tracking/min/hel1728-min.spec.ts e2e/hel1728-min.spec.ts
MIN_QUERY=$Q SWEEP_OUT=$OUT DEV_PORT=7160 BACKEND_PORT=10067 nice -n 19 npx playwright test e2e/hel1728-min.spec.ts --workers 1 --reporter=line 2>&1 | grep -E "MINSWEEP|failed|Error|PAGEERROR|CONSOLEERR" | sed 's/^.*MINSWEEP /MINSWEEP /' | cut -c1-900
rm -f frontend/hel1728-min.html frontend/hel1728-min.tsx e2e/hel1728-min.spec.ts
