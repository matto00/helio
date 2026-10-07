## Context

See proposal.md for the motivation. Live tree at 469f4ea93: 20 `Thread.sleep`/`pg_sleep` sites in 15 spec files,
plus a few non-sleep real-time windows. HEL-1287's count of 23 is stale because HEL-1325 removed
SparkJobSubmitterSpec's sleeps. Paths below are relative to `backend/src/test/scala/com/helio/`.

## Inventory

Contention effect: **F** means the spec fails when the window is overrun (flake). **V** means it passes without
proving anything (vacuous, never a flake). **-** means no effect, because the window only orders events or forces
asynchrony.

| # | Site | Window | Work inside the window | Effect | Action |
|---|------|--------|------------------------|--------|--------|
| 1 | services/pipelines/DatasetWriteAutoRunEndToEndSpec:279 | elapsed >= 1000 ms | Clock starts AFTER triggerAutoRun's DB round trip, but fire_at = lastWriteAt + 1 s, so elapsed ~= 1 s - trigger time (observed 544 ms) | F | Fix (D1) |
| 2 | services/pipelines/PipelineCycleDetectionServiceSpec:489 | 150 ms head start | tx1 must acquire the advisory lock before tx2 starts; a slow tx1 lets tx2 win and the >= assertion fails | F | Fix (D2) |
| 3 | domain/connectors/SqlEgressSocketFactoriesSpec:68 | 200 ms | Acceptor thread must accept() and increment before `accepts shouldBe 1` | F | Fix (D3) |
| 4 | domain/connectors/SqlEgressSocketFactoriesSpec:41 | 200 ms | `accepts shouldBe 0` after a refused connect | V | Fix (D4) |
| 5 | domain/connectors/SqlConnectorRebindingSpec:60, :94 | 300 ms x2 | `accepts shouldBe 0` after a refused mysql connect | V | Fix (D4) |
| 6 | domain/connectors/SqlConnectorConfigShapeSpec:66 | 300 ms | `accepts shouldBe 0` after a dialect refusal | V | Fix (D4) |
| 7 | infrastructure/persistence/sources/ConnectorRepositorySpec:458 | 1500 ms poll | "rotation stays pending" while the delete is locked; a slow regressed rotation passes | V | Fix (D5) |
| 8 | api/routes/pipelines/PipelineRunCrossInstanceSpec:151 | 500 ms | A late self-echo would land after the assertion | V | Fix (D6) |
| 8a | api/routes/pipelines/OutputRoutesSpec:756 | ScalaTest default `eventually` patience: 150 ms timeout, 15 ms poll (no override in class, HelioRouteTest or build.sbt) | Fire-and-forget `backfillOutputNode` (DB read + snapshot materialization) plus an HTTP+DB round trip per poll; the HEL-1323 shape | F | Fix (D9, ruling A) |
| 9 | api/routes/pipelines/OutputRoutesSpec:780 | 200 ms | A fire-and-forget backfill "finds nothing"; no observable completion | V | Leave: needs a prod completion hook; follow-up in PR body (driver files it) |
| 10 | services/assistant/AssistantTelemetrySpec:323 | 200 ms | Negative; the path structurally schedules no Future (justified in-code) | V (theory only) | Leave |
| 11 | api/routes/pipelines/PipelineRunCrossInstanceSpec:73; api/routes/pipelines/SseReconnectGapProbeSpec:144 | 2 s / 1 s expected timeout | Negative Await | V | Leave (out of the sleep class; noted) |
| 12 | api/ApiTokenAuthSpec:391 | 5 s state-wait deadline, 50 ms poll | Fire-and-forget last_used_at write | F only past 5 s | Leave (already a state wait) |
| 13 | api/AuditMutationInstrumentationSpec:240; api/routes/auth/GoogleOAuthRoutesSpec:147 | 2 s deadline, 25 ms poll | Fire-and-forget audit insert | F only past 2 s | Leave; low risk, noted |
| 14 | DatasetWriteAutoRunEndToEndSpec:155, :181 | 5 s / 10 s deadlines | Scheduler tick / debounce upsert | F only past the deadline | Leave |
| 15 | PipelineRunRegistrySpec:136; AuthoringTelemetrySpec:68; AssistantTelemetrySpec:59 | 2 s eventually/patience | Async log/event delivery | F only past 2 s | Leave; low risk, noted |
| 16 | ProvenanceServiceSpec:190; AssistantConversationServiceSpec:88, :189 | 5 / 5 / 2 ms | Forces a timestamp delta; contention only lengthens it | - | Leave |
| 17 | api/http/TraceContextDirectiveSpec:151 | 20 ms in a Future | Forces async completion on a foreign EC | - | Leave |
| 18 | infrastructure/persistence/DatabaseConnectionTimeoutSpec:80-81 | 3 s <= elapsed < 15 s | Real 5 s Hikari connect timeout; 10 s of headroom | F only past 15 s | Leave; not a test race |
| 19 | infrastructure/persistence/NodePayloadTrimPurgeLockOrderSpec:239; infrastructure/persistence/RetentionLockGuardSpec:264; api/routes/sources/CsvUploadLimitsRoutesSpec:268 | 5 s / 10 s / 5 s bounded Await or state wait | Lock-ordered DB work / upload | F only past the deadline | Leave (state waits, row 12-15 class) |
| 20 | domain/steps/AssertStepSpec:119, :140 | 1 s Await | In-memory step evaluation, no I/O | F only past 1 s of pure CPU | Leave; low risk |
| 21 | OutputHistoryRetentionServiceSpec:89; ProductEventRollupServiceSpec:90; OutputHistoryCostMeasurementSpec:125, :141 | nanoTime timings | Reported via `info(...)`, never asserted | - | Leave |
| 22 | services/pipelines/PipelineShapeServiceSpec:29, :35, :45 (added by HEL-1357) | `whenReady` on ScalaTest default patience (150 ms) | `PipelineShapeService.expand` returns `Future.successful`, so the future is complete before `whenReady` polls | - | Leave |
| 23 | spark/SparkJobSubmitterSpec:345 (added by HEL-1357) | `eventually` 30 s timeout / 50 ms interval in `awaitRunPersisted`; also 30 s bounded `Await.result` (:165, :337) | Un-awaited terminal writes for the background Spark job | F only past 30 s | Leave (state wait, rows 12-15 class) |

