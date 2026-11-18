## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); scripts/concertino/.concertino.env may be read by scripts but never printed; never copy .env files.
- [C2] Quoted heredocs only (<<'EOF'), or Write/Edit.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers via scripts/concertino/stop-servers.sh; DB residue deleted only by exact id via buildUserDeleteSql; throwaway emails plain addresses.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout: 600000 on long Bash calls; sbt testFull, never bare sbt test.
- [C6] RED FIRST with recorded mutations; evaluator and skeptic run FULL affected spec files.
- [C7] Scratch in .concertino/scratch/HEL-1763/; e2e on a lane-private DB helio_hel1763 (DATABASE_URL set for start-servers.sh AND Playwright).
- [C8] No prod actions, no release cut, no concertino sync; no claude.ai session link in commits/PRs.
- [C9] The e2e derives the content bottom from in-flow content (never a max over all descendants, which includes the escaping element), asserts on both the dialog and .ui-modal__body scroll extents, and the desktop case compares the canvas rect against the preview wrapper rect with a small tolerance.

### Frontend

- [x] 1.1 Probe at 375px with a chart Output open: identify the element(s) extending the dialog's scroll extent and their containing-block ancestor; record before scrollHeight and findings in .concertino/scratch/HEL-1763/probe.md
- [x] 1.2 Apply the fix at the layer the probe identifies (design Decision 2); verify the probe's scrollHeight now matches content
- [x] 1.3 If the fix is in shared chart CSS, check every ChartRenderer host (dashboard panel, phone sheet, public view, detail modal) for the bug and regressions; record results in probe.md

### Tests

- [x] 2.1 Add e2e/hel1763-output-editor-preview-scroll.spec.ts (375px and 390x844, light and dark, plus desktop render/clip case); record it red with the fix reverted and green with it
- [x] 2.2 Run full e2e/hel1752-output-editor-footer-fit.spec.ts and any chart-render spec the change touches (e.g. hel1573-motion-grid-chart) green
- [x] 2.3 Run frontend lint, typecheck, format:check and the outputEditor jest tests green
