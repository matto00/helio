## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; no env-dumping commands; only scripts may read `scripts/concertino/.concertino.env`, never print it.
- [C2] Quoted heredocs only (`<<'EOF'`).
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with `scripts/concertino/stop-servers.sh`.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, `nice -n 19`.
- [C5] Bash timeout 600000; no background run past the tool timeout.
- [C12] Red first, with mutations; run full spec files; the red probe is committed before the fix.
- [C13] Scratch in `.concertino/scratch/HEL-1790/`; follow-up-referenced evidence in `.concertino/runs/HEL-1790/evidence/`.
- [C14] Lane-private DB `helio_hel1790`, DATABASE_URL for start-servers.sh and Playwright; backend with ANTHROPIC_API_KEY empty.

### Tests

## 1. Reproduce and probe

- [x] 1.1 Create lane DB `helio_hel1790`, start lane servers; verify `/health` answers on the lane backend port.
- [x] 1.2a Step 0: download the 3 failing-run `playwright-report-shard-2` artifacts, persist the trace.zip files to evidence (expire 2026-11-27), extract instance-3 click/hover points, trigger box and timings.
- [x] 1.2 Add diagnostics for instance 3 (pointer position, elementFromPoint, :hover, activeElement, animations, rect, PAINT) and run the spec alone; record output in scratch.
- [x] 1.3 Reproduce with CI leg 2's file selection/order (`scripts/e2e-shard.mjs plan 7`) at 2 workers, then with the `hel1752`/`hel1783` neighbours; record the red rate.
- [x] 1.4 Name the root cause meeting design Decision 1's completeness bar (light vs dark, instance 3 only, pass vs fail runs); persist the probe log to `.concertino/runs/HEL-1790/evidence/`.
- [x] 1.5 Commit the red probe (reproducing the failure) before any fix; verify the commit exists and the probe is red.

## 2. Fix

- [x] 2.1 Fix at the layer the probe proved wrong (test or Select CSS, design Decision 3); escalate if HEL-1735 scope.
- [x] 2.2 Keep `not.toEqual(rest)` and `toEqual(DESKTOP_HOVER[theme])` intact; verify by diff review.
- [x] 2.3 Mutation: revert the fix (or re-impose the probed condition) and show red; restore and show green.

## 3. Stability

- [x] 3.1 `--repeat-each` (>= 3) over the full leg-2 file selection from `scripts/e2e-shard.mjs plan 7`, 2 workers, lane ports exported; report pass count.
- [x] 3.2 Supplementary `--repeat-each` (>= 10) of this spec with `hel1752`/`hel1783` at 2 workers; report pass count.
- [x] 3.3 Remove temporary diagnostics not part of the fix; run lint/format/typecheck on changed files; drop lane DB at the end.

## 4. CI

- [ ] 4.1 Push the branch; observe the PR's `e2e (2)` leg green and record run/job ids (post-merge main `e2e (2)` is checked by the orchestrator at Delivery).
