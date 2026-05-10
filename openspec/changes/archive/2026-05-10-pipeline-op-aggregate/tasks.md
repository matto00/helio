## 1. Backend

- [x] 1.1 Add `applyAggregate` method to `InProcessPipelineEngine` for op `"aggregate"` with config shape `{groupBy:[{name,type}], aggregations:[{alias,fn,field}]}` supporting fn: sum/avg/min/max/count
- [x] 1.2 Wire `"aggregate"` case in `applyStep` dispatch in `InProcessPipelineEngine`

## 2. Frontend

- [x] 2.1 Create `AggregateConfig.tsx` component with group-by checkbox list and aggregations dynamic row list (alias input, fn dropdown, field dropdown), calling `onChange` with serialized config JSON on every change
- [x] 2.2 Add `parseAggregateConfig` helper and `AggregateConfigValue` type in `PipelineDetailPage.tsx`
- [x] 2.3 Wire `aggregate` into `StepCard` — render `AggregateConfig` when `step.opType.id === "aggregate"`, passing `analyzeSchema` and `analyzeColumns`
- [x] 2.4 Wire `aggregate` into `handleAddStep` with initial config `'{"groupBy":[],"aggregations":[]}'`

## 3. Tests

- [x] 3.1 Add `aggregate` op tests to `InProcessPipelineEngineSpec.scala`: sum grouping, avg, min/max, count, empty groupBy, null-safe skipping
- [x] 3.2 Create `AggregateConfig.test.tsx`: render with empty config, render with hydrated config, add/remove group-by field, add/remove aggregation row, inline warning for missing field
