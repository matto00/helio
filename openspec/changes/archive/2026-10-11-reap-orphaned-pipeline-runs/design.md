## Context

See proposal.md (Why) and specs/pipeline-run-reaper. The owner's rulings were made on 2026-10-11 local (HEL-1511
escalation, A on Q1-Q6). Facts from main at 2e02b7951 shape the approach:

- `PipelineRunExecutor.executeRun` inserts a real run as `queued`
  (`insertRunIfUnderConcurrencyCap`/`insertGranteeRunIfUnderOwnerCap`, via `insertRunRowAction`). The row stays
  `queued` until a terminal write: `running` is only an SSE event.
- `PipelineSchedulerActor` arms the next tick only after `tick()` completes. `tick()` awaits a scheduled run's whole
  `submit()`, so any liveness driven by the tick stalls for the length of a long scheduled run.
- There is no run-level timeout. `SparkJobSubmitter.submit` (dormant, no caller) inserts and terminates its own rows.
- `PipelineRunRegistry.publish` fans out across instances (local, then pg NOTIFY, HEL-1168).
- The success chain (`PipelineRunSucceededWrites.onUnblockedRunSuccess`) writes node snapshots and history BEFORE
  `updateRun`. `updateMeta` and `updateRun` are built eagerly near :230.

## Goals / Non-Goals

Goals: the spec requirements, plus HEL-1511 items 2 and 4. Non-goals: those in the proposal, plus making the
stalled-instance window zero (see Risks).

## Decisions

**D1. Heartbeat (Q1 A).**
- V126 (re-check the number before committing) adds `heartbeat_at TIMESTAMPTZ NULL` to `pipeline_runs`. There is
  no backfill.
- `insertRunRowAction` sets `heartbeat_at = started_at`, so every row admitted by new code is never "legacy".
- A `LiveRunTracker` (a concurrent set of run ids) has `register(runId)` and `deregister(runId)`. It is
  INJECTED, not a global: `PipelineRunService` owns one (a constructor parameter with a default of a new instance,
  so existing construction sites compile) and passes it to `PipelineRunExecutor`. Main hands the same instance
  (`apiRoutes.pipelineRunService.liveRunTracker`) to the heartbeat actor.
  - `executeRun` registers on the `Inserted` arm.
  - It deregisters in a `transformWith`/`andThen` that wraps the whole run future (engine, then terminal chain).
    Every exit path deregisters: success, failure, blocked, write-back failure, and a thrown exception.
  - `SparkJobSubmitter.submit` (dormant) registers and deregisters the same way.
- `PipelineRunRepository.stampHeartbeatsInternal(ids, now)` runs one statement, under `ctx.withSystemContext`, and
  returns the count: `UPDATE pipeline_runs SET heartbeat_at = now WHERE id = ANY(ids) AND completed_at IS NULL`. It
  MUST be system context. On the RLS user pool it would match 0 rows in prod (no request-bound user), and every
  live run would be reaped after 10 minutes. Dev and CI run as superuser and cannot catch this, so the evaluator
  verifies it by reading the code. An empty set means no query.
- `RunHeartbeatService.stampOnce(now)` reads the tracker and calls it.
- A new `RunHeartbeatActor` (shaped like `PipelineSchedulerActor`, a self-arming timer, 30 s) calls `stampOnce`
  with `SystemClock`. It is spawned in `Main` and is independent of the scheduler actor. Tests call `stampOnce`
  directly.
- `executeRun`'s `startAt` stays `Instant.now()`, unchanged: moving it to the guard clock would perturb existing
  specs that pin a fixed fake clock (started_at ordering, keep-N pruning). Reaper specs therefore start their fake
  clock at real `Instant.now()` (truncated to millis), never at a fixed past `t0`, so `started_at`, `heartbeat_at`
  and the reaper's `now` share one timeline (design-gate R1).
- Rejected alternatives:
  - A fixed age from `started_at` (Q1 B) would reap long Spark runs.
  - Stamping from the tick would stall during the tick's own awaited scheduled run (see Context).
  - An instance-liveness table: no instance identity exists today, so it would be more machinery than this needs.