Fix count: rows 1-8 are 9 sites in 7 spec files; with row 8a (`OutputRoutesSpec:756`, D9), 10 sites in 8 spec files, plus at most one shared D4 test helper. That is 8 spec files, below the ~10-spec escalation threshold. At 469f4ea93 the only `eventually` on the 150 ms default was row 8a; every other `eventually` set an explicit timeout or patience. (HEL-1357 correction, at 575a58b1f: no `eventually` remains on the default, and the only default-patience `whenReady`/ScalaFutures use is PipelineShapeServiceSpec, row 22, which never waits.) Rows 12-15 are state waits. A deadline
there bounds how long the spec waits for a state; it is not a race window. These rows are left as they are, because
lengthening a window is forbidden.

## Goals / Non-Goals

**Goals:** rows 1-8 and 8a fixed, with no window lengthened and every fix proven red-before/green-after (D7).
**Non-goals:** rows 9-21, production hooks; any default fork-count change; any `ci.yml` edit in this PR.

## Decisions

- **D1 Auto-run latency: fake clock instead of wall clock.** `PipelineSchedulerService` already takes a `Clock`, and
  the trigger computes `fire_at = writeAt + debounce`. Reuse `DatasetWriteAutoRunCoalescingSpec`'s `FakeClock`
  convention: with `debounceSeconds = 1` and a write at t0, a tick at t0 + 999 ms fires nothing (runCount 0), and a
  tick at t0 + 1000 ms fires exactly once. Use t0 truncated to a whole second, because `fire_at` is stored at
  microsecond precision. **Only the elapsed measurement moves behind `HELIO_MEASURE=1`:** the `>= 1000L` assertion is
  removed and the latency `println` is gated (report-only, like HEL-1344). The real-`SystemClock` case itself stays
  unconditional: `pollUntil(scheduler, 10.seconds)(runCount >= 1)` followed by `runCount shouldBe 1` is a row-14-class
  state wait, and it is CI's only end-to-end proof that the production clock wiring fires a debounced auto-run. The
  FakeClock boundary case is ADDED alongside it, so coverage is equal or stronger (backend-ci-test-execution). Rejected: moving `startNanos` before the trigger.
  That still asserts on wall time and only moves the race.
