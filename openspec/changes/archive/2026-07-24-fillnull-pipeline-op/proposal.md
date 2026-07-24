## Why

Rows with missing values break downstream aggregation and charts. Users currently have no way to
fill nulls with a constant, forward-fill from the previous row, or impute a column statistic
(mean/median/mode) in a pipeline. This is the sixth leaf of the HEL-336 Pipeline Op Expansion
epic (v1.6).

## What Changes

- New backend `fillnull` op (`FillNullStep.scala`) — per-field, schema-preserving transform with
  five strategies: `constant`, `forwardFill`, `mean`, `median`, `mode`.
- `analyze_pipeline` passthrough dispatch for `fillnull` — output schema identical to input schema.
- Flyway migration extending `pipeline_steps_op_check` to accept `'fillnull'`.
- Frontend `FillNullConfig.tsx` step-card editor (columns multi-select, strategy dropdown,
  constant-value input shown only for `constant`), wired into `StepCard.tsx` /
  `useStepCardState.ts` / `stepNarrowing.ts` / `pipelineStep.ts`.
- MCP `add_pipeline_step` tool description updated to document `fillnull` + its config shape.

## Capabilities

### New Capabilities

- `pipeline-fillnull-op`: fill-null / impute pipeline step — constant, forward-fill, and
  column-statistic (mean/median/mode) strategies for replacing null cells in named columns,
  schema-preserving, exposed in the pipeline step-card editor and the MCP write tool.

### Modified Capabilities

(none — `fillnull` is additive; no existing capability's requirements change)

## Impact

- Backend: `domain/steps/FillNullStep.scala` (new), `PipelineStep.scala`,
  `PipelineStepProtocol.scala`, `PipelineStepConfigCodec.scala`, `PipelineAnalyzeService.scala`,
  `PipelineAnalyzeProtocol.scala`, exhaustive-match consumers (`domain/package.scala`,
  `PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`), new Flyway
  migration.
- Frontend: `types/pipelineStep.ts`, `state/stepNarrowing.ts`, new `ui/FillNullConfig.tsx` +
  co-located test, `StepCard.tsx`, `useStepCardState.ts`.
- MCP: `helio-mcp/src/tools/write.ts`.
- Tests: `InProcessPipelineEngineSpec.scala`, `PipelineStepSpec.scala`, analyze passthrough test,
  codec round-trip test, `FillNullConfig.test.tsx`.

## Non-goals

- Cross-partition forward-fill grouping (whole-batch order only).
- DAG/branching support — chains linearly like all existing ops.
