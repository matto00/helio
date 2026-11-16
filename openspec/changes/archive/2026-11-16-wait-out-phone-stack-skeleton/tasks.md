## Standing Constraints

- [C1] Never touch e2e/hel1575-dashboard-tabs.spec.ts (lane HEL-1644); shared e2e support diff stays additive and is called out in the PR.
- [C2] No retries and no larger timeouts anywhere; the fix is a readiness wait, proven red-first under a forced repro.
- [C3] The guard's stretch proof targets the panels-level skeleton layer (the .crossfade__skeleton containing [aria-label="Loading panels"]), not any inner body-skeleton crossfade.

## 1. Red first

- [x] 1.1 Throwaway probe (not committed, under `.concertino/scratch/HEL-1724/`): stretch `.crossfade .crossfade__skeleton` transition to 3s + delay panels fetch; run the UNMODIFIED `hel1583-mobile-dashboard.spec.ts:156` (both themes) and record it red with >3 cards measured. Save output to evidence.

## 2. Helper

- [x] 2.1 Add `LIVE_STACK_ITEMS` and `waitForPanelStack` to `e2e/support/panelGridReady.ts` (design D1); doc-comment pointer only on `waitForPanelGrid`.

## 3. hel1583

- [x] 3.1 `open()` waits with `waitForPanelStack(page, 3)`; geometry read uses the live-layer selector (D2). Check every caller of `open()` and any post-switch measurement in the file.
- [x] 3.2 Entrance-animation probe (D3): record running animations and rect deltas at the geometry read; add a bounded animation wait only if the probe shows it matters. Record numbers.
- [x] 3.3 Re-run the 1.1 probe against the fixed spec: green.

## 4. Guard

- [x] 4.1 `e2e/hel1724-panel-stack-ready.spec.ts` per D4.2; record the two mutation reds (each reverted).

## 5. Sweep

- [x] 5.1 `sweep.md` per D5 with per-hit verdicts and line refs; fix only real FIX sites; do not touch `e2e/hel1575-dashboard-tabs.spec.ts`.

## 6. Proof

- [x] 6.1 `:156 --repeat-each 20 --workers 2 --trace retain-on-failure` under `nice -n 19` = 40/40 (D6); whole hel1583 file, guard spec, and FIX-touched specs once each.
- [x] 6.2 lint/typecheck/format clean; commit.
