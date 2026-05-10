# HEL-192 — Pipeline operation: Aggregate

## Title
Pipeline operation: Aggregate

## Description
Step type: group by one or more fields and apply aggregation functions (sum, count, avg, min, max)
to numeric fields. UI: group-by field selector + per-field aggregation configuration. Output schema
reflects the grouped structure.

## Parent Epic
HEL-141

## Critical Planning Notes (from prior ops in this epic)

### 1. apply/infer config shape must match
`PipelineAnalyzeService.inferAggregate` already exists and handles op `"aggregate"` with:
  - config.groupBy: Array<{ name: string, type: string }>
  - config.aggregations: Array<{ alias: string, fn: string, field: string }>

`InProcessPipelineEngine.applyGroupBy` handles op `"groupby"` (a DIFFERENT op name) with a
completely different shape: `{ groupBy: string[], aggColumn: string, aggFunction: string }`.

The engine must gain a new `applyAggregate` method for op `"aggregate"` that uses the SAME config
shape as inferAggregate. The old `applyGroupBy` / `"groupby"` op is a legacy stub that can be
left alone (it has no frontend exposure as "aggregate").

### 2. Use the analyze endpoint for field discovery in the UI
The `useAnalyzePipeline` hook / `analyzePipeline` thunk already exists. The AggregateConfig
component receives `analyzeSchema: SchemaField[]` (the inputSchema for this step) from
PipelineDetailPage via the existing pattern — no "run pipeline first" requirement.

### 3. Aggregate semantics
- groupBy: zero or more fields selected from inputSchema
- aggregations: one or more rows each specifying { alias, fn (sum/avg/min/max/count), field }
- Output schema: groupBy fields (using their inputSchema names/types) ++ aggregation alias fields
- Backend: if aggregation field doesn't exist in a row, skip that row for numeric agg (null-safe)
- Frontend: warn inline if an aggregation field references a non-existent inputSchema field

### 4. Initial config for a new aggregate step
`'{"groupBy":[],"aggregations":[]}'`

## Acceptance Criteria
- User can add an "aggregate" step to a pipeline
- Group-by field selector shows fields from the analyze endpoint inputSchema
- Per-aggregation row: alias text input, fn dropdown (sum/avg/min/max/count), field dropdown
- Backend engine executes aggregate op correctly (group + aggregate)
- Output schema from the analyze endpoint correctly reflects grouped structure
- Backend spec tests cover happy path + malformed config
- Frontend component tests cover render, hydration, and onChange
