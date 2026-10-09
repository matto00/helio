## Standing Constraints

- [C1] All measurement under `nice -n 19`, one heavy job at a time; abort any run that drops MemAvailable below 12 GB.
- [C2] Interim caps for your own runs until the new config lands: jest `--maxWorkers=3`, Playwright `--workers=2`, sbt `-J-Xmx3g`.
- [C3] Never edit `scripts/concertino/*`, Dockerfile, Cloud Run flags, prod `application.conf`, or frontend build config.
- [C4] CI effective config must be byte-identical: prove with before/after diffs under `CI=true`.
- [C5] Never pkill/pgrep/killall; kill only recorded PIDs. Never delete caches or `/tmp` contents. No writes under `~` outside the worktree.
- [C6] No `--no-verify`/`HUSKY=0` without explicit disclosure in the commit report.
- [C7] Every sbt probe/measurement runs in an sbt server started with the intended env (`--server`/`--client=false`, or confirm no server is up for the checkout); record the mechanism.

## 1. Baseline measurement

- [x] 1.1 Attribute the incident's shmem: verify `/tmp` tmpfs contents (jest_rs, embedded-pg, others) and `/dev/shm` vs the kernel log; record in measurements.md
- [x] 1.2 Measure the whole base-config `.husky/pre-commit` chain per step (worker count, per-process peak RSS, shmem delta, wall-clock), name the peak step, and confirm or refute "two jest runs x 11 workers"; record
- [x] 1.3 Measure base-config `sbt testFull` per C7 (per-forked-JVM max heap + peak RSS, sbt server max heap, resident servers after) and idle dev servers; record

## 2. Backend

- [x] 2.1 build.sbt: local-only `-Xmx` on Test and run javaOptions, overridable; verify per C7 that `show Test/javaOptions` and `show Compile/run/javaOptions` under CI=true are unchanged and local shows the cap
- [x] 2.2 Apply design D4's sbt-server heap rule: record measured local server max heap; cap (CI-neutral mechanism) only if > 3g, else record the no-op

## 3. Frontend / tooling

- [x] 3.1 Root + frontend jest configs: local-only maxWorkers (<=3), workerIdleMemoryLimit, overrides, and disk cacheDirectory if 1.1 confirms jest_rs; verify `jest --showConfig` diff under CI=true is empty
- [x] 3.2 playwright.config.ts: local workers <=2 with override; verify resolved config under CI=true still 2
- [x] 3.3 Confirm helio-mcp tests run through the root jest config (or cap their own entry point); record
- [x] 3.4 Apply design D5a node-heap rule to every hook node process from 1.2 (cap or record "peak X, no cap needed"); invalid override values throw (D5)

## 4. Docs

- [x] 4.1 CONTRIBUTING.md + CLAUDE.md: local caps table, CI values, and one-off override vars; verify prettier passes
- [x] 4.2 MISTAKES.md: the 2026-10-09 OOM, what really consumed memory (measured), and the caps
- [x] 4.3 Hand each Concertino-side need (start-servers.sh, lane briefs) to the orchestrator in the executor report for CON filing; record the filed IDs in measurements.md; never edit render targets

## 5. Tests / proof

- [x] 5.1 After-config single-lane peaks (whole pre-commit chain per step, sbt testFull per C7, dev servers) + wall-clock deltas; record in measurements.md
- [x] 5.2 3-lane simulation live if safe, else justified extrapolation, with headroom vs 62 GB and concurrent-lane load noted
- [x] 5.3 Prod-untouched proof: `git diff` base..HEAD over Dockerfile, infra/, .github/workflows/cd-*, application*.conf, vite.config.ts is empty
- [x] 5.4 Full pre-commit hook passes on the commit (no bypass)
