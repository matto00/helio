## Why

Pipeline editors need feedback at each transformation step — without running the
full pipeline — to validate that each op is producing the expected output. The
"Preview data" button already exists in StepCard but is a non-functional stub.

## What Changes

- **New backend endpoint**: `GET /api/pipelines/:id/steps/:stepId/preview`
  Runs the partial pipeline (steps 1..K where K is the position of stepId, inclusive)
  using the existing `InProcessPipelineEngine` and returns the first 10 rows.
- **StepCard wiring**: Hook the existing "Preview data" button to fetch from the
  new endpoint and render the sample rows in a collapsible table below the config
  editor. Loading and error states are handled.
- No new Redux state: preview is transient UI state kept in StepCard component state.

## Capabilities

### New Capabilities

- `pipeline-step-preview`: Per-step data preview — backend runs partial pipeline up to
  a given step and returns first-N sample rows; frontend renders inline preview table
  inside StepCard.

### Modified Capabilities

- `pipeline-run-execution`: New read-only dry-run variant that stops at a given step
  (partial execution). Does not update `last_run_status` or write to the Type Registry.

## Impact

- Backend: new route handler in `PipelineRunRoutes`; reuses `InProcessPipelineEngine.execute`
- Frontend: StepCard gains preview state + fetch; no new Redux slice
- No DB schema changes; no breaking API changes

## Non-goals

- Previewing the source data (raw, before any steps) — the SourceChip already has a mock preview
- Spark-backed preview (only `static` and `csv` source types are supported in-process)
- Paginating the preview table
