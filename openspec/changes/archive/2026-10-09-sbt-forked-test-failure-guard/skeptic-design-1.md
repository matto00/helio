## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD bc39b79c1f1e6c6d6c8c29397a6c3f8e2c9ec69b (change dir untracked). Sources: sbt v2.0.9 files in the
orchestrator scratchpad `sbtsrc/`, and ScalaTest 3.2.19 `scalatest-core_2.13-3.2.19-sources.jar` from the local
coursier cache (`org/scalatest/tools/Framework.scala`, `ArgsParser.scala`).

### What I verified (with evidence)

1. **Repro is real (grep of the transcripts, not the summary).** `hel1468-many{1,2,5,6}.log` end
   `*** 40 TESTS FAILED ***` / `No tests to run for Test / testSelected` / `[success]`; `many3,4` end
   `sbt.TestsFailedException`. `loop1,2` (+ `m1b`) end `*** 7 TESTS FAILED ***` ... `[success]`; `loop3-5`, `m1` fail.
   `r1-r3` (1 failure) all fail. Matches the Planning findings (4/6, 2/5, 0/3).
2. **Tests.Cleanup runs in the sbt JVM after each forked group, and a throw fails the task: TRUE.**
   `ForkTests.scala:75-77` `main...dependsOn(all(opts.setup)*) flatMap { results => all(opts.cleanup).join.map(_ => results) }`;
   Cleanup reaches forked groups via `Tests.processOptions` (`Tests.scala` `case Cleanup(cleanupFunction, _) => cleanup += ...`)
   from `testExecution` options (`Defaults.scala:1324-1327`, `testSelected / testOptions = Listeners +: (TaskZero / testOptions)`).
   (The scaladoc at `Tests.scala:109` "Cleanup is not currently performed for forked tests" is stale.) Cleanup runs even
   for groups with zero selected tests (`ForkTests.scala:61-62` constant Passed, cleanup still chained).
3. **One uncached task value shared by testGrouping and testOptions: plausible.** Both `testOnly` (`inputTests0`,
   `Defaults.scala:1449-1453`, rescoped `testGrouping`) and `testFull` (`executeTests`, `test / testGrouping`) delegate
   to `Test`-scoped keys; a single task key is evaluated once per command execution. The design's proof obligation is
   adequate for this point — but see CR-1, which makes it moot.
4. **Event-loss mechanism (supports the design's "don't depend on it" stance).** `WorkerProxy.watch`
   (`WorkerExchange.scala:195-199`) polls `process.isAlive` and calls `React.notifyExit`, which does
   `promise.success(0)` on a clean exit if the response line has not been processed yet (`ForkTests.scala:199-204`).
   The reader thread (`sbt-fork-test-response-reader`) may still have the group's `testEvents` backlog unread, so
   `testOutputResult` snapshots an empty `resultsAcc` = Passed. Consistent with payload-size dependence. Task 1.1's
   shutdown-hook probe is a good discriminator for exactly this.
5. **Does ScalaTest's sbt runner honour `-C` in a fork? NO — the design's core mechanism is false.**
   - sbt passes the fork both args and remote args: `ForkTests.scala:110-115`
     `TestInfo.TestRunner(..., mainRunner.args(), mainRunner.remoteArgs())`; `ForkTestMain.java` runs
     `framework.runner(frameworkArgs, remoteFrameworkArgs, classLoader)`.
   - ScalaTest `SbtRunner.remoteArgs` (`Framework.scala:804-925`) always starts a `Skeleton` server socket in the sbt
     JVM and returns `[127.0.0.1, port]` — never empty.
   - `Framework.scala:1046-1055`: `if (remoteArgs.isEmpty) parseReporterArgsIntoConfigurations(stdoutArgs ::: stderrArgs ::: others)
     else parseReporterArgsIntoConfigurations("-K" :: remoteArgs(0) :: remoteArgs(1) :: stdoutArgs)`. `-C` and `-u` are
     reporter args (`ArgsParser.scala:60,63`) that land in `others` — **dropped in the forked runner**.
   - They are instantiated instead in the sbt-JVM main runner (`Defaults.createTestRunners`, `Defaults.scala:1473-1488`,
     `f.runner(args, Array.empty, loader)`), fed by the Skeleton socket (`Framework.scala:839-890`), a channel
     independent of sbt's `testEvents`.
   - Consequences: (a) a `-D<prop>` added to the fork's `ForkOptions` is invisible to the reporter (it runs in the sbt
     JVM), so the reporter has no ledger path; (b) the "synchronous write before the fork exits" guarantee in Decision 1
     does not exist; (c) the Skeleton thread and ScalaTest's async `DispatchReporter` are only drained by the main
     runner's `done()` (`Framework.scala:755-779`: joins `serverThread`, `dispatchDisposeAndWaitUntilDone`), which sbt
     calls once, after ALL groups and their Cleanups (`Defaults.scala:1680-1683`
     `Tests.Summary(frameworks(tf).name, r.done())`). A per-group Cleanup reading a ledger written by an sbt-side
     reporter therefore races the dispatch: the same race class as the bug, failing open.
   - The design's fallback (`-u` JUnit XML) is also a reporter arg in `others`: same JVM, same race. It is not a
     fallback.
