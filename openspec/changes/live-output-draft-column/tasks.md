## Standing Constraints

- [C1] Frontend only. No backend file, schema or migration change; never touch backend step files (`StringOpsStep`, `AssertStep`: HEL-1676 lane).
- [C2] `e2e/hel1631-draft-mode.spec.ts` stays green UNCHANGED, including the edit-speed test (edit 1 < 100 ms, edits 2-10 < 50 ms).
- [C3] Zero requests per client-evaluable edit; one history read per displayed Output per page load (+ once after a run); saved rows only for not-previewed nodes.
- [C4] Resource caps: at most 2 workers, `nice -n 19`, `HELIO_JEST_MAX_WORKERS=2` on frontend jest; full Playwright suites under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock`; skip heavy runs while 1-min load > 10 (sleep 60 s, recheck, up to 30 min); Playwright `--trace retain-on-failure`; Bash `timeout: 600000` on long calls.
- [C5] Process safety: no kill/pkill/pgrep/killall; stop servers only with `scripts/concertino/stop-servers.sh`. Delete test data you create by exact id.
- [C6] `files-modified.md` lists every path explicitly, deletions included (CON-260).
- [C7] The 10-edit burst with a chart Output displayed must meet edit 1 < 100 ms, edits 2-10 < 50 ms (hel1632 spec); never relax the budget.

## 1. Shared render inputs (parity by construction)

- [x] 1.1 Create `frontend/src/features/panels/ui/outputRenderInputs.ts` with `recordsToPanelRows`, `chartRenderInputs`, `metricLoadedValue`, `keyAggregate` (design D1) and unit tests.
- [x] 1.2 Refactor `ChartOutputPanel.tsx`, `MetricOutputPanel.tsx` and `usePanelData.ts` (and `usePublicPanelData.ts` if it duplicates the conversion) to call them; existing panel tests pass unchanged.

## 2. Rows for the live view

- [x] 2.1 `frameToRecords` + `orderLiveColumns` (design D2) with tests (Integral, schema order).
- [x] 2.2 `usePipelineDraftFrames`: always-on base walk when the pipeline has ≥1 Output; expose base nodes (incl. root frames); counts/preview with no draft unchanged (design D3).
- [x] 2.3 Pure `liveOutputSource` covering every row of the design D3 table, with tests.

## 3. Baseline and saved rows

- [x] 3.1 `useLiveOutputBaseline` via the shared history cache; refresh once after a run settles (design D4); tests asserting no fetch on edit/selection/Discard.
- [x] 3.2 Saved-rows fetch for not-previewed nodes, cached per Output per page load (design D5).

## 4. Component and placement

- [x] 4.1 `features/pipelines/ui/liveOutput/LiveOutputColumn.tsx` + `LiveOutputRender` + CSS: header, marker, selector, render, tiles, caption, empty state, `useDeferredValue` (design D6).
- [x] 4.2 Desktop track sizing via container query and spine formula update; narrow-desktop disclosure; phone Preview tab placement (design D7). Update `PipelineDetailPage.spine.test.tsx:207`.
- [x] 4.3 Component tests for every state; the parity test `LiveOutputColumn.parity.test.tsx` (design D8).

## 5. e2e and evidence

- [x] 5.1 `e2e/hel1632-live-output.spec.ts` per design D8, with `attachApiRequestCounter`.
- [x] 5.2 In the hel1632 spec, the 10-edit burst with a chart Output displayed asserts edit 1 < 100 ms and edits 2-10 < 50 ms on the count/preview update (gated). Separately measure input → live-output DOM update for 10 edits at 1280 and record it.
- [x] 5.3 Screenshots: 1280 light/dark, one width in 769-1100, 375 and 430 phone, motion Full/Subtle/Off, into `/home/matt/Development/helio/.concertino/scratch/HEL-1632/`.
- [x] 5.4 Run the frontend CI job's script checks locally (lint, typecheck, format:check, `check:node-root-encoding`, schema drift, any other `check:*` in the CI frontend job), jest, and `hel1631`/`hel1579`/`hel1632` specs.
