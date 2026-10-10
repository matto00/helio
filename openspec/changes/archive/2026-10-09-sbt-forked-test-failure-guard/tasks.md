## Standing Constraints

- [C1] Throwaway failing specs live only under `backend/src/test/scala/com/helio/hel1468scratch/` (or a scratch copy),
  are never staged or committed, and are removed by exact path; `git status` must not list them at commit time.
- [C2] Every sbt invocation: `nice -n 19`, `-J-Xmx3g`, one sbt at a time, `free -g` checked first; shut down any sbt
  server you start (`sbt --client shutdown`); never pkill/pgrep/killall; never print backend/.env or any env map.
- [C3] Pass/fail of any sbt run is judged from BOTH the exit code and the ScalaTest `Tests:`/`*** ... FAILED ***`
  lines, plus the two project-path lines naming this worktree.
- [C4] No per-invocation value in any `Tests.Argument` (it is folded into the testQuick digest); the guard keeps no
  disk state and fails closed on an unreadable ScalaTest summary.

## 1. Probe and repro matrix

- [x] 1.1 Discriminating probe: temporarily register a fork shutdown hook that sleeps 2 s (scratch only), rerun the
  40-failure scratch spec 6x; record whether lost-event runs disappear (race) or persist (swallowed handler); revert
- [x] 1.2 Repro matrix BEFORE the fix, >=5 runs per path, exit code + key line each, with the test-result cache both
  cold (after a source touch) and warm as an explicit column: `-batch testOnly`, default launcher `testOnly`, `test`
  (testQuick), `testFull` (scratch spec present), thin client (`sbt --client` or state why unavailable), client
  attached to a server started from a second disposable checkout, `scripts/ci-sbt.sh`; write `repro-matrix.md`
- [x] 1.3 CI history: grep (only) the logs of >=25 recent green CI backend shard jobs for ScalaTest failed/aborted
  summaries or "No tests to run"; use `gh api --allow-escape-sequences .../jobs/<id>/logs` and record a positive
  control count (`Tests: succeeded` lines) per job so an empty fetch cannot read as clean; record in `repro-matrix.md`

### Backend

- [x] 2.1 Add the sbt-free default-package summary parser in `backend/project/` (added to `Test / unmanagedSources`
  like `DevEnv`) and, in a separate `project/` file, the wrapper (check before delegating, `[hel1468-guard]` line,
  readable `toString`); verify `sbt -batch "compile; Test/compile"`
- [x] 2.2 Wire `build.sbt`: wrap the inherited `Test / testResultLogger` and `Test / testFull / testResultLogger`;
  add no ScalaTest argument; verify `show` per scope (testOnly, testSelected, testQuick, testFull)
  and that a passing `testOnly` and the unit spec stay green
- [x] 2.3 Add the `ci-sbt.sh` post-exit log scan (ANSI stripped first, then anchored `[info] *** ... ***` and
  `RUN ABORTED` patterns, `::error::`); verify with
  the selftest cases in 3.3

### Tests

- [x] 3.1 Unit spec (default package, `DevEnvSpec` precedent) for the parser, fed real summary texts from the repro
  logs captured verbatim from real runs: all passed, N failed, suite aborted, ANSI-colored,
  unparseable; record exit + `Tests:`
- [x] 3.2 Red/green after the fix, >=5 runs per path from 1.2 (cache cold and warm): scratch failing spec ->
  non-zero every run AND the `[hel1468-guard]` line names the failure (else not counted as guard-red) AND the log shows the scratch suite's
  header line followed by at least one `*** FAILED ***` line; count exit-0-before vs guard-caught-after per path; scratch removed -> exit 0; `testFull` red once with
  `HEL924_TEST_GROUP_CONCURRENCY` set and green once; append to `repro-matrix.md`
- [x] 3.3 Extend `scripts/ci-sbt.selftest.mjs`: log with summary + exit 0 -> exit 1; ANSI-wrapped summary and RUN
  ABORTED lines with real ESC bytes, modelled on real FAILING `$LOG`-form lines (job 114064543620 l.16698
  `*** 1 TEST FAILED ***`, job 113204133537 l.15702 `*** 1 SUITE ABORTED ***`; see skeptic-design-6.md) -> exit 1 (and red against an unstripped regex); clean log -> 0; sbt non-zero ->
  unchanged; run `npm run selftest:ci-sbt` and record output
- [x] 3.5 Concurrency: >=10 runs, `HEL924_TEST_GROUP_CONCURRENCY=2`, failing scratch suite in the first-started,
  slower group (sleep) plus a passing suite in another group via `testOnly`; record per run which group's fork
  started last and guard hits/misses
- [x] 3.4 Mutation proof: remove the wrapper from both scopes, rerun the 40-failure spec >=6x, show at least one green
  (exit 0) run; restore and show it red again

### Docs

- [x] 4.1 MISTAKES.md entry (symptom, mechanism, guard, residual RUN ABORTED + concurrency risks, how to judge a run); verify Prettier/format hooks pass
