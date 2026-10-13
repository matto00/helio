## Context

See proposal.md (Why). Current state, re-derived from main at f3490d1d8:

- `PipelineRunExecutor.onRunSuccess` (unblocked path) calls `isStillOpen` -> `PipelineRunRepository.isRunOpenInternal`
  (`id = runId AND completed_at IS NULL`, privileged). `false` -> WARN + `Left(ServiceError.Conflict("Run was already
  finalized as abandoned before it finished"))`. A run row deleted by the `pipeline_runs.pipeline_id ... ON DELETE
  CASCADE` FK also reads `false`, which is item 1.
- `PipelineRunSucceededWrites.onUnblockedRunSuccess` writes each materialized node via
  `NodeSnapshotRepository.overwriteRows` / `overwriteRowsWith(..., historyAction)`; each is ONE privileged
  transaction (`ctx.withSystemContext(...)` wraps `.transactionally`). Nothing in that transaction looks at the run,
  which is item 2. The whole chain is wrapped in `PipelineRunTerminalWrites.publishTerminalAfter`, which publishes
  `succeeded` whatever the chain's outcome.
- `binaryRefsUpsert`, `alertEvaluation`, `updateRun` and `baselineUpsert` are eager `val`s started concurrently with
  `materializedWrites`.
- `PipelineRepository.delete`: one user-context transaction: `PanelRowLocks.lockForDeletion` (HEL-1498 V129 /
  HEL-1534 V130 `hel1498_lock_panels`: panel rows, then their dashboards) -> `DELETE pipelines` (row lock) -> FK
  cascades (`pipeline_runs`, `outputs` -> `output_snapshot_history`, `node_payload_history`, ...).
  `node_snapshots` has no FK. `output_snapshot_history.output_id` FKs `outputs`; `node_payload_history.pipeline_id`
  FKs `pipelines`.
- `reapStaleRunsInternal`: one statement, `UPDATE pipeline_runs ...` (non-key columns -> `FOR NO KEY UPDATE` row
  lock), then `UPDATE pipelines SET last_run_* ...` (non-key -> `FOR NO KEY UPDATE`).
- `stampHeartbeatsInternal`: `UPDATE pipeline_runs SET heartbeat_at` (non-key).
- Call sites lacking the `withSystemContext` justification comment: `OrphanedRunReaper.reap`
  (`runRepo.reapStaleRunsInternal`), `PipelineRunExecutor.isStillOpen` (`pipelineRunRepo.isRunOpenInternal`).

## Goals / Non-Goals

**Goals:** items 1-3 of ticket.md's acceptance criteria.

