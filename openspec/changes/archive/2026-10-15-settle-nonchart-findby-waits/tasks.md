## Standing Constraints

- [C1] No raised timeouts, no retries, no product-code change; no conversion without a probe result for its file.
- [C2] All jest runs: <= 3 workers, `nice -n 19`, <= 3-4 parallel processes, this worktree only; Bash `timeout: 600000`; never pkill/pgrep/killall.
- [C3] Stall injection is scratch-only (never committed); a stalled run counts only if the stall fired.
- [C4] HEL-1600 network guard stays active; new mocks at the narrowest service function.

### Frontend

- [x] 1.1 Inventory every `findBy*`/`findAllBy*` AND every `waitFor` (own row each, e.g. chartTruncation:176) in the 7 files (file:line, gating promise)
- [x] 1.2 BEFORE probes per design.md D4 on main's files (all 7 files); record results + one failure excerpt per file
- [x] 1.3 Add `settleMocks` sibling in `frontend/src/test/settleChartMount.ts` (why-comment; settleChartMount behavior unchanged)
- [x] 1.4 Convert exposed waits in PanelContent.chartTruncation, PublicDashboardViewerPage.truncation, PanelCard.crossFilter
- [x] 1.5 Convert exposed waits in PanelFullscreenOverlay.test and PanelContent.test (incl. lazy markdown, form schema)
- [x] 1.6 Leave unexposed sites unchanged; record reason per site; a listed AC1 wait left unconverted (e.g. crossFilter 392/416) is an explicit AC1 deviation in measurements.md

### Tests

- [x] 2.1 AFTER probes: identical stall, N=5, whole file + `-t`, fired == N, all green
- [x] 2.2 Secondary `arm` sweep on converted files; list any remaining firing `findBy*` with reason
- [x] 2.3 Clean: 10 cold-cache CI=true runs per converted file green
- [x] 2.4 Regression guard: one scratch mutation per converted file turns it red
- [x] 2.5 HEL-1599's 15 settleChartMount files still green (folder run)
- [x] 2.6 Write `measurements.md` (commands, env, cwd, N, results, inventory)
- [x] 2.7 Gates: lint, format:check, typecheck, full frontend jest (CI=true, nice -n 19, --maxWorkers=3); commit