- **D2 Advisory lock: release controlled by the test, not by time.** Mirror
  `NodePayloadTrimPurgeLockOrderSpec.startRetention`/`awaitBlocked` (:143-165). (a) tx1 is a test-owned raw JDBC
  connection (`autoCommit=false`) that takes `pg_advisory_xact_lock(key)` and records `clock_timestamp()`, with no
  `pg_sleep`. (b) Start tx2 (`db.run(acquireHoldRelease(0.0).transactionally)`), then bounded-wait (10 s, state wait)
  until tx2 shows as an **ungranted** advisory waiter on the key. This step is mandatory. The match is
  `locktype = 'advisory' AND NOT granted AND classid = 0 AND objid = 72901101 AND objsubid = 1`. Derive it from
  `PipelineCycleValidator.AdvisoryLockKey` (72901101L, below 2^32) as `classid = (key >> 32)::oid` and
  `objid = (key & x'FFFFFFFF'::bigint)::oid`. A bare `x'FFFFFFFF'` is a `bit` value and errors. The `::oid` form
  assumes a non-negative key (a negative key raises `OID out of range`). Verified against live Postgres in round 2. (c) Only then record tx1's release timestamp and commit. tx2's acquisition must be
  `>=` it. There is no fixed hold and no head start left, so no time window remains.
- **D3 Positive accept: state wait.** Replace `sleep(200); accepts shouldBe 1` with a bounded poll until
  `accepts.get() == 1`, then assert `== 1`.
- **D4 Negative accept: sentinel-identified barrier.** The acceptor records each accepted socket's remote port in a
  concurrent queue, not just a counter. After the refused operation, the spec opens one sentinel connection and reads its
  `getLocalPort` after connect. It bounded-waits (5 s, state wait) until that port appears, then asserts the accepted list is
  exactly `[sentinelPort]`. A single acceptor takes connections from the kernel backlog in arrival order. Any stray
  connection was established before connect() returned, so it precedes the sentinel and would already be in the list.
  Waiting on `accepts >= 1` would exit on the stray and is rejected for that reason. One shared test helper may serve
  all three files.
- **D5 Credential rotation: blocked-state barrier.** Before the existing 1500 ms pending-poll, wait until
  `pg_stat_activity` shows a backend with `wait_event_type = 'Lock'` whose query is the `connector_credentials`
  delete. A row-lock wait appears in `pg_locks` as a transactionid/tuple lock, not a table lock. The give-up bound is
  a named constant, `RotationBlockedStateWaitDeadline = 10.seconds` (C6). That proves the window covers a genuinely
  blocked delete. The existing poll stays exactly as it is and is not lengthened. This narrows the vacuity but does not close it: a
  regressed fire-and-forget rotation that completes more than 1500 ms after the barrier would still pass.
- **D6 Self-echo: ordered marker barrier.** After the witness, B publishes a marker and the spec waits until A's
  local subscriber has received it. Postgres delivers NOTIFYs to a listening session in commit order. A's own
  `queued` committed before B's marker, so an unguarded echo of it would arrive first. The assertion becomes
  `List("queued", <marker>)`. The marker is a NON-terminal status, and the spec waits on A's capture by content,
  not by size, through a concurrent collection (e.g.
  `ConcurrentLinkedQueue`), because the stream thread appends to it. The executor must confirm that A's bus delivers B's foreign events on its single
  LISTEN connection before relying on this. If it does not, D6 falls back to "leave" and the reason is recorded.
