## Context

PipelineAnalyzeService already handles op `"aggregate"` via `inferAggregate`, using config shape:
`{groupBy: [{name, type}], aggregations: [{alias, fn, field}]}`. Tests for this exist and pass.

InProcessPipelineEngine handles op `"groupby"` (a legacy stub, different shape, never exposed
in the current frontend) but has no handler for `"aggregate"`. This gap means running an aggregate
step in the engine would hit the `"Unknown step op"` error path.

Frontend: PipelineDetailPage lists "aggregate" as an op type and renders a placeholder body —
the AggregateConfig component does not exist yet.

## Goals / Non-Goals

**Goals:**
- Add `AggregateConfig` React component consistent with ComputeFieldConfig / FilterConfig patterns.
- Wire `aggregate` into PipelineDetailPage's StepCard and handleAddStep with initial config.
- Add `applyAggregate` in InProcessPipelineEngine for op `"aggregate"` using the same shape as
  inferAggregate (so analyze and execute agree on the contract).
- Backend ScalaTest coverage for applyAggregate happy paths and edge cases.
- Frontend Jest coverage for AggregateConfig.

**Non-Goals:**
- Spark-side aggregate execution.
- Support for the legacy `"groupby"` op in the new UI.
- HAVING-clause filtering.

## Decisions

### Config shape: match inferAggregate exactly
The analyze service uses `{groupBy: [{name, type}], aggregations: [{alias, fn, field}]}`.
The engine's applyAggregate must use the same shape. Alternative (adapting the old groupby shape)
would require a separate parse path and version divergence — rejected.

### groupBy stores {name, type} objects, not just strings
This allows schema inference to reconstruct the output type without querying inputSchema again.
The engine only needs `name` at execution time (to group rows), so it reads `obj.fields("name")`.

### Null-safe aggregation: skip nulls in sum/avg/min/max, count counts non-nulls
Standard SQL semantics. COUNT(*) behavior (counting all rows) is out of scope for this op.

### Frontend: AggregateConfig receives analyzeSchema: SchemaField[]
The parent (StepCard) already passes `analyzeSchema` from the analyze endpoint per step.
Group-by and aggregation-field dropdowns are populated from `analyzeSchema.map(f => f.name)`.
Inline warning shown when an aggregation field is not in analyzeSchema.

### Initial config for new aggregate step
`'{"groupBy":[],"aggregations":[]}'` — mirrors select `{"fields":[]}` and filter
`{"combinator":"AND","conditions":[]}` patterns for empty but valid configs.

### AggregateConfig component structure
- Group-by section: multi-select checkbox list (matches SelectFieldsConfig pattern) or add/remove
  row buttons with field dropdown. Decision: use add/remove row with field dropdown (same as
  FilterConfig condition rows) so the user can select the same field multiple times if needed.
- Aggregations section: dynamic list of rows, each with alias input + fn dropdown + field dropdown.
- Each change calls `onChange(JSON.stringify(config))` — parent handles the PATCH.

## Risks / Trade-offs

- [Risk] groupBy on zero fields collapses all rows into one — valid but potentially confusing.
  Mitigation: document as expected behavior; no UI guard needed.
- [Risk] An aggregation row with `field` referencing a missing column silently skips those rows.
  Mitigation: frontend warns inline; backend skips gracefully (mirrors filter skip pattern).

## Planner Notes

- `applyAggregate` replaces the old `applyGroupBy` dispatch only for the `"aggregate"` op name.
  The `"groupby"` op case in the engine is left as-is (legacy).
- No new API routes, no Flyway migration, no Redux slice changes needed.
- Backend test file `InProcessPipelineEngineSpec.scala` — check if it exists before creating.
