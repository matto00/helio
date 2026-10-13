## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD f3490d1d8c81a5082c973c21462ace3089d7183a. The planning artifacts are untracked in the worktree. I re-derived everything below from the code; nothing is taken from the round-1 report or the orchestrator prompt.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/late-finisher-404-reap-window/HEL-1518`.

- **CR1 premise. Who can write `succeeded` to a `pipeline_runs` row?** I grepped `backend/src/main` for `"succeeded"`, `RunStatus.Succeeded`, `updateRunTerminal*`, `writeTerminal(` and raw `UPDATE pipeline_runs`. Every hit:
  - `PipelineRunSucceededWrites.scala:234`: the executing run's own `writeTerminal(runId, "succeeded", ...)`. It is the only in-process writer, and it is reached only from `onUnblockedRunSuccess`.
  - `SparkJobSubmitter.scala:96`: writes `succeeded` only to a run id it generated itself (`UUID.randomUUID()`, `:54`), inserts itself (`:71`), and never writes node snapshots. So it cannot collide with an in-process run's node writes. The path is also dormant (its own comment says nothing calls `submit`).
  - Every other terminal writer writes only `failed`: `PipelineRunTerminalWrites.scala:111/196/229`, `PipelineRunService.recordUnrunnable` `:251`, and the reaper `PipelineRunRepository.scala:368-377`, whose literal is `SET status = 'failed'` with `WHERE completed_at IS NULL AND status <> 'dry_run'`.
  - Dry runs go through `onDryRunSuccess` (`PipelineRunExecutor.scala:301`) and never reach the node fold.
  - `HookTriggerService.scala:90`'s `"succeeded"` is a response label, not a DB write.
  - No migration defines a trigger touching `pipeline_runs`, `node_snapshots`, `output_snapshot_history` or `node_payload_history` (grep of `CREATE TRIGGER`).
  - Run ids are fresh UUIDs per submit (`PipelineRunExecutor.scala:108`, `PipelineRunService.scala:233`). No retry, auto-run or hook path reuses an id.
  - Both `updateRunTerminal` (owner run, user-scoped lookup then Internal) and `updateRunTerminalInternal` (editor run) are conditional on `completed_at IS NULL` (`:318-331`), so a reaped `failed` row can never become `succeeded`.

  Conclusion: while this execution's node writes are pending, `status = 'succeeded'` on its run id can only come from this execution's own terminal write. D3's widened predicate is sound.

- **No self-deadlock from the predicate change.**
  - `updateRun` is an UPDATE of non-key columns, so it takes `FOR NO KEY UPDATE`. That conflicts with the guard's `FOR SHARE`, so `updateRun` waits for the in-flight node transaction to commit. The node transaction never waits on `updateRun`.
  - `updateMeta` (non-key UPDATE of `pipelines`) is compatible with `KEY SHARE`.
  - Whichever of node N+1's guard and the pending `updateRun` gets the row next, the guard reads either an open row or `succeeded`. Both are accepted.
  - The only FK to `pipeline_runs` is `pipeline_run_assertions.run_id` (V84). The history and payload `run_id` columns are not FKs, so the node transaction takes no extra lock on the run row.

- **Lock order against delete and reaper (re-checked, HEAD unchanged since round 1).**
  - The node transaction is `NodeSnapshotRepository.overwriteRowsAction` (`:125-156`, plus the history/payload `andThen`). It touches only `pipeline_roots` (read), `node_snapshots` (no FK), `output_snapshot_history` (FK `outputs`) and `node_payload_history` (FK `pipelines`). It never touches panels or dashboards.
  - With the guard's pipeline `KEY SHARE` taken first, D3's ordering argument holds.

- **Every path that reaches the node fold.**
  - `materializedWrites` is the only caller of `overwriteRows`/`overwriteRowsWith` that carries a run (`PipelineRunSucceededWrites.scala:110,137`).
  - `PipelineRunBackfill.scala:158` also calls `overwriteRows`, but it has no run id (see note 1).
  - A failure of `onUnblockedRunSuccess` is not routed to `executeRunFailure`: that is `runFuture.transformWith` only (`PipelineRunExecutor.scala:248-255`). It propagates out of `followUp` instead. So D4's "map to the D2 `Left` in the executor" is implementable as a recover in `onRunSuccess`, and no stray `failed` event results.

- **CR2:** D6 and task 2.5 now require a deterministic multi-node positive control with history and payload opt-in, the own `succeeded` write forced before node 1, and mutation evidence against a `completed_at IS NULL`-only guard. That would catch CR1.

- **CR3:** the spec delta now scopes the in-transaction guarantee to snapshots, history and payload, and names alerts, binary refs, baseline and Output schema as early-check-only. It also states the own-terminal-write exemption. Task 4.1 files the follow-up.

- **CR4:** tasks 2.2 (predicate), 2.5 (positive control), 2.6 (writer grep) and 4.1 (follow-up) are present.

- **Items 1 and 3 traced.**
  - The ticket title pins the 404, and the existing `pipelineGone` 404 is reused.
  - The privileged-comment sites are named: `OrphanedRunReaper.reap`, the executor run-state read, the Missing-case `findByIdInternal`, and the guard.

- **Placeholders and contradictions.** No TODO/TBD. Proposal, design, tasks and spec agree on predicate, lock order, D4 handling and scope.

### Verdict: CONFIRM

### Non-blocking notes

1. **Backfill must not be guarded.** `PipelineRunBackfill.persistBackfilledRows` (`PipelineRunBackfill.scala:158`) calls `nodeSnapshotRepo.overwriteRows` with no run. Task 2.2's wording "every node snapshot transaction (`overwriteRows` and `overwriteRowsWith` paths)" means the two success-chain call sites (`PipelineRunSucceededWrites.scala:110,137`). Implement the guard as an optional prefix DBIO passed from the success chain, not as an unconditional change inside `overwriteRows`, or backfill breaks.

2. **Pruning is the one remaining way the guard can trip on a healthy run. Disclose it.** `deleteOldRunsInternal` (`PipelineRunRepository.scala:459-472`, called at every real admission, `PipelineRunExecutor.scala:171-172`) deletes non-dry runs outside the newest 10 by `started_at`, including in-flight ones. If an executing run drops out of the newest 10 between two of its node transactions (its own `succeeded` may already be committed), the next guard reads `Missing` with the pipeline present. Per D4 the remaining nodes are skipped, no terminal event is published (prune publishes none either), and the caller gets 409.
   - Today this outcome exists only when the prune lands before the early check. The guard widens it to between nodes.
   - It is extremely rare: it needs at least 10 newer real runs of the same pipeline admitted during one run's execution. The spec's "or gone" wording already covers it.
   - Please record it in design Risks, and optionally in the follow-up from task 4.1. It is not a blocker.

3. Round-1 note still open: the 409 text "finalized as abandoned" is inaccurate for the Missing-with-pipeline-present (pruned) case. A neutral message would be better.

4. CR1 asked how the HEL-1366 publish-ordering comment (`PipelineRunSucceededWrites.scala:279-282`) changes. Because the fix keeps the eager `updateRun`, the comment stays valid. It should gain one line noting that a `RunNoLongerOpen` trip publishes nothing (D4).

5. The executor must recover `RunNoLongerOpen` inside `onRunSuccess`/`unblockedChain`. It is not caught by `executeRun`'s `transformWith` (`PipelineRunExecutor.scala:248`). Otherwise it surfaces as a failed Future, which becomes a 500 rather than a 404/409.