- **D7 Proof per fix (probes are never committed; transcripts go to `evidence/` and are persisted).** P = a
  delay-injection probe that turns the OLD form red and leaves the NEW form green (F rows), or a vacuity probe that
  shows the OLD form passing under mutation plus a slow observer (V rows). M = a mutation that turns the NEW form red.
  T = a test-side substitute, used where the spec reaches no production code.

  | Row | P | M |
  |---|---|---|
  | 1 | 600 ms delay before `triggerAutoRun` returns: OLD `>= 1000` red, NEW green | Prod: `fire_at = now` (debounce ignored) -> t0+999 ms tick fires -> NEW red |
  | 2 | 300 ms delay before tx1 starts: OLD red (tx2 wins), NEW green | T: tx2 locks a different key -> waiter-wait times out -> NEW red; T: release tx1 before tx2 is seen waiting -> NEW red |
  | 3 | Acceptor delays 400 ms before counting: OLD red, NEW green | T: acceptor never started -> state wait times out -> NEW red |
  | 4-6 | Refusal bypassed plus slowed acceptor: OLD passes (vacuous) | Prod: refusal path actually connects -> list is `[stray, sentinel]` -> NEW red |
  | 7 | Delay (> 1500 ms) injected on the rotation future's own path before it issues its delete (NOT inside a fire-and-forget branch; the transcript must show OLD green), COMBINED with the not-awaited mutation: OLD passes (the 1500 ms poll ends during pre-delete work), NEW red (once the barrier sees the blocked delete, the un-awaited rotation has completed) | Prod: delete not awaited inside the rotation transaction (no delay) -> NEW red |
  | 8 | Echo guard removed plus delayed LISTEN delivery: OLD passes | Prod: `originInstanceId` check removed -> `[queued, queued, marker]` -> NEW red |
  | 8a | 300 ms delay in backfill: OLD red, NEW green | Prod: backfill disabled -> NEW red |
- **D8 3-fork trial (Part 2, after merge).** CI triggers only on push to main or on a PR to main, with no
  `workflow_dispatch`. Branch `trial/hel-1341-3fork` comes from the post-merge `origin/main`, with one commit that
  sets `HEL924_TEST_GROUP_CONCURRENCY: 3`. It is opened as a DRAFT PR titled `[TRIAL - DO NOT MERGE]`. CI runs at
  least 5 times serially (initial run, then a full `gh run rerun <id>`, never `--failed`, after each completes; record
  each run's head SHA). Record per run: backend legs
  pass/fail, failing suite names, leg durations. The baseline is the same legs at 2 forks from recent main runs.
  Afterwards: close the PR, delete the branch, post the numbers on HEL-1341, and escalate the default decision. HEL-1339
  edits `ci.yml`, so nothing is pushed to main.

- **D9 Row 8a (`OutputRoutesSpec:756`): explicit state wait. Ruled A on 2026-10-07 (escalation.answered: answer_source human, channel chat).**
  Replace the implicit ScalaTest-default `eventually` (150 ms) with an explicit poll of the `/rows` response until
  `materialized == true` and items are non-empty. The give-up bound is a named constant,
  `BackfillMaterializedStateWaitDeadline = 5.seconds` (the same class as `ApiTokenAuthSpec:391`). The test moves on the
  moment the state holds. This is a state wait the ticket allows, not a lengthened race window (C6). Proof (D7 row
  8a): a 300 ms backfill delay turns OLD red and leaves NEW green; a disabled backfill turns NEW red. Follow-up (PR
  body; the driver files it): `OutputRoutesSpec:780`'s 200 ms "nothing happened" check needs a production
  backfill-completion hook.

## Risks / Trade-offs

- [D4 FIFO assumption wrong] -> The D7 probe with a stray connection plus a slow acceptor demonstrates it either way.
- [D6 bus does not relay foreign events on A's connection] -> Fall back to "leave", record it, and note a follow-up.
- [Low-risk state waits (rows 12-15) still flake at 3 forks] -> The trial reports failing suite names, which feeds
  the owner's decision. They are not lengthened here.
- [Trial reruns cost CI minutes] -> Serial runs only, at least 5 and no more than 6.

## Planner Notes

- Self-approved: skip_specs (test-only change), a fix count of 8 spec files (10 sites) under the threshold, and the post-merge timing of
  the trial.
