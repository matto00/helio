## Why

Helio pipelines lack an aggregate step, blocking users from grouping rows and computing summary
statistics (totals, averages, counts) as part of a transformation chain. This is the sixth in
a series of pipeline ops for HEL-141 and is needed to close the feature gap before v1.3 ships.

## What Changes

- Add `AggregateConfig` React component — group-by field selector + per-aggregation rows
  (alias, fn, field) — following the pattern of ComputeFieldConfig and FilterConfig.
- Wire `aggregate` step into `StepCard` and `handleAddStep` in PipelineDetailPage.
- Add `applyAggregate` to `InProcessPipelineEngine` for op `"aggregate"`, using the same config
  shape already handled by `PipelineAnalyzeService.inferAggregate`
  (`{groupBy: [{name, type}], aggregations: [{alias, fn, field}]}`).
- Add backend ScalaTest spec cases for the new `applyAggregate` execution path.
- Add frontend Jest tests for `AggregateConfig`.

## Capabilities

### New Capabilities

- `pipeline-aggregate-op`: Aggregate pipeline step — group-by + aggregation functions in the UI
  and backend execution engine.

### Modified Capabilities

- `pipeline-analyze-api`: No spec change needed — inferAggregate already exists and is correct.
- `pipeline-run-execution`: Execution engine gains the `aggregate` op; requirement is unchanged
  (run pipeline executes all steps), implementation is extended.

## Non-goals

- No Spark-side aggregate execution (that is out of scope for in-process engine work).
- No support for the legacy `"groupby"` op shape in the new UI.
- No HAVING-clause filtering on aggregated results.

## Impact

- `frontend/src/components/AggregateConfig.tsx` (new)
- `frontend/src/components/AggregateConfig.test.tsx` (new)
- `frontend/src/components/PipelineDetailPage.tsx` (wired in)
- `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` (applyAggregate added)
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` (new test cases)