**Non-Goals:**
- Guarding `binaryRefsUpsert`, `alertEvaluation`, `baselineUpsert` and the per-Output `updateSchemaInternal` against
  the same window. The ticket names the snapshot writes; those four are eager or post-node writes with their own
  transactions. They stay covered only by the early open-check (HEL-1511 D4's accepted residual). The spec delta
  states this limit explicitly, and a follow-up ticket records it (Follow-up label, relatedTo HEL-1518; tasks.md 4.1).
- Guarding write-backs (`applyPendingWriteBacks`) in-transaction. They run as the owner on the RLS user pool, before
  the snapshot writes, and stay behind the early open-check.
- The ops note (prod count query before v0.9.4): release-time, touches prod; out of scope.
- No migration (V131 stays free).

## Decisions

**D1. Tri-state run state.** Replace the boolean read with `runStateInternal(runId): Future[RunState]`, where
`RunState` is `Open | Terminal | Missing` (a small sealed ADT next to `ReapedRun`). `isRunOpenInternal` may stay as
a thin wrapper if tests use it, or be removed with its callers updated; the executor decides, no dead code left.
- Alternative: keep the boolean and on `false` look up the pipeline. Rejected only as the primary signal because it
  conflates "reaped" with "pruned"/"deleted"; the pipeline lookup is still used for the Missing case (D2).

**D2. Response mapping (item 1).** `Open` -> continue. `Terminal` -> today's WARN + 409, unchanged text.
`Missing` -> privileged `pipelineRepo.findByIdInternal(pipelineId)` (same pattern as HEL-1503's submit-time
`pipelineGone` check in `PipelineRunExecutor.submit`): `None` -> WARN ("pipeline deleted while its run executed;
discarding its outcome") + `Left(pipelineGone(pipelineId))` = `404 Pipeline not found: <id>`; `Some` (run row gone,
pipeline present, e.g. pruned) -> 409 as today. Both paths publish nothing. The 404 is pinned by the ticket title
("should be 404") and matches the existing submit-time 404 for a pipeline deleted mid-submit, so this is not an
assumed product call.

**D3. In-transaction guard (item 2).** A guard `DBIO[RunState]`, built by `PipelineRunRepository`, is composed as
the FIRST action of each node's snapshot transaction (`overwriteRows` and `overwriteRowsWith` paths both), before
the `node_snapshots` delete. It runs, in order:
1. `SELECT 1 FROM pipelines WHERE id = :pipelineId FOR KEY SHARE`
2. `SELECT completed_at IS NULL OR status = 'succeeded' FROM pipeline_runs WHERE id = :runId FOR SHARE`
Not writable -> `DBIO.failed(RunNoLongerOpen(state))` so the transaction rolls back having written nothing.
- Why the guard also accepts `status = 'succeeded'` (design-gate R1/CR1): the success chain's own terminal write
  (`updateRun` = `writeTerminal(runId, "succeeded", ...)`) is an eager `val` started concurrently with the node
  fold, so on a healthy run it routinely commits before node 1 (or between nodes, since it only waits on the
  FOR SHARE of the node in flight). A guard keyed on `completed_at IS NULL` alone would then trip on every later
  node of a healthy run. `succeeded` on this run id can only have been written by this execution's own terminal
  write (first terminal write wins; the reaper writes `failed`; no other path writes `succeeded` for an
  executing real run id -- the executor re-verifies this by grep and states it in the evidence), so it proves this
  execution, not a reaper, finalized the run. A reaped run reads `failed` -> `Terminal`; a deleted run -> `Missing`.
- Alternative considered: sequence `updateRun`/`updateMeta`/`assertionsInsert` strictly after the node fold.
  Rejected: it changes when the terminal write happens on a node-write failure (today the eager `updateRun` still
  finalizes the run; sequenced, a failed node write would leave the run non-terminal holding a concurrency slot
  until the reaper fires 600 s later unless a new failure branch is added), widening the change beyond the ticket.
- Lock order rationale (deadlock-freedom, must be proven by test per D6): pipeline delete takes panels ->
  dashboards -> pipeline row (`FOR UPDATE`) -> cascaded rows. The guard takes the pipeline row first (KEY SHARE
  conflicts with the delete's FOR UPDATE), so whichever of delete/guard reaches the pipeline row first wins and the
  other waits; neither holds a lock the other needs next. After a delete commits, the guard's step 1 finds no row,
  step 2 finds no run -> `Missing`. The guard never touches panels or dashboards, so the HEL-1498/HEL-1534 order is
  not inverted.
- Reaper: its run-row UPDATE (`FOR NO KEY UPDATE`) conflicts with `FOR SHARE`, so a reap waits for an open node
  transaction to commit and then re-evaluates its WHERE (READ COMMITTED) and reaps. Its `pipelines` UPDATE (`FOR NO
  KEY UPDATE`) does not conflict with KEY SHARE. No cycle.
- Why `FOR SHARE` on the run, not `FOR KEY SHARE`: KEY SHARE does not conflict with the reaper's non-key UPDATE, so
  a reap could commit mid-transaction, which is the window this ticket closes.
- Cost: `stampHeartbeatsInternal` also waits on `FOR SHARE` for the length of one node transaction. Bounded by one
  node write (ms to low seconds), against a 600 s stale bound; accepted.
- The guard runs only when `pipelineRunRepo` is wired and the run is real (a fixture with no run repository gets no
  guard, matching `isStillOpen`'s fixture rule). It is privileged (system context, inside the existing
  `withSystemContext` transaction) and carries the justification comment.

**D4. Guard trip handling.** A `RunNoLongerOpen` failure from any node's transaction stops the node fold (later
nodes are not written; earlier nodes were written while the run was open, which HEL-1511 Q6 accepts). The chain then:
- (The run's own `succeeded` terminal write never trips the guard, per D3.)
- does NOT publish `succeeded`: `publishTerminalAfter` (or its call site in `onUnblockedRunSuccess`) skips the publish
  for this one failure (the reaper, or the delete, already ended the run's lifecycle). Every other failure keeps
  today's publish behaviour.
- maps to the same `Left` as D2 in `PipelineRunExecutor` (Terminal -> 409, Missing -> pipeline lookup -> 404/409),
  with the same WARN. The eagerly started `updateRun` cannot win (row terminal or gone), so `last_run_*` and
  assertions are already skipped by HEL-1511's `afterTerminalWin`.
- Executor confirms the exact return-type plumbing (`Future[Option[String]]` failing vs an `Either`), keeping the
  change minimal and not widening any public signature beyond `private[pipelines]`.

**D5. Privileged comments (item 3).** Inline comments, in the `// Privileged: ...` form already used in this
package (e.g. `PipelineRunPreview.scala`, `PipelineRunExecutor.submit`), at: `OrphanedRunReaper.reap`'s
`reapStaleRunsInternal` call (no request user on the scheduler tick; must see every owner's stale runs), the
executor's run-state read (keyed by a server-generated run id the executor itself inserted; an editor-admitted run
is invisible to the editor under the owner-JOIN RLS), the Missing-case `findByIdInternal` (existence only, by the
id already authorized at submit), and the guard (runs inside the node write's already-privileged transaction).

**D6. Tests (red first).**
- Item 1: a service-level spec (alongside `LiveRunReaperSpec`/`OrphanedRunReaperSpec`) that admits a real run,
  deletes its pipeline before the success chain, and asserts `Left(NotFound("Pipeline not found: <id>"))` -- red on
  main (Conflict), green after. Plus the existing reaped -> 409 case still passing.
- Positive control (design-gate CR2): a healthy real run with >= 2 materialized nodes, history on and one Output
  opted into payload history, with the run's own `succeeded` terminal write forced to commit BEFORE the first node
  write (e.g. a test-only hook/latch around the node fold, or a repository wrapper delaying node 1). Assert every
  node's snapshots, history and payload are written, `succeeded` is published, the result is `Right`, and the run
  row is `succeeded`. Must be shown red against a guard keyed on `completed_at IS NULL` alone (mutation evidence).
- Item 2: a repository/concurrency spec (pattern: `RunReaperConcurrencySpec`, two real connections) that
  (a) reaps the run after the early check and before a node write -> no `node_snapshots`/`output_snapshot_history`
  rows for that run, no `succeeded` event, 409 -- red on main (rows written); (b) holds a node transaction open past
  the guard, starts a reap on another connection, asserts the reap blocks until commit then reaps; (c) runs a guarded
  node write concurrently with `PipelineRepository.delete` of the same pipeline (both orders) and asserts no 40P01
  and the 404 outcome when the delete wins. (c)'s fixture MUST have history on and a payload opt-in, otherwise the
  "pipeline-row lock removed" mutation cannot go red (the cycle needs the FK-bearing history/payload inserts). Each must be shown failable by mutation (e.g. guard switched to
  `FOR KEY SHARE`, or pipeline-row lock removed) and labelled as such in the evidence.
- Full `sbt testFull` with `HELIO_TEST_JVM_XMX=3g`, nice -n 19, worker caps per CLAUDE.md.

**D7. Lost terminal write (evaluation-1 CR1).** The node guard cannot see a pipeline deleted before the Output list is
read (the cascade already emptied the list, so no node guard runs) or a run reaped/deleted after the last node's guard.
Both leave the success chain's own `succeeded` write returning `won = false`. After the chain's writes, when that write
lost and a run repository is wired, the chain reads `runStateInternal`: `Missing` or `Terminal` fail the chain with
`RunNoLongerOpen(state)` (no `succeeded` publish; the executor's existing recover maps Missing to 404, or the neutral
409 when the pipeline still exists, and Terminal to the 409 "abandoned" text); `Open` (not expected) is ignored. First
terminal write wins: the late finisher lost. Node writes committed before a reap stay (HEL-1511 Q6). Likewise for a delete landing after some node writes or write-backs: the 404 and no `succeeded` hold, but `node_snapshots` (no FK, not removed by `PipelineRepository.delete`) and write-back dataset rows already committed remain, as for any pipeline delete; history and payload cascade away. Cleaning `node_snapshots` on delete is out of scope (tracked on HEL-1541).

## Risks / Trade-offs

- [Lock order wrong under some cascade path] -> D6(c) proves both orders; any 40P01 fails the gate.
- [Heartbeat stamping blocks briefly on FOR SHARE] -> bounded by one node transaction; noted in D3.
- [Partial materialization when a reap lands between nodes] -> earlier nodes were written while open; accepted by
  HEL-1511 Q6; recorded.
- [Non-snapshot eager writes keep the residual window] -> Non-Goal, follow-up filed.
- [Row locks need privileges that dev/CI never exercise] -> `SELECT ... FOR SHARE/KEY SHARE` needs UPDATE on the
  table; dev/CI connect as a superuser (MISTAKES.md: RLS/privilege parity gap), so a missing grant would only fail in
  prod. `helio_privileged` holds `UPDATE` on `pipelines` (V23) and `pipeline_runs` (V24) via V38's blanket grant; the
  executor re-verifies against the migrations and states it in the evidence.

## Migration Plan

None. Code-only, backward-compatible; rollback is a revert.

## Design-gate round 2 notes (binding implementation guidance)

- **N1. Backfill stays unguarded.** `PipelineRunBackfill` also calls `overwriteRows` with no run id. The guard is
  passed in from the success chain as an optional first action; `overwriteRows`'s existing behaviour for other
  callers is unchanged.
- **N2. Pruning (risk).** `deleteOldRunsInternal` keeps the newest 10 real runs per pipeline and can delete a still
  in-flight run row. If that lands between two node writes, the next guard reads `Missing` with the pipeline
  present: the run stops writing nodes, publishes nothing, answers 409. Before this change the same prune could
  only bite before the success chain. Accepted as very rare; recorded in the follow-up ticket (tasks 4.1).
- **N3. Neutral 409 text for Missing-with-pipeline-present:** "Run record no longer exists; its outcome was
  discarded" (the Terminal case keeps today's "finalized as abandoned" text).
- **N4.** Update the HEL-1366 publish-ordering comment in `onUnblockedRunSuccess` to state a guard trip publishes
  nothing.
- **N5.** Catch the guard-trip failure inside `onRunSuccess` (or its chain), not in `executeRun`'s engine-failure
  handling, so it maps to 404/409 and never surfaces as a 500.