6. **Where the "*** N TESTS FAILED ***" line actually comes from.** `ForkTestMain` discards the fork runner's
   `runner.done()` return; the printed summary is the sbt-JVM main runner's `done()` string carried in
   `Tests.Output.summaries` and printed by `TestResultLogger` — which is why it is correct in every lost-event run
   (counts come from the Skeleton channel). `inputTests0` (`Defaults.scala:1460-1466`) and `testFull`
   (`Defaults.scala:1265-1272`) both call `trl.run(log, output, taskName)` AFTER `allTestGroupsTask` has called
   `r.done()`. That is a deterministic post-drain hook point the design missed.
7. **Coverage vs ticket.** Driver context asks to grep past CI backend shard logs for silent greens; no task covers it.
   Spec claims `test` (testQuick) but the 1.2/3.2 matrices omit it. AC "with the sbt 2 test-result cache in play" is not
   an explicit matrix dimension (Planning finding asserts independence; not a task).
8. **Cache interaction (no defect, executor note).** `testOptionDigests` (`Defaults.scala:1329-1340`) digests every
   `Tests.Cleanup` (macro code-string) and every `Tests.Argument`'s literal args into the testQuick digest
   (`IncrementalTest.scala:57-63`). Anything per-invocation (a UUID) placed in a `Tests.Argument` would invalidate
   testQuick on every run. `TestStatusReporter.endGroup` only records Passed suites that arrive via `testEvents`, so
   lost events do not poison the testQuick cache.

### Verdict: REFUTE

The two-layer fix cannot deliver its guarantee as designed: Decision 1's reporter is never loaded in the fork, its
`-D` path is unreachable from where it does load, and a per-group Cleanup races ScalaTest's sbt-side dispatch. The
"prove with a red run, else fall back to -u" hedge does not rescue it (the fallback has the identical flaw), and a
racy guard can pass a few red runs and still fail open in production.

### Change Requests

1. **Rewrite Decision 1 against the real ScalaTest/sbt fork topology** (`Framework.scala:1046-1055`,
   `ForkTests.scala:110-115`, `Defaults.scala:1473-1488,1680-1683`): state that `-C`/`-u` reporters run in the sbt-JVM
   main runner fed by the Skeleton socket, not in the fork, and drop the "loaded in the forked JVM / -D into
   ForkOptions / synchronous write before fork exit" claims.
2. **Move the check to a point that runs after `r.done()`**, not a per-group `Tests.Cleanup`. Candidate the design must
   evaluate (and, if rejected, say why): a custom `TestResultLogger` set on `Test / testResultLogger` AND
   `Test / testFull / testResultLogger` (sbt sets the latter to `SilentWhenNoTests` at `Defaults.scala:1264`, so
   overriding only the former misses `testFull`) that delegates to the default logger, then throws when the
   ScalaTest outcome says failed/aborted while `output.overall` is not — either from a sbt-JVM `-C` reporter's
   in-memory tally (drained by `done()`) or from the `Tests.Summary` text. Must cover `testOnly`/`testSelected`,
   `test`/`testQuick`, `testFull`. If the design keeps any per-group/Cleanup or on-disk ledger, it must name the
   barrier that guarantees the reporter has processed the group's events before the check runs.
3. **Decision 3 must be fail-closed, not optional.** Remove the "if not observable, prove the marker in transcripts and
   state the limitation" escape hatch: the guard must fail the run at runtime when its reporter/tally did not observe a
   `RunStarting` (or equivalent) for a run that executed tests. A guard that is silently off is the defect class this
   ticket exists to close. (With CR-2's post-`done()` hook, "tests ran" is observable from `Tests.Output.summaries`.)
4. **If any on-disk state survives the redesign,** the check must treat a missing/unreadable ledger as FAILURE, and
   pruning must never delete a directory a concurrent invocation in the same worktree may own (age-bounded, not
   "all others"). Prefer no disk state at all.
5. **Never put a per-invocation value in a `Tests.Argument`** (it is folded into the testQuick digest,
   `Defaults.scala:1329-1340`); state this in the design.
6. **Add a task to grep past CI backend shard logs** (grep only, never print env) for `TESTS? FAILED|SUITES? ABORTED|RUN ABORTED`
   co-occurring with a successful sbt step, per the ticket's driver context; record the result in `repro-matrix.md`.
7. **Add `test` (testQuick) to the 1.2 and 3.2 matrices**, and make "test-result cache in play" an explicit
   dimension (e.g. a second `test` run after a green one), since the spec's requirement names `test`.
8. **Task 3.4 mutation** must target the new hook (disable the TestResultLogger/tally check) and show the 40-failure
   scratch spec going green again in at least one of N runs — i.e. prove the guard, not the sbt race, is what turns it red.

### Non-blocking notes

- Decision 4 (ci-sbt.sh log scan) is sound and independent; anchor patterns to ScalaTest's `[info] *** ... ***`
  summary lines so test stdout cannot false-trigger. It works precisely because the summary is computed sbt-side
  from the Skeleton channel (finding 6).
- `ScalaTest done()` joins only the last `serverThread`; with `HEL924_TEST_GROUP_CONCURRENCY` > 1 in CI an earlier
  group's Skeleton thread is not explicitly joined. Its fork has exited and RunCompleted is the last frame, so this is
  likely benign, but the design should mention it and the CI red proof should run with concurrency set.
- Task 1.1's shutdown-hook probe is well-chosen: finding 4's `notifyExit` race predicts lost events vanish with it.
