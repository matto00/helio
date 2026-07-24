# Files modified — HEL-375 pivot pipeline op

## Backend — domain step

- `backend/src/main/scala/com/helio/domain/steps/PivotStep.scala` — new. `PivotConfig(index, column, values, agg)`, tolerant `decode`, `PivotStep.evaluate`/`apply` (two-stage grouping + `<values>_<v>` column emission, collision-tolerant `indexMap ++ valueColumnsMap`), `companion` JSON codec.
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registered `PivotStep.Kind -> PivotStep.companion` in `Registry`; added `PipelineStepKind.Pivot`.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exported `PivotStep`/`PivotConfig` type + value aliases.

## Backend — wire protocol + persistence

- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — `PivotStepResponse` case class, `pivotConfigFormat` implicit, `jsonFormat6` formatter, `write`/`read` union arms, `PipelineStepResponse.fromDomain` arm.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — `encodeConfig`/`extractConfig` arms for `PivotConfig`/`PivotStep`.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — `rowToDomain` arm for `PivotConfig`.

## Backend — analyze

- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — `"pivot" -> inferPivot(...)` dispatch arm and `inferPivot` (index-only output schema with types looked up from `inputSchema`; existence-validation on `index`/`column`/`values`; identity fallback + real `validationError` only on genuine misconfiguration — never a spurious error for the unenumerable dynamic value columns).
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — `PivotAnalyzeStepResponse` (standard 6-field shape), formatter, `write`/`read` union arms.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — `toAnalyzeStepResponse` arm for `PivotConfig`.

## Backend — migration

- `backend/src/main/resources/db/migration/V65__add_pivot_op.sql` — new. Extends `pipeline_steps_op_check` to accept `'pivot'` (drop/re-add, following `V50`/`V64` pattern). Confirmed V65 was the next free VNN both before writing this file and again immediately before the delivery commit (origin/main max remained V64 throughout).

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `PivotConfig` wire interface, `PivotStep`/`PivotAnalyzeStep` interfaces, added to the `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` unions.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `OP_TYPES` entry (`faTableCells` icon), `defaultConfigFor` case, `pivotConfigOf` narrowing helper.
- `frontend/src/features/pipelines/ui/PivotConfig.tsx` — new. Index-field multi-select rows (add/remove, mirrors `AggregateConfig`'s `groupBy` rows), `column`/`values` single-field dropdowns, `agg` dropdown seeded with a local `PIVOT_AGG_FNS` constant (includes `first`, unlike `AggregateConfig.AGG_FNS`).
- `frontend/src/features/pipelines/ui/PivotConfig.test.tsx` — new. Covers empty-state rendering, index add/remove/change, column/values/agg selection, and `onChange` round-trip.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — render arm for the `pivot` step kind.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — `pivotConfig` state + `onPivotChange` handler, wired into the during-render sync block and the returned handler bag.

## MCP

- `helio-mcp/src/tools/write.ts` — added `pivot` to the `add_pipeline_step` tool description's type list and documented its `config` shape (`index`/`column`/`values`/`agg`) and the dynamic-value-column analyze caveat.

## Tests

- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — `makeStep` arm for `PivotConfig`; execution tests: basic sum pivot, count/avg/min/max/first aggs, null-column-value handling, unsupported-agg failure, index/value-column-name collision.
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — analyze tests: index-only output schema with no validation error, unknown index/column/values field errors, multi-index-field type lookup, malformed-config identity fallback.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — decode/encode round-trip, `decode({})` tolerance, inclusion in the all-kinds encode-round-trip table.
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — `pivot` added to `allSubtypes`, `PipelineStepKind.All` set, kind-string assertions, and the exhaustive pattern-match test.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — `PivotStepResponse` added to the discriminated-union round-trip `subtypes` table.
