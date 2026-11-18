## Standing Constraints

- [C1] Never read, cat, grep, source or print any `.env` file; no env-dumping commands (scripts may read scripts/concertino/.concertino.env).
- [C2] Heredocs quoted (`<<'EOF'`) or use Write/Edit; no backticks or `$(...)` inside echo strings.
- [C3] No pkill/pgrep/killall; kill by exact PID only; stop servers with scripts/concertino/stop-servers.sh; delete DB residue only by exact id.
- [C4] jest maxWorkers 3, Playwright workers 2 (every --repeat-each run), sbt -J-Xmx3g, nice -n 19 for heavy runs.
- [C12] Red first by forcing the timing, then 40/40 with --repeat-each=40 --workers=2. No retries, sleeps or longer timeouts.

## 1. Frontend (product fix, hel1578)

- [x] 1.1 Write a jest test for `hydrateTabs`: saved active tab B, deferred `refreshChangeSignals`, user selects A (or the location becomes `/dashboards/A`) mid-hydration; assert A stays selected and active. Verify it FAILS on unmodified code (record output).
- [x] 1.2 Fix `frontend/src/features/dashboards/tabs/hydrateTabs.ts` so a navigation made during hydration wins, by re-reading the current location and re-running `planHydration` (design.md D1); verify 1.1 passes and the existing hydrateTabs / dashboardTabsListeners tests pass.
- [x] 1.3 Add a jest test for the no-navigation path (B still selected) and verify it passes before and after the fix.

## 2. Probes (hel1668 specs)

- [x] 2.1 hel1668-phone-sheet:184: run the D3 probe (focus/blur, popover open/close, elementFromPoint at tap); record the confirmed cause, or what was tried, in `.concertino/scratch/HEL-1754/evidence/phone-sheet-probe.md`.
- [x] 2.2 hel1668-schema-panel-copy:172: run the D4 probe (hover/focus state, menu getAnimations across frames, which element `.spine-row--selected` resolves to); record the cause or what was tried in `.../evidence/schema-panel-probe.md`.
- [x] 2.3 If either probe shows a product defect that is small, fix it with a failing-first jest or e2e test; if large or in Popover/ActionsMenu, stop and report it to the orchestrator instead.

## 3. Tests (e2e)

- [x] 3.1 hel813: force red by stalling only the FIRST fonts.googleapis.com request on unmodified `uiLogin`; change `uiLogin` (e2e/support/isolateLivePage.ts, plus `waitForURL` if it also blocks) per D2; verify green under the same first-request stall; record the residual risk.
- [x] 3.2 hel1578: force red by gating `/api/dashboard-changes` until after the card click, on unmodified product code; verify green with 1.2 under the same gate.
- [x] 3.3 hel1668-phone-sheet:184 and schema-panel-copy:172: force red per the probed cause, apply the fix (test or product), verify green under the same forcing; or document as a named candidate (AC4). (schema-panel-copy fixed; phone-sheet left a named candidate, see evidence/phone-sheet-probe.md)
- [x] 3.4 Run each of the four tests with `--repeat-each=40 --workers=2` under `nice -n 19`; save transcripts under `.concertino/scratch/HEL-1754/evidence/`; hel1578, hel813 and schema-panel-copy
  were run 40/40 (transcripts are tails, without the header line); hel1668-phone-sheet:184 was probed, not run 40x by
  the executor (the evaluator ran it 40/40 at 390x844, no fix was made).
- [x] 3.5 Check hel1583-glass-nav:554 and hel1584:493 recent failing runs for the D2 shape; record the finding (fold in only on matching evidence).
- [x] 3.6 Clean every dev-DB row this work created by exact id; record the ids deleted.
