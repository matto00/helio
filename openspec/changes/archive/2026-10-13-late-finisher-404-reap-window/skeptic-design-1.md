## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD f3490d1d8c81a5082c973c21462ace3089d7183a (planning artifacts are untracked in the worktree).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/late-finisher-404-reap-window/HEL-1518`.
- **Item 1 premise holds.** `pipeline_runs.pipeline_id ... REFERENCES pipelines(id) ON DELETE CASCADE` (V24 line 3). `isRunOpenInternal` (`PipelineRunRepository.scala:335-336`) reads `completed_at IS NULL` by id, so a cascade-deleted row reads `false`. `PipelineRunExecutor.onRunSuccess` (`PipelineRunExecutor.scala:357-366`) maps `false` to `Conflict("Run was already finalized as abandoned ...")`. The `pipelineGone` 404 helper already exists (`:92`) and is used for the submit-time deleted-pipeline case (`:60`, `:183`, `:192`).
- **404 vs 409 (D2) is pinned by the ticket, not a product call.** The ticket title says "late finisher after pipeline delete gets 409 (should be 404)". The "Missing run row, pipeline present -> 409" branch is an extrapolation. It is harmless because it keeps today's behaviour.
- **D3 lock order against `PipelineRepository.delete` checks out.** `delete` (`PipelineRepository.scala:486-497`) runs one user-context transaction: `hel1498_lock_panels` (V130: `FOR UPDATE OF p` on panels, then `FOR UPDATE OF d` on dashboards, and nothing else), then `DELETE pipelines` (a FOR UPDATE row lock), then the FK cascades. The guard never touches panels or dashboards. If the guard takes the pipeline row with KEY SHARE first, the delete blocks before any cascade. If the delete takes it first, the guard blocks at step 1 and, after the commit, sees no rows (`Missing`). Taking the pipeline lock first is also *necessary*. Without it the guard would hold the run row FOR SHARE while the delete holds the pipeline row and waits on the run-row cascade. The guard's later `node_payload_history` insert (FK to `pipelines`, V116) or its `output_snapshot_history` insert (FK to `outputs`, which the delete cascades) would then wait on the delete, which is a cycle. So D6(c)'s mutation is meaningful.
- **Reaper and heartbeat checks.** `reapStaleRunsInternal` (`:356-398`) is a single statement: a non-key UPDATE of `pipeline_runs` (FOR NO KEY UPDATE, which conflicts with FOR SHARE, so the reap waits and then rechecks its WHERE under READ COMMITTED) and a non-key UPDATE of `pipelines` (compatible with KEY SHARE). `stampHeartbeatsInternal` (`:341-350`) is a non-key UPDATE that waits on FOR SHARE. I found no cycle: the guard locks only its own pipeline and run rows. FOR SHARE on the run does close the per-node reap window, and KEY SHARE would not (D3's rationale is correct).
- **Other explicit lockers** (grepped `forUpdate|FOR UPDATE|FOR SHARE|FOR KEY SHARE|pg_advisory` in `backend/src/main`): admission (pipeline KEY SHARE plus an owner advisory lock), the step lock (`PipelineStepRepository.scala:135`), and the dashboard/panel/connector locks. None of them takes a pipeline-row or run-row lock that conflicts with KEY SHARE / FOR SHARE in an order that inverts the guard's order.
- **Privileges.** `withSystemContext` runs on the privileged pool (`DbContext.scala:63-64`). V38 grants `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` to `helio_privileged`, so `FOR SHARE` / `FOR KEY SHARE` are permitted.
- **Composability.** `NodeSnapshotRepository.overwriteRowsWith` / `overwriteRowsAction` (`:108-155`) are composable DBIOs inside one `withSystemContext` transaction, so a guard prefix is feasible.
- **Success-chain concurrency, where the blocking defect is.** In `PipelineRunSucceededWrites.onUnblockedRunSuccess`, `materializedWrites` (the node fold), `binaryRefsUpsert`, `alertEvaluation`, `updateRun` (= `writeTerminal(runId, "succeeded", ...)`) and `baselineUpsert` are all eager `val`s, started together when `writesChain()` runs. The existing HEL-1366 comment ("the eagerly-started `updateRun` is still in flight") confirms this. `updateRunTerminalInternal` (`PipelineRunRepository.scala:318-331`) sets `completed_at` and `status = 'succeeded'`.
- **HEL-1511 residual.** Archived `2026-10-11-reap-orphaned-pipeline-runs/design.md` Risks accepted the whole post-check window (alerts included). The live spec (`openspec/specs/pipeline-run-reaper/spec.md:56-60`) still says "SHALL NOT overwrite ... alert state".

### Verdict: REFUTE

### Change Requests

1. **D3/D4: the guard will trip on the run's own successful terminal write and break healthy runs.** `updateRun` (the run's own `writeTerminal(..., "succeeded", ...)`) starts eagerly and concurrently with `materializedWrites`. It sets `completed_at`, so from that point the run is not `Open` under D3's predicate (`completed_at IS NULL`). Before the first node transaction, `materializedWrites` runs two queries (`listByPipelineInternal` and `findConfigsByIdsInternal`), and the nodes then run in sequence. So `updateRun` will often commit before node 1, and once node 1 commits, its blocked UPDATE always commits before node 2.

   After that, every later node's guard reads `Terminal`. Per D4 those nodes write nothing, `succeeded` is not published, and the executor returns 409 for a perfectly healthy run. D4's line "The eagerly started `updateRun` cannot win (row terminal or gone)" only considers the reaped case; it misses that in the normal case `updateRun` is what *makes* the row terminal.

   Revise the design so the guard cannot trip on this execution's own terminal write. Name one concrete mechanism. For example: sequence `updateRun` (and therefore `updateMeta`/`assertionsInsert`) strictly after `materializedWrites`. Or, if the predicate is changed instead, justify why only this execution can write `succeeded`. State how the HEL-1366 publish-ordering comment changes.

