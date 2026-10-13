## Why

HEL-1511 (#973) made a run's first terminal write win and added an open-check before the success chain's side effects. Two gaps remain (HEL-1518): a late finisher whose pipeline was deleted mid-run gets a misleading 409 "finalized as abandoned" instead of 404, and the open-check is a separate read that a reap can slip past before the node-snapshot writes. Separately, the new privileged call sites lack the RLS-bypass justification comment `DbContext.withSystemContext` requires.

## What Changes

- The success chain's open-check distinguishes three run states: open, terminal (reaped), and missing. Missing with the pipeline gone answers `404 Pipeline not found: <id>`; terminal (or missing with the pipeline still present) keeps today's 409.
- Each node's snapshot replace (with its history and payload inserts) first locks the pipeline row (`FOR KEY SHARE`) and then the run row (`FOR SHARE`) in the same transaction, and aborts that transaction without writing when the run is no longer open. A reap or pipeline delete can no longer commit between the check and that node's write.
- A guard trip mid-chain is handled like the early check: WARN, no `succeeded` event, and the same 404/409 mapping.
- Inline privileged-call comments at the `reapStaleRunsInternal`, `isRunOpenInternal` and new guard call sites.
- No migration, no API shape change beyond the 409 → 404 status for the deleted-pipeline case.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-run-reaper`: "First terminal write wins" now requires the open-check to share each node-write transaction, and a late finisher whose pipeline was deleted answers 404.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala` (open-check outcome mapping, privileged comment)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunSucceededWrites.scala` (guarded node writes, no `succeeded` publish on guard trip)
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala` (tri-state run-state read, guard DBIO)
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala` (guard prefix on the node replace transaction, if needed)
- `backend/src/main/scala/com/helio/services/pipelines/OrphanedRunReaper.scala` (privileged comment)
- Backend tests only; no frontend, schema, or migration change.
