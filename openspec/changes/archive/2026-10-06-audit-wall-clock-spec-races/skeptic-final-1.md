## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `1ac52d52c82277177f27d93dca2c7a7284f1b4c9`. Base resolved live via `resolve-review-base.sh`:
`469f4ea9377729f90d32e640a22b61be3c487439`. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/audit-wall-clock-spec-races/HEL-1341`.
No UI surface (backend test-only), so step 4 does not apply.

### What I verified (with evidence)

**Scope.** I ran `git diff --stat 469f4ea93...HEAD`. The diff contains 8 spec files, 1 new helper
(`backend/src/test/scala/com/helio/testsupport/AcceptRecordingListener.scala`) and change artifacts only. It touches no
`src/main`, `ci.yml`, `playwright.config.ts` or `.gitignore`. C3 and C4 hold.

**AC1, inventory completeness against the live tree.** I grepped `backend/src/test` myself at base and at head:
- `Thread.sleep|pg_sleep|TimeUnit.*.sleep|LockSupport.park`: there are 20 sleep sites at base. Every one maps to a
  design.md row (1-21). At head the remaining ones are exactly the "Leave" rows.
- `eventually`: every bare `eventually` sits in AuthoringTelemetrySpec or AssistantTelemetrySpec, and both classes
  override `patienceConfig` to 2 s. The only one on the 150 ms default was OutputRoutesSpec:756 (row 8a).
- Awaits: `Await.result/ready` with timeouts of 2 s or less occur only at AssertStepSpec:119/140 (row 20) and at the
  negative Awaits in PipelineRunCrossInstanceSpec:79 and SseReconnectGapProbeSpec:144 (row 11). The other awaits use
  5, 10, 15, 20, 30 or 60 s.
- Timing assertions: `elapsed ... should be >=/<` remains only in DatabaseConnectionTimeoutSpec (row 18).
- Route-test timeout: the testkit's 1 s `RouteTestTimeout` default is already replaced repo-wide by
  `HelioRouteTest.HarnessTimeout = 15.seconds` (HEL-1228), so it is not an open window.
- Two sites are not listed, and neither is a race: `PipelineShapeServiceSpec` `whenReady` uses the default 150 ms
  patience, but `PipelineShapeService.expand` returns `Future.successful`, so there is no window. `SparkJobSubmitterSpec:345`
  is a 30 s `eventually` state wait (row 12-15 class). See the non-blocking notes.
- Conclusion: AC1 is met.

**AC2, each fix removes the race rather than hiding it.** I read each hunk in full.
- Row 1 (D1):
  - Production: `AutoRunTriggerService.triggerAutoRun` takes `now` and stores `now.plusSeconds(debounceSeconds)`
    (AutoRunTriggerService.scala:88). `PipelineSchedulerService.processAutoRunDebounce(now)` calls `claimDue(now)` with
    the injected clock (:113-116).
  - So the FakeClock case drives the real production boundary: 999 ms gives 0 runs and 1000 ms gives 1, and no wall
    clock is involved.
  - The real-SystemClock case still asserts `runCount shouldBe 1` unconditionally. Only the racy `>= 1000` lower bound
    is removed, and only the println is gated behind `HELIO_MEASURE=1`.
  - Not a weakening. The property "debounce is honoured" moved to a deterministic case that is strictly tighter: a 1 ms
    margin, against the old effective ~450-550 ms.
- Row 2 (D2):
  - There is no head start and no hold left. The test owns the lock and releases it only after tx2 is seen as an
    ungranted advisory waiter on the exact key.
  - The tolerance went from -50 ms to 0, so the test is stricter.
  - Both timestamps come from the same server's `clock_timestamp()`, and tx2 reads its timestamp after acquiring the
    lock, which happens after tx1's commit.
- Rows 3-6 (D3/D4):
  - `SqlConnectorDriver.connect` (SqlConnectorDriver.scala:147-165) and `EgressValidatingSocket.connect` are
    synchronous (`DriverManager.getConnection` / `super.connect`). Any stray connection therefore finishes its TCP
    handshake before the call returns, and it sits ahead of the sentinel in the single acceptor's FIFO backlog.
  - So the sentinel barrier is sound, and it turns a vacuous `accepts == 0` after a fixed sleep into a failable check.
- Row 7 (D5):
  - The barrier waits on `pg_stat_activity` showing a `Lock` wait for the `connector_credentials` delete. The embedded
    Postgres is per spec (ConnectorRepositorySpec.scala:62), so no other suite's backends can match the query.
  - The 1500 ms poll is unchanged (:489). The residual vacuity is disclosed in D5.
- Row 8 (D6), the marker assertion:
  - `PipelineRunNotifyBus` drains `getNotifications` on ONE listener thread and hands each notification, in order, to
    `registry.broadcastLocal`. Postgres delivers NOTIFYs in commit order.
  - B publishes the marker only after its witness received A's `queued`. So an unguarded echo of `queued` must reach
    A's subscriber before the marker does.
  - The assertion `List("queued", "running")` is therefore strictly stronger than the old `List("queued")`-after-500 ms.
    The old form could pass on a late echo; this one cannot. `running` is non-terminal, and the wait checks for the
    marker's content through a `ConcurrentLinkedQueue`. Not a weakening.
- Row 8a (D9):
  - The old wait was ScalaTest's default 150 ms patience. It is now a named 5 s give-up state wait.
  - This does lengthen a deadline, so I checked the authority for it. `/home/matt/Development/helio/.concertino/runs/HEL-1341/events.jsonl`
    has `escalation.raised` followed by `escalation.answered` with `"answer":"A","answer_source":"human","resolution_channel":"chat"`.
    The ruling is a human one, not one relayed by an agent.

**Proofs re-run by me.** All edits were temporary and reverted with `git checkout --` by exact path. Afterwards
`git status --short` showed only the evaluator's untracked `evaluation-1.md`, `git diff HEAD --stat` was empty, and HEAD
was unchanged at 1ac52d52c. I deliberately chose the rows the evaluator did NOT re-run.

- **Run X: NEW specs + mutations** (log `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/skX-new-mutations.log`):
  - Row 4 M (`EgressValidatingSocket` refusal branch does `super.connect` first): red,
    `List(43752, 43764) was not equal to List(43764) (SqlEgressSocketFactoriesSpec.scala:31)`.
  - Rows 5 and 6 M (`SqlConnectorDriver.connect` opens a loopback socket to `config.port` first): all three targets red.
    - `List(35884, 35896, 35898) ... (SqlConnectorRebindingSpec.scala:50)`
    - `List(46700, 46710, 46726) ... (SqlConnectorRebindingSpec.scala:85)`
    - `List(60832, 60842) ... (SqlConnectorConfigShapeSpec.scala:64)`
  - Row 2 T (tx1 locks `key + 1`): red, `tx2 never appeared as an ungranted advisory waiter ... (PipelineCycleDetectionServiceSpec.scala:517)`.
  - Row 3 NEW with a 400 ms acceptor delay injected into the helper: "connect when the address is allowed" green.
- **Run Y: OLD specs restored from 469f4ea93 + delay probes** (log `.../scratchpad/skY-old-probes.log`): all three red.
  - Row 1 (600 ms delay before `triggerAutoRun` returns): `461 was not greater than or equal to 1000 (DatasetWriteAutoRunEndToEndSpec.scala:279)`.
  - Row 2 (300 ms delay before tx1 starts): `1791355130293 was not greater than or equal to 1791355131197 (PipelineCycleDetectionServiceSpec.scala:502)`.
  - Row 3 (400 ms acceptor delay): `0 was not equal to 1 (SqlEgressSocketFactoriesSpec.scala:69)`.
- **Run Z: NEW specs + the same row 1 and row 3 probes** (log `.../scratchpad/skZ-new-probes.log`): 16/16 green,
  including both the FakeClock case and the real-clock case.
- **Run W: clean HEAD, all 8 changed specs** (log `.../scratchpad/skW-clean-head.log`): 8 suites, 198 tests, 0 failed.
  Followed by `sbt --client shutdown`.

Combined with the evaluator's independent re-runs of rows 1 M, 6 M, 7 P/M, 8 P/M and 8a P/M, every D7 row now has a P
or M reproduced by someone other than the executor.

**Full suite.** I did not re-run it. The evaluator's pasted output is fresh and unambiguous: exit 0, 6085 tests,
0 failed, HEAD 1ac52d52c, and its log grep shows all 8 targets present. My targeted run W covers the changed specs.

**AC3 / D8 plan.** Deferred by design.
- I checked that the plan is workable: `ci.yml` triggers on `pull_request` to main with no path filters, so a draft PR
  whose only change is `HEL924_TEST_GROUP_CONCURRENCY: 3` (ci.yml:151) will run the backend legs.
- Serial full reruns with recorded SHAs, closing the PR and escalating the default decision are all sound, and the plan
  stays clear of HEL-1339's `ci.yml` edit.

**Evidence-integrity note.** None of my conclusions depend on mtime ordering. Every proof above rests on assertion
messages with cited line numbers.

### Verdict: CONFIRM

### Non-blocking notes
- The pure spin waits busy-burn a core, and this ticket is about contended runners.
  - Where: `AcceptRecordingListener.awaitCondition` (AcceptRecordingListener.scala:61-64) and the D6 loop
    (PipelineRunCrossInstanceSpec.scala:~159). The D2 and D5 loops also issue back-to-back queries with no interval.
  - Impact: on a 2-vCPU runner with 2-3 forks, a spinning thread competes with the thread it is waiting on. On the green
    path this is milliseconds. On the give-up path it burns a full core for 5-10 s.
  - Suggestion: use a short park/sleep interval (1-10 ms) instead. Repo precedent exists, so this is not a blocker.
- `assertNothingAcceptedBeforeSentinel()` asserts nothing, and its Scaladoc says "true iff". Rename it, e.g. `acceptedThroughSentinel()`.
- The test name "reports the observed elapsed time..." (DatasetWriteAutoRunEndToEndSpec) no longer describes what CI
  checks. Suggested: "fires a debounced auto-run on the real SystemClock".
- The inventory could list `PipelineShapeServiceSpec` `whenReady` (150 ms default patience on a `Future.successful`,
  so no window) and `SparkJobSubmitterSpec:345` (30 s state wait) for completeness.
- For D8, compare like with like: main-push runs and PR runs differ in compile-cache save behaviour (ci.yml:217).
  Prefer recent PR-event runs at 2 forks as the leg-time baseline, or record each run's cache-hit state.
