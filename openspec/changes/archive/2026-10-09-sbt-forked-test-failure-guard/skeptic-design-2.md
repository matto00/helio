## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD bc39b79c1f1e6c6d6c8c29397a6c3f8e2c9ec69b (change dir untracked). Ground truth: sbt v2.0.9 sources in
the orchestrator scratchpad `sbtsrc/` (`Defaults.scala`, `ForkTests.scala`, `TestResultLogger.scala`), ScalaTest
3.2.19 `sbtsrc/st/org/scalatest/tools/Framework.scala`, and `StringReporter.scala` extracted from
`~/.cache/coursier/.../scalatest-core_2.13-3.2.19-sources.jar`, plus the repro logs `hel1468-*.log`. No sbt run.

### What I verified (with evidence)

1. **Round-1 change requests addressed.** CR1 (topology rewritten, Context bullets 2-3), CR2 (post-`done()`
   `TestResultLogger` on both scopes), CR3 (fail-closed, Decision 2), CR4 (no disk state), CR5 (Decision 4), CR6
   (task 1.3), CR7 (`test` + cache column in 1.2/3.2), CR8 (3.4 targets the wrapper). All present.
2. **Every path calls a `TestResultLogger` after `r.done()` with summaries populated: TRUE.**
   `allTestGroupsTask` sets `summaries = runners.map(... Tests.Summary(frameworks(tf).name, r.done()))` inside the
   result `map` (`Defaults.scala:1680-1684`). `testFull` (`:1265-1272`) calls `trl.run` after `executeTests.value`;
   `inputTests0` (`:1422-1470`) calls `trl.run` in `.map` over that output. `testOnly`/`testSelected` use
   `inputTests(testSelected)`, `testQuick` uses `inputTests(testQuick)`, `test := testQuick.evaluated`
   (`:1274-1286`). A throw from `run` fails the task in both shapes (`Default` itself throws `TestsFailedException`
   the same way, `TestResultLogger.scala:109-111`).
3. **Scope resolution: TRUE.** `testResultLogger` is set only at `Global` (`:1215`, `testDefaults`) and at
   `Test / testFull` (`:1264`); `testTaskOptions` (`:1304-1340`) sets no per-task `testResultLogger`. So the rescoped
   lookups `Test / testSelected / testResultLogger` and `Test / testQuick / testResultLogger` delegate (task axis
   first) to a project-level `Test / testResultLogger`, and `testFull` needs its own override exactly as the design
   says. No plugin touches it (`project/plugins.sbt`: sbt-assembly only; no `testResultLogger` in `backend/`).
4. **Zero-test runs: absent summary is the natural boundary.** `filteredFrameworks` keeps a framework only if some
   selected test matches its fingerprint (`:1590-1598`); `runners` are built from it, so a `testOnly` matching
   nothing, or a warm `testQuick` whose filter drops every suite, produces `summaries` with NO ScalaTest entry. When
   ScalaTest is in `runners`, `done()` always returns non-empty fragments (`Framework.scala:755-797`;
   `StringReporter.summaryFragments` always emits `Run completed`, `Total number of tests run`, `Suites:`, `Tests:`
   for `Some(summary)`), so "framework ran but empty summary" is unreachable.
5. **Repro texts.** Lost-event runs end `Tests: succeeded 0, failed 40 ...` / `*** 40 TESTS FAILED ***` /
   `No tests to run for Test / testSelected` / `[success]` (`hel1468-many1.log:91-97`, many2/5/6, loop1/2, m1b);
   single-failure r1-r3 are sbt-red. **None contains a reminder section listing failed suites.** No repro log contains
   an aborted suite or run.
6. **"RUN ABORTED" never appears in the `done()` summary text.** `summaryFragments` (`StringReporter.scala` ~251-311)
   emits only run-completed/stopped, totals, `*** N SUITE(S) ABORTED ***`, `*** N TEST(S) FAILED ***`, all-passed / no
   tests. `*** RUN ABORTED ***` is printed by the stdout reporter on a `RunAborted` event, i.e. only in the log. Worse,
   on a forked `RunAborted` the sbt-side Skeleton `react()` dispatches it and STOPS reading (`Framework.scala:891`, no
   recursive `react()`), so later events of that fork are never counted.
7. **Skeleton join covers only the last-started group.** `remoteArgs` is called per group inside the running task
   (`ForkTests.scala:105-110`) and does `serverThread.set(Some(thread))` (`Framework.scala:923`), overwriting the
   previous group's thread; `done()` joins only that one (`:767-772`). CI runs `testFull` with 8 groups and
   `HEL924_TEST_GROUP_CONCURRENCY` (2 concurrent, `build.sbt:187-198`, `ci.yml:172,261`). A first-started group that
   finishes last has an un-joined Skeleton reader trailing its fork's exit: the same reader-behind-exit race class as
   the sbt `testEvents` loss (and plausibly correlated with it for the same heavy group). The guard's only input can
   then under-count. The design names the risk but "mitigates" it with one red run, which cannot rule out a race.
8. **Unit-test compile topology.** `DevEnv.scala` is sbt-free, default package, Scala 2.13/3 common subset, and is
   compiled into the TEST sources (`build.sbt:111-113`, `Test / unmanagedSources += .../project/DevEnv.scala`); the
   backend is Scala 2.13.15. A `TestResultLogger` wrapper imports `sbt.*`, which is not on the test classpath.
