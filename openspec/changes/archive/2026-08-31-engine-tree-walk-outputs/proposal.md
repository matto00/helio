## Why

P1.1 (HEL-904) turned `pipeline_steps` into a tree (trunk + tails) and gave each node its own
Outputs, but `InProcessPipelineEngine` still runs a flat `steps.foldLeft` over a linear list and
`PipelineRunService` still writes one output type's schema. The engine must walk the tree so tails,
per-node materialized snapshots, and per-Output dry-run previews actually work.

## What Changes

- Replace `InProcessPipelineEngine`'s `foldLeft` with a tree walk (behind `PipelineExecutionBackend`,
  HEL-330): trunk in order; at each node, evaluate every tail from that node's frame before
  advancing; at each materialized node (>= 1 Output), persist the frame to `node_snapshots` and
  derive each Output's schema via `SchemaInferenceEngine.inferShallowFromJsObjects` (HEL-891).
- **BREAKING**: engine rejects a graph violating the Phase-1 invariant (>1 trunk child, or branching
  within a tail) with `InvalidGraph`, before running.
- Dry runs walk the same tree in memory, returning per-Output preview rows; nothing is persisted.
- `node_snapshots` for a materialized node are replaced atomically per successful run; a failed run
  leaves the prior snapshot untouched.
- SSE run events and `pipeline_run_assertions` carry `nodeId` and per-node row counts, tails included.
- `PipelineAnalyzeService` projects schema per node (trunk and tails), not just pipeline-wide.
- Disabled steps (`enabled = false`) are skipped in place on trunk and tails.
- `aggregate` over an empty filtered set with an empty `groupBy` returns one zero-value row
  (`count=0`, `sum/avg/min/max=null`); with a non-empty `groupBy` it still returns zero rows.

## Capabilities

### New Capabilities
(none — this extends existing execution/run capabilities)

### Modified Capabilities
- `pipeline-execution`: engine walks the step tree (trunk + tails) instead of folding a flat list;
  persists per-node snapshots at materialized nodes only (per-node atomic replace, not cross-node);
  enforces the Phase-1 graph invariant with a named `InvalidGraph` error; dry-run returns per-Output
  preview rows.
- `pipeline-run-execution`: `POST /api/pipelines/:id/run` walks the tree instead of a flat `position`
  order; per-node snapshot/schema write replaces the retired Type-Registry/`version` mechanism;
  partial-execution preview resolves the root-to-target-step path instead of a positional slice.
- `pipeline-aggregate-op`: empty-input-row aggregate rule (empty `groupBy` -> one zero/null row;
  non-empty `groupBy` -> zero rows, anti-over-fix guard).
- `pipeline-run-sse`: run-status events add a `node-progress` event kind carrying `nodeId` and
  per-node row counts; assertion results are already keyed by node via existing `step_id`.
- `pipeline-analyze-api`: NOT modified in this change (round 4 correction) — per-node schema
  projection (task 6.4) was never implemented; the requirement is deferred to HEL-906, which has
  been noted accordingly. See design.md Decision 11.
- `pipeline-run-status-ui`: `usePipelineRunEvents` gains a non-run-level `node-progress` event
  channel (`nodeId`/`nodeRowCount`), leaving `status`/`rowCount`/terminal-close behavior untouched.

## Impact

`InProcessPipelineEngine`, `InProcessExecutionBackend`, `PipelineExecutionBackend` trait,
`PipelineRunService` (`onUnblockedRunSuccess`/`upsertFieldsFromRows`), `PipelineAnalyzeService`,
`PipelineRunStreamRoutes`, `frontend/.../usePipelineRunEvents`, `SparkJobSubmitter` (compiles against
new trait signature only — no walk implementation required, per HEL-238). Aggregate step
implementation (empty-set rule).

## Non-goals

Branching (multiple position-0 children) is P2.1 (HEL-911). Dataproc/Spark backend parity is
HEL-238. API routes exposing preview/Output CRUD are P1.3 (HEL-906).