2. **D6: add a positive control that would catch CR1, and make it deterministic.** None of D6(a)-(c) can catch a self-trip. D6(a) passes for the wrong reason, since a guard that trips on anything satisfies it. Add a test where a healthy, unreaped real run with at least 2 materialized nodes, history on, and at least one payload opt-in Output is forced so that `updateRun` would commit before the first node transaction (for example, gate `outputRepo.listByPipelineInternal` or the first node write behind a Promise). Assert:
   - every node's `node_snapshots` and `output_snapshot_history` rows are written,
   - exactly one `succeeded` event is published,
   - the result is `Right`,
   - the run row is `succeeded`.

   Show it red against the D3/D4 design as currently written (or a mutation equivalent to it).

3. **Spec delta must not assert a guarantee the design deliberately does not deliver.** The MODIFIED "First terminal write wins" requirement restates "SHALL NOT overwrite ... alert state" without qualification. The Non-Goals, though, leave `alertEvaluation`, `binaryRefsUpsert`, `baselineUpsert` and `updateSchemaInternal` behind only the early check. The scope cut itself is acceptable: the ticket names the snapshot writes, and HEL-1511's Risks accepted this residual. But the restated requirement becomes the new authoritative text. Add a sentence that scopes the residual explicitly. For example: alert evaluation, binary refs, the schema-drift baseline and the Output schema are guarded only by the open-check before the success chain, and a reap landing after that check may still write them. Alternatively, drop "alert state" from the restated sentence and move it to that qualified sentence. Also file and name the follow-up ticket (Follow-up label, relatedTo HEL-1518) as the design promises; tasks.md currently has no task for it.

4. **tasks.md: add tasks for CR1 and CR2, and for the follow-up filing in CR3.** Task 2.2/2.3 must include the self-write sequencing fix, and section 2 must include the positive control.

### Non-blocking notes

- D6(c) mutation evidence: whether "pipeline-row lock removed" actually yields 40P01 depends on the guarded transaction inserting into a table that FKs a row the delete cascades: `node_payload_history` (FK `pipelines`) or `output_snapshot_history` (FK `outputs`). Make sure the D6(c) fixture has history on and a payload opt-in, otherwise the mutation may stay green.
- D2's 409 text "finalized as abandoned" is inaccurate for the Missing-with-pipeline-present (pruned) case. Consider a neutral message, but it is not required.
- D1: if `isRunOpenInternal` becomes unused after the tri-state change, remove it (the design already says no dead code). No test references it (grep of `backend/src/test`: zero hits).
- The heartbeat statement updates multiple runs in one statement, so it can be held up by one run's open node transaction. This is bounded, and D3 accepts it.