9. **CI scan regexes** match the real summary strings (`*** 1 TEST FAILED ***`, `*** 40 TESTS FAILED ***`,
   `*** 1 SUITE ABORTED ***`, `*** N SUITES ABORTED ***`). Selftest plan (3.3) is adequate.

### Verdict: REFUTE

The core mechanism is now correct and well-grounded (findings 2-4). But the plan's proofs and two of its claims do not
hold as written: with "run wrapped logger first", a red run under the guard does not show the guard did anything (so
the per-path proof, including the testFull scope, is not self-authenticating); the spec promises suite names the
default summary does not contain; the "RUN ABORTED" check is dead code against the input it reads; and the
concurrency residual is "mitigated" by a single run. All are fixable in the artifacts without changing the approach.

### Change Requests

1. **Make every red run self-authenticating (Decision 1, tasks 2.2/3.2/3.4).** Evaluate the summary check BEFORE
   delegating (or in a `finally`), log a distinctive guard line (e.g. `HEL-1468 guard: ScalaTest summary reports
   failed=N aborted=M`) whenever the summary shows failures, then run the wrapped logger, then throw if the guard
   found failures. With the current "wrapped first" order, `Default` throws `TestsFailedException` on every
   non-lost run and the guard never executes, so a red `testFull` run proves nothing about the
   `Test / testFull / testResultLogger` wiring. Task 3.2 must count a run as red-by-guard only when that line is in its
   output, and must show it on every path (testOnly, test/testQuick, testFull).
2. **Suite naming (spec "SHALL name each failed suite", Decision 1 "reminder section").** The default ScalaTest
   summary has no reminder section (finding 5, `hel1468-many1.log:91-95`), and in the lost-event case sbt's
   `events` map is empty, so the guard has no source of suite names. Either (a) enable the reminder via a static
   ScalaTest `-o...` argument (state the exact flag, that it changes console output for every run, and that a static
   `Tests.Argument` changes the testQuick digest once, not per invocation), or (b) reword the spec requirement and
   scenario to what is achievable (e.g. "the output reports the failed/aborted counts; the failed suite appears in
   ScalaTest's per-test output in the same log") and drop the reminder claim from Decision 1.
3. **RUN ABORTED (Decision 1, task 3.1).** Remove "or `RUN ABORTED` appears" as a guard condition over the summary
   text (finding 6: never present there) and state what actually happens on a forked `RunAborted`: the Skeleton reader
   stops counting (`Framework.scala:891`), so the summary may under-count; name which layer catches it (the CI log
   scan's `RUN ABORTED` pattern; locally, the fork's exit status / nothing) and record the local gap as a residual.
   Task 3.1's fixtures must be real captured `done()` texts; do not ship a synthetic "run aborted" summary fixture
   presented as a captured one (capture a real suite-aborted text, e.g. a scratch spec throwing in its constructor).
4. **State the zero-test rule explicitly (Decision 2).** "No `Tests.Summary` named `ScalaTest` in
   `results.summaries` -> pass" (finding 4: `testOnly` with no match and warm `testQuick` both take this path;
   `Defaults.scala:1590-1598,1680-1684`). "Present and parseable -> check counts"; "present but no parseable
   `Tests:`/`Suites:` line -> fail". Drop "the ScalaTest framework ran and returned an empty summary" as the
   fail-closed trigger or keep it explicitly labelled as unreachable-defensive; the logger cannot observe "ran"
   any other way.
5. **Concurrency residual (Risks, task 3.2, proposal).** Replace "the testFull red proof runs once with
   `HEL924_TEST_GROUP_CONCURRENCY` set" with an accurate risk statement (finding 7: `done()` joins only the
   last-started group's Skeleton thread; an earlier-started group finishing last can be under-counted, plausibly in
   the same runs where sbt loses that group's events) and a measurement: >=10 `testFull` runs with concurrency 2 and a
   scratch failing suite placed in a group that starts first and finishes last (or a stated reason this ordering
   cannot occur). Record the residual (correlated loss in both channels) in the MISTAKES.md entry. Also correct the
   proposal's "independent second guard": the ci-sbt scan is independent of the build wiring but reads the SAME
   ScalaTest summary channel, so it shares this residual.
6. **File split (Decision 3, task 2.1).** Specify two files: the pure parser in an sbt-free, default-package file in
   the Scala 2.13/3 common subset, added to `Test / unmanagedSources` like `DevEnv.scala` (`build.sbt:111-113`); the
   `TestResultLogger` wrapper (imports `sbt.*`) in a separate `project/*.scala` file NOT added to test sources.
   As written ("a new `backend/project/*.scala` helper" + "+ wrapper" in one task) an implementer can put both in one
   file and break `Test/compile`.

### Non-blocking notes

- `show Test/testSelected/testResultLogger` (etc.) prints the object's `toString`; give the wrapper a recognisable
  `toString` so the `show` proof is legible, and include the `testSelected` and `testQuick` task-scoped keys in the
  `show` set, not just the config-level key.
- Wrap the inherited value (`(Test / testResultLogger).value` referencing the prior definition) rather than a
  hard-coded `TestResultLogger.Default`, so a future upstream default change is not silently masked.
- Validate the ci-sbt regexes against a line from a real CI `sbt.log` (task 1.3 fetches them): confirm sbt writes no
  ANSI codes into `$LOG` under `--server -batch` in Actions, else the `^\[info\]` anchor never matches.
- In the lost-event case the guard's error follows sbt's "No tests to run for ..." line; the MISTAKES.md entry should
  say a run is judged by the guard line / `Tests:` line, not that message.