**D2. Reap statement (Q2 A, Q4 A, Q5 A).** `PipelineRunRepository.reapStaleRunsInternal(now, staleAfter,
legacyAfter): Future[Vector[ReapedRun]]` runs under system context, as one statement with a CTE:
- `reaped AS (UPDATE pipeline_runs SET status='failed', completed_at=now, error_log=<reason>,
  truncated_reads='[]' WHERE completed_at IS NULL AND status <> 'dry_run' AND ((heartbeat_at IS NOT NULL AND
  heartbeat_at < now - staleAfter) OR (heartbeat_at IS NULL AND started_at < now - legacyAfter))
  RETURNING id, pipeline_id, started_at)`;
- then `UPDATE pipelines SET last_run_status='failed', last_run_at=now` for each reaped run that has no newer non-dry
  run on its pipeline;
- then a `SELECT` that joins pipelines for `owner_id`.

The reason string is `Run abandoned: no heartbeat for <N> s (the server running it likely stopped)` for a row with a
heartbeat. A legacy row with none gets `Run abandoned: no heartbeat recorded and started over 1 h ago (the server running it
likely stopped)`, via a CASE in the SET clause.
`truncated_reads` is `[]`, the HEL-873 failed-run convention. PG READ COMMITTED re-evaluates the `WHERE` clause after
waiting on a concurrently updated row. So a heartbeat that commits first leaves the row out of the update, and a
second reaper finds `completed_at` already set. This is why the statement needs no advisory lock (Q4 A, not C).

`legacyAfter` is a 1 h constant. `staleAfter` comes from `PipelineRunGuardConfig.staleRunAfterSeconds`, read from
env `PIPELINE_RUN_STALE_AFTER_SECONDS`, default 600. A non-numeric value, or one below 90 (3 × 30 s), falls back with
a WARN, following the fromEnv convention.

**D3. Where (Q4 A).** `PipelineSchedulerService.tick()` first runs the reap, recovered so it never fails the tick.
Only after that does it start the existing candidates, cleanup, auto-run and telemetry work. A pipeline reaped on
this tick therefore fires its due schedule or pending auto-run on the same tick. For each `ReapedRun` the tick:
- logs WARN (pipeline, run, owner, age = now - started_at);
- calls `registry.publish(pid, RunStatusEvent("failed", errorLog = reason, runId))`.

The registry is a new nullable-optional constructor parameter (null means skip), wired in Main from the run
service's registry.

**D4. First terminal write wins (Q6 A).**
- `updateRunTerminalInternal` and `updateRunTerminal` add `completedAt.isEmpty` to their filter and return
  `Future[Boolean]` (true when a row was updated). `writeTerminal` propagates the Boolean.
- `PipelineRunRepository.isRunOpenInternal(runId)` (`completed_at IS NULL`, system context) is checked in
  `PipelineRunExecutor.onRunSuccess` for a real, unblocked run, BEFORE `applyPendingWriteBacks` (design-gate R3).
  If the run is no longer open, the whole success chain is skipped: write-backs (dataset upserts and their
  auto-run triggers), node snapshots, history and payload history, binary refs, `baselineUpsert`, alert
  evaluation, assertion inserts, `last_run_*` and the terminal update. The executor logs WARN, publishes nothing
  (the reaper already published `failed`) and returns `Left(ServiceError.Conflict(...))`, or the closest existing
  case.
- The blocked path, the failure path (`executeRunFailure`) and the write-back-failure path do their terminal update
  first. When it returns false, they skip `writeLastRun` and the assertion inserts and log WARN. Their terminal
  event may still publish a duplicate `failed`, which is harmless; that is noted, not fixed.
- In the success chain, `updateMeta` is sequenced after the open-check, so a reaped run never writes `last_run_*`.
- The dry-run path is unaffected, because it inserts a terminal row.

