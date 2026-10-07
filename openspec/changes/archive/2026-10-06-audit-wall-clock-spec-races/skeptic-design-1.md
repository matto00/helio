## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 469f4ea9377729f90d32e640a22b61be3c487439 (planning artifacts untracked in the change dir).
All paths below are relative to `backend/src/test/scala/com/helio/` unless stated.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/audit-wall-clock-spec-races/HEL-1341`.
- **Sleep count:** `grep -rnE "Thread\.sleep|pg_sleep|\bsleep\("` over the test tree gives exactly the 20 sites in 15
  files that design.md claims. The count is correct.
- **Wall-clock reads:** `grep nanoTime|currentTimeMillis` finds 14 files. Six are not in the inventory:
  NodePayloadTrimPurgeLockOrderSpec, RetentionLockGuardSpec, OutputHistoryRetentionServiceSpec:89,
  ProductEventRollupServiceSpec:90, OutputHistoryCostMeasurementSpec:125/141, and HelioRouteTest (a comment only).
  The three timing ones only report through `info(...)`. The two lock specs use bounded state waits (10 s / 30 s).
- **Missed flake-capable site: `api/routes/pipelines/OutputRoutesSpec.scala:756`.** It calls `eventually { Get(.../rows) ... materialized shouldBe true; items should not be empty }`
  with ScalaTest's **default** patience: a 150 ms timeout and a 15 ms interval.
  - The class mixes in `Eventually` (line 60) and does not override `patienceConfig`. `grep patienceConfig|PatienceConfig`
    over the tree finds overrides only in AssistantTelemetrySpec and AuthoringTelemetrySpec.
  - `HelioRouteTest` sets only `routeTestTimeout`.
  - `build.sbt` has no `-F` or spanScaleFactor setting.
  - The work inside the window is the fire-and-forget `PipelineRunService.backfillOutputNode`, a DB read plus a
    snapshot materialization. Every poll is also an HTTP route plus DB round trip. This is the HEL-1323 shape, a
    short real-time window against DB work, at 3x the size. The site is **F**.
  - Row 9 inventories the sibling negative case at :780 but not this one.
- **Row 1 mechanism is correct.** `AutoRunTriggerService.scala:88` upserts `fire_at = now.plusSeconds(debounceSeconds)`,
  where `now` is the caller's `lastWriteAt`. `startNanos` is taken after `await(triggerAutoRun(...))` (spec :272-275). So
  elapsed is about 1000 ms minus the trigger time plus one poll, and any trigger slower than the poll slack fails
  `>= 1000L`. F is right.
- **D1's fake clock works.** `PipelineSchedulerService.tick()` reads `clock.now()` (:74). `claimDue(now, ...)` compares
  `fire_at <= $nowTs` against that injected value (PipelineAutoRunDebounceRepository.scala:50-58), not SQL `now()`.
  So ticks at t0+999 ms and t0+1000 ms do pin the boundary.
- **Row 2 is F, as claimed.** If tx1 is slow to start, tx2 takes the free lock first. tx1 then acquires after it and
  holds for 0.8 s, so `tx1ReleasedAt` exceeds `tx2AcquiredAt` and the assertion fails.
  The test calls `pg_advisory_xact_lock($key)` directly with `PipelineCycleValidator.AdvisoryLockKey`
  (PipelineCycleDetectionServiceSpec.scala:476-481). It never runs `PipelineCycleGuard.lockAction`.
- **Rows 3-6:** read SqlEgressSocketFactoriesSpec:16-70, SqlConnectorRebindingSpec:34-96 and
  SqlConnectorConfigShapeSpec:52-68. Each has a single daemon acceptor that runs `server.accept().close();
  accepts.incrementAndGet()`. The classifications are right.
- **Row 7 / D5:** ConnectorRepositorySpec:435-470. A holder row-lock plus a 1500 ms "still pending" poll. V is right.
- **Row 8 / D6 is sound.**
  - `PipelineRunNotifyBus` keeps one LISTEN connection with one daemon receive thread (:114, :219-226).
    `handleNotification` drops only events that carry its own `originInstanceId` (:204-208).
  - `PipelineRunRegistry` forwards foreign events through `broadcastLocal`, which runs `ref ! event` (:90, :130-136).
    That is a sequential tell from the one listener thread, so per-subscriber order is kept.
  - `notifyRemote` sends `pg_notify` on a pooled connection. Postgres delivers notifications from different
    transactions in commit order. A's "queued" NOTIFY committed before B received it, and B's marker is sent after,
    so an unguarded echo always reaches A first.
  - The existing "reaches a subscriber on instance B" test already proves foreign events cross from A to B.
  - The marker must be a non-terminal status (see notes).
- **D8 is feasible.**
  - `ci.yml` triggers on push to main and on pull_request to main. There is no `workflow_dispatch`, and no job-level
    `if:` excludes draft PRs.
  - The concurrency group is keyed on the PR number with cancel-in-progress for PRs, so serial reruns on one draft PR
    do not cancel each other.
  - `HEL924_TEST_GROUP_CONCURRENCY: 2` is at ci.yml:151, and build.sbt:171-173 reads it.
  - The plan makes no default change and no ci.yml edit in the PR, and pushes nothing to main, so it does not collide
    with HEL-1339.
- **Rows 9-18 left alone:** checked rows 10 (AssistantTelemetrySpec:318-323, structural justification in code),
  11, 12-15 (state waits with 2-30 s deadlines), 16-17 (forced deltas) and 18. Leaving them is justified, apart from
  the OutputRoutesSpec:756 gap above.
- **Precedent for D2:** `infrastructure/persistence/NodePayloadTrimPurgeLockOrderSpec.scala:143-165` holds a lock on
  a test-owned raw JDBC connection and waits for `pg_locks WHERE NOT granted`. That is a release controlled by the test
  rather than by time.

### Verdict: REFUTE

### Change Requests

1. **Inventory is incomplete. Add `OutputRoutesSpec:756` as an F row and decide its action.**
   - The site is `eventually` with the 150 ms / 15 ms default patience (evidence above), wrapped around a
     fire-and-forget backfill.
   - `PipelineRunService` is `final` and `backfillOutputNode` exposes no completion handle, so there is no test-side
     barrier. Any fix has to replace the implicit 150 ms deadline.
   - That conflicts with C1 ("never lengthen a window") unless the design argues explicitly that an unconsidered
     library-default `eventually` timeout is a state-wait deadline in the row 12-15 sense. The design already uses
     that reasoning for rows 12-15.
   - Either record that argument and fix the site with an explicit state-wait deadline in line with rows 12-15, or
     raise the C1 conflict as an escalation. Do not leave it uninventoried.
   - Also add one-line rows for the other uninventoried real-time sites so the inventory meets AC 1:
     - Positive bounded Awaits (F only past the deadline): NodePayloadTrimPurgeLockOrderSpec:239 (5 s),
       RetentionLockGuardSpec:264 (10 s), CsvUploadLimitsRoutesSpec:268 (5 s), AssertStepSpec:119/:140 (1 s,
       in-memory).
     - Report-only timings: OutputHistoryRetentionServiceSpec:89, ProductEventRollupServiceSpec:90,
       OutputHistoryCostMeasurementSpec:125/:141.
   - Update the fix count and the proposal's "three F sites" accordingly.

2. **D4's sentinel barrier is unsound as written.**
   - "Wait until `accepts >= 1`, then assert `accepts == 1`" exits on the **stray** connection's increment whenever
     one exists. The stray is queued first, which is the FIFO argument D4 itself relies on. So the barrier passes
     before the sentinel is counted.
   - Under the D7 production mutation ("the refused socket actually connects") the new form stays green. It is still
     vacuous.
   - Revise D4 so the barrier waits for the sentinel specifically. For example, the acceptor appends each accepted
     socket's remote port to a concurrent queue. Wait (bounded) until the sentinel's local port appears, then assert
     the accepted list equals exactly `[sentinelPort]`. Any stray precedes the sentinel in FIFO order, so it would
     already be in the list.
   - Apply the same shape to all three files (rows 4-6).

3. **D2 turns the 0.8 s `pg_sleep` hold into a new race window and can pass vacuously.**
   - The `pg_locks` held-wait, tx2's start and any waiter check all have to happen inside tx1's fixed 0.8 s hold.
   - If they overrun it, the held-poll either never sees the lock (a loud failure, so a new flake) or tx2 starts after
     tx1 committed. In that second case `tx2AcquiredAt >= tx1ReleasedAt - 50` passes without proving any blocking,
     which is vacuous.
   - Revise D2 to make three things mandatory:
     - (a) tx1's hold is released by the test, not by time. Hold the xact lock on a test-owned raw JDBC connection
       and commit it after the barrier, mirroring NodePayloadTrimPurgeLockOrderSpec.startRetention/awaitBlocked.
     - (b) Wait for tx2 to show as an **ungranted** waiter on the key. This is currently "optional"; make it required.
     - (c) Only then release, and assert.
   - Also state the exact `pg_locks` match. A bigint advisory key appears as `classid` = high 32 bits,
     `objid` = low 32 bits and `objsubid = 1`, so `objid` alone is insufficient. Alternatively, use the precedent's
     `NOT granted` count.
   - Correct the sentence "The 0.8 s pg_sleep hold is not a race window" to match.

4. **D7(b)'s per-fix production mutation is not failable for every row as listed. Add a per-row probe/mutation
   table.**
   - Row 2's spec never executes production code. It calls `pg_advisory_xact_lock` directly with the constant, so
     "lock action -> `DBIO.successful(())`" cannot turn it red.
   - Row 3's positive-accept case is not turned red by "the refused socket actually connects" either.
   - For each row 1-8, name the probe (OLD red / NEW green) and the mutation (NEW red).
   - Where no production mutation can reach the spec, name an honest substitute, labelled as test-side. For row 2,
     tx2 locks a different key, or the test releases tx1 before tx2 is seen waiting, and the new form must go red.
     Tasks 3.1/3.2 should reference this table.

5. **D1 is ambiguous about what moves behind `HELIO_MEASURE=1`.**
   - The design says "the real-clock latency `println` is kept but runs only with `HELIO_MEASURE=1`". Task 1.1 says
     "real-clock println only under HELIO_MEASURE=1".
   - An implementer could gate the whole real-SystemClock case. That would remove the only CI coverage that the
     production `SystemClock` wiring actually fires a debounced auto-run end to end.
   - State explicitly that only the elapsed measurement is gated. The `>= 1000L` assertion is removed and the
     `println` is gated. The real-clock `pollUntil(scheduler, 10.seconds)(runCount >= 1)` followed by
     `runCount shouldBe 1` stays unconditional; it is a row-14-class state wait, not a race.
   - The new FakeClock boundary case is added alongside it, so the change is genuinely "equal or stronger" per
     backend-ci-test-execution.

### Non-blocking notes

- D1: truncate t0 to microseconds, or use a whole-second fixed instant. Postgres stores `fire_at` at microsecond
  precision, and an Instant with nanosecond precision makes the 999 ms / 1000 ms boundary harder to reason about.
- D3: name the bounded-poll deadline in tasks.md, as a state wait in the row 12-15 sense.
- D5 narrows the vacuity but does not remove it. A regressed fire-and-forget rotation that completes more than
  1500 ms after the blocked-state barrier still passes. Say so in the design rather than implying it is closed.
- D6: the marker B publishes must be non-terminal. A terminal status completes A's stream and removes the subscriber
  set, which is harmless but confusing. Wait on A's capture by content, not by size.
- D8: use a full `gh run rerun <id>`, not `--failed`, so every run measures all four legs. Record each run's head SHA
  to show all runs used the same commit.
