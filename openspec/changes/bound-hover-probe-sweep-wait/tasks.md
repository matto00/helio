## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; no env-dumping commands; never copy .env files or trees containing them; only scripts may read `scripts/concertino/.concertino.env`, never print it.
- [C2] Quoted heredocs only (`<<'EOF'`).
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with `scripts/concertino/stop-servers.sh`; test residue deleted with buildUserDeleteSql by exact id.
- [C4] jest 3 workers, Playwright 2 workers TOTAL (never two Playwright batches at once), sbt -J-Xmx3g, `nice -n 19`.
- [C5] Bash timeout 600000; no background run past the tool timeout.
- [C12] Red first, with mutations; run full spec files; the red run is committed (as .txt) before the fix.
- [C13] Scratch in the MAIN checkout's `.concertino/scratch/HEL-1813/`; follow-up-referenced evidence in `.concertino/runs/HEL-1813/evidence/`.
- [C14] Lane-private DB `helio_hel1813`; DATABASE_URL for start-servers.sh, Playwright, cleanup and every DB-touching jest/hook run; backend with ANTHROPIC_API_KEY exported empty.

## 1. Probe

- [x] 1.1 Start lane servers on the lane DB; verify `/health` on the lane backend port.
- [x] 1.2 Trace-first: extract the CI dark-case trace evidence (design Decision 1); fetch the PR #1197 failing job's artifacts if present; persist trace.zip files to `.concertino/runs/HEL-1813/evidence/`.
- [x] 1.3 Instrument the sweep per frame (trigger rect, frame delta, animation state); measure the natural miss rate and reproduce the miss under a named forced condition.
- [x] 1.4 Write the root cause with evidence to `.concertino/runs/HEL-1813/evidence/root-cause.md`.
- [x] 1.5 Commit the red demonstration (.txt output) before any fix; the probe code does not run in CI from that commit (outside `testDir` matching, or a temporary spec the fix commit removes).

## 2. Fix

- [x] 2.1 Make the forced condition deterministic (design Decision 3) with a race-free capture installed before the click; if the slide animation is never captured or already finished, the spec fails fast naming that state.
- [x] 2.2 Bound every wait with a short explicit timeout and a diagnostic message (Decision 4).
- [x] 2.3 Diff review: `expect(early).toBe(settled)` unchanged; no retries/skip/timeout increase.

## 3. Verify

- [x] 3.1 Both HEL-1790 mutations red against the fixed spec in every run, each theme, N >= 5 per theme; else at least the HEL-1790 baseline (7/10 noAnimations-only, 3/6 no-op) with the shortfall explained. Confirm the `top <= 250` stall fires.
- [x] 3.2 20 consecutive passes (`--repeat-each=10`, 2 workers, `nice -n 19`); report max test duration.
- [x] 3.3 Fixed spec fails fast (seconds) when its precondition is made unreachable; show the message.
- [x] 3.4 If `e2e/support/hel1790Rest.ts` changed, both `e2e/hel1675-shared-hover.spec.ts` and `e2e/hel1735-feature-hover.spec.ts` pass in full.
- [x] 3.5 lint, format:check, typecheck pass.
