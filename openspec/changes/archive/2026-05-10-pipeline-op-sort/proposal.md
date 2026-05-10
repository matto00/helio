## Why

Helio pipelines need a Sort step so users can order their output rows by one or more fields before
display or further processing. Without Sort, row ordering is source-dependent and unpredictable.

## What Changes

- Add `sort` op to `InProcessPipelineEngine` (multi-column stable sort, nulls last)
- Add `"sort"` to `PipelineStepRoutes.allowedOps`
- Add Flyway migration V27 extending the `pipeline_steps.op` CHECK constraint to include `sort`
- Add `SortConfig.tsx` frontend component (ordered list of {field, direction} pairs)
- Wire `sort` into `PipelineDetailPage`: StepCard rendering + `handleAddStep` initial config
- Use `analyzeColumns` from the analyze endpoint for field discovery in `SortConfig`

## Capabilities

### New Capabilities
- `pipeline-sort-op`: Backend execution and frontend UI for the Sort pipeline step

### Modified Capabilities
- `pipeline-steps-persistence`: Extend op CHECK constraint to include `sort`

## Non-goals

- Spark/distributed sort (in-process only)
- Locale-aware string collation
- Custom null placement (nulls always last)

## Impact

- `InProcessPipelineEngine.scala` — new `applySort` method
- `PipelineStepRoutes.scala` — `allowedOps` set extended
- `V27__add_sort_op.sql` — Flyway migration
- `SortConfig.tsx` — new frontend component
- `PipelineDetailPage.tsx` — wiring for sort step rendering and creation
