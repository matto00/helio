## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; no env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Scripts may read scripts/concertino/.concertino.env; never print it.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) in echo strings.
- [C3] No pkill/pgrep/killall; kill by exact PID only; stop servers with stop-servers.sh; DB residue deleted only by exact id via buildUserDeleteSql.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout 600000 on long calls.
- [C6] Budget exhausted means escalate.
- [C7] Merge only through the auditor with gh pr merge --squash --match-head-commit; never --auto.
- [C8] No prod actions, no release cut, no concertino sync.
- [C9] No claude.ai session link in the PR or commits.
- [C10] Phase 4 cleanup.sh --phase4 from the main checkout; confirm run.end; delete the local branch if skipped.
- [C11] Known-flake rule: rerun only the failed job once, name it in the PR; a second failure escalates. Known: hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184, hel1665-home-phone-stability:437, hel1573-motion-grid-chart:104.
- [C12] Red first: forced red before the fix and green after, both recorded; then 40/40 with --repeat-each=40 --workers=2 --retries=0; evaluator and skeptic run the full chart and panel spec files. No timeout, sleep or retry added.
- [C13] Scratch in .concertino/scratch/HEL-1760/ only.
- [C14] Dev-DB residue cleaned by exact id.
- [C15] Probes run only against this run's ports (DEV_PORT=7192, BACKEND_PORT=10099); check page URL and port before trusting any probe (the shared Playwright browser has been hijacked between lanes).

## 1. Baseline (before any code change)

- [x] 1.1 Base build: `npm run build` output saved to scratch; raw+gzip bytes of everything index.html/app.html load up front (entries + modulepreload chunks) and echarts-absence grep recorded (D5)
- [x] 1.2 Timeline measured on unfixed code (D3): load, output meta, rows, ChartPanel.tsx request, last chart module, canvas; saved to scratch
- [x] 1.3 Literal forcing (ChartPanel.tsx +6 s) on unfixed code, exact command + output saved; expected red
- [x] 1.4 CI-shaped forcing (rows hold + CI-calibrated chunk delay, numbers and expected arithmetic written first, D4) on unfixed code; red recorded

### Frontend

- [x] 2.1 Add `chartPanelModule.ts` (`loadChartPanel` memoised with clear-on-reject, `preloadChartPanel` swallowing); verify unit tests in 3.1
- [x] 2.2 `ChartRenderer.tsx` builds its `lazy()` from `loadChartPanel`; verify existing ChartRenderer/ChartPanel tests pass
- [x] 2.3 `outputMetaCache`: private `noteKind` helper (knownKinds.set + preload when chart) used by `fetchOutputMeta`'s success handler and `seedOutputMeta`; verify unit test in 3.2
- [x] 2.4 `publicDashboardService.fetchPublicOutputMeta` calls `preloadChartPanel()` when `kind === "chart"`; verify unit test in 3.2

### Tests

- [x] 3.1 Unit: loader memoises one import, retries after a rejection (mocked import; stated as unit-level proof), preload never rejects (jest, maxWorkers 3)
- [x] 3.2 Unit: fetchOutputMeta, seedOutputMeta and fetchPublicOutputMeta preload for a chart Output and not for table/metric/markdown; red first against unfixed code
- [x] 3.3 After-fix timeline (D3) recorded; ChartPanel.tsx requested before rows answer under the rows hold
- [x] 3.4 Literal forcing and CI-shaped forcing re-run on fixed code, outputs saved (green expected for CI-shaped; literal recorded as-is)
- [x] 3.5 `hel1573-motion-grid-chart.spec.ts -g "chart:"` 40/40 with --repeat-each=40 --workers=2 --retries=0, nice -n 19, ports 7192/10099
- [x] 3.6 Full `e2e/hel1573-motion-grid-chart.spec.ts` plus the chart/panel spec files green once
- [x] 3.7 Fixed build output saved; entry chunk byte delta and echarts-absence recorded next to 1.1
- [x] 3.8 lint, typecheck, format:check, full frontend jest green with no "import after the Jest environment has been torn down" warning; `files-modified.md` lists every touched file and shared-file overlap with HEL-1744/1746/1757
