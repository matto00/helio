## Why

There is no way to compute per-partition ordered analytics — rank, row_number, running total,
lag/lead — in a pipeline. These are needed for "rank within category", "cumulative total over
time", and top-N-per-group patterns (HEL-336 v1.6 op-expansion epic; last of the three High-
priority ops, after HEL-378 datebucket and HEL-375 pivot).

## What Changes

- New `window` pipeline op: config carries `partitionBy` (fields), `orderBy` (reuses `SortKey`),
  `function` (`row_number`/`rank`/`dense_rank`/`running_sum`/`lag`/`lead`), `field` (source column
  for `running_sum`/`lag`/`lead`), `outputColumn` (name), `offset` (for `lag`/`lead`, default 1).
- Rows are partitioned by `partitionBy`, ordered within each partition by `orderBy` (reusing
  `SortStep`'s comparator), then the function is computed and appended as `outputColumn`. Row
  count is preserved (schema-additive, unlike `pivot`).
- `analyze_pipeline` gains an `inferWindow` case: output schema = input schema +
  `outputColumn` with a type fixed per function (integer for rank family, number for
  `running_sum`, same-as-`field` for `lag`/`lead`) — statically knowable without sampling data,
  simpler than `pivot`'s data-dependent-arity inference.
- Flyway migration extends `pipeline_steps_op_check` to accept `'window'` (V66, confirmed
  against current main at proposal time — re-confirmed before the delivery push).
- Frontend: new `WindowConfig.tsx` StepCard editor (partitionBy multi-select, orderBy keys,
  function dropdown, field, outputColumn, offset) + wiring through `stepNarrowing.ts` and
  `pipelineStep.ts`.
- MCP `add_pipeline_step` tool description documents the `window` config shape (the `type` field
  is free-text, not an enum).

## Capabilities

### New Capabilities

- `pipeline-window-op`: the `window` op — partition + order + per-row derived-column analytics
  (rank/row_number/dense_rank/running_sum/lag/lead), plus its `analyze_pipeline` schema inference.

### Modified Capabilities

(none — `window` is purely additive; no existing capability's requirements change)

## Impact

- Backend: `WindowStep.scala` (new), `PipelineStep.scala`, `PipelineStepProtocol.scala`,
  `PipelineStepConfigCodec.scala`, `PipelineAnalyzeService.scala`, `PipelineAnalyzeProtocol.scala`,
  `domain/package.scala`, `PipelineStepRepository.scala`, `PipelineService.scala`, one Flyway
  migration.
- Frontend: `types/pipelineStep.ts`, `state/stepNarrowing.ts`, new `ui/WindowConfig.tsx` +
  co-located test, `StepCard.tsx`, `useStepCardState.ts`.
- MCP: `helio-mcp/src/tools/write.ts`.
- Tests: `InProcessPipelineEngineSpec.scala`, `PipelineAnalyzeServiceSpec.scala`,
  `PipelineStepConfigCodecSpec.scala`, `PipelineStepProtocolSpec.scala`, `PipelineStepSpec.scala`,
  `WindowConfig.test.tsx`.

## Non-goals

- SQL-window pushdown to the source DB — computed in-engine over loaded rows.
- DAG/branching — chains linearly, same as every other op.
