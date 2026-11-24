## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file (nor .concertino.env) or run env-dumping commands; never copy a worktree or any directory containing an env file.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh.
- [C4] jest 3 workers, Playwright 2 workers total (one batch at a time), nice -n 19.
- [C5] Bash timeout 600000; split calibration/mutation batches to finish under it; no background run past it.
- [C12] Red first with mutations; full spec files; commit (or record) the red run as .txt before implementation code.
- [C13] Scratch/tool output only in the main checkout's .concertino/scratch/HEL-1836/ (TMPDIR exception for hooks only).
- [C14] Lane-private DB helio_hel1836 for servers, Playwright, hooks; backend with ANTHROPIC_API_KEY exported empty.

## 1. Tests (red first)

- [x] 1.1 `cd frontend && nice -n 19 npm ci`; add the D4 (a)-(d) tests (zero-`codePointAt` worst rows, stage-1 skip, equivalence property test, admitted-frame no-scan); run the full spec files, see red on main; commit the red run as .txt
- [x] 1.2 Record mutations (design D4 list), each turning a test red, in mutations.txt

## 2. Implementation

- [x] 2.1 `perPositionWork` reads membership through the cached BMP table (design D1); full regex spec files green
- [x] 2.2 Length-only pre-check skips stage 1's per-cell test when it cannot avoid the scan (design D2)
- [x] 2.3 Stage 1 uses `unitLength` (design D3), kept only if calibration shows no regression; doc comments state the true-upper-bound argument
- [x] 2.4 Measure the table-build cost on the widest classes, recorded in calibration.md

## 3. Calibration and e2e

- [x] 3.1 Copy calibrate-anchored.mjs into this change, add group J (non-member and member bodies, incl. the 8-range f=1 class) and the COST-DIFF check; run groups A-J on the change and H, I, J on main, one per call (design D5)
- [x] 3.2 Write calibration.md: per-group maxima, H/I/J before/after, no row over 20 ms (else D6 escalation with numbers), zero DECISION-DIFF/COST-DIFF/MISMATCH, main's unrecorded non-member rows (about 46 ms worst, measured), group-D control reported as exec-only noise
- [x] 3.3 Run e2e/hel1683-regex-main-thread.spec.ts via npm run e2e:prod-build; save transcript as evidence
- [x] 3.4 lint, typecheck, format:check and the full frontend jest suite pass
- [x] 3.5 PR-body scope note (AC4): original premise refuted, cite premise-validation.md, report main's unrecorded non-member rows (about 46 ms worst, from calibration.md) (orchestrator writes the PR body from this; executor supplies the numbers in calibration.md)
