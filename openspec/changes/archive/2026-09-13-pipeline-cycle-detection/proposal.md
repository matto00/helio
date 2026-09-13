## Why

v0.8 lets a pipeline write back into a dataset source (`upsertsource`, HEL-1099/1100). A
write-capable graph can form a cycle — a pipeline reading the very source it (directly or
transitively, via another pipeline) writes — which would loop forever at run time. HEL-1099's
own spec already blocks registering `upsertsource` until this validation-time check exists
(HEL-1100 is `blockedBy` this ticket). Reject at validation time, not at run time.

## What Changes

- New `PipelineCycleValidator`: builds a directed source-dependency graph (edge `readSource ->
  writeTarget` per pipeline, for the caller's own visible pipelines only) and detects whether
  adding/updating an edge introduces a cycle, returning the cycle path for the error message.
- Wire the validator into every write path that can add or change a read/write edge:
  `PipelineService.create`, `addRoot`, `addStep`, `updateStep` (write targets only need
  `existingSource`; `removeRoot`/deletes cannot introduce a cycle and are not checked).
  `PipelineProposalService.apply` funnels into `create`, so it is covered without separate wiring.
- Concurrency: two simultaneous edge-adding writes are serialized per-owner with a Postgres
  advisory transaction lock (`pg_advisory_xact_lock`) around the check-then-write, closing the
  race without a new migration or table.
- No engine change, no `PipelineStep.Registry` change — `upsertsource` stays unregistered
  (HEL-1100's job, unblocked once this ticket lands).

### New Capabilities
- `pipeline-cycle-detection`: validation-time rejection of a pipeline write/read graph that
  contains a cycle (direct or transitive), with a message naming the cycle, scoped to the
  caller's own visible resources.

## Impact

`PipelineService` (create/addRoot/addStep/updateStep), a new domain validator + repository query
against `pipeline_roots`/`pipeline_steps`, `PipelineProposalService` covered transitively. No
schema change. No `PipelineStep.Registry` change.
