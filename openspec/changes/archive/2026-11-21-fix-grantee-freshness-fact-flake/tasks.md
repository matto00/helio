## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file, never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); only scripts may read scripts/concertino/.concertino.env, never print it. Never copy .env files or trees containing them.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete test residue with buildUserDeleteSql by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; never a background run past the tool timeout; sbt testFull only in small shards.
- [C12] Red first with mutations; run full spec files; record and COMMIT the red run before implementation code.
- [C13] Scratch in .concertino/scratch/HEL-1812/ (main checkout); follow-up-relevant evidence in .concertino/runs/HEL-1812/evidence/.
- [C14] Lane DB helio_hel1812: DATABASE_URL for start-servers.sh, Playwright, e2e cleanup and every DB-touching jest/commit-hook run; servers with ANTHROPIC_API_KEY exported empty.
- [C15] Do not weaken the freshness assertion (no accepting both facts, no bare timeout bump) without a probe-confirmed root cause.

## 1. Root cause

- [x] 1.1 Start lane servers (7244/10151, lane DB, empty ANTHROPIC_API_KEY) and run the full spec file repeated under load (2 workers, nice -n 19); record pass/fail counts
- [x] 1.2 Probe per D1 (scratch-instrumented copy logging owner reads, both pipelines' run history with trigger sources, grantee panel-status bodies and rendered text with times); induce the real mechanism if it will not reproduce; verify by a log that confirms or refutes H1/H2 and whether pipeline 1's auto-run is cancelled
- [x] 1.3 Write root-cause.md (H1/H2/H3 verdict + log excerpts) to the main checkout's .concertino/runs/HEL-1812/evidence/ and verify persist-evidence READY

### Frontend

- [x] 2.1 N/A: H2 refuted (root-cause.md)

### Tests

- [x] 3.1 (H1) Commit the red (probe-induced failure) run, then in beforeAll wait until the checked pipeline's run history shows one more terminal run (the armed auto-run) after the blocked manual run, bounded ~50 s (D2); add the same settle after the viewer run only if 1.2 shows pipeline 1's auto-run is not cancelled; verify the induced-timing probe now passes
- [x] 3.2 Run the full spec file 20 times consecutively (2 workers, nice -n 19); persist the transcript; verify 20/20
- [x] 3.3 Run lint, typecheck, format:check and affected jest suites (3 workers); verify all pass
