## Why

The pipeline vocabulary can reshape rows (filter/aggregate/sort/datebucket) but cannot pivot a long
table to wide — one row per index key, one column per distinct value of a pivot column. This blocks
matrix/crosstab panels and the pivot/matrix smart shape (HEL-337).

## What Changes

- Add a new `pivot` pipeline op: groups rows by `index` fields; for each distinct value of `column`,
  emits an output column named after that value, whose cell is `agg` (`sum`/`count`/`avg`/`min`/`max`/
  `first`) over `values` for rows in that group+value pair. Unsupported `agg` fails at execute time
  (parity with `aggregate`).
- Wire the full stack: domain step (`PivotStep.scala`) + registry, wire protocol
  (`PivotStepResponse`) + analyze-inference parity (`inferPivot`), Flyway migration extending
  `pipeline_steps_op_check`, frontend `StepCard` editor (`PivotConfig.tsx`), MCP
  `add_pipeline_step` tool description.
- `analyze_pipeline`'s output schema for `pivot` returns only the `index` fields (types carried
  through from input schema) — the dynamic value columns are data-dependent and are NOT enumerated
  statically. No `validationError` is raised solely because value columns can't be listed; a
  genuine `validationError` is still raised if `index`/`column`/`values` reference unknown input
  fields (existence-validation, same pattern as `splittext`).

## Capabilities

### New Capabilities

- `pipeline-pivot-op`: the `pivot` execution semantics (grouping, per-value column emission, agg
  functions, error handling) and the analyze/infer-schema contract for a data-dependent-arity op.

### Modified Capabilities

(none — no existing capability's requirements change; this is a purely additive op alongside the
existing `filter`/`aggregate`/`datebucket`/etc. ops.)

## Impact

- Backend: new `backend/src/main/scala/com/helio/domain/steps/PivotStep.scala`; registry entry in
  `PipelineStep.scala`; type aliases in `domain/package.scala`; wire types in
  `PipelineStepProtocol.scala` + `PipelineStepConfigCodec.scala`; analyze dispatch in
  `PipelineAnalyzeService.scala` + `PipelineAnalyzeProtocol.scala`; exhaustive-match updates in
  `PipelineStepRepository.rowToDomain` and `PipelineService.toAnalyzeStepResponse`; Flyway migration
  (next free VNN — reconfirm at scheduling time and again at delivery).
- Frontend: `pipelineStep.ts` (wire type), `stepNarrowing.ts` (`OP_TYPES`/`defaultConfigFor`/
  `pivotConfigOf`), new `PivotConfig.tsx` + co-located test, `StepCard.tsx` render arm,
  `useStepCardState.ts` state wiring.
- MCP: `helio-mcp/src/tools/write.ts` `add_pipeline_step` description text (free-text `type`, no
  enum to update).
- No breaking changes; existing pipelines/persisted steps/rows unaffected; unknown-kind tolerance
  preserved.

## Non-goals

- The pivot/matrix smart shape (HEL-337) — raw op only.
- The DAG/branching authoring model — pivot still chains linearly.
