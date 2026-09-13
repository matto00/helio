## Why

HEL-1099 shipped the `upsertsource` config model and HEL-1101 the write-edge cycle guard, but the step is still
unregistered: no pipeline can write its result into a dataset. This closes the write-back loop (epic HEL-1098).

## What Changes

- Register `upsertsource` as a runnable step kind (only this one; `convertformat`/`analyzewithai`/`generatetext`
  stay rejected).
- In-process engine support: the step passes rows through and records a pending write; writes are applied only
  after the whole run succeeds (non-dry, not assertion-blocked), all in one transaction, as the pipeline owner.
- `append` preserves existing rows; `replace` swaps atomically; any write failure fails the run with zero rows
  committed.
- Rows are validated against the target's declared schema; undeclared columns, type mismatches and the 500-row cap
  fail the run with a named error (no coercion, no truncation).
- New-source target: first run creates an owner-owned dataset with a schema inferred from the rows (all fields
  optional) and rewrites the step's target to that dataset's id.
- Analyze/infer: the step's output schema is its input schema.
- Pipeline editor: a persisted step of an op the frontend does not know renders as an explicit read-only
  "unsupported step" instead of silently masquerading as the first op type (config-overwrite bug).

## Capabilities

### New Capabilities
- `pipeline-upsertsource-execution`: run-time behavior of the `upsertsource` step (write timing, modes, atomicity,
  validation, ownership/RLS, new-source creation, analyze parity, editor fallback for unregistered ops).

### Modified Capabilities
- `pipeline-upsertsource-config`: removes "The upsertsource step is not yet creatable".

## Non-goals

- Step card UI / MCP tool support (HEL-1102). Downstream refresh/auto-run (HEL-1091). Raising the 500-row cap
  (follow-up ticket). Any migration. Spark backend support (write-back runs are in-process only).

## Impact

Backend: `PipelineStep` registry, new `UpsertSourceStep`, `InProcessPipelineEngine` context, `PipelineRunService`,
`DataSourceRepository` (composable row-write actions), `PipelineService` ACL pre-flight, `PipelineAnalyzeService`.
Frontend: `stepNarrowing.ts`, `StepOpEditor.tsx`. Tests across all of these.
