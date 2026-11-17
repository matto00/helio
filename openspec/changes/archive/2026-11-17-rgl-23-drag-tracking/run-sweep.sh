#!/usr/bin/env bash
# usage: run-sweep.sh <outdir>   (from the worktree root; dev servers must be up on 7160/10067)
OUT=$1; mkdir -p "$OUT"; cp openspec/changes/rgl-23-drag-tracking/hel1728-sweep.spec.ts e2e/hel1728-sweep.spec.ts
for row in control d0 d8 d16 d33 d100 r0 r16; do
  SWEEP_ONLY=$row SWEEP_OUT=$OUT DEV_PORT=7160 BACKEND_PORT=10067 nice -n 19 npx playwright test e2e/hel1728-sweep.spec.ts --workers 1 --reporter=line 2>&1 | grep -E "^.*SWEEP |failed" | sed 's/^.*SWEEP /SWEEP /' | cut -c1-600
done
rm -f e2e/hel1728-sweep.spec.ts
