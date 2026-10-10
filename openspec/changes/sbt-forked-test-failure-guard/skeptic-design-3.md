## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD bc39b79c1f1e6c6d6c8c29397a6c3f8e2c9ec69b (change dir untracked). Ground truth: ScalaTest 3.2.19
`sbtsrc/st/org/scalatest/tools/Framework.scala` (scratchpad), `StringReporter.scala` extracted from
`~/.cache/coursier/.../scalatest-core_2.13-3.2.19-sources.jar`, sbt 2.0.9 `sbtsrc/ForkTestMain.java`, `backend/build.sbt`,
repro logs `hel1468-*.log`, `ci-history-scan.txt`. No sbt run.

### What I verified (with evidence)

1. **Round-2 CR1 (self-authenticating red runs): addressed.** Decision 1 now parses + logs `[hel1468-guard] ...` BEFORE
   delegating to the inherited logger, then throws; task 3.2 counts guard-red only when that line names the failure,
   on every path. `show` per scope incl. testSelected/testQuick is in 2.2; readable `toString` in Decision 1.
2. **Round-2 CR3 (RUN ABORTED): addressed.** Decision 3b drops it from the summary check, states the Skeleton stops
   counting, names the layers (fork non-zero exit via sbt; `aborted > 0`; CI log scan; local residual in MISTAKES.md).
3. **Round-2 CR4 (zero-test rule): addressed.** Decision 2 states absent summary -> delegate; parseable -> counts;
   present-unparseable -> throw.
4. **Round-2 CR5 (concurrency): addressed.** Risks entry is accurate; task 3.5 measures >=10 runs; proposal now says
   the CI scan shares ScalaTest's channel. 4.1 records the residual.
5. **Round-2 CR6 (file split): addressed.** Decision 3 + task 2.1 specify two files, parser in Test/unmanagedSources.
6. **CI history spot-check:** `ci-history-scan.txt` has 120 rows across 30 distinct run ids, every row `ctl=1 hits=0`
   (`awk '{print $3,$4}' | sort | uniq -c` -> `120 ctl=1 hits=0`). Consistent with ticket.md's claim.
7. **Round-2 CR2 / Decision 3a (`-oI` names failed suites in `done()`'s summary): FALSE against source.**
   - A constant `Tests.Argument(ScalaTest, "-oI")` does reach the sbt-side main runner (`Framework.runner`, remoteArgs
     empty -> `parseReporterArgsIntoConfigurations(stdoutArgs ...)`, `Framework.scala:1046-1050`), so its
     `presentReminder` is true (`:1066-1080`). That part holds.
   - But `done()` builds the reminder from `summaryCounter.reminderEventsQueue` (`Framework.scala:784-794`), and that
     queue is filled ONLY by `SbtLogInfoReporter.apply` -> `recordReminderEvents` (`:608-614`). `SbtLogInfoReporter` is
     created per task in `runSuite` (`:462`), i.e. where tasks execute -- in the FORK. The sbt-side Skeleton `react()`
     (`:843-890`) increments counters and dispatches events but never calls `recordReminderEvents`. The main
     `dispatchReporter` also has no stdout reporter (`reporterConfigs = ...copy(standardOutReporterConfiguration =
     None)`, `:1107-1110`).
   - `StringReporter.summaryFragments` emits reminder fragments only `for event <- filteredSortedEvents`
     (`StringReporter.scala` ~320-333): empty queue -> no reminder lines.
   - The fork's own `runner.done()` (whose summaryCounter DID record reminders) has its return value discarded
     (`ForkTestMain.java:386-391`). So in this project's forked setup (`Test / fork := true`, every path) the reminder
     never appears anywhere -- not in `done()`'s summary the guard reads, not in the log.
   - Consequence: the spec requirement "The failure output SHALL name each failed suite" and the "Lost forked-test
     events" scenario's "names the failed suite" have no working mechanism; task 3.1's "N failed (with -oI reminder)"
     fixture cannot be captured; Decision 3a's "the guard's thrown message repeats those lines" has nothing to repeat.
     The design's escape hatch covers "-oI breaks anything", not "-oI produces nothing", so an implementer reaches an
     unsatisfiable spec line mid-execution. (Round 2's CR2 option (a) itself was unsound for the same reason; this
     round's reviewer corrects it.)
8. **testQuick digest:** a constant `Tests.Argument` changes the digest once (on adoption) and is then stable;
   Decision 4 is correct. Moot if `-oI` is dropped per CR1 below.

### Verdict: REFUTE

One item, a repeat of round 2's CR2 (suite naming): the chosen remedy (`-oI`) is provably inert under forked tests.

### Change Requests

1. **(Repeat of round-2 CR2.) Drop Decision 3a's `-oI` and reword the suite-naming promise to what is achievable.**
   Remove `-oI` from Decision 3a and task 2.2 (it adds a digest change and per-event reminder buffering for no output,
   `Framework.scala:462,608-614,784-794`; `ForkTestMain.java:386-391`). Reword the spec requirement and the
   "Lost forked-test events" scenario to, e.g., "the guard's output reports the ScalaTest failed/aborted counts, and
   each failed test appears with its suite in ScalaTest's per-test output in the same log". Make the guard's thrown
   message point there (e.g. "see `*** FAILED ***` lines above"). Update task 3.1's fixture list (drop "with -oI
   reminder"; capture a real N-failed summary) and task 3.2 to check the per-test `*** FAILED ***` line naming the
   scratch suite in the same output. If the planner instead wants suite names in the guard message, it must name a
   mechanism that works in the sbt JVM under fork (the Skeleton only counts) and cite the source for it -- not
   another reporter flag.

### Non-blocking notes

- Task 3.5: "first-started" group is not controllable with two groups at concurrency 2; record per run which group's
  fork started last (debug log / fork start line), or put the sleep in the failing suite so that, whichever started
  first, the un-joined-thread case is exercised in roughly half the runs, and report how many runs actually hit it.
- Decision 1 logs the guard line "whenever a ScalaTest summary is present" -- also on green runs; fine, but keep it
  to one line so it does not drown testFull output.
