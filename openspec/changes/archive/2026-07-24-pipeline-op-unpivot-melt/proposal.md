## Why

The pipeline vocabulary can pivot wide (HEL-375) but has no inverse: wide sources (many value
columns per entity) can't be normalized into a long, tidy shape before aggregation. This blocks
users who ingest wide data (e.g. one column per month, per metric, per category) and need to
reshape it into `(id..., variable, value)` rows before `aggregate`/`pivot`/panel binding.

## What Changes

- Add a new `unpivot` pipeline op: for each input row, emits one output row per `valueVars` column
  — the `idVars` unchanged, plus `varName` (default `"variable"`) = the source column's name and
  `valueName` (default `"value"`) = that column's cell value. Row count multiplies:
  `N input rows * len(valueVars) = N output rows`.
- Wire the full stack: domain step (`UnpivotStep.scala`) + registry, wire protocol
  (`UnpivotStepResponse`) + analyze-inference parity (`inferUnpivot`), Flyway migration extending
  `pipeline_steps_op_check`, frontend `StepCard` editor (`UnpivotConfig.tsx`), MCP
  `add_pipeline_step` tool description.
- Unlike `pivot`, `unpivot`'s output schema is statically knowable from config alone (no data
  sampling needed): `idVars` (types carried through) + `varName` (`string`) + `valueName` (the
  common type of `valueVars` if uniform, else `string` fallback). `analyze_pipeline` returns this
  deterministically, with apply/infer parity on the full output schema (not just `idVars`, unlike
  `pivot`'s dynamic-arity case).

## Capabilities

### New Capabilities

- `pipeline-unpivot-op`: the `unpivot` execution semantics (row multiplication, idVars passthrough,
  varName/valueName population) and the fully-deterministic analyze/infer-schema contract.

### Modified Capabilities

(none — no existing capability's requirements change; this is a purely additive op alongside the
existing `filter`/`aggregate`/`pivot`/`datebucket`/etc. ops.)

## Impact

- Backend: new `backend/src/main/scala/com/helio/domain/steps/UnpivotStep.scala`; registry entry in
  `PipelineStep.scala`; type aliases in `domain/package.scala`; wire types in
  `PipelineStepProtocol.scala` + `PipelineStepConfigCodec.scala`; analyze dispatch in
  `PipelineAnalyzeService.scala` + `PipelineAnalyzeProtocol.scala`; exhaustive-match updates in
  `PipelineStepRepository.rowToDomain` and `PipelineService.toAnalyzeStepResponse`; Flyway migration
  (next free VNN — reconfirm at scheduling time and again at delivery; main was at V66 as of
  HEL-376).
- Frontend: `pipelineStep.ts` (wire type, 4 additions), `stepNarrowing.ts` (`OP_TYPES`/
  `defaultConfigFor`/`unpivotConfigOf`), new `UnpivotConfig.tsx` + co-located test, `StepCard.tsx`
  render arm, `useStepCardState.ts` state wiring.
- MCP: `helio-mcp/src/tools/write.ts` `add_pipeline_step` description text (free-text `type`, no
  enum to update).
- No breaking changes; existing pipelines/persisted steps/rows unaffected; unknown-kind tolerance
  preserved.

## Non-goals

- The DAG/branching authoring model — `unpivot` still chains linearly.
- Any smart-shape/panel consumer of the reshaped data — raw op only.
