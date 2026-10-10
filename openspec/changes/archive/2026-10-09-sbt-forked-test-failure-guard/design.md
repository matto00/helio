## Context

See proposal.md (Why) and ticket.md (Planning findings). Facts this design rests on (sbt v2.0.9, ScalaTest 3.2.19
sources; design-gate skeptic round 1 corrected the first draft's topology):

- `ForkTests.mainTestTask` builds a group's `Tests.Output` from `resultsAcc`, filled only by `React.processNotification`
  on a `testEvents` notification. `WorkerProxy.watch` -> `React.notifyExit` completes the promise with success once the
  fork exits cleanly, possibly before the reader thread has processed the `testEvents` backlog (likely mechanism;
  task 1.1 probes it). An empty `resultsAcc` is `Passed`; `TestResultLogger.Default` then prints "No tests to run".
- ScalaTest's forked runner gets sbt's `mainRunner.remoteArgs()` (never empty), so in the fork ScalaTest builds only
  its `-K host port` socket reporter. All configured reporters (`-C`, `-u`) and the summary counter live in the MAIN
  runner in the sbt JVM, fed over ScalaTest's own Skeleton socket -- a channel independent of sbt's `testEvents` IPC.
- `allTestGroupsTask` calls `r.done()` once, after every group and Cleanup, and stores its return value in
  `Tests.Output.summaries`. ScalaTest's `done()` waits for run statuses and the Skeleton server thread, then returns
  the summary text (`Tests: succeeded A, failed B, ...`, `*** N TESTS FAILED ***`, `*** N SUITES ABORTED ***`). That is
  why the summary is right in every lost-event run while sbt's own result is empty.
- Both result paths call `TestResultLogger.run` after that: `inputTests` (testOnly / testSelected / testQuick, i.e.
  `test`) via `testResultLogger`, and `testFull` via `Test / testFull / testResultLogger` (sbt sets it to
  `SilentWhenNoTests`). A throw from `run` fails the task.

## Goals / Non-Goals

**Goals:** a failing/aborted backend test makes every documented sbt test path exit non-zero, deterministically;
a passing run stays green; no disk state, so nothing stale can fail a later run; CI gets an independent guard.

**Non-Goals:** patching or shadowing sbt classes (`WorkerMain`/`ForkTests`); un-forking tests; timing-based
mitigations (a shutdown-hook sleep) as the fix -- only as a probe.

## Decisions

1. **Check ScalaTest's own summary after `done()`, in a custom `TestResultLogger`, BEFORE delegating.** The wrapper
   parses each ScalaTest `Tests.Summary` text (ANSI stripped) first, logs one distinctive line (`[hel1468-guard]
   ScalaTest summary: failed=N aborted=M ...`) whenever a ScalaTest summary is present, then runs the wrapped logger
   (the inherited value, not a hard-coded `Default`), then throws when `failed > 0` or `aborted > 0`. A red run counts
   as "red by the guard" only when the guard's line names the failure -- sbt's own `Default` can also throw on runs
   where events did arrive, so exit code alone proves nothing about the wiring. Installed on `Test / testResultLogger`
   (inherited by the `testSelected`/`testQuick` rescoped lookups; nothing sets it per task) AND
   `Test / testFull / testResultLogger` (sbt sets `SilentWhenNoTests` there). The wrapper has a recognisable
   `toString` so `show` per scope (testOnly, testSelected, testQuick, testFull) is readable.
   Rejected: in-fork `-C`/`-u` ledger (reporters never load in the fork); a sbt-side `-C` tally (cross-classloader
   state, same channel as the summary); a wrapper script only (bare `sbt testOnly` stays exposed).
2. **Fail-closed rule, exactly:** no ScalaTest summary in the output (zero selected tests, warm `testQuick`) -> no
   guard verdict, delegate unchanged; a ScalaTest summary with a parseable `Tests:` line -> check its counts and the
   `*** N SUITE(S) ABORTED ***` line; a ScalaTest summary with no parseable `Tests:` line -> throw ("cannot verify
   ScalaTest result").
3. **Two files.** The pure parser is an sbt-free, default-package object in 2.13/3 shared syntax in `backend/project/`,
   added to `Test / unmanagedSources` exactly like `DevEnv.scala`, and unit-tested by a default-package spec with
   fixtures captured verbatim from real runs (the repro logs and new runs; none hand-written). The wrapper, which
   imports `sbt.*`, is a separate `project/` file never compiled into tests.
3a. **Naming failed suites (owner ruling 2026-10-09: reword-spec).** The guard reports counts only; its thrown
   message points to ScalaTest's per-suite output earlier in the same log: each suite's header line (`[info] <Suite>:`)
   followed by its `*** FAILED ***` test lines (the per-test lines themselves do not carry the suite name; round 4).
   No `-oI` or other ScalaTest argument is added: under forked tests ScalaTest's sbt-side reminder queue is never
   filled (design-gate round 3), so no summary-based suite naming exists.
3b. **Aborted runs.** `*** RUN ABORTED ***` never appears in `done()`'s summary text, and after a forked `RunAborted`
   ScalaTest's sbt-side reader stops counting, so the summary can under-count. Layers: a fork that dies non-zero is
   already a failure via sbt (`notifyExit` failure); a suite abort shows as `aborted > 0`; a `RunAborted` inside a
   fork that still exits 0 is the residual gap -- the `ci-sbt.sh` scan greps the log's `*** RUN ABORTED ***` line in
   CI, and MISTAKES.md records that locally only the log line reveals it.
4. **No per-invocation value in any `Tests.Argument`** -- arguments are folded into the testQuick digest
   (`Defaults.scala` ~1329-1340), so one would defeat sbt 2's test cache on every run. This design adds none.
5. **CI log scan in `scripts/ci-sbt.sh`** (NOT independent of Decision 1 for counts -- it reads the same ScalaTest
   summary lines -- but independent of the build wiring, and the only layer that sees `*** RUN ABORTED ***`). After sbt exits 0, scan `$LOG` for ScalaTest summary lines anchored as
   `^\[info\] \*\*\* [0-9]+ (TEST|TESTS|SUITE|SUITES) (FAILED|ABORTED) \*\*\*$` and `^\[info\] \*\*\* RUN ABORTED`;
   on a hit exit 1 with a `::error::` naming the line. No other behavior of the script changes. Selftest cases in
   `scripts/ci-sbt.selftest.mjs`.
   Real CI `$LOG` lines are ANSI-wrapped around the level tag (`ESC[0m[ESC[0mESC[0minfoESC[0m] ...`, 0 plain `[info] `
   lines in three real backend job logs; design-gate round 5), so the scan strips ANSI escapes (`sed
   's/\x1b\[[0-9;]*m//g'`) before applying the anchored patterns.
6. **Documentation.** MISTAKES.md entry: symptom, mechanism, the guard, and that a gate still reads the ScalaTest
   `Tests:` line. The CON lane-guidance ticket is filed by the orchestrator at Delivery.

## Risks / Trade-offs

- [Concurrent groups (CI sets `HEL924_TEST_GROUP_CONCURRENCY`): ScalaTest's `remoteArgs` replaces its stored reader
  thread per group and `done()` joins only the last-started one, so a first-started, last-finishing group's events can
  be under-counted -- the same race class as the bug, possibly on the same runs] -> task 3.5: >=10 runs with
  concurrency 2 and the failing scratch suite deliberately in the first-started, slower group (sleep), counting guard
  hits; any miss is reported (not hidden) and the residual risk goes in MISTAKES.md either way.
- [A key-scope mistake leaves one path unguarded (e.g. testFull's own logger)] -> `show` per scope plus a red run per
  path; the 3.4 mutation removes the wrapper and shows the 40-failure spec going green again.
- [sbt or ScalaTest changes the summary format on upgrade] -> fail-closed parsing (Decision 2) turns that into a loud
  failure, never a silent pass.
- [Overlap with HEL-1425 on `ci-sbt.sh` / its selftest] -> keep the ci-sbt change minimal; later merger reconciles.
- [Memory: test runs on a shared desktop] -> `nice -n 19`, `-J-Xmx3g`, check `free -g`; one sbt at a time.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` file and no script invoked by `.husky/pre-commit` changes (the executor confirms with
`git diff --name-only`; if that changes, this section must be filled before Delivery).

## Planner Notes

- Self-approved: the two-layer approach (build-level summary check + CI log scan); adding
  an ADDED requirement to `backend-ci-test-execution` rather than a new capability.
- The probe matrix (ticket AC 1) is evidence, not code: transcripts persisted under the change directory as
  `repro-matrix.md`, with exit code and key line per path, N runs per path because the defect is nondeterministic.