**D5. Item 2 tests.**
- (i) Retry-After floor: a guard-rejected fire with `retryAfterSeconds = 0` re-arms with
  `fire_at == now + 1 s` exactly, and a second `tick()` at the same `now` does not re-claim. Use a test seam on the
  guard, or `PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS = 0` on the cap pre-flight path. Mutating `max(1L, ...)` to
  the raw value must turn it red.
- (ii) Several writes (three) during one in-flight run: no run fires while the first is in flight (ticks during it),
  then exactly one auto-run fires after it completes.
- (iii) Case (d)'s last assertion becomes a fresh write that lands while a row is still re-armed at count >= 1, and
  asserts the count resets to 0. Removing the reset from `upsertDebounce`'s `ON CONFLICT` must turn it red.

**D6. Item 4 wording.** The `RearmOutcome.Superseded` DEBUG line becomes "claim token no longer matches (a fresh
write re-armed the row, or another instance took over a stale claim)". Update the `Superseded` scaladoc to match.

## Risks / Trade-offs

- [An instance stalls for longer than the bound mid-run (GC, CPU starvation) and its run is reaped while still
  executing] → D4 keeps the data consistent. The 600 s default is about 20 missed stamps.
- [The reap lands between D4's open-check and the snapshot writes] → the open-check runs immediately before the
  writes, and the run is still being stamped, so this needs a stall of more than 600 s inside that window. This is
  accepted and documented.
- [A rolling deploy while an old-revision instance runs a run with `heartbeat_at` NULL] → the 1 h legacy bound
  (Q5 A). A run on the old revision that is longer than 1 h could be reaped. That is accepted, because a deploy
  drains old instances.
- [HEL-1503 also edits `PipelineRunExecutor` and the admission inserts] → re-sync origin/main before the PR, and
  resolve by intent.

- [Clock skew between instances: one instance's `now` judges another's stamps] → the stale bound (600 s) is
  orders of magnitude above normal Cloud Run NTP skew; the bound floor of 90 s keeps a misconfiguration safe-ish.
- [Two reapers lock overlapping rows in different orders and deadlock] → PG aborts one; the tick's `recover`
  logs it and the next tick retries. Not worth ordering by id.
- [A long scheduled run on an instance delays that instance's next tick, and so its reaps] → other instances still
  tick; on a single instance, reaping resumes after the run (the Q4 ruling accepts tick placement).

## Migration Plan

- V126 is additive (nullable column, no default rewrite). Rollback is safe because old code ignores the column.
- First deploy: stuck legacy rows older than 1 h are reaped on the first tick, as the owner approved. The PR body
  carries a read-only prod count query:
  `SELECT count(*) FROM pipeline_runs WHERE completed_at IS NULL AND status <> 'dry_run' AND started_at < now() - interval '1 hour';`

## Planner Notes

- Self-approved: the heartbeat interval is a fixed 30 s, not an env var. The legacy bound is a 1 h constant. The
  stale-bound floor is 90 s. The late finisher returns the closest existing `ServiceError` case. Q3 A's "terminal
  failed event" reuses `RunStatusEvent("failed")`.
- Red-first (design-gate R5): the orphan repro drives only `tick()` and the `Clock`. Orphans are inserted with
  raw SQL that does NOT name `heartbeat_at` (naming it errors on main, and `insertRunInternal` would silently start
  stamping it after D1). Case (c)'s orphan sits on a DIFFERENT pipeline of the same owner, and fills the cap
  together with the other in-flight rows. Every new config/constructor parameter has a default, so the unchanged
  spec compiles before and after. The recorded red run must show assertion failures, not exceptions.
- Lock-wait proof (design-gate R2), for heartbeat-vs-reap and reap-vs-reap:
  1. Connection B begins, applies its UPDATE to the row, and does not commit.
  2. The reap starts as a Future.
  3. The test polls `pg_stat_activity` (wait_event_type = 'Lock' for the reaper's pid/query) until the reap is
     blocked, a bounded poll with no sleeps-as-timing.
  4. B commits.
  5. Assert the reap returns 0 rows. Mutation: a SELECT-then-UPDATE-by-id reap (no predicate re-check) turns it red.
