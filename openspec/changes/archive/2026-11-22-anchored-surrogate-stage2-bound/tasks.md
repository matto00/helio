## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file or run env-dumping commands; never copy dirs containing env files.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh.
- [C4] jest 3 workers, Playwright 2 workers total (one batch at a time), sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; split calibration/mutation batches to finish under it; no background run past it.
- [C12] Red first with mutations; full spec files; commit (or record) the red run before implementation code.
- [C13] Scratch/tool output only in main checkout .concertino/scratch/HEL-1823/ (TMPDIR exception for hooks only).
- [C14] Lane-private DB helio_hel1823 for servers, Playwright, hooks; backend with ANTHROPIC_API_KEY exported empty.

### Tests

## 1. Tests (red first)

- [x] 1.1 Add the group-H worst-shape test and the stage-2 soundness property test (design D3); run the full spec files, see red on main; commit or record the red run
- [x] 1.2 Record mutations (drop `- 1`, count pairs as lone, revert to doubling, count only one lone) each turning a test red, in mutations.txt

### Frontend

## 2. Implementation

- [x] 2.1 Stage-2 bound uses `text.length + (LONE_SURROGATE_UNITS - 1) x loneCount` (design D1); full regex spec files green
- [x] 2.2 Pick the counting method by measurement (design D2), recorded in calibration.md

## 3. Calibration and e2e

- [x] 3.1 Copy calibrate-anchored.mjs into this change, add the dense-surrogate group; run groups A-H + new group, one per call
- [x] 3.2 Write calibration.md: group-H before/after (all under 20 ms), dense rows not slower than main, decision identity on every row
- [x] 3.3 Run e2e/hel1683-regex-main-thread.spec.ts via npm run e2e:prod-build; save transcript as evidence
- [x] 3.4 lint, typecheck, format:check and the full frontend jest suite pass
